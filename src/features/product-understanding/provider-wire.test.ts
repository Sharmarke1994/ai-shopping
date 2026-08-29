import { describe, expect, it } from "vitest";
import {
  productUnderstandingInputV1Schema,
  productUnderstandingProviderStructuredOutputSchema,
  productUnderstandingProviderWireV1Schema,
  productUnderstandingProviderWireV1SchemaForInput,
} from "./provider-wire";

function focusedInput(criterionCount = 1) {
  return productUnderstandingInputV1Schema.parse({
    schemaVersion: 1,
    market: { country: "GB", language: "en-GB", currency: "GBP" },
    candidate: {
      title: "Exact candidate",
      merchant: null,
      observedPriceText: null,
    },
    criteria: Array.from({ length: criterionCount }, (_, ordinal) => ({
      ordinal,
      label: ordinal === 0 ? "Battery life" : "Long-session comfort",
      definition:
        ordinal === 0 ? "Battery endurance" : "Comfort over a working day",
      strength: "strong_preference" as const,
      targetSemantics: "qualitative" as const,
      value: {
        schemaVersion: 1,
        kind: "qualitative",
        mode: "text",
        text: ordinal === 0 ? "long battery life" : "comfortable all day",
      },
    })),
    sources: [
      {
        ordinal: 0,
        role: "manufacturer",
        kind: "fetched_page",
        title: "Exact candidate specifications",
        url: "https://example.test/specifications",
        excerpt: "The manufacturer states a battery specification.",
      },
    ],
  });
}

function proposal(options: {
  observationCriterionOrdinal: number | null;
  assessmentCriterionOrdinal: number;
  value: unknown;
  status: "meets" | "conflicts";
}) {
  return {
    providerSchemaVersion: 1 as const,
    observations: [
      {
        localRef: "evidence",
        sourceOrdinal: 0,
        criterionOrdinal: options.observationCriterionOrdinal,
        support: "supported" as const,
        observationKind: "source_assertion" as const,
        propertyLabel: "Unrelated product fact",
        claim: "The source states an unrelated product fact.",
        value: options.value,
        derivation: "model_text" as const,
      },
    ],
    assessments: [
      {
        criterionOrdinal: options.assessmentCriterionOrdinal,
        status: options.status,
        relation: "claimed_relation",
        explanation: "The unrelated fact was cited.",
        observationRefs: ["evidence"],
      },
    ],
  };
}

describe("product-understanding provider wire", () => {
  it("accepts an assessment backed by evidence for that exact criterion", () => {
    expect(
      productUnderstandingProviderWireV1Schema.safeParse(
        proposal({
          observationCriterionOrdinal: 0,
          assessmentCriterionOrdinal: 0,
          status: "meets",
          value: {
            schemaVersion: 1,
            kind: "quantity",
            amount: "40",
            unit: "hours",
            qualifier: "exact",
          },
        }),
      ).success,
    ).toBe(true);
  });

  it.each([
    {
      kind: "quantity" as const,
      value: {
        schemaVersion: 1 as const,
        kind: "quantity" as const,
        amount: "40",
        unit: "hours",
        qualifier: "exact",
      },
    },
    {
      kind: "categorical" as const,
      value: {
        schemaVersion: 1 as const,
        kind: "categorical" as const,
        values: ["red"],
      },
    },
    {
      kind: "text" as const,
      value: {
        schemaVersion: 1 as const,
        kind: "text" as const,
        text: "unrelated evidence",
      },
    },
  ])(
    "rejects unrelated $kind evidence for hard meets and conflicts",
    ({ value }) => {
      for (const status of ["meets", "conflicts"] as const) {
        const result = productUnderstandingProviderWireV1Schema.safeParse(
          proposal({
            observationCriterionOrdinal: 0,
            assessmentCriterionOrdinal: 1,
            status,
            value,
          }),
        );
        expect(result.success).toBe(false);
      }
    },
  );

  it("does not allow a criterion-free observation to support a criterion assessment", () => {
    expect(
      productUnderstandingProviderWireV1Schema.safeParse(
        proposal({
          observationCriterionOrdinal: null,
          assessmentCriterionOrdinal: 0,
          status: "meets",
          value: {
            schemaVersion: 1,
            kind: "text",
            text: "generic product context",
          },
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects non-target ordinals and criterion-free observations for a focused call", () => {
    const input = focusedInput();
    const focusedSchema = productUnderstandingProviderWireV1SchemaForInput({
      input,
      requireCriterionBinding: true,
    });
    expect(
      focusedSchema.safeParse({
        providerSchemaVersion: 1,
        observations: [],
        assessments: [
          {
            criterionOrdinal: 1,
            status: "uncertain",
            relation: "attempted_non_target",
            explanation: "This ordinal was not supplied to the model.",
            observationRefs: [],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      focusedSchema.safeParse({
        providerSchemaVersion: 1,
        observations: [
          {
            localRef: "generic_fact",
            sourceOrdinal: 0,
            criterionOrdinal: null,
            support: "supported",
            observationKind: "source_assertion",
            propertyLabel: "Unrelated fact",
            claim: "A generic fact must not escape a focused extraction.",
            value: {
              schemaVersion: 1,
              kind: "text",
              text: "unrelated",
            },
            derivation: "model_text",
          },
        ],
        assessments: [],
      }).success,
    ).toBe(false);
  });

  it("uses a structurally focused schema while preserving an honest evidence-free result", () => {
    const focusedSchema = productUnderstandingProviderStructuredOutputSchema({
      input: focusedInput(),
      requireCriterionBinding: true,
    });

    expect(
      focusedSchema.safeParse({
        providerSchemaVersion: 1,
        observations: [],
        assessments: [
          {
            criterionOrdinal: 0,
            status: "uncertain",
            relation: "insufficient_evidence",
            explanation: "No supplied source supports this criterion.",
            observationRefs: [],
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      focusedSchema.safeParse({
        providerSchemaVersion: 1,
        observations: [
          {
            localRef: "generic_fact",
            sourceOrdinal: 0,
            criterionOrdinal: null,
            support: "supported",
            observationKind: "source_assertion",
            propertyLabel: "Unrelated fact",
            claim: "This fact has no target binding.",
            value: {
              schemaVersion: 1,
              kind: "text",
              text: "unrelated",
            },
            derivation: "model_text",
          },
        ],
        assessments: [
          {
            criterionOrdinal: 0,
            status: "uncertain",
            relation: "insufficient_evidence",
            explanation: "No target evidence was emitted.",
            observationRefs: [],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("limits both focused ordinal positions and their cross-references", () => {
    const focusedSchema = productUnderstandingProviderStructuredOutputSchema({
      input: focusedInput(2),
      requireCriterionBinding: true,
    });
    const observation = {
      localRef: "battery",
      sourceOrdinal: 0,
      criterionOrdinal: 0,
      support: "supported",
      observationKind: "source_assertion",
      propertyLabel: "Battery life",
      claim: "The source states a battery specification.",
      value: {
        schemaVersion: 1,
        kind: "text",
        text: "battery specification",
      },
      derivation: "model_text",
    };

    expect(
      focusedSchema.safeParse({
        providerSchemaVersion: 1,
        observations: [{ ...observation, criterionOrdinal: 2 }],
        assessments: [
          {
            criterionOrdinal: 0,
            status: "uncertain",
            relation: "insufficient_evidence",
            explanation: "No source supports this criterion.",
            observationRefs: [],
          },
          {
            criterionOrdinal: 1,
            status: "uncertain",
            relation: "insufficient_evidence",
            explanation: "No source supports this criterion.",
            observationRefs: [],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      focusedSchema.safeParse({
        providerSchemaVersion: 1,
        observations: [observation],
        assessments: [
          {
            criterionOrdinal: 0,
            status: "uncertain",
            relation: "insufficient_evidence",
            explanation: "No source supports this criterion.",
            observationRefs: [],
          },
          {
            criterionOrdinal: 1,
            status: "meets",
            relation: "source_support",
            explanation: "This incorrectly cites the battery observation.",
            observationRefs: ["battery"],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("does not infer focused mode from a one-criterion input", () => {
    const broadSchema = productUnderstandingProviderStructuredOutputSchema({
      input: focusedInput(),
      requireCriterionBinding: false,
    });
    expect(
      broadSchema.safeParse({
        providerSchemaVersion: 1,
        observations: [
          {
            localRef: "general_fact",
            sourceOrdinal: 0,
            criterionOrdinal: null,
            support: "supported",
            observationKind: "source_assertion",
            propertyLabel: "General fact",
            claim: "The source contains a general product fact.",
            value: {
              schemaVersion: 1,
              kind: "text",
              text: "general product fact",
            },
            derivation: "model_text",
          },
        ],
        assessments: [],
      }).success,
    ).toBe(true);
  });

  it("rejects an empty focused target before a provider contract can be built", () => {
    expect(() =>
      productUnderstandingProviderStructuredOutputSchema({
        input: focusedInput(0),
        requireCriterionBinding: true,
      }),
    ).toThrow("Focused product understanding requires a criterion");
  });
});
