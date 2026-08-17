import { describe, expect, it } from "vitest";
import { formatBriefItem, projectShoppingBrief } from "./brief";
import {
  conceptDefinitionIdSchema,
  criterionIdSchema,
  criterionLineageIdSchema,
  shoppingTaskIdSchema,
} from "./ids";
import type { CurrentShoppingState } from "./shopping-state";
import type { SemanticValue } from "./semantic-value";
import type { DecisionCriterion } from "./decision-criterion";

const taskId = shoppingTaskIdSchema.parse(
  "00000000-0000-4000-8000-000000000001",
);
const brandId = conceptDefinitionIdSchema.parse(
  "00000000-0000-4000-8000-000000000010",
);
const budgetId = conceptDefinitionIdSchema.parse(
  "00000000-0000-4000-8000-000000000011",
);
const market = {
  country: "GB" as const,
  language: "en-GB",
  currency: "GBP" as const,
};

function criterion(options: {
  id: string;
  lineage: string;
  conceptId: typeof brandId;
  semanticValue: SemanticValue;
  strength: "hard" | "preference" | null;
  targetSemantics: DecisionCriterion["targetSemantics"];
}) {
  return {
    criterion: {
      id: criterionIdSchema.parse(options.id),
      taskId,
      lineageId: criterionLineageIdSchema.parse(options.lineage),
      conceptId: options.conceptId,
      authority: "user_explicit" as const,
      strength: options.strength,
      targetSemantics: options.targetSemantics,
      valueSchemaVersion: 1 as const,
      valueKind: options.semanticValue.kind,
      semanticValue: options.semanticValue,
      lifecycle: "active" as const,
      createdRevision: 1n,
      endedRevision: null,
      supersededById: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
    sources: [],
  };
}

describe("structured brief projection", () => {
  it("omits indifference and preserves exact semantic variants", () => {
    const state: CurrentShoppingState = {
      task: {
        id: taskId,
        currentRevision: 1n,
        market,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
      concepts: [
        {
          id: brandId,
          taskId,
          label: "Brand",
          definition: "Manufacturer",
          valueFamily: "categorical",
          canonicalUnit: null,
          createdRevision: 0n,
          createdAt: new Date(0),
        },
        {
          id: budgetId,
          taskId,
          label: "Budget",
          definition: "Target and stretch",
          valueFamily: "money",
          canonicalUnit: null,
          createdRevision: 0n,
          createdAt: new Date(0),
        },
      ],
      activeCriteria: [
        criterion({
          id: "00000000-0000-4000-8000-000000000020",
          lineage: "00000000-0000-4000-8000-000000000030",
          conceptId: brandId,
          strength: null,
          targetSemantics: "indifferent",
          semanticValue: { schemaVersion: 1, kind: "indifferent" },
        }),
        criterion({
          id: "00000000-0000-4000-8000-000000000021",
          lineage: "00000000-0000-4000-8000-000000000031",
          conceptId: budgetId,
          strength: "preference",
          targetSemantics: "stretch",
          semanticValue: {
            schemaVersion: 1,
            kind: "money_stretch",
            targetMinor: 3000,
            stretchCeilingMinor: 4000,
            currency: "GBP",
            condition: "materially better",
          },
        }),
      ],
    };
    const brief = projectShoppingBrief(state);
    expect(brief.items).toHaveLength(1);
    expect(brief.items[0]?.semanticValue).toMatchObject({
      kind: "money_stretch",
      targetMinor: 3000,
      stretchCeilingMinor: 4000,
    });
    expect(formatBriefItem(brief.items[0]!, market)).toBe(
      "Around £30; up to £40 if materially better",
    );
  });

  it("never formats a soft categorical exclusion as hard eligibility", () => {
    const base = {
      criterionId: criterionIdSchema.parse(
        "00000000-0000-4000-8000-000000000020",
      ),
      lineageId: criterionLineageIdSchema.parse(
        "00000000-0000-4000-8000-000000000030",
      ),
      conceptId: brandId,
      conceptLabel: "Colour",
      conceptDefinition: "Finish colour",
      targetSemantics: "categorical" as const,
      semanticValue: {
        schemaVersion: 1 as const,
        kind: "categorical" as const,
        operator: "exclude" as const,
        values: ["white"],
      },
    };
    expect(formatBriefItem({ ...base, strength: "hard" }, market)).toBe(
      "No white",
    );
    expect(formatBriefItem({ ...base, strength: "preference" }, market)).toBe(
      "Prefer not to have white",
    );
  });
});
