import { randomUUID } from "node:crypto";
import {
  PersistedDataCorruptionError,
  StaleTaskRevisionError,
  StateApplicationIdempotencyConflictError,
} from "@/domain/shopping-state/errors";
import {
  shoppingTaskIdSchema,
  taskInputIdSchema,
} from "@/domain/shopping-state/ids";
import type { StateApplicationResult } from "@/features/shopping-state/persistence/state-transitions";
import {
  applyStatePatch,
  loadValidatedStateApplicationBySourceInput,
} from "@/features/shopping-state/persistence/state-transitions";
import { loadCurrentShoppingState } from "@/features/shopping-state/persistence/state-loaders";
import type { ShoppingDatabase } from "@/infrastructure/database/clients";
import type {
  ContextAcquisitionModel,
  ModelCallMetadata,
  ModelCallResult,
} from "./model-port";
import {
  lowerContextActionProviderWireV1,
  lowerInterpretationProviderWireV1,
  type ContextActionProviderWireV1,
  type InterpretationProviderWireV1,
} from "./provider-wire";
import {
  ContextAcquisitionInputTooLargeError,
  projectContextActionProviderInputV1,
  projectInterpretationProviderInputV1,
} from "./provider-input";
import {
  buildContextActionRequestV1,
  buildInterpretationRequestV1,
} from "./request-builders";
import { recordContextAcquisitionAttempt } from "./persistence/attempts";
import {
  loadContextActionByApplication,
  persistContextAction,
  StaleContextActionSelectionError,
  type PersistedContextAction,
} from "./persistence/context-actions";
import { resolveStoredShoppingInput } from "./persistence/resolved-input";
import { validateContextActionCapabilities } from "./contracts";
import {
  CONTEXT_ACTION_PROMPT_VERSION,
  INTERPRETATION_PROMPT_VERSION,
} from "./prompts";

export type ContextAcquisitionResult =
  | Readonly<{
      status: "completed";
      stateApplication: StateApplicationResult;
      action: PersistedContextAction;
    }>
  | Readonly<{
      status: "failed";
      stage: "interpretation" | "context_action";
      errorCode: string;
    }>;

const localFailureMetadata = (
  promptVersion: string,
  schemaVersion: number,
): ModelCallMetadata => ({
  provider: "local",
  model: "not_called",
  promptVersion,
  providerSchemaVersion: schemaVersion,
  providerRequestId: null,
  durationMs: 0,
  inputTokens: null,
  outputTokens: null,
});

export async function acquireShoppingContext(options: {
  db: ShoppingDatabase;
  model: ContextAcquisitionModel;
  taskId: unknown;
  sourceInputId: unknown;
  maximumProviderInputBytes?: number;
  capabilities?: { canSearch: boolean; canShowRefine: boolean };
}): Promise<ContextAcquisitionResult> {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const sourceInputId = taskInputIdSchema.parse(options.sourceInputId);
  const orchestrationRunId = randomUUID();
  const source = await resolveStoredShoppingInput({
    db: options.db,
    taskId,
    inputId: sourceInputId,
  });

  let application = await loadValidatedStateApplicationBySourceInput(
    options.db,
    taskId,
    sourceInputId,
  );

  if (application === null) {
    const interpretation = await interpretAndApply({
      ...options,
      taskId,
      sourceInputId,
      source,
      orchestrationRunId,
    });
    if (interpretation.status === "failed") return interpretation;
    application = interpretation.stateApplication;
  }

  const existingAction = await loadContextActionByApplication({
    db: options.db,
    taskId,
    stateChangeApplicationId: application.application.id,
  });
  if (existingAction !== null) {
    return {
      status: "completed",
      stateApplication: application,
      action: existingAction,
    };
  }

  const actionResult = await selectAndPersistAction({
    ...options,
    taskId,
    sourceInputId,
    source,
    application,
    orchestrationRunId,
  });
  if (actionResult.status === "failed") return actionResult;
  return {
    status: "completed",
    stateApplication: application,
    action: actionResult.action,
  };
}

async function interpretAndApply(options: {
  db: ShoppingDatabase;
  model: ContextAcquisitionModel;
  taskId: ReturnType<typeof shoppingTaskIdSchema.parse>;
  sourceInputId: ReturnType<typeof taskInputIdSchema.parse>;
  source: Awaited<ReturnType<typeof resolveStoredShoppingInput>>;
  orchestrationRunId: string;
  maximumProviderInputBytes?: number;
}): Promise<
  | { status: "completed"; stateApplication: StateApplicationResult }
  | Extract<ContextAcquisitionResult, { status: "failed" }>
> {
  for (let attemptOrdinal = 1; attemptOrdinal <= 2; attemptOrdinal += 1) {
    const state = await loadCurrentShoppingState(options.db, options.taskId);
    let projected;
    try {
      projected = projectInterpretationProviderInputV1(
        buildInterpretationRequestV1({
          state,
          sourceInputId: options.sourceInputId,
          source: options.source,
        }),
        options.maximumProviderInputBytes,
      );
    } catch (error) {
      if (!(error instanceof ContextAcquisitionInputTooLargeError)) throw error;
      await recordFailureAttempt({
        ...options,
        stage: "interpretation",
        attemptOrdinal,
        snapshotRevision: state.task.currentRevision,
        status: "input_too_large",
        errorCode: error.code,
        metadata: localFailureMetadata(INTERPRETATION_PROMPT_VERSION, 1),
      });
      return {
        status: "failed",
        stage: "interpretation",
        errorCode: error.code,
      };
    }

    const modelResult = await options.model.interpret(projected);
    if (modelResult.status !== "completed") {
      await recordModelFailure(
        options,
        "interpretation",
        attemptOrdinal,
        state.task.currentRevision,
        modelResult,
      );
      return {
        status: "failed",
        stage: "interpretation",
        errorCode: modelResult.errorCode,
      };
    }

    let proposal;
    try {
      proposal = lowerInterpretationProviderWireV1(modelResult.value);
    } catch {
      await recordFailureAttempt({
        ...options,
        stage: "interpretation",
        attemptOrdinal,
        snapshotRevision: state.task.currentRevision,
        status: "malformed",
        errorCode: "provider_lowering_failed",
        metadata: modelResult.metadata,
        interpretationProposal: modelResult.value,
      });
      return {
        status: "failed",
        stage: "interpretation",
        errorCode: "provider_lowering_failed",
      };
    }

    try {
      const applied = await applyStatePatch(options.db, {
        applicationSchemaVersion: 1,
        applicationKind: "patch",
        taskId: options.taskId,
        expectedRevision: state.task.currentRevision,
        source: { kind: "user_explicit", inputId: options.sourceInputId },
        patch: proposal.patch,
      });
      await recordContextAcquisitionAttempt({
        db: options.db,
        attempt: attemptRecord({
          ...options,
          stage: "interpretation",
          attemptOrdinal,
          snapshotRevision: state.task.currentRevision,
          status: "completed",
          metadata: modelResult.metadata,
          interpretationProposal: modelResult.value,
          stateChangeApplicationId: applied.application.id,
        }),
      });
      return { status: "completed", stateApplication: applied };
    } catch (error) {
      if (error instanceof PersistedDataCorruptionError) throw error;
      if (error instanceof StateApplicationIdempotencyConflictError) {
        const winner = await loadValidatedStateApplicationBySourceInput(
          options.db,
          options.taskId,
          options.sourceInputId,
        );
        if (winner === null) throw error;
        await recordFailureAttempt({
          ...options,
          stage: "interpretation",
          attemptOrdinal,
          snapshotRevision: state.task.currentRevision,
          status: "superseded_by_winner",
          errorCode: "concurrent_application_won",
          metadata: modelResult.metadata,
          interpretationProposal: modelResult.value,
          stateChangeApplicationId: winner.application.id,
        });
        return { status: "completed", stateApplication: winner };
      }
      if (error instanceof StaleTaskRevisionError && attemptOrdinal === 1) {
        await recordFailureAttempt({
          ...options,
          stage: "interpretation",
          attemptOrdinal,
          snapshotRevision: state.task.currentRevision,
          status: "stale",
          errorCode: "stale_interpretation_retrying",
          metadata: modelResult.metadata,
          interpretationProposal: modelResult.value,
        });
        continue;
      }
      await recordFailureAttempt({
        ...options,
        stage: "interpretation",
        attemptOrdinal,
        snapshotRevision: state.task.currentRevision,
        status:
          error instanceof StaleTaskRevisionError ? "stale" : "invalid_patch",
        errorCode:
          error instanceof StaleTaskRevisionError
            ? "stale_interpretation_exhausted"
            : "invalid_state_patch",
        metadata: modelResult.metadata,
        interpretationProposal: modelResult.value,
      });
      return {
        status: "failed",
        stage: "interpretation",
        errorCode:
          error instanceof StaleTaskRevisionError
            ? "stale_interpretation_exhausted"
            : "invalid_state_patch",
      };
    }
  }
  return {
    status: "failed",
    stage: "interpretation",
    errorCode: "retry_exhausted",
  };
}

async function selectAndPersistAction(options: {
  db: ShoppingDatabase;
  model: ContextAcquisitionModel;
  taskId: ReturnType<typeof shoppingTaskIdSchema.parse>;
  sourceInputId: ReturnType<typeof taskInputIdSchema.parse>;
  source: Awaited<ReturnType<typeof resolveStoredShoppingInput>>;
  application: StateApplicationResult;
  orchestrationRunId: string;
  maximumProviderInputBytes?: number;
  capabilities?: { canSearch: boolean; canShowRefine: boolean };
}): Promise<
  | { status: "completed"; action: PersistedContextAction }
  | Extract<ContextAcquisitionResult, { status: "failed" }>
> {
  for (let attemptOrdinal = 1; attemptOrdinal <= 2; attemptOrdinal += 1) {
    const state = await loadCurrentShoppingState(options.db, options.taskId);
    const capabilities = options.capabilities ?? {
      canSearch: true,
      canShowRefine: false,
    };
    let projected;
    try {
      projected = projectContextActionProviderInputV1(
        buildContextActionRequestV1({
          state,
          sourceInputId: options.sourceInputId,
          source: options.source,
          capabilities,
        }),
        options.maximumProviderInputBytes,
      );
    } catch (error) {
      if (!(error instanceof ContextAcquisitionInputTooLargeError)) throw error;
      await recordFailureAttempt({
        ...options,
        stage: "context_action",
        attemptOrdinal,
        snapshotRevision: state.task.currentRevision,
        status: "input_too_large",
        errorCode: error.code,
        metadata: localFailureMetadata(CONTEXT_ACTION_PROMPT_VERSION, 1),
      });
      return {
        status: "failed",
        stage: "context_action",
        errorCode: error.code,
      };
    }
    const modelResult = await options.model.selectAction(projected);
    if (modelResult.status !== "completed") {
      await recordModelFailure(
        options,
        "context_action",
        attemptOrdinal,
        state.task.currentRevision,
        modelResult,
      );
      return {
        status: "failed",
        stage: "context_action",
        errorCode: modelResult.errorCode,
      };
    }
    let proposal;
    try {
      proposal = validateContextActionCapabilities({
        proposal: lowerContextActionProviderWireV1(modelResult.value),
        capabilities,
      });
    } catch {
      await recordFailureAttempt({
        ...options,
        stage: "context_action",
        attemptOrdinal,
        snapshotRevision: state.task.currentRevision,
        status: "malformed",
        errorCode: "provider_lowering_failed",
        metadata: modelResult.metadata,
        contextActionProposal: modelResult.value,
      });
      return {
        status: "failed",
        stage: "context_action",
        errorCode: "provider_lowering_failed",
      };
    }
    try {
      const persisted = await persistContextAction({
        db: options.db,
        taskId: options.taskId,
        stateChangeApplicationId: options.application.application.id,
        selectedAtRevision: state.task.currentRevision,
        proposal,
        config: {
          provider: modelResult.metadata.provider,
          model: modelResult.metadata.model,
          promptVersion: modelResult.metadata.promptVersion,
          providerSchemaVersion: modelResult.metadata.providerSchemaVersion,
        },
      });
      await recordContextAcquisitionAttempt({
        db: options.db,
        attempt: attemptRecord({
          ...options,
          stage: "context_action",
          attemptOrdinal,
          snapshotRevision: state.task.currentRevision,
          status: "completed",
          metadata: modelResult.metadata,
          contextActionProposal: modelResult.value,
          contextActionId: persisted.action.id,
        }),
      });
      return { status: "completed", action: persisted.action };
    } catch (error) {
      if (error instanceof PersistedDataCorruptionError) throw error;
      if (
        error instanceof StaleContextActionSelectionError &&
        attemptOrdinal === 1
      ) {
        await recordFailureAttempt({
          ...options,
          stage: "context_action",
          attemptOrdinal,
          snapshotRevision: state.task.currentRevision,
          status: "stale",
          errorCode: "stale_action_retrying",
          metadata: modelResult.metadata,
          contextActionProposal: modelResult.value,
        });
        continue;
      }
      if (error instanceof StaleContextActionSelectionError) {
        await recordFailureAttempt({
          ...options,
          stage: "context_action",
          attemptOrdinal,
          snapshotRevision: state.task.currentRevision,
          status: "stale",
          errorCode: "stale_action_exhausted",
          metadata: modelResult.metadata,
          contextActionProposal: modelResult.value,
        });
        return {
          status: "failed",
          stage: "context_action",
          errorCode: "stale_action_exhausted",
        };
      }
      throw error;
    }
  }
  return {
    status: "failed",
    stage: "context_action",
    errorCode: "retry_exhausted",
  };
}

async function recordModelFailure<T>(
  options: {
    db: ShoppingDatabase;
    taskId: string;
    sourceInputId: string;
    orchestrationRunId: string;
  },
  stage: "interpretation" | "context_action",
  attemptOrdinal: number,
  snapshotRevision: bigint,
  result: Exclude<ModelCallResult<T>, { status: "completed" }>,
) {
  await recordFailureAttempt({
    ...options,
    stage,
    attemptOrdinal,
    snapshotRevision,
    status: result.status,
    errorCode: result.errorCode,
    metadata: result.metadata,
  });
}

async function recordFailureAttempt(
  options: Parameters<typeof attemptRecord>[0],
) {
  await recordContextAcquisitionAttempt({
    db: options.db,
    attempt: attemptRecord(options),
  });
}

function attemptRecord(options: {
  db: ShoppingDatabase;
  orchestrationRunId: string;
  taskId: string;
  sourceInputId: string;
  stage: "interpretation" | "context_action";
  attemptOrdinal: number;
  snapshotRevision: bigint;
  status:
    | "completed"
    | "refused"
    | "incomplete"
    | "malformed"
    | "timed_out"
    | "provider_failed"
    | "input_too_large"
    | "invalid_patch"
    | "stale"
    | "superseded_by_winner";
  errorCode?: string;
  metadata: ModelCallMetadata;
  interpretationProposal?: InterpretationProviderWireV1;
  contextActionProposal?: ContextActionProviderWireV1;
  stateChangeApplicationId?: string;
  contextActionId?: string;
}) {
  return {
    orchestrationRunId: options.orchestrationRunId,
    taskId: options.taskId,
    sourceTaskInputId: options.sourceInputId,
    snapshotRevision: options.snapshotRevision,
    stage: options.stage,
    attemptOrdinal: options.attemptOrdinal,
    status: options.status,
    metadata: options.metadata,
    interpretationProposal: options.interpretationProposal ?? null,
    contextActionProposal: options.contextActionProposal ?? null,
    errorCode: options.errorCode ?? null,
    stateChangeApplicationId: options.stateChangeApplicationId ?? null,
    contextActionId: options.contextActionId ?? null,
  };
}
