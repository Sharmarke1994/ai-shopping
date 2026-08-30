import { describe, expect, it } from "vitest";
import {
  classifyProductUnderstandingValidationError,
  diagnoseProductUnderstandingFailure,
  productUnderstandingValidationErrorCode,
} from "./failure-taxonomy";
import {
  productUnderstandingInputV1Schema,
  productUnderstandingProviderStructuredOutputSchema,
  productUnderstandingProviderWireV1Schema,
  productUnderstandingProviderWireV1SchemaForInput,
} from "./provider-wire";

function broadInput() {
  return productUnderstandingInputV1Schema.parse({
    schemaVersion: 1,
    market: { country: "GB", language: "en-GB", currency: "GBP" },
    candidate: {
      title: "Historical broad-shape candidate",
      merchant: "Retailer",
      observedPriceText: "£39.99",
    },
    criteria: Array.from({ length: 8 }, (_, ordinal) => ({
      ordinal,
      label: `Criterion ${ordinal}`,
      definition: `Definition ${ordinal}`,
      strength: "preference" as const,
      targetSemantics: "qualitative" as const,
      value: {
        schemaVersion: 1,
        kind: "qualitative",
        mode: "text",
        text: `preference ${ordinal}`,
      },
    })),
    sources: Array.from({ length: 4 }, (_, ordinal) => ({
      ordinal,
      role: ordinal === 0 ? ("retailer" as const) : ("other" as const),
      kind:
        ordinal === 0
          ? ("listing_field" as const)
          : ("organic_result" as const),
      title: `Source ${ordinal}`,
      url: `https://source-${ordinal}.example/product`,
      excerpt: `Bounded excerpt ${ordinal}`,
    })),
  });
}

function validBroadOutput() {
  return {
    providerSchemaVersion: 1 as const,
    observations: Array.from({ length: 8 }, (_, criterionOrdinal) => ({
      localRef: `fact_${criterionOrdinal}`,
      sourceOrdinal: criterionOrdinal % 4,
      criterionOrdinal,
      support: "supported" as const,
      observationKind: "source_assertion" as const,
      propertyLabel: `Property ${criterionOrdinal}`,
      claim: `The source states fact ${criterionOrdinal}.`,
      value: {
        schemaVersion: 1 as const,
        kind: "text" as const,
        text: `fact ${criterionOrdinal}`,
      },
      derivation: "model_text" as const,
    })),
    assessments: Array.from({ length: 8 }, (_, criterionOrdinal) => ({
      criterionOrdinal,
      status: "meets" as const,
      relation: "source_support",
      explanation: `Fact ${criterionOrdinal} supports this criterion.`,
      observationRefs: [`fact_${criterionOrdinal}`],
    })),
  };
}

const metadata = {
  provider: "openai",
  model: "test-model",
  promptVersion: "test-prompt",
  providerSchemaVersion: 1,
  providerRequestId: "req_sanitized",
  durationMs: 10,
  inputTokens: 100,
  outputTokens: 200,
} as const;

describe("product-understanding failure taxonomy", () => {
  it("classifies provider JSON and exact broad assessment coverage failures", () => {
    expect(
      classifyProductUnderstandingValidationError(new SyntaxError("bad json")),
    ).toMatchObject({ rule: "provider_output_invalid_json" });

    const input = broadInput();
    const output = validBroadOutput();
    const result = productUnderstandingProviderStructuredOutputSchema({
      input,
      requireCriterionBinding: false,
    }).safeParse({
      ...output,
      assessments: output.assessments.slice(0, 7),
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected bounded schema rejection");
    expect(classifyProductUnderstandingValidationError(result.error)).toEqual({
      rule: "assessment_count_mismatch",
      offendingCriterionOrdinal: null,
      offendingSourceOrdinal: null,
    });
  });

  it("reports an out-of-scope source without retaining provider product text", () => {
    const input = broadInput();
    const output =
      productUnderstandingProviderWireV1Schema.parse(validBroadOutput());
    const outOfScope = {
      ...output,
      observations: output.observations.map((observation, index) =>
        index === 0 ? { ...observation, sourceOrdinal: 19 } : observation,
      ),
    };
    expect(
      productUnderstandingProviderWireV1Schema.safeParse(outOfScope).success,
    ).toBe(true);
    const scoped = productUnderstandingProviderWireV1SchemaForInput({
      input,
      requireCriterionBinding: false,
    }).safeParse(outOfScope);
    expect(scoped.success).toBe(false);
    if (scoped.success) throw new Error("Expected input-scope rejection");

    const diagnostic = diagnoseProductUnderstandingFailure({
      result: { status: "completed", value: outOfScope, metadata },
      scopedValidationError: scoped.error,
      input,
      policy: { requireCriterionBinding: false },
      candidateListingId: "1759d960-3918-48ed-a0a7-3dd11cfb92af",
      researchPhase: "first_pass",
    });
    expect(diagnostic).toEqual({
      failureCode: "invalid_model_output",
      category: "application_scope_contract",
      rule: "observation_source_ordinal_out_of_scope",
      candidateListingId: "1759d960-3918-48ed-a0a7-3dd11cfb92af",
      researchPhase: "first_pass",
      requireCriterionBinding: false,
      criterionCount: 8,
      sourceCount: 4,
      offendingCriterionOrdinal: null,
      offendingSourceOrdinal: 19,
      providerRequestId: "req_sanitized",
    });
    expect(JSON.stringify(diagnostic)).not.toContain(
      "Historical broad-shape candidate",
    );

    const wrongDerivation = productUnderstandingProviderWireV1SchemaForInput({
      input,
      requireCriterionBinding: false,
    }).safeParse({
      ...output,
      observations: output.observations.map((observation, index) =>
        index === 0
          ? { ...observation, derivation: "model_visual" }
          : observation,
      ),
    });
    expect(wrongDerivation.success).toBe(false);
    if (wrongDerivation.success)
      throw new Error("Expected evidence-binding rejection");
    expect(
      classifyProductUnderstandingValidationError(wrongDerivation.error),
    ).toMatchObject({
      rule: "observation_evidence_binding_invalid",
      offendingSourceOrdinal: 0,
    });
  });

  it("creates a bounded provider rule instead of a raw validation error", () => {
    const input = broadInput();
    const output = validBroadOutput();
    const result = productUnderstandingProviderStructuredOutputSchema({
      input,
      requireCriterionBinding: false,
    }).safeParse({
      ...output,
      assessments: [
        output.assessments[0],
        output.assessments[0],
        ...output.assessments.slice(2),
      ],
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected duplicate rejection");
    expect(productUnderstandingValidationErrorCode(result.error)).toBe(
      "product_understanding_assessment_criterion_duplicate",
    );

    expect(
      diagnoseProductUnderstandingFailure({
        result: {
          status: "malformed",
          errorCode: "product_understanding_assessment_criterion_duplicate",
          metadata,
        },
        input,
        policy: { requireCriterionBinding: false },
        candidateListingId: "1759d960-3918-48ed-a0a7-3dd11cfb92af",
        researchPhase: "first_pass",
      }),
    ).toMatchObject({
      failureCode: "invalid_model_output",
      category: "provider_output_contract",
      rule: "assessment_criterion_duplicate",
      criterionCount: 8,
      sourceCount: 4,
      providerRequestId: "req_sanitized",
    });
  });
});
