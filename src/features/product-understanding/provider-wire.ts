import { z } from "zod";
import {
  criterionAssessmentStatusSchema,
  evidenceSourceRoleSchema,
  productObservationValueV1Schema,
} from "./contracts";

export const PRODUCT_UNDERSTANDING_PROVIDER_SCHEMA_VERSION = 1 as const;

const localRefSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

export const evidenceSourceInputSchema = z.strictObject({
  ordinal: z.number().int().min(0).max(19),
  role: evidenceSourceRoleSchema,
  kind: z.enum([
    "listing_field",
    "organic_result",
    "fetched_page",
    "listing_image",
  ]),
  title: z.string().min(1).max(500),
  url: z.url().max(4_000),
  excerpt: z.string().min(1).max(1_000).nullable(),
});

export const criterionInputSchema = z.strictObject({
  ordinal: z.number().int().min(0).max(49),
  label: z.string().min(1).max(200),
  definition: z.string().min(1).max(500),
  strength: z.enum(["hard", "strong_preference", "preference"]),
  targetSemantics: z.enum([
    "exact",
    "range",
    "around",
    "stretch",
    "categorical",
    "qualitative",
    "comparative",
  ]),
  value: z.record(z.string(), z.unknown()),
});

export const productUnderstandingInputV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  market: z.strictObject({
    country: z.literal("GB"),
    language: z.literal("en-GB"),
    currency: z.literal("GBP"),
  }),
  candidate: z.strictObject({
    title: z.string().min(1).max(1_000),
    merchant: z.string().min(1).max(500).nullable(),
    observedPriceText: z.string().min(1).max(120).nullable(),
  }),
  criteria: z.array(criterionInputSchema).max(50),
  sources: z.array(evidenceSourceInputSchema).min(1).max(20),
});

const proposedObservationSchema = z.strictObject({
  localRef: localRefSchema,
  sourceOrdinal: z.number().int().min(0).max(19),
  criterionOrdinal: z.number().int().min(0).max(49).nullable(),
  support: z.enum(["supported", "ambiguous"]),
  observationKind: z.enum(["source_assertion", "visual_inference"]),
  propertyLabel: z.string().min(1).max(120),
  claim: z.string().min(1).max(500),
  value: productObservationValueV1Schema,
  derivation: z.enum(["model_text", "model_visual"]),
});

const proposedAssessmentSchema = z.strictObject({
  criterionOrdinal: z.number().int().min(0).max(49),
  status: criterionAssessmentStatusSchema,
  relation: z.string().min(1).max(120),
  explanation: z.string().min(1).max(500),
  observationRefs: z.array(localRefSchema).max(20),
});

type ProviderWireRelations = Readonly<{
  observations: readonly z.infer<typeof proposedObservationSchema>[];
  assessments: readonly z.infer<typeof proposedAssessmentSchema>[];
}>;

function validateProviderWireRelations(
  value: ProviderWireRelations,
  context: z.RefinementCtx,
) {
  const refs = new Set<string>();
  const criterionByRef = new Map<string, number | null>();
  for (const [index, observation] of value.observations.entries()) {
    if (refs.has(observation.localRef)) {
      context.addIssue({
        code: "custom",
        path: ["observations", index, "localRef"],
        message: "Observation references must be unique",
        params: { rule: "observation_local_ref_duplicate" },
      });
    }
    refs.add(observation.localRef);
    criterionByRef.set(observation.localRef, observation.criterionOrdinal);
  }
  const assessed = new Set<number>();
  for (const [index, assessment] of value.assessments.entries()) {
    if (assessed.has(assessment.criterionOrdinal)) {
      context.addIssue({
        code: "custom",
        path: ["assessments", index, "criterionOrdinal"],
        message: "Each criterion may be assessed only once",
        params: {
          rule: "assessment_criterion_duplicate",
          criterionOrdinal: assessment.criterionOrdinal,
        },
      });
    }
    assessed.add(assessment.criterionOrdinal);
    for (const ref of assessment.observationRefs) {
      if (!refs.has(ref)) {
        context.addIssue({
          code: "custom",
          path: ["assessments", index, "observationRefs"],
          message: "Assessments may reference only emitted observations",
          params: { rule: "assessment_observation_ref_missing" },
        });
      } else if (criterionByRef.get(ref) !== assessment.criterionOrdinal) {
        context.addIssue({
          code: "custom",
          path: ["assessments", index, "observationRefs"],
          message:
            "Assessments may reference only observations emitted for the same criterion",
          params: { rule: "assessment_observation_ref_criterion_mismatch" },
        });
      }
    }
  }
}

export const productUnderstandingProviderWireV1Schema = z
  .strictObject({
    providerSchemaVersion: z.literal(
      PRODUCT_UNDERSTANDING_PROVIDER_SCHEMA_VERSION,
    ),
    observations: z.array(proposedObservationSchema).max(50),
    assessments: z.array(proposedAssessmentSchema).max(50),
  })
  .superRefine(validateProviderWireRelations);

/**
 * Builds the schema supplied to the model provider for one server-owned call.
 * Focused calls structurally require criterion binding and expose only the
 * exact local ordinal enum present in that input. The application still runs
 * productUnderstandingProviderWireV1SchemaForInput afterwards as a separate
 * authority check.
 */
export function productUnderstandingProviderStructuredOutputSchema(options: {
  input: z.infer<typeof productUnderstandingInputV1Schema>;
  requireCriterionBinding: boolean;
}) {
  const criterionOrdinals = options.input.criteria.map(
    ({ ordinal }) => ordinal,
  );
  if (options.requireCriterionBinding && criterionOrdinals.length === 0) {
    throw new Error("Focused product understanding requires a criterion");
  }
  if (new Set(criterionOrdinals).size !== criterionOrdinals.length) {
    throw new Error("Focused product-understanding ordinals must be unique");
  }
  const sourceOrdinals = options.input.sources.map(({ ordinal }) => ordinal);
  if (new Set(sourceOrdinals).size !== sourceOrdinals.length) {
    throw new Error("Product-understanding source ordinals must be unique");
  }
  const sourceOrdinalSchema = z.literal(
    sourceOrdinals as [number, ...number[]],
  );
  const criterionOrdinalSchema =
    criterionOrdinals.length === 0
      ? null
      : z.literal(criterionOrdinals as [number, ...number[]]);
  const boundObservationSchema = proposedObservationSchema.extend({
    sourceOrdinal: sourceOrdinalSchema,
    criterionOrdinal: options.requireCriterionBinding
      ? criterionOrdinalSchema!
      : criterionOrdinalSchema === null
        ? z.null()
        : z.union([z.null(), criterionOrdinalSchema]),
  });
  const boundAssessmentSchema =
    criterionOrdinalSchema === null
      ? null
      : proposedAssessmentSchema.extend({
          criterionOrdinal: criterionOrdinalSchema,
        });

  return z
    .strictObject({
      providerSchemaVersion: z.literal(
        PRODUCT_UNDERSTANDING_PROVIDER_SCHEMA_VERSION,
      ),
      observations: z.array(boundObservationSchema).max(50),
      assessments:
        boundAssessmentSchema === null
          ? z.tuple([])
          : z.array(boundAssessmentSchema).length(criterionOrdinals.length),
    })
    .superRefine(validateProviderWireRelations);
}

/**
 * Binds provider-local criterion ordinals to the exact server-owned criterion
 * subset sent in a particular model call. Focused calls additionally forbid
 * criterion-free observations so they cannot introduce unrelated concepts.
 */
export function productUnderstandingProviderWireV1SchemaForInput(options: {
  input: z.infer<typeof productUnderstandingInputV1Schema>;
  requireCriterionBinding: boolean;
}) {
  const criterionOrdinals = new Set(
    options.input.criteria.map(({ ordinal }) => ordinal),
  );
  const sourceOrdinals = new Set(
    options.input.sources.map(({ ordinal }) => ordinal),
  );
  const sourceKindByOrdinal = new Map(
    options.input.sources.map(({ ordinal, kind }) => [ordinal, kind]),
  );
  return productUnderstandingProviderWireV1Schema.superRefine(
    (value, context) => {
      for (const [index, observation] of value.observations.entries()) {
        if (!sourceOrdinals.has(observation.sourceOrdinal)) {
          context.addIssue({
            code: "custom",
            path: ["observations", index, "sourceOrdinal"],
            message:
              "Observation source ordinal is outside the authoritative source subset",
            params: {
              rule: "observation_source_ordinal_out_of_scope",
              sourceOrdinal: observation.sourceOrdinal,
            },
          });
        }
        const sourceKind = sourceKindByOrdinal.get(observation.sourceOrdinal);
        if (
          sourceKind !== undefined &&
          (observation.derivation === "model_visual") !==
            (sourceKind === "listing_image")
        ) {
          context.addIssue({
            code: "custom",
            path: ["observations", index, "derivation"],
            message:
              "Observation derivation must match the authoritative evidence source kind",
            params: {
              rule: "observation_evidence_binding_invalid",
              sourceOrdinal: observation.sourceOrdinal,
            },
          });
        }
        if (
          observation.criterionOrdinal === null &&
          options.requireCriterionBinding
        ) {
          context.addIssue({
            code: "custom",
            path: ["observations", index, "criterionOrdinal"],
            message:
              "Focused observations must bind to a criterion in the authoritative target subset",
            params: { rule: "focused_observation_criterion_missing" },
          });
        } else if (
          observation.criterionOrdinal !== null &&
          !criterionOrdinals.has(observation.criterionOrdinal)
        ) {
          context.addIssue({
            code: "custom",
            path: ["observations", index, "criterionOrdinal"],
            message:
              "Observation criterion ordinal is outside the authoritative target subset",
            params: {
              rule: "observation_criterion_ordinal_out_of_scope",
              criterionOrdinal: observation.criterionOrdinal,
            },
          });
        }
      }
      for (const [index, assessment] of value.assessments.entries()) {
        if (!criterionOrdinals.has(assessment.criterionOrdinal)) {
          context.addIssue({
            code: "custom",
            path: ["assessments", index, "criterionOrdinal"],
            message:
              "Assessment criterion ordinal is outside the authoritative target subset",
            params: {
              rule: "assessment_criterion_ordinal_out_of_scope",
              criterionOrdinal: assessment.criterionOrdinal,
            },
          });
        }
      }
      const assessedOrdinals = new Set(
        value.assessments.map(({ criterionOrdinal }) => criterionOrdinal),
      );
      for (const criterionOrdinal of criterionOrdinals) {
        if (!assessedOrdinals.has(criterionOrdinal)) {
          context.addIssue({
            code: "custom",
            path: ["assessments"],
            message:
              "Every authoritative target criterion must have one assessment",
            params: {
              rule: "assessment_criterion_missing",
              criterionOrdinal,
            },
          });
        }
      }
    },
  );
}

export type ProductUnderstandingInputV1 = z.infer<
  typeof productUnderstandingInputV1Schema
>;
export type ProductUnderstandingProviderWireV1 = z.infer<
  typeof productUnderstandingProviderWireV1Schema
>;
