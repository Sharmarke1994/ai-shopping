import { z } from "zod";
import {
  type ConceptDefinition,
  conceptDefinitionSchema,
} from "./concept-definition";
import { getCurrencyMetadata } from "./currency-metadata";
import {
  CandidateIdentityNotAvailableError,
  CriterionCompatibilityError,
  ProvenanceValidationError,
} from "./errors";
import {
  criterionIdSchema,
  criterionLineageIdSchema,
  criterionSourceIdSchema,
  shoppingTaskIdSchema,
  taskInputIdSchema,
  userMessageIdSchema,
} from "./ids";
import {
  type SemanticValue,
  normalizeMeasurementAmount,
  semanticValueSchema,
  unitsShareDimension,
} from "./semantic-value";
import { shoppingTaskSchema, taskRevisionSchema } from "./task";

export const criterionAuthoritySchema = z.enum([
  "user_explicit",
  "user_confirmed",
]);
export const criterionStrengthSchema = z.enum([
  "hard",
  "strong_preference",
  "preference",
]);
export const targetSemanticsSchema = z.enum([
  "exact",
  "range",
  "around",
  "stretch",
  "categorical",
  "qualitative",
  "comparative",
  "indifferent",
]);
export const criterionLifecycleSchema = z.enum([
  "active",
  "superseded",
  "removed",
]);

export const decisionCriterionSchema = z
  .strictObject({
    id: criterionIdSchema,
    taskId: shoppingTaskIdSchema,
    lineageId: criterionLineageIdSchema,
    conceptId: conceptDefinitionSchema.shape.id,
    authority: criterionAuthoritySchema,
    strength: criterionStrengthSchema.nullable(),
    targetSemantics: targetSemanticsSchema,
    valueSchemaVersion: z.literal(1),
    valueKind: z.enum([
      "boolean",
      "qualitative",
      "measurement",
      "measurement_range",
      "money",
      "money_stretch",
      "categorical",
      "comparison",
      "indifferent",
    ]),
    semanticValue: semanticValueSchema,
    lifecycle: criterionLifecycleSchema,
    createdRevision: taskRevisionSchema,
    endedRevision: taskRevisionSchema.nullable(),
    supersededById: criterionIdSchema.nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .superRefine((criterion, context) => {
    if (criterion.valueKind !== criterion.semanticValue.kind) {
      context.addIssue({
        code: "custom",
        message: "valueKind must match semanticValue.kind",
        path: ["valueKind"],
      });
    }

    const isIndifferent = criterion.semanticValue.kind === "indifferent";
    const hasIndifferentDimensions =
      criterion.targetSemantics === "indifferent" &&
      criterion.strength === null;
    const hasOrdinaryDimensions =
      criterion.targetSemantics !== "indifferent" &&
      criterion.strength !== null;
    if (
      (isIndifferent && !hasIndifferentDimensions) ||
      (!isIndifferent && !hasOrdinaryDimensions)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Indifference requires an indifferent target/value and null strength",
      });
    }

    if (
      criterion.lifecycle === "active" &&
      (criterion.endedRevision !== null || criterion.supersededById !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "An active criterion cannot have an end or successor",
      });
    }

    if (
      criterion.lifecycle === "removed" &&
      (criterion.endedRevision === null || criterion.supersededById !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "A removed criterion requires an end and no successor",
      });
    }

    if (
      criterion.lifecycle === "superseded" &&
      (criterion.endedRevision === null ||
        criterion.supersededById === null ||
        criterion.supersededById === criterion.id)
    ) {
      context.addIssue({
        code: "custom",
        message: "A superseded criterion requires a different successor",
      });
    }

    if (
      criterion.endedRevision !== null &&
      criterion.endedRevision < criterion.createdRevision
    ) {
      context.addIssue({
        code: "custom",
        message: "A criterion cannot end before it was created",
        path: ["endedRevision"],
      });
    }

    if (criterion.updatedAt < criterion.createdAt) {
      context.addIssue({
        code: "custom",
        message: "Criterion updatedAt cannot precede createdAt",
      });
    }
  });

export type DecisionCriterion = z.infer<typeof decisionCriterionSchema>;

export const criterionSourceSchema = z
  .strictObject({
    id: criterionSourceIdSchema,
    taskId: shoppingTaskIdSchema,
    criterionId: criterionIdSchema,
    sourceRole: z.enum(["origin", "confirmation", "change"]),
    sourceKind: z.enum(["message", "question_answer", "direct_brief_action"]),
    taskInputId: taskInputIdSchema,
    messageId: userMessageIdSchema.nullable(),
    createdAt: z.date(),
  })
  .superRefine((source, context) => {
    if ((source.sourceKind === "message") !== (source.messageId !== null)) {
      context.addIssue({
        code: "custom",
        message: "Only message provenance requires a messageId",
        path: ["messageId"],
      });
    }
  });

export type CriterionSource = z.infer<typeof criterionSourceSchema>;

const familyKinds = {
  boolean: new Set<SemanticValue["kind"]>(["boolean", "indifferent"]),
  qualitative: new Set<SemanticValue["kind"]>([
    "qualitative",
    "comparison",
    "indifferent",
  ]),
  measurement: new Set<SemanticValue["kind"]>([
    "measurement",
    "measurement_range",
    "comparison",
    "indifferent",
  ]),
  money: new Set<SemanticValue["kind"]>([
    "money",
    "money_stretch",
    "indifferent",
  ]),
  categorical: new Set<SemanticValue["kind"]>(["categorical", "indifferent"]),
} as const;

function expectedTargetSemantics(value: SemanticValue) {
  switch (value.kind) {
    case "boolean":
      return new Set(["exact"]);
    case "qualitative":
      return new Set(["qualitative"]);
    case "measurement":
      return new Set(["exact", "around"]);
    case "measurement_range":
      return new Set(["range"]);
    case "money":
      return value.mode === "ceiling"
        ? new Set(["range"])
        : new Set(["exact", "around"]);
    case "money_stretch":
      return new Set(["stretch"]);
    case "categorical":
      return new Set(["categorical"]);
    case "comparison":
      return new Set(["comparative"]);
    case "indifferent":
      return new Set(["indifferent"]);
  }
}

export function parseDecisionCriterionForContext(input: {
  criterion: unknown;
  concept: unknown;
  task: unknown;
}) {
  const criterion = decisionCriterionSchema.parse(input.criterion);
  const concept = conceptDefinitionSchema.parse(input.concept);
  const task = shoppingTaskSchema.parse(input.task);

  if (criterion.taskId !== concept.taskId || criterion.taskId !== task.id) {
    throw new CriterionCompatibilityError(
      "market_scope",
      "Criterion, concept, and task must share one task identity",
    );
  }

  if (criterion.conceptId !== concept.id) {
    throw new CriterionCompatibilityError(
      "concept_family",
      "Criterion must reference the validated concept",
    );
  }

  if (!familyKinds[concept.valueFamily].has(criterion.semanticValue.kind)) {
    throw new CriterionCompatibilityError(
      "concept_family",
      `${criterion.semanticValue.kind} is incompatible with ${concept.valueFamily}`,
    );
  }

  if (
    !expectedTargetSemantics(criterion.semanticValue).has(
      criterion.targetSemantics,
    )
  ) {
    throw new CriterionCompatibilityError(
      "target_semantics",
      "Target semantics do not match the semantic value",
    );
  }

  if (
    criterion.semanticValue.kind === "categorical" &&
    criterion.semanticValue.operator === "prefer" &&
    criterion.strength === "hard"
  ) {
    throw new CriterionCompatibilityError(
      "categorical_strength",
      "A hard categorical rule uses include or exclude, not prefer",
    );
  }

  if (
    (criterion.semanticValue.kind === "money" ||
      criterion.semanticValue.kind === "money_stretch") &&
    criterion.semanticValue.currency !== task.market.currency
  ) {
    throw new CriterionCompatibilityError(
      "currency",
      "Money criteria must use the task currency",
    );
  }

  if (
    (criterion.semanticValue.kind === "money" ||
      criterion.semanticValue.kind === "money_stretch") &&
    getCurrencyMetadata(criterion.semanticValue.currency) === undefined
  ) {
    throw new CriterionCompatibilityError(
      "currency",
      `Currency ${criterion.semanticValue.currency} is not in the reviewed currency registry`,
    );
  }

  if (
    (criterion.semanticValue.kind === "measurement" ||
      criterion.semanticValue.kind === "measurement_range") &&
    (concept.canonicalUnit === null ||
      !unitsShareDimension(criterion.semanticValue.unit, concept.canonicalUnit))
  ) {
    throw new CriterionCompatibilityError(
      "unit_dimension",
      "Measurement criteria must match the concept unit dimension",
    );
  }

  if (
    criterion.semanticValue.kind === "comparison" &&
    criterion.semanticValue.reference.taskId !== task.id
  ) {
    throw new CriterionCompatibilityError(
      "reference_scope",
      "Comparison references must declare the same task",
    );
  }

  if (
    concept.canonicalUnit !== null &&
    criterion.semanticValue.kind === "measurement"
  ) {
    criterion.semanticValue = {
      ...criterion.semanticValue,
      amount: normalizeMeasurementAmount(
        criterion.semanticValue.amount,
        criterion.semanticValue.unit,
        concept.canonicalUnit,
      ),
      unit: concept.canonicalUnit,
    };
  }

  if (
    concept.canonicalUnit !== null &&
    criterion.semanticValue.kind === "measurement_range"
  ) {
    criterion.semanticValue = {
      ...criterion.semanticValue,
      ...(criterion.semanticValue.lower === undefined
        ? {}
        : {
            lower: {
              ...criterion.semanticValue.lower,
              amount: normalizeMeasurementAmount(
                criterion.semanticValue.lower.amount,
                criterion.semanticValue.unit,
                concept.canonicalUnit,
              ),
            },
          }),
      ...(criterion.semanticValue.upper === undefined
        ? {}
        : {
            upper: {
              ...criterion.semanticValue.upper,
              amount: normalizeMeasurementAmount(
                criterion.semanticValue.upper.amount,
                criterion.semanticValue.unit,
                concept.canonicalUnit,
              ),
            },
          }),
      unit: concept.canonicalUnit,
    };
  }

  return { criterion, concept, task };
}

export function assertCriterionPersistable(criterionInput: unknown) {
  const criterion = decisionCriterionSchema.parse(criterionInput);
  if (criterion.semanticValue.kind === "comparison") {
    throw new CandidateIdentityNotAvailableError();
  }
  return criterion;
}

export function validateCriterionSources(options: {
  criterion: unknown;
  sources: readonly unknown[];
}) {
  const criterion = decisionCriterionSchema.parse(options.criterion);
  const sources = options.sources.map((source) =>
    criterionSourceSchema.parse(source),
  );

  if (
    sources.some(
      (source) =>
        source.taskId !== criterion.taskId ||
        source.criterionId !== criterion.id,
    )
  ) {
    throw new ProvenanceValidationError(
      "Every source must belong to the criterion and its task",
    );
  }

  const roles = new Set(sources.map((source) => source.sourceRole));
  if (!roles.has("origin")) {
    throw new ProvenanceValidationError(
      "Every criterion needs an origin source",
    );
  }

  if (criterion.authority === "user_confirmed" && !roles.has("confirmation")) {
    throw new ProvenanceValidationError(
      "A user-confirmed criterion needs a confirmation source",
    );
  }

  return sources;
}

export function conceptForCriterion(
  concept: ConceptDefinition,
  criterion: DecisionCriterion,
) {
  return (
    concept.taskId === criterion.taskId && concept.id === criterion.conceptId
  );
}
