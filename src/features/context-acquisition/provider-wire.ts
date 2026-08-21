import { z } from "zod";
import { conceptValueFamilySchema } from "@/domain/shopping-state/concept-definition";
import {
  criterionIdSchema,
  conceptDefinitionIdSchema,
} from "@/domain/shopping-state/ids";
import { currencyCodeSchema } from "@/domain/shopping-state/market-context";
import {
  decimalStringSchema,
  measurementUnitSchema,
} from "@/domain/shopping-state/semantic-value";
import {
  type StatePatchProposalV1,
  statePatchProposalV1Schema,
} from "@/domain/shopping-state/state-patch";
import {
  criterionStrengthSchema,
  targetSemanticsSchema,
} from "@/domain/shopping-state/decision-criterion";

export const INTERPRETATION_PROVIDER_SCHEMA_VERSION = 1 as const;
export const INTERPRETATION_PROPOSAL_SCHEMA_VERSION = 1 as const;
export const CONTEXT_ACTION_PROVIDER_SCHEMA_VERSION = 1 as const;
export const CONTEXT_ACTION_PROPOSAL_SCHEMA_VERSION = 1 as const;

const providerBoundedTextSchema = z
  .string()
  .min(1)
  .max(500)
  .refine((value) => value.trim().length > 0, "Expected non-whitespace text");
const providerShortTextSchema = z
  .string()
  .min(1)
  .max(120)
  .refine((value) => value.trim().length > 0, "Expected non-whitespace text");
const providerLocalRefSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z][a-z0-9_]*$/);

const providerMeasurementBoundWireV1Schema = z.strictObject({
  amount: decimalStringSchema,
  inclusive: z.boolean(),
});

const providerBooleanValueWireV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("boolean"),
  value: z.boolean(),
});

const providerQualitativeTextValueWireV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("qualitative_text"),
  text: providerBoundedTextSchema,
});

const providerQualitativeOrdinalValueWireV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("qualitative_ordinal"),
  relation: z.enum(["more", "less", "at_least", "at_most"]),
  anchor: providerBoundedTextSchema,
});

const providerMeasurementValueWireV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("measurement"),
  amount: decimalStringSchema,
  unit: measurementUnitSchema,
});

const providerMeasurementRangeValueWireV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("measurement_range"),
    lower: providerMeasurementBoundWireV1Schema.nullable(),
    upper: providerMeasurementBoundWireV1Schema.nullable(),
    unit: measurementUnitSchema,
  })
  .superRefine((value, context) => {
    if (value.lower === null && value.upper === null) {
      context.addIssue({
        code: "custom",
        message: "A measurement range needs at least one bound",
      });
      return;
    }
    if (
      value.lower !== null &&
      value.upper !== null &&
      compareNonNegativeDecimals(value.lower.amount, value.upper.amount) > 0
    ) {
      context.addIssue({
        code: "custom",
        message: "The lower measurement bound cannot exceed the upper bound",
      });
    }
  });

const providerMoneyValueWireV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("money"),
  mode: z.enum(["target", "ceiling"]),
  amountMinor: z.number().int().nonnegative().safe(),
  currency: currencyCodeSchema,
});

const providerMoneyStretchValueWireV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("money_stretch"),
    targetMinor: z.number().int().nonnegative().safe(),
    stretchCeilingMinor: z.number().int().nonnegative().safe(),
    currency: currencyCodeSchema,
    condition: providerBoundedTextSchema,
  })
  .superRefine((value, context) => {
    if (value.stretchCeilingMinor <= value.targetMinor) {
      context.addIssue({
        code: "custom",
        message: "A stretch ceiling must be greater than its target",
      });
    }
  });

const providerCategoricalValueWireV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("categorical"),
    operator: z.enum(["include", "prefer", "exclude"]),
    values: z.array(providerShortTextSchema).min(1).max(50),
  })
  .superRefine((value, context) => {
    const caseFolded = value.values.map((entry) => entry.toLowerCase());
    if (new Set(caseFolded).size !== caseFolded.length) {
      context.addIssue({
        code: "custom",
        message: "Categorical values must be unique ignoring case",
      });
    }
  });

const providerSemanticValueWireV1Schema = z.union([
  providerBooleanValueWireV1Schema,
  providerQualitativeTextValueWireV1Schema,
  providerQualitativeOrdinalValueWireV1Schema,
  providerMeasurementValueWireV1Schema,
  providerMeasurementRangeValueWireV1Schema,
  providerMoneyValueWireV1Schema,
  providerMoneyStretchValueWireV1Schema,
  providerCategoricalValueWireV1Schema,
]);

const providerTargetWireV1Schema = z
  .strictObject({
    strength: criterionStrengthSchema,
    targetSemantics: targetSemanticsSchema.exclude([
      "comparative",
      "indifferent",
    ]),
    semanticValue: providerSemanticValueWireV1Schema,
  })
  .superRefine((target, context) => {
    const validTargetSemantics = expectedTargetSemantics(target.semanticValue);
    if (!validTargetSemantics.has(target.targetSemantics)) {
      context.addIssue({
        code: "custom",
        path: ["targetSemantics"],
        message: `${target.semanticValue.kind} is incompatible with ${target.targetSemantics}`,
      });
    }
  });

const providerConceptRefWireV1Schema = z.union([
  z.strictObject({
    kind: z.literal("existing"),
    conceptId: conceptDefinitionIdSchema,
  }),
  z.strictObject({
    kind: z.literal("created"),
    localRef: providerLocalRefSchema,
  }),
]);

const providerCreateConceptOperationWireV1Schema = z
  .strictObject({
    op: z.literal("create_concept"),
    localRef: providerLocalRefSchema,
    label: providerShortTextSchema,
    definition: providerBoundedTextSchema,
    valueFamily: conceptValueFamilySchema,
    canonicalUnit: measurementUnitSchema.nullable(),
  })
  .superRefine((operation, context) => {
    if (
      (operation.valueFamily === "measurement") !==
      (operation.canonicalUnit !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["canonicalUnit"],
        message: "Only measurement concepts require a canonical unit",
      });
    }
  });

const providerPatchOperationWireV1Schema = z.union([
  providerCreateConceptOperationWireV1Schema,
  z.strictObject({
    op: z.literal("add_criterion"),
    concept: providerConceptRefWireV1Schema,
    target: providerTargetWireV1Schema,
  }),
  z.strictObject({
    op: z.literal("replace_target"),
    targetCriterionId: criterionIdSchema,
    result: providerTargetWireV1Schema,
  }),
  z.strictObject({
    op: z.literal("relax"),
    targetCriterionId: criterionIdSchema,
    result: providerTargetWireV1Schema,
  }),
  z.strictObject({
    op: z.literal("tighten"),
    targetCriterionId: criterionIdSchema,
    result: providerTargetWireV1Schema,
  }),
  z.strictObject({
    op: z.literal("remove"),
    targetCriterionId: criterionIdSchema,
  }),
  z.strictObject({
    op: z.literal("mark_indifferent"),
    concept: providerConceptRefWireV1Schema,
    replacesCriterionIds: z.array(criterionIdSchema).max(100),
  }),
]);

const providerAmbiguityWireV1Schema = z.strictObject({
  kind: z.enum([
    "unclear_reference",
    "unclear_strength",
    "unclear_value",
    "possible_conflict",
  ]),
  summary: providerBoundedTextSchema,
  existingConceptId: conceptDefinitionIdSchema.nullable(),
  affectedCriterionIds: z.array(criterionIdSchema).max(100),
});

export const interpretationProviderWireV1Schema = z
  .strictObject({
    providerSchemaVersion: z.literal(INTERPRETATION_PROVIDER_SCHEMA_VERSION),
    outcome: z.enum(["change", "no_change"]),
    operations: z.array(providerPatchOperationWireV1Schema).max(32),
    ambiguities: z.array(providerAmbiguityWireV1Schema).max(4),
  })
  .superRefine((wire, context) => {
    if (wire.outcome === "change" && wire.operations.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["operations"],
        message: "A change outcome requires at least one operation",
      });
    }
    if (wire.outcome === "no_change" && wire.operations.length !== 0) {
      context.addIssue({
        code: "custom",
        path: ["operations"],
        message: "A no_change outcome requires an empty operations array",
      });
    }
  });

export type InterpretationProviderWireV1 = z.infer<
  typeof interpretationProviderWireV1Schema
>;

export const interpretationAmbiguityV1Schema = providerAmbiguityWireV1Schema;
export type InterpretationAmbiguityV1 = z.infer<
  typeof interpretationAmbiguityV1Schema
>;

export const interpretationProposalV1Schema = z.strictObject({
  schemaVersion: z.literal(INTERPRETATION_PROPOSAL_SCHEMA_VERSION),
  patch: statePatchProposalV1Schema,
  ambiguities: z.array(interpretationAmbiguityV1Schema).max(4),
});

export type InterpretationProposalV1 = z.infer<
  typeof interpretationProposalV1Schema
>;

const providerQuestionWireV1Schema = z
  .strictObject({
    prompt: providerBoundedTextSchema,
    responseMode: z.enum(["open_text", "single_select"]),
    options: z.array(providerShortTextSchema).max(4),
    expectedImpact: z.enum(["retrieval", "eligibility", "judgement"]),
    whyNow: providerBoundedTextSchema,
    canSearchWithoutAnswer: z.boolean(),
  })
  .superRefine((question, context) => {
    if (
      question.responseMode === "open_text" &&
      question.options.length !== 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Open-text questions require an empty options array",
      });
    }
    if (
      question.responseMode === "single_select" &&
      (question.options.length < 2 || question.options.length > 4)
    ) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Single-select questions require two to four options",
      });
    }
    const caseFolded = question.options.map((entry) => entry.toLowerCase());
    if (new Set(caseFolded).size !== caseFolded.length) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Question options must be unique ignoring case",
      });
    }
  });

const providerActionRationaleWireV1Schema = z.strictObject({
  summary: providerBoundedTextSchema,
});

export const contextActionProviderWireV1Schema = z
  .strictObject({
    providerSchemaVersion: z.literal(CONTEXT_ACTION_PROVIDER_SCHEMA_VERSION),
    action: z.enum(["ask", "search", "show_refine"]),
    question: providerQuestionWireV1Schema.nullable(),
    rationale: providerActionRationaleWireV1Schema.nullable(),
  })
  .superRefine((wire, context) => {
    if (
      wire.action === "ask" &&
      (wire.question === null || wire.rationale !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "ASK requires a question and no branch rationale",
      });
    }
    if (
      wire.action !== "ask" &&
      (wire.question !== null || wire.rationale === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Non-ASK actions require rationale and no question",
      });
    }
  });

export type ContextActionProviderWireV1 = z.infer<
  typeof contextActionProviderWireV1Schema
>;

export const questionProposalV1Schema = providerQuestionWireV1Schema;
export type QuestionProposalV1 = z.infer<typeof questionProposalV1Schema>;

export const contextActionRationaleV1Schema =
  providerActionRationaleWireV1Schema;
export type ContextActionRationaleV1 = z.infer<
  typeof contextActionRationaleV1Schema
>;

export const contextActionProposalV1Schema = z.discriminatedUnion("action", [
  z.strictObject({
    schemaVersion: z.literal(CONTEXT_ACTION_PROPOSAL_SCHEMA_VERSION),
    action: z.literal("ask"),
    question: questionProposalV1Schema,
  }),
  z.strictObject({
    schemaVersion: z.literal(CONTEXT_ACTION_PROPOSAL_SCHEMA_VERSION),
    action: z.literal("search"),
    rationale: contextActionRationaleV1Schema,
  }),
  z.strictObject({
    schemaVersion: z.literal(CONTEXT_ACTION_PROPOSAL_SCHEMA_VERSION),
    action: z.literal("show_refine"),
    rationale: contextActionRationaleV1Schema,
  }),
]);

export type ContextActionProposalV1 = z.infer<
  typeof contextActionProposalV1Schema
>;

export function lowerInterpretationProviderWireV1(
  input: unknown,
): InterpretationProposalV1 {
  const wire = interpretationProviderWireV1Schema.parse(input);
  const patch: StatePatchProposalV1 =
    wire.outcome === "no_change"
      ? { schemaVersion: 1, outcome: "no_change" }
      : {
          schemaVersion: 1,
          outcome: "change",
          operations: wire.operations.map(lowerPatchOperation),
        };
  return interpretationProposalV1Schema.parse({
    schemaVersion: INTERPRETATION_PROPOSAL_SCHEMA_VERSION,
    patch,
    ambiguities: wire.ambiguities,
  });
}

export function lowerContextActionProviderWireV1(
  input: unknown,
): ContextActionProposalV1 {
  const wire = contextActionProviderWireV1Schema.parse(input);
  switch (wire.action) {
    case "ask":
      if (wire.question === null) return assertNeverBranch();
      return contextActionProposalV1Schema.parse({
        schemaVersion: CONTEXT_ACTION_PROPOSAL_SCHEMA_VERSION,
        action: "ask",
        question: wire.question,
      });
    case "search":
    case "show_refine":
      if (wire.rationale === null) return assertNeverBranch();
      return contextActionProposalV1Schema.parse({
        schemaVersion: CONTEXT_ACTION_PROPOSAL_SCHEMA_VERSION,
        action: wire.action,
        rationale: wire.rationale,
      });
  }
}

type ProviderPatchOperationWireV1 = z.infer<
  typeof providerPatchOperationWireV1Schema
>;
type ProviderSemanticValueWireV1 = z.infer<
  typeof providerSemanticValueWireV1Schema
>;

function lowerPatchOperation(
  operation: ProviderPatchOperationWireV1,
): StatePatchProposalChangeOperation {
  switch (operation.op) {
    case "create_concept":
    case "remove":
    case "mark_indifferent":
      return operation;
    case "add_criterion":
      return {
        ...operation,
        target: lowerTarget(operation.target),
      };
    case "replace_target":
    case "relax":
    case "tighten":
      return {
        ...operation,
        result: lowerTarget(operation.result),
      };
  }
}

function lowerTarget(target: z.infer<typeof providerTargetWireV1Schema>) {
  return {
    strength: target.strength,
    targetSemantics: target.targetSemantics,
    semanticValue: lowerSemanticValue(target.semanticValue),
  };
}

function lowerSemanticValue(value: ProviderSemanticValueWireV1) {
  switch (value.kind) {
    case "boolean":
    case "measurement":
    case "money":
    case "money_stretch":
    case "categorical":
      return value;
    case "qualitative_text":
      return {
        schemaVersion: 1 as const,
        kind: "qualitative" as const,
        mode: "text" as const,
        text: value.text,
      };
    case "qualitative_ordinal":
      return {
        schemaVersion: 1 as const,
        kind: "qualitative" as const,
        mode: "ordinal" as const,
        relation: value.relation,
        anchor: value.anchor,
      };
    case "measurement_range":
      return {
        schemaVersion: value.schemaVersion,
        kind: value.kind,
        ...(value.lower === null ? {} : { lower: value.lower }),
        ...(value.upper === null ? {} : { upper: value.upper }),
        unit: value.unit,
      };
  }
}

type StatePatchProposalChangeOperation = Extract<
  StatePatchProposalV1,
  { outcome: "change" }
>["operations"][number];

function expectedTargetSemantics(value: ProviderSemanticValueWireV1) {
  switch (value.kind) {
    case "boolean":
      return new Set(["exact"]);
    case "qualitative_text":
    case "qualitative_ordinal":
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
  }
}

function compareNonNegativeDecimals(left: string, right: string) {
  const [leftInteger = "0", leftFraction = ""] = left.split(".");
  const [rightInteger = "0", rightFraction = ""] = right.split(".");
  if (leftInteger.length !== rightInteger.length) {
    return leftInteger.length < rightInteger.length ? -1 : 1;
  }
  const integerComparison = leftInteger.localeCompare(rightInteger);
  if (integerComparison !== 0) return integerComparison < 0 ? -1 : 1;
  const fractionLength = Math.max(leftFraction.length, rightFraction.length);
  const fractionComparison = leftFraction
    .padEnd(fractionLength, "0")
    .localeCompare(rightFraction.padEnd(fractionLength, "0"));
  return fractionComparison === 0 ? 0 : fractionComparison < 0 ? -1 : 1;
}

function assertNeverBranch(): never {
  throw new TypeError("Provider branch coherence validation was bypassed");
}
