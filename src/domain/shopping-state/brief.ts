import { z } from "zod";
import {
  criterionStrengthSchema,
  targetSemanticsSchema,
} from "./decision-criterion";
import { getCurrencyMetadata } from "./currency-metadata";
import {
  conceptDefinitionIdSchema,
  criterionIdSchema,
  criterionLineageIdSchema,
  shoppingTaskIdSchema,
} from "./ids";
import { marketContextSchema, type MarketContext } from "./market-context";
import { semanticValueSchema } from "./semantic-value";
import type {
  CurrentShoppingState,
  HistoricalShoppingState,
} from "./shopping-state";
import { taskRevisionSchema } from "./task";

const ordinarySemanticValueSchema = semanticValueSchema.refine(
  (value) => value.kind !== "indifferent",
);

export const briefItemV1Schema = z.strictObject({
  criterionId: criterionIdSchema,
  lineageId: criterionLineageIdSchema,
  conceptId: conceptDefinitionIdSchema,
  conceptLabel: z.string().min(1),
  conceptDefinition: z.string().min(1),
  strength: criterionStrengthSchema,
  targetSemantics: targetSemanticsSchema.exclude(["indifferent"]),
  semanticValue: ordinarySemanticValueSchema,
});

export const shoppingBriefV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  taskId: shoppingTaskIdSchema,
  revision: taskRevisionSchema,
  market: marketContextSchema,
  items: z.array(briefItemV1Schema).readonly(),
});

export type BriefItemV1 = z.infer<typeof briefItemV1Schema>;
export type ShoppingBriefV1 = z.infer<typeof shoppingBriefV1Schema>;

export function projectShoppingBrief(
  state: CurrentShoppingState | HistoricalShoppingState,
): ShoppingBriefV1 {
  const criteria =
    "activeCriteria" in state ? state.activeCriteria : state.effectiveCriteria;
  const revision =
    "revision" in state ? state.revision : state.task.currentRevision;
  const concepts = new Map(
    state.concepts.map((concept) => [concept.id, concept] as const),
  );
  const items = criteria
    .filter(({ criterion }) => criterion.semanticValue.kind !== "indifferent")
    .sort((left, right) => {
      const leftConcept = concepts.get(left.criterion.conceptId)!;
      const rightConcept = concepts.get(right.criterion.conceptId)!;
      if (leftConcept.createdRevision !== rightConcept.createdRevision)
        return leftConcept.createdRevision < rightConcept.createdRevision
          ? -1
          : 1;
      const conceptIdentity = leftConcept.id.localeCompare(rightConcept.id);
      if (conceptIdentity !== 0) return conceptIdentity;
      if (left.criterion.createdRevision !== right.criterion.createdRevision)
        return left.criterion.createdRevision < right.criterion.createdRevision
          ? -1
          : 1;
      return left.criterion.id.localeCompare(right.criterion.id);
    })
    .map(({ criterion }) => {
      const concept = concepts.get(criterion.conceptId);
      if (
        concept === undefined ||
        criterion.strength === null ||
        criterion.targetSemantics === "indifferent" ||
        criterion.semanticValue.kind === "indifferent"
      ) {
        throw new Error(
          `Brief criterion ${criterion.id} has invalid concept or ordinary dimensions`,
        );
      }
      return briefItemV1Schema.parse({
        criterionId: criterion.id,
        lineageId: criterion.lineageId,
        conceptId: concept.id,
        conceptLabel: concept.label,
        conceptDefinition: concept.definition,
        strength: criterion.strength,
        targetSemantics: criterion.targetSemantics,
        semanticValue: criterion.semanticValue,
      });
    });
  return shoppingBriefV1Schema.parse({
    schemaVersion: 1,
    taskId: state.task.id,
    revision,
    market: state.task.market,
    items,
  });
}

function formatMoney(amountMinor: number, market: MarketContext) {
  const metadata = getCurrencyMetadata(market.currency);
  if (metadata === undefined)
    throw new Error(`Unsupported currency ${market.currency}`);
  return new Intl.NumberFormat(market.language, {
    style: "currency",
    currency: market.currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: metadata.minorUnitScale,
  }).format(amountMinor / 10 ** metadata.minorUnitScale);
}

function strengthPrefix(strength: BriefItemV1["strength"]) {
  return strength === "hard"
    ? ""
    : strength === "strong_preference"
      ? "Strong preference: "
      : "Prefer ";
}

export function formatBriefItem(
  item: BriefItemV1,
  market: MarketContext,
): string {
  const value = item.semanticValue;
  switch (value.kind) {
    case "boolean":
      return `${strengthPrefix(item.strength)}${item.conceptLabel}: ${value.value ? "yes" : "no"}`;
    case "qualitative":
      return `${strengthPrefix(item.strength)}${value.mode === "text" ? value.text : `${value.relation?.replaceAll("_", " ")} ${value.anchor}`}`;
    case "measurement":
      return `${item.targetSemantics === "around" ? "Around " : strengthPrefix(item.strength)}${value.amount} ${value.unit}`;
    case "measurement_range": {
      const lower =
        value.lower === undefined
          ? ""
          : `${value.lower.inclusive ? "at least" : "more than"} ${value.lower.amount} ${value.unit}`;
      const upper =
        value.upper === undefined
          ? ""
          : `${value.upper.inclusive ? "maximum" : "less than"} ${value.upper.amount} ${value.unit}`;
      return `${strengthPrefix(item.strength)}${[lower, upper].filter(Boolean).join(" and ")}`;
    }
    case "money":
      return `${value.mode === "ceiling" ? "Maximum" : item.targetSemantics === "around" ? "Around" : strengthPrefix(item.strength).trim() || "Exactly"} ${formatMoney(value.amountMinor, market)}`;
    case "money_stretch":
      return `Around ${formatMoney(value.targetMinor, market)}; up to ${formatMoney(value.stretchCeilingMinor, market)} if ${value.condition}`;
    case "categorical": {
      const joined = value.values.join(", ");
      if (value.operator === "exclude")
        return item.strength === "hard"
          ? `No ${joined}`
          : item.strength === "strong_preference"
            ? `Strong preference: avoid ${joined}`
            : `Prefer not to have ${joined}`;
      if (value.operator === "include")
        return item.strength === "hard"
          ? `Must be ${joined}`
          : `${strengthPrefix(item.strength)}${joined}`;
      return `${strengthPrefix(item.strength)}${joined}`;
    }
    case "comparison":
      return `${strengthPrefix(item.strength)}${value.relation.replaceAll("_", " ")} referenced candidate`;
  }
}
