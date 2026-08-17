import { isDeepStrictEqual } from "node:util";
import { ContradictoryTransitionIntentError } from "./errors";
import type { DecisionCriterion } from "./decision-criterion";

type OrdinaryTarget = Pick<
  DecisionCriterion,
  "strength" | "targetSemantics" | "semanticValue"
>;
type Direction = "relax" | "tighten";

const strengthRank = { preference: 1, strong_preference: 2, hard: 3 } as const;

function decimalParts(value: string) {
  const [integer = "0", fraction = ""] = value.split(".");
  return { integer, fraction };
}

function compareDecimal(left: string, right: string) {
  const a = decimalParts(left);
  const b = decimalParts(right);
  if (a.integer.length !== b.integer.length)
    return a.integer.length < b.integer.length ? -1 : 1;
  const integer = a.integer.localeCompare(b.integer);
  if (integer !== 0) return integer < 0 ? -1 : 1;
  const size = Math.max(a.fraction.length, b.fraction.length);
  return a.fraction
    .padEnd(size, "0")
    .localeCompare(b.fraction.padEnd(size, "0"));
}

function setRelation(
  beforeValues: readonly string[],
  afterValues: readonly string[],
) {
  const before = new Set(beforeValues);
  const after = new Set(afterValues);
  const beforeSubset = [...before].every((value) => after.has(value));
  const afterSubset = [...after].every((value) => before.has(value));
  if (beforeSubset && !afterSubset) return "superset" as const;
  if (afterSubset && !beforeSubset) return "subset" as const;
  return null;
}

export function classifyTransitionDirection(
  before: OrdinaryTarget,
  after: OrdinaryTarget,
): Direction | null {
  if (before.strength === null || after.strength === null) return null;
  const sameValue = isDeepStrictEqual(
    before.semanticValue,
    after.semanticValue,
  );
  const sameTarget = before.targetSemantics === after.targetSemantics;
  if (sameValue && sameTarget && before.strength !== after.strength) {
    return strengthRank[after.strength] < strengthRank[before.strength]
      ? "relax"
      : "tighten";
  }
  if (before.strength !== after.strength || !sameTarget) return null;

  const beforeValue = before.semanticValue;
  const afterValue = after.semanticValue;
  if (
    beforeValue.kind === "money" &&
    afterValue.kind === "money" &&
    beforeValue.mode === "ceiling" &&
    afterValue.mode === "ceiling" &&
    beforeValue.currency === afterValue.currency
  ) {
    if (afterValue.amountMinor === beforeValue.amountMinor) return null;
    return afterValue.amountMinor > beforeValue.amountMinor
      ? "relax"
      : "tighten";
  }
  if (
    beforeValue.kind === "measurement_range" &&
    afterValue.kind === "measurement_range" &&
    beforeValue.unit === afterValue.unit
  ) {
    if (
      beforeValue.lower === undefined &&
      afterValue.lower === undefined &&
      beforeValue.upper !== undefined &&
      afterValue.upper !== undefined &&
      beforeValue.upper.inclusive === afterValue.upper.inclusive
    ) {
      return compareDecimal(afterValue.upper.amount, beforeValue.upper.amount) >
        0
        ? "relax"
        : "tighten";
    }
    if (
      beforeValue.upper === undefined &&
      afterValue.upper === undefined &&
      beforeValue.lower !== undefined &&
      afterValue.lower !== undefined &&
      beforeValue.lower.inclusive === afterValue.lower.inclusive
    ) {
      return compareDecimal(afterValue.lower.amount, beforeValue.lower.amount) <
        0
        ? "relax"
        : "tighten";
    }
  }
  if (
    beforeValue.kind === "categorical" &&
    afterValue.kind === "categorical" &&
    beforeValue.operator === afterValue.operator &&
    beforeValue.operator !== "prefer"
  ) {
    const relation = setRelation(beforeValue.values, afterValue.values);
    if (relation === null) return null;
    if (beforeValue.operator === "include")
      return relation === "superset" ? "relax" : "tighten";
    return relation === "subset" ? "relax" : "tighten";
  }
  return null;
}

export function assertTransitionIntent(
  intent: Direction,
  before: OrdinaryTarget,
  after: OrdinaryTarget,
) {
  const classified = classifyTransitionDirection(before, after);
  if (classified !== null && classified !== intent) {
    throw new ContradictoryTransitionIntentError(
      `Declared ${intent} is contradicted by the exact resulting target`,
    );
  }
}
