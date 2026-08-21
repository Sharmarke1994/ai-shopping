import { describe, expect, it } from "vitest";
import { projectShoppingBrief } from "@/domain/shopping-state/brief";
import type { ConceptDefinition } from "@/domain/shopping-state/concept-definition";
import type { DecisionCriterion } from "@/domain/shopping-state/decision-criterion";
import {
  conceptDefinitionIdSchema,
  criterionIdSchema,
  criterionLineageIdSchema,
  shoppingTaskIdSchema,
} from "@/domain/shopping-state/ids";
import type { CurrentShoppingState } from "@/domain/shopping-state/shopping-state";
import type { SemanticValue } from "@/domain/shopping-state/semantic-value";
import {
  createV005LiveEvalReport,
  evaluateGoldenCase,
  renderV005LiveEvalMarkdown,
  V0_05_GOLDEN_CASES,
} from "./golden-cases";

const taskId = shoppingTaskIdSchema.parse(
  "11111111-1111-4111-8111-111111111111",
);
const createdAt = new Date(0);

function goldenCase(name: string) {
  const result = V0_05_GOLDEN_CASES.find((entry) => entry.name === name);
  if (result === undefined) throw new Error(`Missing case ${name}`);
  return result;
}

function uuid(index: number) {
  return index.toString(16).padStart(12, "0");
}

function concept(options: {
  index: number;
  label: string;
  definition: string;
  valueFamily: ConceptDefinition["valueFamily"];
  canonicalUnit?: ConceptDefinition["canonicalUnit"];
  createdRevision?: bigint;
}): ConceptDefinition {
  return {
    id: conceptDefinitionIdSchema.parse(
      `00000000-0000-4000-8000-${uuid(options.index)}`,
    ),
    taskId,
    label: options.label,
    definition: options.definition,
    valueFamily: options.valueFamily,
    canonicalUnit: options.canonicalUnit ?? null,
    createdRevision: options.createdRevision ?? 1n,
    createdAt,
  };
}

function criterion(options: {
  index: number;
  concept: ConceptDefinition;
  semanticValue: SemanticValue;
  strength: DecisionCriterion["strength"];
  targetSemantics: DecisionCriterion["targetSemantics"];
  createdRevision?: bigint;
  lineageIndex?: number;
  lifecycle?: DecisionCriterion["lifecycle"];
  endedRevision?: bigint | null;
  supersededById?: DecisionCriterion["supersededById"];
}): DecisionCriterion {
  return {
    id: criterionIdSchema.parse(
      `10000000-0000-4000-8000-${uuid(options.index)}`,
    ),
    taskId,
    lineageId: criterionLineageIdSchema.parse(
      `20000000-0000-4000-8000-${uuid(options.lineageIndex ?? options.index)}`,
    ),
    conceptId: options.concept.id,
    authority: "user_explicit",
    strength: options.strength,
    targetSemantics: options.targetSemantics,
    valueSchemaVersion: 1,
    valueKind: options.semanticValue.kind,
    semanticValue: options.semanticValue,
    lifecycle: options.lifecycle ?? "active",
    createdRevision: options.createdRevision ?? 1n,
    endedRevision: options.endedRevision ?? null,
    supersededById: options.supersededById ?? null,
    createdAt,
    updatedAt: createdAt,
  };
}

function state(options: {
  revision: bigint;
  concepts: readonly ConceptDefinition[];
  criteria: readonly DecisionCriterion[];
}): CurrentShoppingState {
  return {
    task: {
      id: taskId,
      currentRevision: options.revision,
      market: { country: "GB", language: "en-GB", currency: "GBP" },
      createdAt,
      updatedAt: createdAt,
    },
    concepts: options.concepts,
    activeCriteria: options.criteria.map((entry) => ({
      criterion: entry,
      sources: [],
    })),
  };
}

const emptyState = state({ revision: 0n, concepts: [], criteria: [] });

function evaluate(options: {
  caseName: string;
  current: CurrentShoppingState;
  action: "ask" | "search" | "show_refine";
  question?: {
    prompt: string;
    whyNow: string;
    options?: readonly string[];
  };
  baseline?: CurrentShoppingState;
  history?: readonly DecisionCriterion[];
}) {
  return evaluateGoldenCase({
    testCase: goldenCase(options.caseName),
    state: options.current,
    baselineState: options.baseline ?? emptyState,
    criterionHistory:
      options.history ??
      options.current.activeCriteria.map(({ criterion: entry }) => entry),
    brief: projectShoppingBrief(options.current),
    action:
      options.action === "ask"
        ? {
            action: "ask",
            question: {
              prompt: options.question?.prompt ?? "Unspecified question",
              whyNow: options.question?.whyNow ?? "Unspecified reason",
              options: (options.question?.options ?? []).map((label) => ({
                label,
              })),
            },
          }
        : { action: options.action },
  });
}

function validCapState() {
  const weight = concept({
    index: 1,
    label: "Mass burden",
    definition: "How low weight the cap feels in use",
    valueFamily: "qualitative",
  });
  const airflow = concept({
    index: 2,
    label: "Air exchange",
    definition: "Ventilation and airflow through the cap",
    valueFamily: "qualitative",
  });
  const criteria = [
    criterion({
      index: 1,
      concept: weight,
      strength: "preference",
      targetSemantics: "qualitative",
      semanticValue: {
        schemaVersion: 1,
        kind: "qualitative",
        mode: "text",
        text: "low weight",
      },
    }),
    criterion({
      index: 2,
      concept: airflow,
      strength: "preference",
      targetSemantics: "qualitative",
      semanticValue: {
        schemaVersion: 1,
        kind: "qualitative",
        mode: "text",
        text: "high airflow",
      },
    }),
  ];
  return state({ revision: 1n, concepts: [weight, airflow], criteria });
}

function validShelvingState() {
  const width = concept({
    index: 10,
    label: "Product width",
    definition: "Overall shelving width",
    valueFamily: "measurement",
    canonicalUnit: "cm",
  });
  const appearance = concept({
    index: 11,
    label: "Airy appearance",
    definition: "Low visual weight rather than generic design quality",
    valueFamily: "qualitative",
  });
  const budget = concept({
    index: 12,
    label: "Spending plan",
    definition: "Target spend and conditional stretch budget",
    valueFamily: "money",
  });
  const criteria = [
    criterion({
      index: 10,
      concept: width,
      strength: "hard",
      targetSemantics: "range",
      semanticValue: {
        schemaVersion: 1,
        kind: "measurement_range",
        upper: { amount: "80", inclusive: false },
        unit: "cm",
      },
    }),
    criterion({
      index: 11,
      concept: appearance,
      strength: "preference",
      targetSemantics: "qualitative",
      semanticValue: {
        schemaVersion: 1,
        kind: "qualitative",
        mode: "text",
        text: "airy appearance with low visual weight",
      },
    }),
    criterion({
      index: 12,
      concept: budget,
      strength: "preference",
      targetSemantics: "stretch",
      semanticValue: {
        schemaVersion: 1,
        kind: "money_stretch",
        targetMinor: 15_000,
        stretchCeilingMinor: 22_000,
        currency: "GBP",
        condition: "especially beautiful",
      },
    }),
  ];
  return state({
    revision: 1n,
    concepts: [width, appearance, budget],
    criteria,
  });
}

describe("V0-05 human-labelled golden evaluator", () => {
  it("accepts harmless concept wording while freezing conservative cap strengths", () => {
    expect(
      evaluate({
        caseName: "light-breathable-cap",
        current: validCapState(),
        action: "search",
      }).passed,
    ).toBe(true);
  });

  it("rejects a strengthened cap criterion and reports the exact measure", () => {
    const current = validCapState();
    current.activeCriteria[0]!.criterion.strength = "strong_preference";
    const result = evaluate({
      caseName: "light-breathable-cap",
      current,
      action: "search",
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain(
      "[criterion:lightweight:strength] expected preference, received strong_preference",
    );
  });

  it("rejects negated qualitative meaning and a negated stretch condition", () => {
    const cap = validCapState();
    const weight = cap.activeCriteria[0]!.criterion;
    weight.semanticValue = {
      schemaVersion: 1,
      kind: "qualitative",
      mode: "text",
      text: "not lightweight",
    };
    expect(
      evaluate({
        caseName: "light-breathable-cap",
        current: cap,
        action: "search",
      }).failures,
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("qualitative value does not preserve"),
      ]),
    );

    const shelving = validShelvingState();
    const budget = shelving.activeCriteria[2]!.criterion;
    if (budget.semanticValue.kind !== "money_stretch")
      throw new Error("bad fixture");
    budget.semanticValue.condition = "not especially beautiful";
    expect(
      evaluate({
        caseName: "bounded-shelving",
        current: shelving,
        action: "search",
      }).failures,
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("stretch condition does not preserve"),
      ]),
    );
  });

  it("requires the headphones ASK to resolve the unsettled priority", () => {
    const comfort = concept({
      index: 40,
      label: "Wear comfort",
      definition: "Comfort while travelling",
      valueFamily: "qualitative",
    });
    const anc = concept({
      index: 41,
      label: "Active noise cancellation",
      definition: "Reduction of train noise",
      valueFamily: "qualitative",
    });
    const current = state({
      revision: 1n,
      concepts: [comfort, anc],
      criteria: [
        criterion({
          index: 40,
          concept: comfort,
          strength: "preference",
          targetSemantics: "qualitative",
          semanticValue: {
            schemaVersion: 1,
            kind: "qualitative",
            mode: "text",
            text: "comfort",
          },
        }),
        criterion({
          index: 41,
          concept: anc,
          strength: "preference",
          targetSemantics: "qualitative",
          semanticValue: {
            schemaVersion: 1,
            kind: "qualitative",
            mode: "text",
            text: "noise cancellation",
          },
        }),
      ],
    });
    const valid = evaluate({
      caseName: "headphones-unsettled-priority",
      current,
      action: "ask",
      question: {
        prompt: "Which should take priority for the train?",
        whyNow: "Comfort and noise cancellation can lead to different options.",
        options: ["Comfort", "Noise cancellation"],
      },
    });
    expect(valid.failures).toEqual([]);

    const irrelevant = evaluate({
      caseName: "headphones-unsettled-priority",
      current,
      action: "ask",
      question: {
        prompt: "Which colour would you prefer?",
        whyNow: "Colour can narrow the shortlist.",
      },
    });
    expect(irrelevant.failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining("question does not address comfort"),
        expect.stringContaining(
          "question introduces unsupported topic: colour",
        ),
      ]),
    );
  });

  it("rejects shelving bound, unit, stretch, and target-shape corruption", () => {
    const current = validShelvingState();
    const width = current.activeCriteria[0]!.criterion;
    if (width.semanticValue.kind !== "measurement_range")
      throw new Error("bad fixture");
    width.semanticValue.upper = { amount: "80", inclusive: true };
    width.semanticValue.unit = "m";
    const budget = current.activeCriteria[2]!.criterion;
    budget.targetSemantics = "around";
    budget.semanticValue = {
      schemaVersion: 1,
      kind: "money",
      mode: "target",
      amountMinor: 15_000,
      currency: "GBP",
    };
    budget.valueKind = "money";
    const result = evaluate({
      caseName: "bounded-shelving",
      current,
      action: "search",
    });
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining("upper inclusive expected false"),
        expect.stringContaining("unit expected cm, received m"),
        expect.stringContaining("expected stretch, received around"),
        expect.stringContaining("expected kind money_stretch, received money"),
      ]),
    );
  });

  it("rejects unexpected authoritative criteria even when the visible limit would pass", () => {
    const current = validCapState();
    const brand = concept({
      index: 3,
      label: "Brand",
      definition: "Preferred manufacturer",
      valueFamily: "categorical",
    });
    current.concepts = [...current.concepts, brand];
    current.activeCriteria = [
      ...current.activeCriteria,
      {
        criterion: criterion({
          index: 3,
          concept: brand,
          strength: "preference",
          targetSemantics: "categorical",
          semanticValue: {
            schemaVersion: 1,
            kind: "categorical",
            operator: "prefer",
            values: ["Nike"],
          },
        }),
        sources: [],
      },
    ];
    expect(
      evaluate({
        caseName: "light-breathable-cap",
        current,
        action: "search",
      }).failures,
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("unexpected authoritative criteria"),
        expect.stringContaining("invented or broadened concept meaning: brand"),
      ]),
    );
  });

  it("requires a persisted supersession into authoritative hidden indifference", () => {
    const width = concept({
      index: 20,
      label: "Overall width",
      definition: "Maximum product width",
      valueFamily: "measurement",
      canonicalUnit: "cm",
      createdRevision: 1n,
    });
    const successorId = criterionIdSchema.parse(
      "10000000-0000-4000-8000-000000000015",
    );
    const predecessor = criterion({
      index: 20,
      concept: width,
      strength: "hard",
      targetSemantics: "range",
      semanticValue: {
        schemaVersion: 1,
        kind: "measurement_range",
        upper: { amount: "60", inclusive: true },
        unit: "cm",
      },
      createdRevision: 1n,
      lifecycle: "superseded",
      endedRevision: 2n,
      supersededById: successorId,
    });
    const successor = criterion({
      index: 21,
      lineageIndex: 20,
      concept: width,
      strength: null,
      targetSemantics: "indifferent",
      semanticValue: { schemaVersion: 1, kind: "indifferent" },
      createdRevision: 2n,
    });
    const baselinePredecessor = {
      ...predecessor,
      lifecycle: "active" as const,
      endedRevision: null,
      supersededById: null,
    };
    const baseline = state({
      revision: 1n,
      concepts: [width],
      criteria: [baselinePredecessor],
    });
    const current = state({
      revision: 2n,
      concepts: [width],
      criteria: [successor],
    });
    const valid = evaluate({
      caseName: "explicit-change-to-indifference",
      baseline,
      current,
      history: [predecessor, successor],
      action: "search",
    });
    expect(valid.failures).toEqual([]);
    expect(projectShoppingBrief(current).items).toHaveLength(0);

    const removed = {
      ...predecessor,
      lifecycle: "removed" as const,
      supersededById: null,
    };
    const invalid = evaluate({
      caseName: "explicit-change-to-indifference",
      baseline,
      current,
      history: [removed, successor],
      action: "search",
    });
    expect(invalid.failures).toContain(
      "[criterion:width-indifference:lifecycle] seeded criterion was not replaced through one coherent supersession lineage",
    );
  });

  it("rejects categorical direction errors and a non-search exact lookup", () => {
    const colour = concept({
      index: 30,
      label: "Finish hue",
      definition: "Surface colour",
      valueFamily: "categorical",
    });
    const red = criterion({
      index: 30,
      concept: colour,
      strength: "hard",
      targetSemantics: "categorical",
      semanticValue: {
        schemaVersion: 1,
        kind: "categorical",
        operator: "prefer",
        values: ["red"],
      },
    });
    expect(
      evaluate({
        caseName: "quoted-prompt-injection",
        current: state({ revision: 1n, concepts: [colour], criteria: [red] }),
        action: "search",
      }).failures,
    ).toContain(
      "[criterion:red-colour:semantic-value] operator expected include, received prefer",
    );
    expect(
      evaluate({
        caseName: "exact-model-lookup",
        current: emptyState,
        action: "ask",
      }).failures,
    ).toContain("[action] action ask not in search");
  });

  it("derives JSON and concise Markdown summaries from the same measure results", () => {
    const report = createV005LiveEvalReport({
      generatedAt: "2026-08-21T18:00:00.000Z",
      runsPerCase: 3,
      configuration: { model: "reviewed-model" },
      results: [
        {
          case: "exact-model-lookup",
          run: 1,
          action: "ask",
          passed: false,
          failures: ["[action] action ask not in search"],
          measures: [
            {
              measure: "action",
              passed: false,
              failures: ["action ask not in search"],
            },
          ],
          brief: [],
          attempts: [],
        },
      ],
    });
    expect(report).toMatchObject({
      schemaVersion: 2,
      totalRuns: 1,
      protectedInvariantViolations: 1,
      releaseGatePassed: false,
      perMeasure: [{ measure: "action", total: 1, passed: 0, failures: 1 }],
    });
    expect(renderV005LiveEvalMarkdown(report)).toContain(
      "| exact-model-lookup | 1 | ask | FAIL | action |",
    );
    expect(renderV005LiveEvalMarkdown(report)).toContain(
      "- **action:** action ask not in search",
    );
  });
});
