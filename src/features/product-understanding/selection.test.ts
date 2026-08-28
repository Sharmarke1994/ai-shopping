import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  candidateListingSchema,
  searchQueryPortfolioSchema,
} from "@/features/retrieval-spike/contracts";
import { persistedSearchRunSchema } from "@/features/retrieval-spike/persistence/contracts";
import { shoppingBriefV1Schema } from "@/domain/shopping-state/brief";
import {
  MAX_RESEARCH_CANDIDATES,
  planEvidenceSearches,
  selectResearchCandidates,
} from "./selection";

function fixture() {
  const taskId = randomUUID();
  const runId = randomUUID();
  const contextActionId = randomUUID();
  const queryIds = [randomUUID(), randomUUID(), randomUUID()];
  const hypothesisIds = [randomUUID(), randomUUID(), randomUUID()];
  const portfolio = searchQueryPortfolioSchema.parse({
    run: {
      id: runId,
      taskId,
      taskRevision: 1n,
      market: { country: "GB", language: "en-GB", currency: "GBP" },
      queryStrategyVersion: "retrieval-spike-v3",
      startedAt: new Date("2026-01-01T00:00:00Z"),
    },
    hypotheses: hypothesisIds.map((id, ordinal) => ({
      id,
      runId,
      kind:
        ordinal === 0
          ? "literal"
          : ordinal === 1
            ? "brief_expansion"
            : "market_vocabulary",
      rationale: `test hypothesis ${ordinal}`,
      sourceTextIsBasis: ordinal === 0,
      basisCriterionIds: [],
    })),
    queries: queryIds.map((id, ordinal) => ({
      id,
      runId,
      taskId,
      taskRevision: 1n,
      market: { country: "GB", language: "en-GB", currency: "GBP" },
      surface: "shopping",
      text: `mouse ${ordinal}`,
      limit: 10,
      hypothesisId: hypothesisIds[ordinal],
      purpose:
        ordinal === 0
          ? "literal_precision"
          : ordinal === 1
            ? "brief_recall"
            : "market_language",
    })),
  });
  const brief = shoppingBriefV1Schema.parse({
    schemaVersion: 1,
    taskId,
    revision: 1n,
    market: { country: "GB", language: "en-GB", currency: "GBP" },
    items: [
      {
        criterionId: randomUUID(),
        lineageId: randomUUID(),
        conceptId: randomUUID(),
        conceptLabel: "Maximum price",
        conceptDefinition: "Maximum acceptable observed price",
        strength: "hard",
        targetSemantics: "exact",
        semanticValue: {
          schemaVersion: 1,
          kind: "money",
          mode: "ceiling",
          amountMinor: 5_000,
          currency: "GBP",
        },
      },
      {
        criterionId: randomUUID(),
        lineageId: randomUUID(),
        conceptId: randomUUID(),
        conceptLabel: "Battery life",
        conceptDefinition: "Battery endurance",
        strength: "strong_preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "very good battery life",
        },
      },
      {
        criterionId: randomUUID(),
        lineageId: randomUUID(),
        conceptId: randomUUID(),
        conceptLabel: "Long-session comfort",
        conceptDefinition: "Comfort during long workdays",
        strength: "preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "comfortable over long workdays",
        },
      },
    ],
  });
  const listings = Array.from({ length: 9 }, (_, ordinal) => {
    const queryId = queryIds[ordinal % queryIds.length]!;
    return {
      id: randomUUID(),
      queryExecutionId: randomUUID(),
      ...candidateListingSchema.parse({
        taskId,
        runId,
        queryId,
        provider: "fixture",
        providerResultId: `candidate-${ordinal}`,
        sourceRank: ordinal + 1,
        surface: "shopping",
        title: `Mouse ${ordinal}`,
        url: `https://example.test/${ordinal}`,
        canonicalUrl: `https://example.test/${ordinal}`,
        merchantDestinationUrl: `https://shop.test/${ordinal}`,
        merchantDestinationSource: "shopping_result",
        merchant: "Shop",
        price:
          ordinal === 0
            ? { amountMinor: 7_000, currency: "GBP" }
            : { amountMinor: 3_000 + ordinal, currency: "GBP" },
        priceText: `£${30 + ordinal}`,
        imageUrl: null,
        deliveryText: null,
        availabilityText: null,
        reviewEvidence: null,
        retrievedAt: new Date("2026-01-01T00:00:00Z"),
      }),
    };
  });
  return {
    brief,
    run: persistedSearchRunSchema.parse({
      contextActionId,
      provider: "fixture",
      status: "succeeded",
      finishedAt: new Date("2026-01-01T00:00:01Z"),
      portfolio,
      queryExecutions: [],
      listings,
    }),
  };
}

describe("selective evidence research", () => {
  it("withholds direct hard conflicts and caps research candidates", () => {
    const { brief, run } = fixture();
    const selected = selectResearchCandidates({ brief, run });
    expect(selected).toHaveLength(MAX_RESEARCH_CANDIDATES);
    expect(selected.map(({ listing }) => listing.title)).not.toContain(
      "Mouse 0",
    );
  });

  it("produces two criterion-driven and meaningfully different hypotheses", () => {
    const { brief, run } = fixture();
    const [candidate] = selectResearchCandidates({ brief, run });
    const planned = planEvidenceSearches({ brief, candidate: candidate! });
    expect(planned).toHaveLength(2);
    expect(new Set(planned.map(({ query }) => query)).size).toBe(2);
    expect(planned[0]!.query).toContain("Battery life");
    expect(planned[1]!.query).toContain("Long-session comfort");
  });
});
