import type {
  PatchOperationV1,
  RawApplyStatePatchCommandV1,
} from "../../src/domain/shopping-state/state-patch";

type FixtureSemanticValue = Extract<
  PatchOperationV1,
  { op: "add_criterion" }
>["target"]["semanticValue"];
type UserExplicitInputId = Extract<
  RawApplyStatePatchCommandV1["source"],
  { kind: "user_explicit" }
>["inputId"];

/**
 * Development/evaluation-only authoritative states. This module is imported
 * by tests and the product proof script, never by the application runtime.
 * Keeping the patch operations here prevents the live proof from silently
 * lowering founder intent into generic preferences.
 */

export type ProductEngineCaseName =
  | "ergonomic-mouse"
  | "office-chair"
  | "cordless-vacuum"
  | "compact-coffee-machine";

export type ProductEngineCriterion = Readonly<{
  localRef: string;
  label: string;
  definition: string;
  strength: "hard" | "strong_preference" | "preference";
  targetSemantics:
    "exact" | "range" | "around" | "stretch" | "categorical" | "qualitative";
  semanticValue: FixtureSemanticValue;
}>;

export type ProductEngineFixture = Readonly<{
  name: ProductEngineCaseName;
  request: string;
  criteria: readonly ProductEngineCriterion[];
  indifferentConcepts: readonly Readonly<{
    localRef: string;
    label: string;
    definition: string;
  }>[];
  refinement?: Readonly<{
    request: string;
    replaceLocalRef: string;
    replacement: Readonly<{
      strength: "hard" | "strong_preference" | "preference";
      targetSemantics: "qualitative";
      semanticValue: FixtureSemanticValue;
    }>;
    add: ProductEngineCriterion;
  }>;
}>;

const mouseRequest =
  "I need an ergonomic mouse under £50. I don’t know much about mouse brands, so I want the best options rather than having to know which specs matter. Reviews matter a lot to me. I’d prefer wireless, but only if the battery life is very good. I like mice that are a little chunkier and sculpted, with a noticeable side profile or thumb-rest shape rather than something flat and minimal. Good brands only, no Amazon Basics stuff or bad brands.";

export const V0_09_PRODUCT_ENGINE_CASES: readonly ProductEngineFixture[] = [
  {
    name: "ergonomic-mouse",
    request: mouseRequest,
    criteria: [
      {
        localRef: "price",
        label: "Price",
        definition: "Maximum purchase price",
        strength: "hard",
        targetSemantics: "range",
        semanticValue: {
          schemaVersion: 1,
          kind: "money",
          mode: "ceiling",
          amountMinor: 5000,
          currency: "GBP",
        },
      },
      {
        localRef: "reviews",
        label: "Reviews",
        definition: "Importance of review quality",
        strength: "strong_preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "reviews matter a lot",
        },
      },
      {
        localRef: "wireless",
        label: "Wireless connectivity",
        definition: "Whether wireless connectivity is preferred",
        strength: "preference",
        targetSemantics: "categorical",
        semanticValue: {
          schemaVersion: 1,
          kind: "categorical",
          operator: "prefer",
          values: ["wireless"],
        },
      },
      {
        localRef: "battery",
        label: "Battery life",
        definition: "Battery quality required when choosing wireless",
        strength: "preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "very good battery life if wireless",
        },
      },
      {
        localRef: "shape",
        label: "Mouse shape",
        definition: "A chunkier sculpted side profile or thumb-rest shape",
        strength: "preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "a little chunkier and sculpted, with a noticeable side profile or thumb-rest shape rather than flat and minimal",
        },
      },
      {
        localRef: "brand_reputation",
        label: "Brand reputation",
        definition: "Good or reputable brands only; avoid bad brands",
        strength: "hard",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "good/reputable brands only; avoid bad brands",
        },
      },
      {
        localRef: "amazon_basics",
        label: "Excluded brand",
        definition: "Amazon Basics is explicitly unacceptable",
        strength: "hard",
        targetSemantics: "categorical",
        semanticValue: {
          schemaVersion: 1,
          kind: "categorical",
          operator: "exclude",
          values: ["Amazon Basics"],
        },
      },
    ],
    indifferentConcepts: [],
    refinement: {
      request:
        "Reviews matter less now. Comfort for long workdays matters most.",
      replaceLocalRef: "reviews",
      replacement: {
        strength: "preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "reviews matter less now",
        },
      },
      add: {
        localRef: "comfort",
        label: "Comfort for long workdays",
        definition: "Comfort during long workdays",
        strength: "strong_preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "comfort for long workdays matters most",
        },
      },
    },
  },
  {
    name: "office-chair",
    request:
      "I need a comfortable office chair for working from home most days, around £250. I can stretch to £350 if it’s genuinely better for long sessions. I’m 5'10 and don’t want anything huge or gamer-looking. Good lower-back support matters a lot, and I’d prefer breathable fabric or mesh over leather. I don’t care about brand or colour.",
    criteria: [
      {
        localRef: "price",
        label: "Price",
        definition: "Around £250, with a conditional stretch to £350",
        strength: "preference",
        targetSemantics: "stretch",
        semanticValue: {
          schemaVersion: 1,
          kind: "money_stretch",
          targetMinor: 25000,
          stretchCeilingMinor: 35000,
          currency: "GBP",
          condition: "only if genuinely better for long sessions",
        },
      },
      {
        localRef: "height",
        label: "Shopper height",
        definition: "Shopper height for chair fit",
        strength: "preference",
        targetSemantics: "exact",
        semanticValue: {
          schemaVersion: 1,
          kind: "measurement",
          amount: "178",
          unit: "cm",
        },
      },
      {
        localRef: "lumbar",
        label: "Lower-back support",
        definition: "Good lower-back support for long sessions",
        strength: "strong_preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "good lower-back support",
        },
      },
      {
        localRef: "material",
        label: "Material",
        definition: "Breathable fabric or mesh is preferred over leather",
        strength: "preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "breathable fabric or mesh over leather",
        },
      },
      {
        localRef: "size",
        label: "Chair size",
        definition: "The chair must not be huge",
        strength: "hard",
        targetSemantics: "categorical",
        semanticValue: {
          schemaVersion: 1,
          kind: "categorical",
          operator: "exclude",
          values: ["huge"],
        },
      },
      {
        localRef: "style",
        label: "Chair style",
        definition: "The chair must not look like a gamer chair",
        strength: "hard",
        targetSemantics: "categorical",
        semanticValue: {
          schemaVersion: 1,
          kind: "categorical",
          operator: "exclude",
          values: ["gamer-looking"],
        },
      },
    ],
    indifferentConcepts: [
      {
        localRef: "brand",
        label: "Brand",
        definition: "Whether chair brand matters",
      },
      {
        localRef: "colour",
        label: "Colour",
        definition: "Whether chair colour matters",
      },
    ],
  },
  {
    name: "cordless-vacuum",
    request:
      "I need a cordless vacuum for a small flat under £250. It must work well on both hard floors and rugs, and it must not be very loud because I have a noise-sensitive cat. I prefer something under 3kg with at least 40 minutes of useful runtime. I don’t care about colour or brand.",
    criteria: [
      {
        localRef: "cordless",
        label: "Cordless operation",
        definition: "The vacuum operates cordless",
        strength: "hard",
        targetSemantics: "exact",
        semanticValue: { schemaVersion: 1, kind: "boolean", value: true },
      },
      {
        localRef: "price",
        label: "Price",
        definition: "Maximum purchase price",
        strength: "hard",
        targetSemantics: "range",
        semanticValue: {
          schemaVersion: 1,
          kind: "money",
          mode: "ceiling",
          amountMinor: 25000,
          currency: "GBP",
        },
      },
      {
        localRef: "surfaces",
        label: "Floor-type suitability",
        definition: "Works well on both hard floors and rugs",
        strength: "hard",
        targetSemantics: "categorical",
        semanticValue: {
          schemaVersion: 1,
          kind: "categorical",
          operator: "include",
          values: ["hard floors", "rugs"],
        },
      },
      {
        localRef: "noise",
        label: "Noise level",
        definition: "Must not be very loud around a noise-sensitive cat",
        strength: "hard",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "not very loud",
        },
      },
      {
        localRef: "weight",
        label: "Weight",
        definition: "Preferred weight under 3kg",
        strength: "preference",
        targetSemantics: "range",
        semanticValue: {
          schemaVersion: 1,
          kind: "measurement_range",
          upper: { amount: "3", inclusive: false },
          unit: "kg",
        },
      },
      {
        localRef: "runtime",
        label: "Useful runtime",
        definition: "Preferred useful cordless runtime",
        strength: "preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "ordinal",
          relation: "at_least",
          anchor: "40 minutes",
        },
      },
    ],
    indifferentConcepts: [
      {
        localRef: "brand",
        label: "Brand",
        definition: "Whether vacuum brand matters",
      },
      {
        localRef: "colour",
        label: "Colour",
        definition: "Whether vacuum colour matters",
      },
    ],
  },
  {
    name: "compact-coffee-machine",
    request:
      "I need a compact coffee machine for a small kitchen under £350. It must be no more than 25cm wide. I want genuinely good espresso and something that is easy to clean. I’d prefer it not to be very loud, and milk frothing would be useful but isn’t essential. I’m open on brand and colour.",
    criteria: [
      {
        localRef: "price",
        label: "Price",
        definition: "Maximum purchase price",
        strength: "hard",
        targetSemantics: "range",
        semanticValue: {
          schemaVersion: 1,
          kind: "money",
          mode: "ceiling",
          amountMinor: 35000,
          currency: "GBP",
        },
      },
      {
        localRef: "width",
        label: "Machine width",
        definition: "Maximum machine width",
        strength: "hard",
        targetSemantics: "range",
        semanticValue: {
          schemaVersion: 1,
          kind: "measurement_range",
          upper: { amount: "25", inclusive: true },
          unit: "cm",
        },
      },
      {
        localRef: "espresso",
        label: "Espresso quality",
        definition: "Genuinely good espresso",
        strength: "strong_preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "genuinely good espresso",
        },
      },
      {
        localRef: "cleaning",
        label: "Ease of cleaning",
        definition: "The machine should be easy to clean",
        strength: "preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "easy to clean",
        },
      },
      {
        localRef: "noise",
        label: "Noise level",
        definition: "Prefer operation that is not very loud",
        strength: "preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "not very loud",
        },
      },
      {
        localRef: "milk",
        label: "Milk frothing",
        definition: "Useful but explicitly nonessential milk frothing",
        strength: "preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "milk frothing useful but not essential",
        },
      },
    ],
    indifferentConcepts: [
      {
        localRef: "brand",
        label: "Brand",
        definition: "Whether coffee-machine brand matters",
      },
      {
        localRef: "colour",
        label: "Colour",
        definition: "Whether coffee-machine colour matters",
      },
    ],
  },
] as const;

export function buildProductEngineInitialPatch(
  fixture: ProductEngineFixture,
  taskId: RawApplyStatePatchCommandV1["taskId"],
  inputId: UserExplicitInputId,
): RawApplyStatePatchCommandV1 {
  const operations: PatchOperationV1[] = [];
  for (const criterion of fixture.criteria) {
    operations.push({
      op: "create_concept",
      localRef: criterion.localRef,
      label: criterion.label,
      definition: criterion.definition,
      valueFamily:
        criterion.semanticValue.kind === "money" ||
        criterion.semanticValue.kind === "money_stretch"
          ? "money"
          : criterion.semanticValue.kind === "measurement" ||
              criterion.semanticValue.kind === "measurement_range"
            ? "measurement"
            : criterion.semanticValue.kind === "categorical"
              ? "categorical"
              : criterion.semanticValue.kind === "boolean"
                ? "boolean"
                : "qualitative",
      canonicalUnit:
        criterion.semanticValue.kind === "measurement" ||
        criterion.semanticValue.kind === "measurement_range"
          ? criterion.semanticValue.unit
          : null,
    });
    operations.push({
      op: "add_criterion",
      concept: { kind: "created", localRef: criterion.localRef },
      target: {
        strength: criterion.strength,
        targetSemantics: criterion.targetSemantics,
        semanticValue: criterion.semanticValue,
      },
    });
  }
  for (const concept of fixture.indifferentConcepts) {
    operations.push({
      op: "create_concept",
      localRef: concept.localRef,
      label: concept.label,
      definition: concept.definition,
      valueFamily: "categorical",
      canonicalUnit: null,
    });
    operations.push({
      op: "mark_indifferent",
      concept: { kind: "created", localRef: concept.localRef },
      replacesCriterionIds: [],
    });
  }
  return {
    applicationSchemaVersion: 1,
    applicationKind: "patch",
    taskId,
    expectedRevision: 0n,
    source: { kind: "user_explicit", inputId },
    patch: { schemaVersion: 1, outcome: "change", operations },
  };
}

export function buildMouseRevisionTwoPatch(
  fixture: ProductEngineFixture,
  taskId: RawApplyStatePatchCommandV1["taskId"],
  inputId: UserExplicitInputId,
  reviewsCriterionId: Extract<
    PatchOperationV1,
    { op: "replace_target" }
  >["targetCriterionId"],
): RawApplyStatePatchCommandV1 {
  if (fixture.name !== "ergonomic-mouse" || fixture.refinement === undefined) {
    throw new Error("Mouse revision-two patch requested for another fixture");
  }
  const replacement = fixture.refinement.replacement;
  const add = fixture.refinement.add;
  return {
    applicationSchemaVersion: 1,
    applicationKind: "patch",
    taskId,
    expectedRevision: 1n,
    source: { kind: "user_explicit", inputId },
    patch: {
      schemaVersion: 1,
      outcome: "change",
      operations: [
        {
          op: "replace_target",
          targetCriterionId: reviewsCriterionId,
          result: replacement,
        },
        {
          op: "create_concept",
          localRef: add.localRef,
          label: add.label,
          definition: add.definition,
          valueFamily: "qualitative",
          canonicalUnit: null,
        },
        {
          op: "add_criterion",
          concept: { kind: "created", localRef: add.localRef },
          target: {
            strength: add.strength,
            targetSemantics: add.targetSemantics,
            semanticValue: add.semanticValue,
          },
        },
      ],
    },
  };
}
