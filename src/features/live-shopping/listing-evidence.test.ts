import { describe, expect, it } from "vitest";
import { shoppingBriefV1Schema } from "@/domain/shopping-state/brief";
import { candidateListingSchema } from "@/features/retrieval-spike/contracts";
import { summarizeListingEvidence } from "./listing-evidence";

const taskId = "11111111-1111-4111-8111-111111111111";

function brief() {
  return shoppingBriefV1Schema.parse({
    schemaVersion: 1,
    taskId,
    revision: 2n,
    market: { country: "GB", language: "en-GB", currency: "GBP" },
    items: [
      {
        criterionId: "20000000-0000-4000-8000-000000000001",
        lineageId: "30000000-0000-4000-8000-000000000001",
        conceptId: "40000000-0000-4000-8000-000000000001",
        conceptLabel: "Price",
        conceptDefinition: "Maximum spend",
        strength: "hard",
        targetSemantics: "range",
        semanticValue: {
          schemaVersion: 1,
          kind: "money",
          mode: "ceiling",
          amountMinor: 5000,
          currency: "GBP",
        },
      },
      {
        criterionId: "20000000-0000-4000-8000-000000000002",
        lineageId: "30000000-0000-4000-8000-000000000002",
        conceptId: "40000000-0000-4000-8000-000000000002",
        conceptLabel: "Wireless connectivity",
        conceptDefinition: "Whether the mouse connects without a cable",
        strength: "hard",
        targetSemantics: "categorical",
        semanticValue: { schemaVersion: 1, kind: "boolean", value: true },
      },
      {
        criterionId: "20000000-0000-4000-8000-000000000003",
        lineageId: "30000000-0000-4000-8000-000000000003",
        conceptId: "40000000-0000-4000-8000-000000000003",
        conceptLabel: "Battery life",
        conceptDefinition: "How long the battery lasts",
        strength: "strong_preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "strong battery life",
        },
      },
    ],
  });
}

function listing(title: string) {
  return candidateListingSchema.parse({
    taskId,
    runId: "50000000-0000-4000-8000-000000000001",
    queryId: "60000000-0000-4000-8000-000000000001",
    provider: "fixture",
    providerResultId: title,
    sourceRank: 1,
    surface: "shopping",
    title,
    url: "https://shop.example/mouse",
    canonicalUrl: "https://shop.example/mouse",
    merchantDestinationUrl: "https://shop.example/mouse",
    merchantDestinationSource: "shopping_result",
    merchant: "Example retailer",
    price: { amountMinor: 2599, currency: "GBP" },
    priceText: "£25.99",
    imageUrl: null,
    deliveryText: null,
    availabilityText: null,
    reviewEvidence: null,
    retrievedAt: new Date("2026-08-26T12:00:00.000Z"),
  });
}

describe("listing evidence summary", () => {
  it("separates directly observed support from important unknowns", () => {
    expect(
      summarizeListingEvidence({
        brief: brief(),
        listing: listing("Trust Bayo II Ergonomic Wireless Mouse"),
      }),
    ).toEqual({
      sourceFacts: [],
      directlyEvidenced: [
        "£25.99 is within your £50 maximum",
        "Listing title says wireless",
      ],
      contradictions: [],
      unverifiedLabels: ["Battery life"],
      additionalUnverifiedCount: 0,
      hasDirectNonPriceSupport: true,
    });
  });

  it("does not infer wireless or battery life from an ergonomic title", () => {
    const result = summarizeListingEvidence({
      brief: brief(),
      listing: listing("Trust Verto Ergonomic Optical Mouse"),
    });

    expect(result.directlyEvidenced).toEqual([
      "£25.99 is within your £50 maximum",
    ]);
    expect(result.unverifiedLabels).toEqual([
      "Wireless connectivity",
      "Battery life",
    ]);
    expect(result.hasDirectNonPriceSupport).toBe(false);
  });

  it("shows an attributable retailer rating without claiming it satisfies review quality", () => {
    const candidate = candidateListingSchema.parse({
      ...listing("Trust Bayo II Ergonomic Wireless Mouse"),
      merchant: "Argos",
      merchantDestinationUrl: "https://www.argos.co.uk/product/6827043",
      merchantDestinationSource: "verified_organic",
      reviewEvidence: {
        kind: "provider_structured_rating",
        ratingHundredths: 460,
        scaleHundredths: 500,
        reviewCount: 29,
        sourceUrl: "https://www.argos.co.uk/product/6827043",
      },
    });

    const result = summarizeListingEvidence({
      brief: brief(),
      listing: candidate,
    });

    expect(result.sourceFacts).toEqual([
      "Argos result reports 4.6/5 from 29 reviews",
    ]);
    expect(result.unverifiedLabels).toContain("Battery life");
  });

  it("keeps a direct contradiction explicit for previously saved listings", () => {
    const result = summarizeListingEvidence({
      brief: brief(),
      listing: listing("TECKNET Ergonomic Wired Mouse"),
    });

    expect(result.contradictions).toEqual([
      "Listing title contradicts a must-have",
    ]);
  });
});
