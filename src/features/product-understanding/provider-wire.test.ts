import { describe, expect, it } from "vitest";
import { productUnderstandingProviderWireV1Schema } from "./provider-wire";

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
});
