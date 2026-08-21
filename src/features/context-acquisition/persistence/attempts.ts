import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  contextActionIdSchema,
  shoppingTaskIdSchema,
  stateChangeApplicationIdSchema,
  taskInputIdSchema,
} from "@/domain/shopping-state/ids";
import { taskRevisionSchema } from "@/domain/shopping-state/task";
import type { ShoppingDatabaseExecutor } from "@/infrastructure/database/clients";
import { contextAcquisitionAttempts } from "@/infrastructure/database/schema";
import {
  contextActionProviderWireV1Schema,
  interpretationProviderWireV1Schema,
} from "../provider-wire";

const attemptStatusSchema = z.enum([
  "completed",
  "refused",
  "incomplete",
  "malformed",
  "timed_out",
  "provider_failed",
  "input_too_large",
  "invalid_patch",
  "stale",
  "superseded_by_winner",
]);

const modelMetadataSchema = z.strictObject({
  provider: z.string().min(1).max(120).nullable(),
  model: z.string().min(1).max(160).nullable(),
  promptVersion: z.string().min(1).max(120),
  providerSchemaVersion: z.number().int().positive(),
  providerRequestId: z.string().min(1).max(240).nullable(),
  durationMs: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
});

export const contextAcquisitionAttemptInputSchema = z
  .strictObject({
    id: z.uuid().optional(),
    orchestrationRunId: z.uuid(),
    taskId: shoppingTaskIdSchema,
    sourceTaskInputId: taskInputIdSchema,
    snapshotRevision: taskRevisionSchema,
    stage: z.enum(["interpretation", "context_action"]),
    attemptOrdinal: z.number().int().positive(),
    status: attemptStatusSchema,
    metadata: modelMetadataSchema,
    interpretationProposal: interpretationProviderWireV1Schema.nullable(),
    contextActionProposal: contextActionProviderWireV1Schema.nullable(),
    errorCode: z
      .string()
      .regex(/^[a-z0-9_:-]{1,120}$/)
      .nullable(),
    stateChangeApplicationId: stateChangeApplicationIdSchema.nullable(),
    contextActionId: contextActionIdSchema.nullable(),
  })
  .superRefine((attempt, context) => {
    if (
      (attempt.status === "completed" && attempt.errorCode !== null) ||
      (attempt.status !== "completed" && attempt.errorCode === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["errorCode"],
        message: "Only failed terminal attempts require an error code",
      });
    }
    if (
      attempt.stage === "interpretation" &&
      attempt.contextActionProposal !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["contextActionProposal"],
        message: "An interpretation attempt cannot contain an action proposal",
      });
    }
    if (
      attempt.stage === "context_action" &&
      attempt.interpretationProposal !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["interpretationProposal"],
        message: "An action attempt cannot contain an interpretation proposal",
      });
    }
    if (
      attempt.status === "completed" &&
      ((attempt.stage === "interpretation" &&
        (attempt.interpretationProposal === null ||
          attempt.stateChangeApplicationId === null)) ||
        (attempt.stage === "context_action" &&
          (attempt.contextActionProposal === null ||
            attempt.contextActionId === null)))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A completed attempt requires its validated proposal and result",
      });
    }
    if (
      attempt.status === "completed" &&
      ((attempt.stage === "interpretation" &&
        attempt.contextActionId !== null) ||
        (attempt.stage === "context_action" &&
          attempt.stateChangeApplicationId !== null))
    ) {
      context.addIssue({
        code: "custom",
        message: "Completed attempt results must match their stage",
      });
    }
  });

export type ContextAcquisitionAttemptInput = z.infer<
  typeof contextAcquisitionAttemptInputSchema
>;

export async function recordContextAcquisitionAttempt(options: {
  db: ShoppingDatabaseExecutor;
  attempt: unknown;
}) {
  const attempt = contextAcquisitionAttemptInputSchema.parse(options.attempt);
  const [row] = await options.db
    .insert(contextAcquisitionAttempts)
    .values({
      id: attempt.id ?? randomUUID(),
      orchestrationRunId: attempt.orchestrationRunId,
      taskId: attempt.taskId,
      sourceTaskInputId: attempt.sourceTaskInputId,
      snapshotRevision: attempt.snapshotRevision,
      stage: attempt.stage,
      attemptOrdinal: attempt.attemptOrdinal,
      status: attempt.status,
      provider: attempt.metadata.provider,
      model: attempt.metadata.model,
      promptVersion: attempt.metadata.promptVersion,
      providerSchemaVersion: attempt.metadata.providerSchemaVersion,
      providerRequestId: attempt.metadata.providerRequestId,
      durationMs: attempt.metadata.durationMs,
      inputTokens: attempt.metadata.inputTokens,
      outputTokens: attempt.metadata.outputTokens,
      interpretationProposal: attempt.interpretationProposal,
      contextActionProposal: attempt.contextActionProposal,
      errorCode: attempt.errorCode,
      stateChangeApplicationId: attempt.stateChangeApplicationId,
      contextActionId: attempt.contextActionId,
    })
    .returning({ id: contextAcquisitionAttempts.id });

  if (row === undefined) throw new Error("Attempt insert returned no row");
  return row.id;
}
