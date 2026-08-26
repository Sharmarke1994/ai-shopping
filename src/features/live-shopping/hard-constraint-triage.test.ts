import { describe, expect, it } from "vitest";
import { shoppingBriefV1Schema } from "@/domain/shopping-state/brief";
import { candidateListingSchema } from "@/features/retrieval-spike/contracts";
import { triageListingAgainstHardCriteria } from "./hard-constraint-triage";

const taskId = "11111111-1111-4111-8111-111111111111";

function brief() {
  return shoppingBriefV1Schema.parse({
    schemaVersion: 1,
    taskId,
    revision: 1n,
    market: { country: "GB", language: "en-GB", currency: "GBP" },
    items: [
      {
        criterionId: "20000000-0000-4000-8000-000000000001",
        lineageId: "30000000-0000-4000-8000-000000000001",
        conceptId: "40000000-0000-4000-8000-000000000001",
        conceptLabel: "Budget",
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
        conceptLabel: "Brand",
        conceptDefinition: "Excluded brand",
        strength: "hard",
        targetSemantics: "categorical",
        semanticValue: {
          schemaVersion: 1,
          kind: "categorical",
          operator: "exclude",
          values: ["Amazon Basics"],
        },
      },
      {
        criterionId: "20000000-0000-4000-8000-000000000003",
        lineageId: "30000000-0000-4000-8000-000000000003",
        conceptId: "40000000-0000-4000-8000-000000000003",
        conceptLabel: "Reputation",
        conceptDefinition: "Reputable manufacturer",
        strength: "hard",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "reputable brand",
        },
      },
    ],
  });
}

function listing(overrides: {
  title?: string;
  price?: { amountMinor: number; currency: "GBP" } | null;
}) {
  return candidateListingSchema.parse({
    taskId,
    runId: "50000000-0000-4000-8000-000000000001",
    queryId: "60000000-0000-4000-8000-000000000001",
    provider: "fixture",
    providerResultId: "fixture:one",
    sourceRank: 1,
    surface: "shopping",
    title: overrides.title ?? "Slim metal shelf",
    url: "https://shop.example/shelf",
    canonicalUrl: "https://shop.example/shelf",
    merchantDestinationUrl: "https://shop.example/shelf",
    merchant: "Example Retailer",
    price: overrides.price ?? { amountMinor: 4500, currency: "GBP" },
    priceText: "£45",
    imageUrl: null,
    deliveryText: null,
    availabilityText: null,
    retrievedAt: new Date("2026-08-25T12:00:00.000Z"),
  });
}

describe("hard-constraint result triage", () => {
  it("withholds only directly observed conflicts and leaves unsupported suitability unknown", () => {
    const result = triageListingAgainstHardCriteria({
      brief: brief(),
      listing: listing({ price: { amountMinor: 6500, currency: "GBP" } }),
    });

    expect(result.hasDirectConflict).toBe(true);
    expect(result.criteria.map(({ state }) => state)).toEqual([
      "conflicts",
      "unknown",
      "unknown",
    ]);
  });

  it("recognises an explicit excluded name without inferring brand reputation", () => {
    const result = triageListingAgainstHardCriteria({
      brief: brief(),
      listing: listing({ title: "Amazon Basics slim shelving unit" }),
    });

    expect(result.criteria).toEqual([
      expect.objectContaining({ state: "meets", reason: "observed_price" }),
      expect.objectContaining({
        state: "conflicts",
        reason: "explicit_exclusion",
      }),
      expect.objectContaining({
        state: "unknown",
        reason: "not_directly_comparable",
      }),
    ]);
  });

  it("recognises an explicitly excluded multiword brand when a listing concatenates it", () => {
    const result = triageListingAgainstHardCriteria({
      brief: brief(),
      listing: listing({ title: "AmazonBasics ergonomic wireless mouse" }),
    });

    expect(result.hasDirectConflict).toBe(true);
    expect(result.criteria[1]).toMatchObject({
      state: "conflicts",
      reason: "explicit_exclusion",
    });
  });
});
