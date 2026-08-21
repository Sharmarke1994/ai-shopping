import { z } from "zod";
import { briefItemV1Schema } from "@/domain/shopping-state/brief";
import { conceptValueFamilySchema } from "@/domain/shopping-state/concept-definition";
import {
  criterionAuthoritySchema,
  criterionStrengthSchema,
  targetSemanticsSchema,
} from "@/domain/shopping-state/decision-criterion";
import {
  conceptDefinitionIdSchema,
  contextActionIdSchema,
  contextQuestionOptionIdSchema,
  criterionIdSchema,
  shoppingTaskIdSchema,
  taskInputIdSchema,
} from "@/domain/shopping-state/ids";
import { marketContextSchema } from "@/domain/shopping-state/market-context";
import {
  measurementUnitSchema,
  semanticValueSchema,
} from "@/domain/shopping-state/semantic-value";
import { taskRevisionSchema } from "@/domain/shopping-state/task";
import {
  contextActionProposalV1Schema,
  type ContextActionProposalV1,
} from "./provider-wire";

export const CONTEXT_ACQUISITION_REQUEST_SCHEMA_VERSION = 1 as const;

const exactShopperTextSchema = z
  .string()
  .min(1)
  .max(10_000)
  .refine((value) => value.trim().length > 0, "Expected shopper text");

export const resolvedShoppingInputV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("message"),
    body: exactShopperTextSchema,
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("legacy_question_answer"),
    questionId: z.string().min(1).max(160),
    optionId: z.string().min(1).max(160),
    answerText: exactShopperTextSchema,
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("question_answer"),
    questionId: contextActionIdSchema,
    prompt: z.string().min(1).max(500),
    answer: z.discriminatedUnion("mode", [
      z.strictObject({
        mode: z.literal("open_text"),
        text: exactShopperTextSchema,
      }),
      z.strictObject({
        mode: z.literal("single_select"),
        optionId: contextQuestionOptionIdSchema,
        label: z.string().min(1).max(160),
      }),
    ]),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("direct_brief_action"),
    controlId: z.string().min(1).max(160),
    submittedText: exactShopperTextSchema,
  }),
]);

export type ResolvedShoppingInputV1 = z.infer<
  typeof resolvedShoppingInputV1Schema
>;

export const conceptContextV1Schema = z.strictObject({
  id: conceptDefinitionIdSchema,
  label: z.string().min(1).max(120),
  definition: z.string().min(1).max(500),
  valueFamily: conceptValueFamilySchema,
  canonicalUnit: measurementUnitSchema.nullable(),
});

export const criterionContextV1Schema = z.strictObject({
  id: criterionIdSchema,
  conceptId: conceptDefinitionIdSchema,
  authority: criterionAuthoritySchema,
  strength: criterionStrengthSchema.nullable(),
  targetSemantics: targetSemanticsSchema,
  semanticValue: semanticValueSchema,
});

const authoritativeSnapshotFields = {
  taskId: shoppingTaskIdSchema,
  revision: taskRevisionSchema,
  market: marketContextSchema,
  source: resolvedShoppingInputV1Schema,
  concepts: z.array(conceptContextV1Schema).max(500).readonly(),
  activeCriteria: z.array(criterionContextV1Schema).max(500).readonly(),
};

export const interpretShoppingInputRequestV1Schema = z.strictObject({
  schemaVersion: z.literal(CONTEXT_ACQUISITION_REQUEST_SCHEMA_VERSION),
  sourceInputId: taskInputIdSchema,
  ...authoritativeSnapshotFields,
});

export type InterpretShoppingInputRequestV1 = z.infer<
  typeof interpretShoppingInputRequestV1Schema
>;

export const contextCapabilitiesV1Schema = z.strictObject({
  canSearch: z.boolean(),
  canShowRefine: z.boolean(),
});

export const selectContextActionRequestV1Schema = z.strictObject({
  schemaVersion: z.literal(CONTEXT_ACQUISITION_REQUEST_SCHEMA_VERSION),
  sourceInputId: taskInputIdSchema,
  ...authoritativeSnapshotFields,
  brief: z.strictObject({
    schemaVersion: z.literal(1),
    items: z.array(briefItemV1Schema).max(500).readonly(),
  }),
  capabilities: contextCapabilitiesV1Schema,
});

export type SelectContextActionRequestV1 = z.infer<
  typeof selectContextActionRequestV1Schema
>;

export class UnsupportedContextActionError extends Error {
  constructor(readonly action: ContextActionProposalV1["action"]) {
    super(`Context action ${action} is not available in this capability set`);
    this.name = "UnsupportedContextActionError";
  }
}

export function validateContextActionCapabilities(options: {
  proposal: unknown;
  capabilities: unknown;
}) {
  const proposal = contextActionProposalV1Schema.parse(options.proposal);
  const capabilities = contextCapabilitiesV1Schema.parse(options.capabilities);
  if (
    (proposal.action === "search" && !capabilities.canSearch) ||
    (proposal.action === "show_refine" && !capabilities.canShowRefine) ||
    (proposal.action === "ask" &&
      proposal.question.canSearchWithoutAnswer &&
      !capabilities.canSearch)
  ) {
    throw new UnsupportedContextActionError(proposal.action);
  }
  return proposal;
}
