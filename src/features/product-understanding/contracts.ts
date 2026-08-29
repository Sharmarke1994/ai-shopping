import { z } from "zod";
import {
  candidateListingIdSchema,
  conceptDefinitionIdSchema,
  criterionIdSchema,
  shoppingTaskIdSchema,
} from "@/domain/shopping-state/ids";
import { currencyCodeSchema } from "@/domain/shopping-state/market-context";
import { decimalStringSchema } from "@/domain/shopping-state/semantic-value";
import { taskRevisionSchema } from "@/domain/shopping-state/task";
import {
  httpUrlSchema,
  searchRunIdSchema,
} from "@/features/retrieval-spike/contracts";

export const evidenceResearchRunIdSchema = z
  .uuid()
  .brand<"EvidenceResearchRunId">();
export const evidenceAcquisitionAttemptIdSchema = z
  .uuid()
  .brand<"EvidenceAcquisitionAttemptId">();
export const evidenceSourceIdSchema = z.uuid().brand<"EvidenceSourceId">();
export const productObservationIdSchema = z
  .uuid()
  .brand<"ProductObservationId">();
export const criterionAssessmentIdSchema = z
  .uuid()
  .brand<"CriterionAssessmentId">();

export const evidenceSourceRoleSchema = z.enum([
  "listing",
  "retailer",
  "manufacturer",
  "independent_review",
  "retailer_review_aggregate",
  "visual",
  "other",
]);

export const observationQuantityUnitSchema = z.enum([
  "mm",
  "cm",
  "m",
  "g",
  "kg",
  "hours",
  "days",
  "months",
  "years",
]);

const observationBooleanValueSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("boolean"),
  value: z.boolean(),
});

const observationMoneyValueSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("money"),
  amountMinor: z.number().int().nonnegative().safe(),
  currency: currencyCodeSchema,
});

const observationQuantityValueSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("quantity"),
  amount: decimalStringSchema,
  unit: observationQuantityUnitSchema,
  qualifier: z.enum(["exact", "up_to", "approximately", "at_least"]),
});

const observationRatingAggregateValueSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("rating_aggregate"),
  ratingHundredths: z.number().int().min(0).max(500),
  scaleHundredths: z.literal(500),
  reviewCount: z.number().int().positive(),
});

const observationCategoricalValueSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("categorical"),
  values: z.array(z.string().trim().min(1).max(120)).min(1).max(12),
});

const observationTextValueSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("text"),
  text: z.string().trim().min(1).max(500),
});

export const productObservationValueV1Schema = z.union([
  observationBooleanValueSchema,
  observationMoneyValueSchema,
  observationQuantityValueSchema,
  observationRatingAggregateValueSchema,
  observationCategoricalValueSchema,
  observationTextValueSchema,
]);

export const evidenceSourceV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  id: evidenceSourceIdSchema,
  researchRunId: evidenceResearchRunIdSchema,
  taskId: shoppingTaskIdSchema,
  candidateRunId: searchRunIdSchema,
  candidateListingId: candidateListingIdSchema,
  acquisitionAttemptId: evidenceAcquisitionAttemptIdSchema.nullable(),
  sourceRole: evidenceSourceRoleSchema,
  sourceKind: z.enum([
    "listing_field",
    "organic_result",
    "fetched_page",
    "listing_image",
  ]),
  sourceUrl: httpUrlSchema,
  sourceTitle: z.string().trim().min(1).max(500),
  excerpt: z.string().trim().min(1).max(1_000).nullable(),
  provider: z.enum(["listing", "serper", "page_fetch", "fixture"]),
  providerResultId: z.string().trim().min(1).max(500).nullable(),
  observedAt: z.date(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});

export const productObservationV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  id: productObservationIdSchema,
  researchRunId: evidenceResearchRunIdSchema,
  taskId: shoppingTaskIdSchema,
  candidateRunId: searchRunIdSchema,
  candidateListingId: candidateListingIdSchema,
  evidenceSourceId: evidenceSourceIdSchema,
  conceptId: conceptDefinitionIdSchema.nullable(),
  support: z.enum(["supported", "ambiguous"]),
  observationKind: z.enum([
    "structured_field",
    "source_assertion",
    "visual_inference",
  ]),
  propertyLabel: z.string().trim().min(1).max(120),
  claim: z.string().trim().min(1).max(500),
  value: productObservationValueV1Schema,
  derivation: z.enum(["deterministic", "model_text", "model_visual"]),
  model: z.string().trim().min(1).max(160).nullable(),
  promptVersion: z.string().trim().min(1).max(120).nullable(),
  observedAt: z.date(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});

export const criterionAssessmentStatusSchema = z.enum([
  "meets",
  "conflicts",
  "uncertain",
  "not_applicable",
]);

export const criterionAssessmentV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  id: criterionAssessmentIdSchema,
  researchRunId: evidenceResearchRunIdSchema,
  taskId: shoppingTaskIdSchema,
  taskRevision: taskRevisionSchema,
  candidateRunId: searchRunIdSchema,
  candidateListingId: candidateListingIdSchema,
  criterionId: criterionIdSchema,
  generation: z.number().int().positive().default(1),
  supersedesAssessmentId: criterionAssessmentIdSchema.nullable().default(null),
  supersededAt: z.date().nullable().default(null),
  status: criterionAssessmentStatusSchema,
  relation: z.string().trim().min(1).max(120),
  explanation: z.string().trim().min(1).max(500),
  method: z.enum(["deterministic", "model", "guarded_model"]),
  model: z.string().trim().min(1).max(160).nullable(),
  promptVersion: z.string().trim().min(1).max(120).nullable(),
  observationIds: z.array(productObservationIdSchema).max(50),
  createdAt: z.date(),
});

export type EvidenceSourceV1 = z.infer<typeof evidenceSourceV1Schema>;
export type ProductObservationValueV1 = z.infer<
  typeof productObservationValueV1Schema
>;
export type ProductObservationV1 = z.infer<typeof productObservationV1Schema>;
export type CriterionAssessmentV1 = z.infer<typeof criterionAssessmentV1Schema>;
