import { z } from "zod";
import { candidateListingIdSchema, shoppingTaskIdSchema } from "./ids";
import { currencyCodeSchema } from "./market-context";

export const SEMANTIC_VALUE_SCHEMA_VERSION = 1 as const;

const boundedText = z.string().trim().min(1).max(500);

export const decimalStringSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, "Expected a non-negative decimal");

export const measurementUnitSchema = z.enum(["mm", "cm", "m", "g", "kg"]);
export type MeasurementUnit = z.infer<typeof measurementUnitSchema>;

const unitDimension = {
  mm: "length",
  cm: "length",
  m: "length",
  g: "mass",
  kg: "mass",
} as const satisfies Record<MeasurementUnit, "length" | "mass">;

const unitPowerFromBase = {
  mm: 0,
  cm: 1,
  m: 3,
  g: 0,
  kg: 3,
} as const satisfies Record<MeasurementUnit, number>;

export function unitsShareDimension(
  left: MeasurementUnit,
  right: MeasurementUnit,
) {
  return unitDimension[left] === unitDimension[right];
}

function canonicalDecimal(digits: string, decimalPlaces: number) {
  const paddedDigits = digits.padStart(decimalPlaces + 1, "0");
  const integer = paddedDigits
    .slice(0, -decimalPlaces || undefined)
    .replace(/^0+(?=\d)/, "");
  const fraction =
    decimalPlaces === 0 ? "" : paddedDigits.slice(-decimalPlaces);
  const trimmedFraction = fraction.replace(/0+$/, "");
  return trimmedFraction.length === 0
    ? integer
    : `${integer}.${trimmedFraction}`;
}

export function normalizeMeasurementAmount(
  amountInput: unknown,
  fromUnit: MeasurementUnit,
  toUnit: MeasurementUnit,
) {
  const amount = decimalStringSchema.parse(amountInput);
  if (!unitsShareDimension(fromUnit, toUnit)) {
    throw new Error(`Cannot convert ${fromUnit} to ${toUnit}`);
  }

  const [integer = "0", fraction = ""] = amount.split(".");
  const digits = `${integer}${fraction}`;
  const decimalPlaces =
    fraction.length - unitPowerFromBase[fromUnit] + unitPowerFromBase[toUnit];

  if (decimalPlaces <= 0) {
    return `${digits}${"0".repeat(-decimalPlaces)}`.replace(/^0+(?=\d)/, "");
  }

  return canonicalDecimal(digits, decimalPlaces);
}

const schemaVersion = z.literal(SEMANTIC_VALUE_SCHEMA_VERSION);

export const booleanValueSchema = z.strictObject({
  schemaVersion,
  kind: z.literal("boolean"),
  value: z.boolean(),
});

export const qualitativeValueSchema = z
  .strictObject({
    schemaVersion,
    kind: z.literal("qualitative"),
    mode: z.enum(["text", "ordinal"]),
    text: boundedText.optional(),
    relation: z.enum(["more", "less", "at_least", "at_most"]).optional(),
    anchor: boundedText.optional(),
  })
  .superRefine((value, context) => {
    if (
      value.mode === "text" &&
      (value.text === undefined ||
        value.relation !== undefined ||
        value.anchor !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Qualitative text requires text and no ordinal fields",
      });
    }

    if (
      value.mode === "ordinal" &&
      (value.text !== undefined ||
        value.relation === undefined ||
        value.anchor === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Qualitative ordinal requires relation and anchor only",
      });
    }
  });

export const measurementValueSchema = z.strictObject({
  schemaVersion,
  kind: z.literal("measurement"),
  amount: decimalStringSchema,
  unit: measurementUnitSchema,
});

const measurementBoundSchema = z.strictObject({
  amount: decimalStringSchema,
  inclusive: z.boolean(),
});

function compareDecimals(left: string, right: string) {
  const [leftInteger = "0", leftFraction = ""] = left.split(".");
  const [rightInteger = "0", rightFraction = ""] = right.split(".");

  if (leftInteger.length !== rightInteger.length) {
    return leftInteger.length < rightInteger.length ? -1 : 1;
  }

  const integerComparison = leftInteger.localeCompare(rightInteger);
  if (integerComparison !== 0) {
    return integerComparison < 0 ? -1 : 1;
  }

  const fractionLength = Math.max(leftFraction.length, rightFraction.length);
  const fractionComparison = leftFraction
    .padEnd(fractionLength, "0")
    .localeCompare(rightFraction.padEnd(fractionLength, "0"));

  return fractionComparison === 0 ? 0 : fractionComparison < 0 ? -1 : 1;
}

export const measurementRangeValueSchema = z
  .strictObject({
    schemaVersion,
    kind: z.literal("measurement_range"),
    lower: measurementBoundSchema.optional(),
    upper: measurementBoundSchema.optional(),
    unit: measurementUnitSchema,
  })
  .superRefine((value, context) => {
    if (value.lower === undefined && value.upper === undefined) {
      context.addIssue({
        code: "custom",
        message: "A measurement range needs at least one bound",
      });
    }

    if (
      value.lower !== undefined &&
      value.upper !== undefined &&
      compareDecimals(value.lower.amount, value.upper.amount) > 0
    ) {
      context.addIssue({
        code: "custom",
        message: "The lower measurement bound cannot exceed the upper bound",
      });
    }
  });

const minorAmountSchema = z.number().int().nonnegative().safe();

export const moneyValueSchema = z.strictObject({
  schemaVersion,
  kind: z.literal("money"),
  mode: z.enum(["target", "ceiling"]),
  amountMinor: minorAmountSchema,
  currency: currencyCodeSchema,
});

export const moneyStretchValueSchema = z
  .strictObject({
    schemaVersion,
    kind: z.literal("money_stretch"),
    targetMinor: minorAmountSchema,
    stretchCeilingMinor: minorAmountSchema,
    currency: currencyCodeSchema,
    condition: boundedText,
  })
  .superRefine((value, context) => {
    if (value.stretchCeilingMinor <= value.targetMinor) {
      context.addIssue({
        code: "custom",
        message: "A stretch ceiling must be greater than its target",
      });
    }
  });

export const categoricalValueSchema = z
  .strictObject({
    schemaVersion,
    kind: z.literal("categorical"),
    operator: z.enum(["include", "prefer", "exclude"]),
    values: z.array(z.string().trim().min(1).max(120)).min(1).max(50),
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

export const comparisonValueSchema = z.strictObject({
  schemaVersion,
  kind: z.literal("comparison"),
  relation: z.enum(["more_than", "less_than", "similar_to"]),
  reference: z.strictObject({
    kind: z.literal("candidate_listing"),
    taskId: shoppingTaskIdSchema,
    candidateListingId: candidateListingIdSchema,
  }),
});

export const indifferentValueSchema = z.strictObject({
  schemaVersion,
  kind: z.literal("indifferent"),
});

export const semanticValueSchema = z.discriminatedUnion("kind", [
  booleanValueSchema,
  qualitativeValueSchema,
  measurementValueSchema,
  measurementRangeValueSchema,
  moneyValueSchema,
  moneyStretchValueSchema,
  categoricalValueSchema,
  comparisonValueSchema,
  indifferentValueSchema,
]);

export type SemanticValue = z.infer<typeof semanticValueSchema>;
export type SemanticValueInput = z.input<typeof semanticValueSchema>;
export type SemanticValueKind = SemanticValue["kind"];
