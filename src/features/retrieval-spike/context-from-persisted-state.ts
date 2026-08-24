import { and, eq } from "drizzle-orm";
import { projectShoppingBrief } from "@/domain/shopping-state/brief";
import { PersistedDataCorruptionError } from "@/domain/shopping-state/errors";
import {
  contextActionIdSchema,
  shoppingTaskIdSchema,
  stateChangeApplicationIdSchema,
  taskInputIdSchema,
} from "@/domain/shopping-state/ids";
import {
  currentShoppingStateSchema,
  type CurrentShoppingState,
} from "@/domain/shopping-state/shopping-state";
import { loadContextActionByIdInTransaction } from "@/features/context-acquisition/persistence/context-actions";
import { loadCurrentShoppingState } from "@/features/shopping-state/persistence/state-loaders";
import { loadValidatedStateApplicationBySourceInputInTransaction } from "@/features/shopping-state/persistence/state-transitions";
import type { ShoppingDatabase } from "@/infrastructure/database/clients";
import { stateChangeApplications } from "@/infrastructure/database/schema";
import { retrievalContextV1Schema, type RetrievalContextV1 } from "./contracts";
import {
  loadShoppingSubjectInTransaction,
  ShoppingSubjectNotFoundError,
  type PersistedShoppingSubject,
} from "./persistence/shopping-subjects";

export type PersistedRetrievalContextEnvelopeV1 = Readonly<{
  contextActionId: ReturnType<typeof contextActionIdSchema.parse>;
  stateApplicationId: ReturnType<typeof stateChangeApplicationIdSchema.parse>;
  triggerInputId: ReturnType<typeof taskInputIdSchema.parse>;
  context: RetrievalContextV1;
}>;

export class RetrievalContextActionNotFoundError extends Error {
  constructor(readonly contextActionId: string) {
    super(`Retrieval context action ${contextActionId} was not found`);
    this.name = "RetrievalContextActionNotFoundError";
  }
}

export class RetrievalActionNotSearchError extends Error {
  constructor(readonly action: "ask" | "show_refine") {
    super(`Retrieval requires a persisted SEARCH action, received ${action}`);
    this.name = "RetrievalActionNotSearchError";
  }
}

export class StaleRetrievalSearchActionError extends Error {
  constructor(
    readonly selectedAtRevision: bigint,
    readonly currentRevision: bigint,
  ) {
    super(
      `SEARCH selected at revision ${selectedAtRevision} is stale at revision ${currentRevision}`,
    );
    this.name = "StaleRetrievalSearchActionError";
  }
}

function corrupt(contextActionId: string, message: string): never {
  throw new PersistedDataCorruptionError({
    recordType: "RetrievalAuthoritySnapshot",
    recordId: contextActionId,
    cause: new Error(message),
  });
}

function buildRetrievalContextFromCurrentState(options: {
  state: CurrentShoppingState;
  subject: PersistedShoppingSubject;
  marketVocabulary?: unknown;
}): RetrievalContextV1 {
  const state = currentShoppingStateSchema.parse(options.state);
  if (options.subject.taskId !== state.task.id) {
    return corrupt(
      options.subject.taskId,
      "Shopping subject and state belong to different tasks",
    );
  }
  const brief = projectShoppingBrief(state);

  return retrievalContextV1Schema.parse({
    schemaVersion: 1,
    taskId: state.task.id,
    revision: state.task.currentRevision,
    market: state.task.market,
    shoppingSubject: {
      text: options.subject.body,
      sourceInputId: options.subject.sourceInputId,
    },
    brief,
    marketVocabulary: options.marketVocabulary ?? [],
  });
}

/**
 * Loads one coherent authority snapshot. The immutable task subject identifies
 * what is being shopped for; the SEARCH action's state application identifies
 * which later shopper turn triggered this retrieval.
 */
export async function loadRetrievalContextFromPersistedState(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  contextActionId: unknown;
  marketVocabulary?: unknown;
}): Promise<PersistedRetrievalContextEnvelopeV1> {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const contextActionId = contextActionIdSchema.parse(options.contextActionId);

  return options.db.transaction(
    async (tx) => {
      const action = await loadContextActionByIdInTransaction({
        tx,
        taskId,
        contextActionId,
      });
      if (action === null) {
        throw new RetrievalContextActionNotFoundError(contextActionId);
      }
      if (action.action !== "search") {
        throw new RetrievalActionNotSearchError(action.action);
      }

      const [applicationRow] = await tx
        .select({
          id: stateChangeApplications.id,
          sourceTaskInputId: stateChangeApplications.sourceTaskInputId,
        })
        .from(stateChangeApplications)
        .where(
          and(
            eq(stateChangeApplications.taskId, taskId),
            eq(stateChangeApplications.id, action.stateChangeApplicationId),
          ),
        )
        .limit(1);
      if (applicationRow === undefined) {
        return corrupt(
          contextActionId,
          "SEARCH action has no same-task state application",
        );
      }
      const triggerInputId = taskInputIdSchema.parse(
        applicationRow.sourceTaskInputId,
      );
      const application =
        await loadValidatedStateApplicationBySourceInputInTransaction(
          tx,
          taskId,
          triggerInputId,
        );
      if (
        application === null ||
        application.application.id !== action.stateChangeApplicationId ||
        application.application.resultingRevision > action.selectedAtRevision
      ) {
        return corrupt(
          contextActionId,
          "SEARCH action, trigger input, and state application are incoherent",
        );
      }

      const state = await loadCurrentShoppingState(tx, taskId);
      if (action.selectedAtRevision !== state.task.currentRevision) {
        throw new StaleRetrievalSearchActionError(
          action.selectedAtRevision,
          state.task.currentRevision,
        );
      }
      const subject = await loadShoppingSubjectInTransaction({ tx, taskId });
      if (subject === null) throw new ShoppingSubjectNotFoundError(taskId);

      return {
        contextActionId,
        stateApplicationId: stateChangeApplicationIdSchema.parse(
          application.application.id,
        ),
        triggerInputId,
        context: buildRetrievalContextFromCurrentState({
          state,
          subject,
          ...(options.marketVocabulary === undefined
            ? {}
            : { marketVocabulary: options.marketVocabulary }),
        }),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
