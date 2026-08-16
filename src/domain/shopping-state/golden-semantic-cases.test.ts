import { describe, expect, it } from "vitest";
import {
  CandidateIdentityNotAvailableError,
  CriterionCompatibilityError,
  ProvenanceValidationError,
} from "./errors";
import {
  assertCriterionPersistable,
  decisionCriterionSchema,
  parseDecisionCriterionForContext,
  validateCriterionSources,
} from "./decision-criterion";
import { conceptDefinitionSchema } from "./concept-definition";
import type { SemanticValueInput } from "./semantic-value";
import { shoppingTaskSchema } from "./task";

const ids = {
  taskCap: "00000000-0000-4000-8000-000000000001",
  taskShelving: "00000000-0000-4000-8000-000000000002",
  conceptBudget: "00000000-0000-4000-8000-000000000010",
  conceptColour: "00000000-0000-4000-8000-000000000011",
  conceptWidth: "00000000-0000-4000-8000-000000000012",
  conceptDepth: "00000000-0000-4000-8000-000000000013",
  conceptBrand: "00000000-0000-4000-8000-000000000014",
  criterion: "00000000-0000-4000-8000-000000000020",
  lineage: "00000000-0000-4000-8000-000000000021",
  candidate: "00000000-0000-4000-8000-000000000030",
  input: "00000000-0000-4000-8000-000000000040",
  message: "00000000-0000-4000-8000-000000000041",
  sourceOrigin: "00000000-0000-4000-8000-000000000050",
  sourceConfirmation: "00000000-0000-4000-8000-000000000051",
} as const;

const instant = new Date("2026-08-16T10:00:00.000Z");

function task(id: string) {
  return shoppingTaskSchema.parse({
    id,
    currentRevision: 3n,
    market: { country: "GB", language: "en-GB", currency: "GBP" },
    createdAt: instant,
    updatedAt: instant,
  });
}

function concept(options: {
  id: string;
  taskId?: string;
  label: string;
  valueFamily:
    "boolean" | "categorical" | "measurement" | "money" | "qualitative";
  canonicalUnit?: "cm";
}) {
  return conceptDefinitionSchema.parse({
    id: options.id,
    taskId: options.taskId ?? ids.taskShelving,
    label: options.label,
    definition: `Shopper-specific ${options.label.toLowerCase()}`,
    valueFamily: options.valueFamily,
    canonicalUnit: options.canonicalUnit ?? null,
    createdRevision: 1n,
    createdAt: instant,
  });
}

function criterion(options: {
  conceptId: string;
  semanticValue: SemanticValueInput;
  strength?: "hard" | "preference" | "strong_preference" | null;
  targetSemantics:
    | "around"
    | "categorical"
    | "comparative"
    | "indifferent"
    | "range"
    | "stretch";
  authority?: "user_confirmed" | "user_explicit";
  taskId?: string;
}) {
  return decisionCriterionSchema.parse({
    id: ids.criterion,
    taskId: options.taskId ?? ids.taskShelving,
    lineageId: ids.lineage,
    conceptId: options.conceptId,
    authority: options.authority ?? "user_explicit",
    strength: options.strength === undefined ? "preference" : options.strength,
    targetSemantics: options.targetSemantics,
    valueSchemaVersion: 1,
    valueKind: options.semanticValue.kind,
    semanticValue: options.semanticValue,
    lifecycle: "active",
    createdRevision: 2n,
    endedRevision: null,
    supersededById: null,
    createdAt: instant,
    updatedAt: instant,
  });
}

describe("approved golden semantic cases", () => {
  it("keeps target, ceiling, and conditional stretch money distinct", () => {
    const budget = concept({
      id: ids.conceptBudget,
      label: "Budget",
      valueFamily: "money",
    });
    const shelvingTask = task(ids.taskShelving);

    const around = criterion({
      conceptId: budget.id,
      targetSemantics: "around",
      semanticValue: {
        schemaVersion: 1,
        kind: "money",
        mode: "target",
        amountMinor: 3000,
        currency: "GBP",
      },
    });
    const maximum = criterion({
      conceptId: budget.id,
      targetSemantics: "range",
      strength: "hard",
      semanticValue: {
        schemaVersion: 1,
        kind: "money",
        mode: "ceiling",
        amountMinor: 3000,
        currency: "GBP",
      },
    });
    const stretch = criterion({
      conceptId: budget.id,
      targetSemantics: "stretch",
      semanticValue: {
        schemaVersion: 1,
        kind: "money_stretch",
        targetMinor: 3000,
        stretchCeilingMinor: 4000,
        currency: "GBP",
        condition: "if materially better",
      },
    });

    for (const entry of [around, maximum, stretch]) {
      expect(
        parseDecisionCriterionForContext({
          criterion: entry,
          concept: budget,
          task: shelvingTask,
        }).criterion,
      ).toStrictEqual(entry);
    }

    expect(around.semanticValue).not.toEqual(maximum.semanticValue);
    expect(stretch.semanticValue.kind).toBe("money_stretch");
  });

  it("keeps categorical direction separate from strength", () => {
    const colour = concept({
      id: ids.conceptColour,
      label: "Colour",
      valueFamily: "categorical",
    });
    const shelvingTask = task(ids.taskShelving);
    const noWhite = criterion({
      conceptId: colour.id,
      targetSemantics: "categorical",
      strength: "hard",
      semanticValue: {
        schemaVersion: 1,
        kind: "categorical",
        operator: "exclude",
        values: ["white"],
      },
    });
    const avoidWhite = criterion({
      conceptId: colour.id,
      targetSemantics: "categorical",
      strength: "preference",
      semanticValue: {
        schemaVersion: 1,
        kind: "categorical",
        operator: "exclude",
        values: ["white"],
      },
    });

    for (const entry of [noWhite, avoidWhite]) {
      expect(() =>
        parseDecisionCriterionForContext({
          criterion: entry,
          concept: colour,
          task: shelvingTask,
        }),
      ).not.toThrow();
    }
    expect(noWhite.strength).toBe("hard");
    expect(avoidWhite.strength).toBe("preference");

    const impossibleHardPreference = criterion({
      conceptId: colour.id,
      targetSemantics: "categorical",
      strength: "hard",
      semanticValue: {
        schemaVersion: 1,
        kind: "categorical",
        operator: "prefer",
        values: ["dark"],
      },
    });
    expect(() =>
      parseDecisionCriterionForContext({
        criterion: impossibleHardPreference,
        concept: colour,
        task: shelvingTask,
      }),
    ).toThrow(CriterionCompatibilityError);
  });

  it("normalises measurements to the concept's canonical unit", () => {
    const width = concept({
      id: ids.conceptWidth,
      label: "Maximum width",
      valueFamily: "measurement",
      canonicalUnit: "cm",
    });
    const widthCriterion = criterion({
      conceptId: width.id,
      targetSemantics: "range",
      strength: "hard",
      semanticValue: {
        schemaVersion: 1,
        kind: "measurement_range",
        upper: { amount: "0.6", inclusive: true },
        unit: "m",
      },
    });

    expect(
      parseDecisionCriterionForContext({
        criterion: widthCriterion,
        concept: width,
        task: task(ids.taskShelving),
      }).criterion.semanticValue,
    ).toEqual({
      schemaVersion: 1,
      kind: "measurement_range",
      upper: { amount: "60", inclusive: true },
      unit: "cm",
    });
  });

  it("represents only the stated shelving width and depth", () => {
    const dimensions = [
      concept({
        id: ids.conceptWidth,
        label: "Maximum width",
        valueFamily: "measurement",
        canonicalUnit: "cm",
      }),
      concept({
        id: ids.conceptDepth,
        label: "Maximum depth",
        valueFamily: "measurement",
        canonicalUnit: "cm",
      }),
    ];

    expect(dimensions.map((entry) => entry.label)).toEqual([
      "Maximum width",
      "Maximum depth",
    ]);
    expect(dimensions.some((entry) => /height/i.test(entry.label))).toBe(false);
  });

  it("keeps Nike preferred rather than Nike-only", () => {
    const brand = concept({
      id: ids.conceptBrand,
      taskId: ids.taskCap,
      label: "Brand",
      valueFamily: "categorical",
    });
    const nikePreferred = criterion({
      conceptId: brand.id,
      taskId: ids.taskCap,
      targetSemantics: "categorical",
      strength: "preference",
      semanticValue: {
        schemaVersion: 1,
        kind: "categorical",
        operator: "prefer",
        values: ["Nike"],
      },
    });

    expect(
      parseDecisionCriterionForContext({
        criterion: nikePreferred,
        concept: brand,
        task: task(ids.taskCap),
      }).criterion.semanticValue,
    ).toMatchObject({ operator: "prefer", values: ["Nike"] });
  });

  it("distinguishes omitted colour from explicit indifference", () => {
    const activeConceptLabels = ["Budget", "Maximum width", "Maximum depth"];
    expect(activeConceptLabels).not.toContain("Colour");

    const brand = concept({
      id: ids.conceptBrand,
      label: "Brand",
      valueFamily: "categorical",
    });
    const brandIndifference = criterion({
      conceptId: brand.id,
      targetSemantics: "indifferent",
      strength: null,
      semanticValue: { schemaVersion: 1, kind: "indifferent" },
    });

    expect(brandIndifference.semanticValue.kind).toBe("indifferent");
    expect(brandIndifference.strength).toBeNull();
  });

  it("does not allow null strength to masquerade as ordinary truth", () => {
    expect(() =>
      criterion({
        conceptId: ids.conceptBrand,
        targetSemantics: "categorical",
        strength: null,
        semanticValue: {
          schemaVersion: 1,
          kind: "categorical",
          operator: "prefer",
          values: ["Nike"],
        },
      }),
    ).toThrow();
  });

  it("rejects cross-task criterion ownership", () => {
    const capBrand = concept({
      id: ids.conceptBrand,
      taskId: ids.taskCap,
      label: "Brand",
      valueFamily: "categorical",
    });
    const shelvingCriterion = criterion({
      conceptId: capBrand.id,
      taskId: ids.taskShelving,
      targetSemantics: "categorical",
      semanticValue: {
        schemaVersion: 1,
        kind: "categorical",
        operator: "prefer",
        values: ["dark"],
      },
    });

    expect(() =>
      parseDecisionCriterionForContext({
        criterion: shelvingCriterion,
        concept: capBrand,
        task: task(ids.taskShelving),
      }),
    ).toThrow(CriterionCompatibilityError);
  });

  it("types comparisons but rejects persistence until candidate identity exists", () => {
    const width = concept({
      id: ids.conceptWidth,
      taskId: ids.taskCap,
      label: "Physical bulk",
      valueFamily: "qualitative",
    });
    const comparison = criterion({
      conceptId: width.id,
      taskId: ids.taskCap,
      targetSemantics: "comparative",
      semanticValue: {
        schemaVersion: 1,
        kind: "comparison",
        relation: "less_than",
        reference: {
          kind: "candidate_listing",
          taskId: ids.taskCap,
          candidateListingId: ids.candidate,
        },
      },
    });

    expect(() =>
      parseDecisionCriterionForContext({
        criterion: comparison,
        concept: width,
        task: task(ids.taskCap),
      }),
    ).not.toThrow();
    expect(() => assertCriterionPersistable(comparison)).toThrow(
      CandidateIdentityNotAvailableError,
    );
  });

  it("requires referentially useful origin and confirmation sources", () => {
    const budget = concept({
      id: ids.conceptBudget,
      label: "Budget",
      valueFamily: "money",
    });
    const confirmed = criterion({
      conceptId: budget.id,
      authority: "user_confirmed",
      targetSemantics: "around",
      semanticValue: {
        schemaVersion: 1,
        kind: "money",
        mode: "target",
        amountMinor: 3000,
        currency: "GBP",
      },
    });
    const origin = {
      id: ids.sourceOrigin,
      taskId: ids.taskShelving,
      criterionId: confirmed.id,
      sourceRole: "origin",
      sourceKind: "message",
      taskInputId: ids.input,
      messageId: ids.message,
      createdAt: instant,
    };
    const confirmation = {
      id: ids.sourceConfirmation,
      taskId: ids.taskShelving,
      criterionId: confirmed.id,
      sourceRole: "confirmation",
      sourceKind: "question_answer",
      taskInputId: ids.input,
      messageId: null,
      createdAt: instant,
    };

    expect(
      validateCriterionSources({
        criterion: confirmed,
        sources: [origin, confirmation],
      }),
    ).toHaveLength(2);
    expect(() =>
      validateCriterionSources({ criterion: confirmed, sources: [origin] }),
    ).toThrow(ProvenanceValidationError);
  });
});
