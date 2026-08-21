import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { PersistedDataCorruptionError } from "../../../domain/shopping-state/errors";
import {
  contextActionIdSchema,
  contextQuestionOptionIdSchema,
  shoppingTaskIdSchema,
  stateChangeApplicationIdSchema,
} from "../../../domain/shopping-state/ids";
import { taskRevisionSchema } from "../../../domain/shopping-state/task";
import type {
  ShoppingDatabase,
  ShoppingTransaction,
} from "../../../infrastructure/database/clients";
import {
  contextActions,
  contextQuestionOptions,
  shoppingTasks,
  stateChangeApplications,
} from "../../../infrastructure/database/schema";
import {
  CONTEXT_ACTION_PROVIDER_SCHEMA_VERSION,
  contextActionProposalV1Schema,
} from "../provider-wire";
import { loadValidatedStateApplicationBySourceInputInTransaction } from "../../shopping-state/persistence/state-transitions";

const boundedText = z
  .string()
  .min(1)
  .max(500)
  .refine((value) => value.trim().length > 0, "Expected non-whitespace text");
const shortText = z
  .string()
  .min(1)
  .max(160)
  .refine((value) => value.trim().length > 0, "Expected non-whitespace text");
const configText = z.string().min(1).max(120);

const persistedOptionSchema = z.strictObject({
  id: contextQuestionOptionIdSchema,
  ordinal: z.number().int().nonnegative(),
  label: shortText,
});

const persistedContextActionBase = {
  id: contextActionIdSchema,
  taskId: shoppingTaskIdSchema,
  stateChangeApplicationId: stateChangeApplicationIdSchema,
  selectedAtRevision: taskRevisionSchema,
  schemaVersion: z.literal(1),
  provider: configText,
  model: z.string().min(1).max(160),
  promptVersion: configText,
  providerSchemaVersion: z.literal(CONTEXT_ACTION_PROVIDER_SCHEMA_VERSION),
  createdAt: z.date(),
};

export const persistedContextActionSchema = z.discriminatedUnion("action", [
  z.strictObject({
    ...persistedContextActionBase,
    action: z.literal("ask"),
    question: z.strictObject({
      promptSchemaVersion: z.literal(1),
      prompt: boundedText,
      responseMode: z.enum(["open_text", "single_select"]),
      options: z.array(persistedOptionSchema).max(4),
      expectedImpact: z.enum(["retrieval", "eligibility", "judgement"]),
      whyNow: boundedText,
      canSearchWithoutAnswer: z.boolean(),
    }),
  }),
  z.strictObject({
    ...persistedContextActionBase,
    action: z.literal("search"),
    rationale: boundedText,
  }),
  z.strictObject({
    ...persistedContextActionBase,
    action: z.literal("show_refine"),
    rationale: boundedText,
  }),
]);

export type PersistedContextAction = z.infer<
  typeof persistedContextActionSchema
>;

export class ContextActionReceiptError extends Error {
  constructor(readonly applicationId: string) {
    super(
      `State application ${applicationId} is not an available validated patch receipt`,
    );
    this.name = "ContextActionReceiptError";
  }
}

export class StaleContextActionSelectionError extends Error {
  constructor(
    readonly taskId: string,
    readonly selectedAtRevision: bigint,
    readonly currentRevision: bigint,
  ) {
    super(
      `Context action snapshot ${selectedAtRevision} is stale for task ${taskId} at revision ${currentRevision}`,
    );
    this.name = "StaleContextActionSelectionError";
  }
}

function validateQuestionShape(action: PersistedContextAction) {
  if (action.action !== "ask") return action;
  const { options, responseMode } = action.question;
  if (
    (responseMode === "open_text" && options.length !== 0) ||
    (responseMode === "single_select" &&
      (options.length < 2 || options.length > 4)) ||
    options.some((option, index) => option.ordinal !== index) ||
    new Set(options.map((option) => option.label.toLowerCase())).size !==
      options.length
  ) {
    throw new Error("Persisted question options are incoherent");
  }
  return action;
}

async function mapContextAction(
  tx: ShoppingTransaction,
  row: typeof contextActions.$inferSelect,
): Promise<PersistedContextAction> {
  try {
    const [task] = await tx
      .select({ currentRevision: shoppingTasks.currentRevision })
      .from(shoppingTasks)
      .where(eq(shoppingTasks.id, row.taskId))
      .limit(1);
    if (task === undefined || row.selectedAtRevision > task.currentRevision) {
      throw new Error("Context action names an impossible task revision");
    }
    await validatePatchReceiptInTransaction({
      tx,
      taskId: shoppingTaskIdSchema.parse(row.taskId),
      applicationId: stateChangeApplicationIdSchema.parse(
        row.stateChangeApplicationId,
      ),
    });
    const options = await tx
      .select()
      .from(contextQuestionOptions)
      .where(
        and(
          eq(contextQuestionOptions.taskId, row.taskId),
          eq(contextQuestionOptions.contextActionId, row.id),
        ),
      )
      .orderBy(asc(contextQuestionOptions.ordinal));
    const base = {
      id: row.id,
      taskId: row.taskId,
      stateChangeApplicationId: row.stateChangeApplicationId,
      selectedAtRevision: row.selectedAtRevision,
      schemaVersion: row.actionSchemaVersion,
      provider: row.provider,
      model: row.model,
      promptVersion: row.promptVersion,
      providerSchemaVersion: row.providerSchemaVersion,
      createdAt: row.createdAt,
    };
    if (row.actionKind === "ask") {
      if (
        row.promptSchemaVersion === null ||
        row.questionPrompt === null ||
        row.responseMode === null ||
        row.expectedImpact === null ||
        row.whyNow === null ||
        row.canSearchWithoutAnswer === null ||
        row.rationale !== null
      ) {
        throw new Error("Persisted ASK branch is incomplete");
      }
      return validateQuestionShape(
        persistedContextActionSchema.parse({
          ...base,
          action: "ask",
          question: {
            promptSchemaVersion: row.promptSchemaVersion,
            prompt: row.questionPrompt,
            responseMode: row.responseMode,
            options: options.map((option) => ({
              id: option.id,
              ordinal: option.ordinal,
              label: option.label,
            })),
            expectedImpact: row.expectedImpact,
            whyNow: row.whyNow,
            canSearchWithoutAnswer: row.canSearchWithoutAnswer,
          },
        }),
      );
    }
    if (
      row.rationale === null ||
      row.promptSchemaVersion !== null ||
      row.questionPrompt !== null ||
      row.responseMode !== null ||
      row.expectedImpact !== null ||
      row.whyNow !== null ||
      row.canSearchWithoutAnswer !== null ||
      options.length !== 0
    ) {
      throw new Error("Persisted non-ASK branch is incoherent");
    }
    return persistedContextActionSchema.parse({
      ...base,
      action: row.actionKind,
      rationale: row.rationale,
    });
  } catch (cause) {
    if (cause instanceof PersistedDataCorruptionError) throw cause;
    throw new PersistedDataCorruptionError({
      recordType: "ContextAction",
      recordId: row.id,
      cause,
    });
  }
}

async function loadByApplication(
  tx: ShoppingTransaction,
  taskId: string,
  applicationId: string,
) {
  const [row] = await tx
    .select()
    .from(contextActions)
    .where(
      and(
        eq(contextActions.taskId, taskId),
        eq(contextActions.stateChangeApplicationId, applicationId),
      ),
    )
    .limit(1);
  return row === undefined ? null : mapContextAction(tx, row);
}

export async function loadContextActionByApplication(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  stateChangeApplicationId: unknown;
}) {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const applicationId = stateChangeApplicationIdSchema.parse(
    options.stateChangeApplicationId,
  );
  return options.db.transaction(async (tx) => {
    await validatePatchReceiptInTransaction({
      tx,
      taskId,
      applicationId,
    });
    return loadByApplication(tx, taskId, applicationId);
  });
}

async function validatePatchReceiptInTransaction(options: {
  tx: ShoppingTransaction;
  taskId: ReturnType<typeof shoppingTaskIdSchema.parse>;
  applicationId: ReturnType<typeof stateChangeApplicationIdSchema.parse>;
}) {
  const [row] = await options.tx
    .select({
      id: stateChangeApplications.id,
      sourceTaskInputId: stateChangeApplications.sourceTaskInputId,
      applicationKind: stateChangeApplications.applicationKind,
    })
    .from(stateChangeApplications)
    .where(
      and(
        eq(stateChangeApplications.taskId, options.taskId),
        eq(stateChangeApplications.id, options.applicationId),
      ),
    )
    .limit(1);
  if (row === undefined || row.applicationKind !== "patch") {
    throw new ContextActionReceiptError(options.applicationId);
  }
  const validated =
    await loadValidatedStateApplicationBySourceInputInTransaction(
      options.tx,
      options.taskId,
      row.sourceTaskInputId,
    );
  if (
    validated === null ||
    validated.application.id !== options.applicationId ||
    validated.application.applicationKind !== "patch"
  ) {
    throw new ContextActionReceiptError(options.applicationId);
  }
  return validated.application;
}

const persistenceConfigSchema = z.strictObject({
  provider: configText,
  model: z.string().min(1).max(160),
  promptVersion: configText,
  providerSchemaVersion: z.literal(CONTEXT_ACTION_PROVIDER_SCHEMA_VERSION),
});

export async function persistContextAction(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  stateChangeApplicationId: unknown;
  selectedAtRevision: unknown;
  proposal: unknown;
  config: unknown;
}): Promise<{ created: boolean; action: PersistedContextAction }> {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const applicationId = stateChangeApplicationIdSchema.parse(
    options.stateChangeApplicationId,
  );
  const selectedAtRevision = taskRevisionSchema.parse(
    options.selectedAtRevision,
  );
  const proposal = contextActionProposalV1Schema.parse(options.proposal);
  const config = persistenceConfigSchema.parse(options.config);
  return options.db.transaction(async (tx) => {
    await validatePatchReceiptInTransaction({ tx, taskId, applicationId });
    const existing = await loadByApplication(tx, taskId, applicationId);
    if (existing !== null) return { created: false, action: existing };

    const [task] = await tx
      .select({ currentRevision: shoppingTasks.currentRevision })
      .from(shoppingTasks)
      .where(eq(shoppingTasks.id, taskId))
      .for("update")
      .limit(1);
    if (task === undefined) throw new Error(`Shopping task ${taskId} missing`);

    const winner = await loadByApplication(tx, taskId, applicationId);
    if (winner !== null) return { created: false, action: winner };
    if (task.currentRevision !== selectedAtRevision) {
      throw new StaleContextActionSelectionError(
        taskId,
        selectedAtRevision,
        task.currentRevision,
      );
    }

    const actionId = contextActionIdSchema.parse(randomUUID());
    const isAsk = proposal.action === "ask";
    const [inserted] = await tx
      .insert(contextActions)
      .values({
        id: actionId,
        taskId,
        stateChangeApplicationId: applicationId,
        selectedAtRevision,
        actionSchemaVersion: proposal.schemaVersion,
        actionKind: proposal.action,
        promptSchemaVersion: isAsk ? 1 : null,
        questionPrompt: isAsk ? proposal.question.prompt : null,
        responseMode: isAsk ? proposal.question.responseMode : null,
        expectedImpact: isAsk ? proposal.question.expectedImpact : null,
        whyNow: isAsk ? proposal.question.whyNow : null,
        canSearchWithoutAnswer: isAsk
          ? proposal.question.canSearchWithoutAnswer
          : null,
        rationale: isAsk ? null : proposal.rationale.summary,
        provider: config.provider,
        model: config.model,
        promptVersion: config.promptVersion,
        providerSchemaVersion: config.providerSchemaVersion,
      })
      .returning();
    if (inserted === undefined) {
      throw new Error("Context action insert returned no row");
    }

    if (isAsk && proposal.question.options.length > 0) {
      await tx.insert(contextQuestionOptions).values(
        proposal.question.options.map((label, ordinal) => ({
          id: contextQuestionOptionIdSchema.parse(randomUUID()),
          taskId,
          contextActionId: actionId,
          ordinal,
          label,
        })),
      );
    }
    return {
      created: true,
      action: await mapContextAction(tx, inserted),
    };
  });
}

export async function loadContextActionByIdInTransaction(options: {
  tx: ShoppingTransaction;
  taskId: string;
  contextActionId: string;
  forUpdate?: boolean;
}) {
  const query = options.tx
    .select()
    .from(contextActions)
    .where(
      and(
        eq(contextActions.taskId, options.taskId),
        eq(contextActions.id, options.contextActionId),
      ),
    )
    .limit(1);
  const rows = options.forUpdate ? await query.for("update") : await query;
  return rows[0] === undefined ? null : mapContextAction(options.tx, rows[0]);
}
