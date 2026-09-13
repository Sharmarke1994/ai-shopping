import { describe, expect, it } from "vitest";
import { extractCorpusEvidence } from "../../../tests/support/founder-product-evidence";
import type { ProductUnderstandingInputV1 } from "./provider-wire";

function input(
  claim: string,
  value: Record<string, unknown> = {},
  label = "Comfort for long workdays",
): ProductUnderstandingInputV1 {
  return {
    schemaVersion: 1,
    market: { country: "GB", language: "en-GB", currency: "GBP" },
    candidate: {
      title: "Arbitrary fictional candidate",
      merchant: null,
      observedPriceText: null,
    },
    criteria: [
      {
        ordinal: 0,
        label,
        definition: label,
        strength: "strong_preference",
        targetSemantics: "qualitative",
        value,
      },
    ],
    sources: [
      {
        ordinal: 0,
        kind: "fetched_page",
        role: "independent_review",
        title: "Exact fixture page",
        url: "https://example.test/review",
        excerpt: `Specification: ${label}: ${claim}`,
      },
    ],
  };
}
describe("founder source-row fixture extractor", () => {
  it("reads actual source content without candidate identity affecting output", () => {
    const source = input(
      "The reviewer remained comfortable after several full workdays.",
    );
    const result = extractCorpusEvidence(source);
    expect(result).toEqual(
      extractCorpusEvidence({
        ...source,
        candidate: {
          ...source.candidate,
          title: "Different candidate with worse source rank",
        },
      }),
    );
    expect(result.observations[0]?.claim).toContain("several full workdays");
    expect(result.assessments[0]?.status).toBe("meets");
  });
  it("leaves explicitly untested comfort unknown, not negative", () => {
    expect(
      extractCorpusEvidence(
        input(
          "The review does not evaluate comfort over extended working sessions.",
        ),
      ).assessments[0]?.status,
    ).toBe("uncertain");
  });
  it("does not turn snippets or absent rows into fetched-page evidence", () => {
    const source = input("Comfortable during full working days.");
    expect(
      extractCorpusEvidence({
        ...source,
        sources: source.sources.map((s) => ({ ...s, kind: "organic_result" })),
      }).observations,
    ).toEqual([]);
  });
  it("extracts exact quantities before comparing with authoritative bounds", () => {
    const result = extractCorpusEvidence(
      input(
        "29 cm",
        {
          kind: "measurement_range",
          upper: { amount: "25", inclusive: true },
          unit: "cm",
        },
        "Machine width",
      ),
    );
    expect(result.observations[0]?.value).toMatchObject({
      kind: "quantity",
      amount: "29",
      unit: "cm",
    });
    expect(result.assessments[0]?.status).toBe("conflicts");
  });
  it("preserves rating evidence in integer hundredths without inventing precision", () => {
    expect(
      extractCorpusEvidence(input("4.4/5; 128 reviews", {}, "Reviews"))
        .observations[0]?.value,
    ).toMatchObject({ ratingHundredths: 440, reviewCount: 128 });
  });
});
