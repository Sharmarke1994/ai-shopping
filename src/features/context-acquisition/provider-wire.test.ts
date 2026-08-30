import { describe, expect, it } from "vitest";
import {
  contextActionProviderWireV1Schema,
  interpretationProviderWireV1Schema,
  lowerContextActionProviderWireV1,
  lowerInterpretationProviderWireV1,
} from "./provider-wire";

const conceptId = "00000000-0000-4000-8000-000000000001";
const criterionId = "00000000-0000-4000-8000-000000000002";
const otherCriterionId = "00000000-0000-4000-8000-000000000003";

const booleanTarget = {
  strength: "preference" as const,
  targetSemantics: "exact" as const,
  semanticValue: {
    schemaVersion: 1 as const,
    kind: "boolean" as const,
    value: true,
  },
};

function changeWire(operations: readonly unknown[]) {
  return {
    providerSchemaVersion: 1,
    outcome: "change",
    operations,
    ambiguities: [],
  };
}

function replaceTarget(
  semanticValue: Record<string, unknown>,
  targetSemantics: string,
) {
  return {
    op: "replace_target",
    targetCriterionId: criterionId,
    result: {
      strength: "strong_preference",
      targetSemantics,
      semanticValue,
    },
  };
}

describe("interpretation provider wire V1", () => {
  it.each([
    [
      "conditional wireless preference",
      "preference",
      "wireless only when battery life is very good",
    ],
    ["conditional monitor fit", "preference", "larger monitor if it fits"],
    [
      "conditional delivery cost",
      "preference",
      "faster delivery if it is not much more expensive",
    ],
    ["explicit hard battery", "hard", "at least 40 minutes"],
    ["explicit hard dimension", "hard", "no more than 25 cm wide"],
    ["hard exclusion", "hard", "not Amazon Basics"],
    ["hard categorical only", "hard", "only black"],
    ["ordinary soft language", "preference", "lighter"],
    ["strong soft language", "strong_preference", "comfort matters a lot"],
  ])(
    "preserves provider authority for %s while lowering qualitative text",
    (_, strength, text) => {
      const lowered = lowerInterpretationProviderWireV1(
        changeWire([
          {
            op: "add_criterion",
            concept: { kind: "existing", conceptId },
            target: {
              strength,
              targetSemantics: "qualitative",
              semanticValue: {
                schemaVersion: 1,
                kind: "qualitative_text",
                text,
              },
            },
          },
        ]),
      );

      expect(lowered.patch).toMatchObject({
        outcome: "change",
        operations: [
          {
            op: "add_criterion",
            target: {
              strength,
              targetSemantics: "qualitative",
              semanticValue: { mode: "text", text },
            },
          },
        ],
      });
    },
  );

  it("lowers every supported patch operation without changing selectors or values", () => {
    const operations = [
      {
        op: "create_concept",
        localRef: "concept_brand",
        label: " Brand ",
        definition: " Preferred manufacturer ",
        valueFamily: "categorical",
        canonicalUnit: null,
      },
      {
        op: "add_criterion",
        concept: { kind: "created", localRef: "concept_brand" },
        target: booleanTarget,
      },
      {
        op: "replace_target",
        targetCriterionId: criterionId,
        result: booleanTarget,
      },
      {
        op: "relax",
        targetCriterionId: criterionId,
        result: booleanTarget,
      },
      {
        op: "tighten",
        targetCriterionId: criterionId,
        result: { ...booleanTarget, strength: "hard" },
      },
      { op: "remove", targetCriterionId: criterionId },
      {
        op: "mark_indifferent",
        concept: { kind: "existing", conceptId },
        replacesCriterionIds: [criterionId, otherCriterionId],
      },
    ];

    const lowered = lowerInterpretationProviderWireV1(changeWire(operations));

    expect(lowered.patch).toEqual({
      schemaVersion: 1,
      outcome: "change",
      operations,
    });
    expect(lowered).toHaveProperty("schemaVersion", 1);
  });

  it.each([
    [
      "boolean",
      { schemaVersion: 1, kind: "boolean", value: false },
      "exact",
      { schemaVersion: 1, kind: "boolean", value: false },
    ],
    [
      "qualitative text",
      { schemaVersion: 1, kind: "qualitative_text", text: " barely there " },
      "qualitative",
      {
        schemaVersion: 1,
        kind: "qualitative",
        mode: "text",
        text: " barely there ",
      },
    ],
    [
      "qualitative ordinal",
      {
        schemaVersion: 1,
        kind: "qualitative_ordinal",
        relation: "less",
        anchor: "clamping pressure",
      },
      "qualitative",
      {
        schemaVersion: 1,
        kind: "qualitative",
        mode: "ordinal",
        relation: "less",
        anchor: "clamping pressure",
      },
    ],
    [
      "measurement",
      { schemaVersion: 1, kind: "measurement", amount: "60", unit: "cm" },
      "around",
      { schemaVersion: 1, kind: "measurement", amount: "60", unit: "cm" },
    ],
    [
      "measurement range",
      {
        schemaVersion: 1,
        kind: "measurement_range",
        lower: null,
        upper: { amount: "60", inclusive: true },
        unit: "cm",
      },
      "range",
      {
        schemaVersion: 1,
        kind: "measurement_range",
        upper: { amount: "60", inclusive: true },
        unit: "cm",
      },
    ],
    [
      "money target",
      {
        schemaVersion: 1,
        kind: "money",
        mode: "target",
        amountMinor: 3000,
        currency: "GBP",
      },
      "around",
      {
        schemaVersion: 1,
        kind: "money",
        mode: "target",
        amountMinor: 3000,
        currency: "GBP",
      },
    ],
    [
      "money ceiling",
      {
        schemaVersion: 1,
        kind: "money",
        mode: "ceiling",
        amountMinor: 4000,
        currency: "GBP",
      },
      "range",
      {
        schemaVersion: 1,
        kind: "money",
        mode: "ceiling",
        amountMinor: 4000,
        currency: "GBP",
      },
    ],
    [
      "money stretch",
      {
        schemaVersion: 1,
        kind: "money_stretch",
        targetMinor: 3000,
        stretchCeilingMinor: 4000,
        currency: "GBP",
        condition: "if it looks visually light",
      },
      "stretch",
      {
        schemaVersion: 1,
        kind: "money_stretch",
        targetMinor: 3000,
        stretchCeilingMinor: 4000,
        currency: "GBP",
        condition: "if it looks visually light",
      },
    ],
    [
      "categorical",
      {
        schemaVersion: 1,
        kind: "categorical",
        operator: "exclude",
        values: ["White"],
      },
      "categorical",
      {
        schemaVersion: 1,
        kind: "categorical",
        operator: "exclude",
        values: ["White"],
      },
    ],
  ])(
    "lowers the %s semantic-value wire branch",
    (_, wire, semantics, domain) => {
      const lowered = lowerInterpretationProviderWireV1(
        changeWire([replaceTarget(wire, semantics)]),
      );
      if (lowered.patch.outcome !== "change")
        throw new Error("Expected change");
      expect(lowered.patch.operations[0]).toMatchObject({
        op: "replace_target",
        result: { semanticValue: domain },
      });
    },
  );

  it("preserves bounded ambiguities outside the authoritative patch", () => {
    const ambiguity = {
      kind: "unclear_reference",
      summary: "Number three has no candidate identity yet",
      existingConceptId: null,
      affectedCriterionIds: [criterionId],
    } as const;
    expect(
      lowerInterpretationProviderWireV1({
        providerSchemaVersion: 1,
        outcome: "no_change",
        operations: [],
        ambiguities: [ambiguity],
      }),
    ).toEqual({
      schemaVersion: 1,
      patch: { schemaVersion: 1, outcome: "no_change" },
      ambiguities: [ambiguity],
    });
  });

  it("rejects incoherent outcome, target, range, concept-unit, and comparison branches", () => {
    const invalidInputs = [
      changeWire([]),
      {
        providerSchemaVersion: 1,
        outcome: "no_change",
        operations: [{ op: "remove", targetCriterionId: criterionId }],
        ambiguities: [],
      },
      changeWire([
        replaceTarget(
          { schemaVersion: 1, kind: "boolean", value: true },
          "qualitative",
        ),
      ]),
      changeWire([
        replaceTarget(
          {
            schemaVersion: 1,
            kind: "measurement_range",
            lower: null,
            upper: null,
            unit: "cm",
          },
          "range",
        ),
      ]),
      changeWire([
        {
          op: "create_concept",
          localRef: "concept_width",
          label: "Width",
          definition: "Physical width",
          valueFamily: "measurement",
          canonicalUnit: null,
        },
      ]),
      changeWire([
        replaceTarget(
          {
            schemaVersion: 1,
            kind: "comparison",
            relation: "more_than",
            reference: {
              kind: "candidate_listing",
              candidateListingId: conceptId,
            },
          },
          "comparative",
        ),
      ]),
    ];
    for (const input of invalidInputs) {
      expect(() => lowerInterpretationProviderWireV1(input)).toThrow();
    }
  });

  it("rejects missing and extra fields at the root and in nested objects", () => {
    expect(() =>
      interpretationProviderWireV1Schema.parse({
        providerSchemaVersion: 1,
        outcome: "no_change",
        operations: [],
      }),
    ).toThrow();
    expect(() =>
      interpretationProviderWireV1Schema.parse({
        providerSchemaVersion: 1,
        outcome: "change",
        operations: [
          {
            op: "remove",
            targetCriterionId: criterionId,
            guessedReason: "unused",
          },
        ],
        ambiguities: [],
        confidence: 0.9,
      }),
    ).toThrow();
  });
});

describe("context-action provider wire V1", () => {
  const openQuestion = {
    prompt: "What is the maximum shelf width?",
    responseMode: "open_text" as const,
    options: [],
    expectedImpact: "eligibility" as const,
    whyNow: "Width determines whether results fit",
    canSearchWithoutAnswer: true,
  };
  const rationale = { summary: "The exact model is searchable now" };

  it("lowers ASK and non-ASK branches from one strict object root", () => {
    expect(
      lowerContextActionProviderWireV1({
        providerSchemaVersion: 1,
        action: "ask",
        question: openQuestion,
        rationale: null,
      }),
    ).toEqual({ schemaVersion: 1, action: "ask", question: openQuestion });
    for (const action of ["search", "show_refine"] as const) {
      expect(
        lowerContextActionProviderWireV1({
          providerSchemaVersion: 1,
          action,
          question: null,
          rationale,
        }),
      ).toEqual({ schemaVersion: 1, action, rationale });
    }
  });

  it("accepts two-to-four unique visible options for single select", () => {
    const question = {
      ...openQuestion,
      responseMode: "single_select",
      options: ["Under 60 cm", "I am flexible"],
    };
    expect(
      contextActionProviderWireV1Schema.parse({
        providerSchemaVersion: 1,
        action: "ask",
        question,
        rationale: null,
      }),
    ).toMatchObject({ question });
  });

  it("rejects incoherent null wrappers, option modes, and extra fields", () => {
    const invalidInputs = [
      {
        providerSchemaVersion: 1,
        action: "ask",
        question: null,
        rationale: null,
      },
      {
        providerSchemaVersion: 1,
        action: "search",
        question: openQuestion,
        rationale,
      },
      {
        providerSchemaVersion: 1,
        action: "show_refine",
        question: null,
        rationale: null,
      },
      {
        providerSchemaVersion: 1,
        action: "ask",
        question: { ...openQuestion, options: ["Anything"] },
        rationale: null,
      },
      {
        providerSchemaVersion: 1,
        action: "ask",
        question: {
          ...openQuestion,
          responseMode: "single_select",
          options: ["Dark", "dark"],
        },
        rationale: null,
      },
      {
        providerSchemaVersion: 1,
        action: "search",
        question: null,
        rationale: { ...rationale, score: 1 },
      },
    ];
    for (const input of invalidInputs) {
      expect(() => lowerContextActionProviderWireV1(input)).toThrow();
    }
  });
});
