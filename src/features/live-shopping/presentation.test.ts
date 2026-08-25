import { describe, expect, it } from "vitest";
import { persistedSearchRunSchema } from "@/features/retrieval-spike/persistence/contracts";
import { displayListings } from "./application";

const taskId = "10000000-0000-4000-8000-000000000001";
const runId = "20000000-0000-4000-8000-000000000001";
const actionId = "30000000-0000-4000-8000-000000000001";
const literalHypothesisId = "40000000-0000-4000-8000-000000000001";
const briefHypothesisId = "40000000-0000-4000-8000-000000000002";
const literalQueryId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const briefQueryId = "00000000-0000-4000-8000-000000000001";
const market = { country: "GB", language: "en-GB", currency: "GBP" } as const;
const observedAt = new Date("2026-08-25T12:00:00.000Z");

function listing(options: {
  id: string;
  queryId: string;
  executionId: string;
  providerResultId: string;
  rank: number;
  title: string;
  canonicalUrl: string;
}) {
  return {
    id: options.id,
    queryExecutionId: options.executionId,
    taskId,
    runId,
    queryId: options.queryId,
    provider: "fixture" as const,
    providerResultId: options.providerResultId,
    sourceRank: options.rank,
    surface: "shopping" as const,
    title: options.title,
    url: `${options.canonicalUrl}?source=${options.id}`,
    canonicalUrl: options.canonicalUrl,
    merchant: "Example merchant",
    price: { amountMinor: 2500, currency: "GBP" as const },
    priceText: "£25.00",
    imageUrl: null,
    deliveryText: null,
    availabilityText: null,
    retrievedAt: observedAt,
  };
}

describe("live product presentation", () => {
  it("uses portfolio order then source rank and counts distinct queries", () => {
    const run = persistedSearchRunSchema.parse({
      contextActionId: actionId,
      provider: "fixture",
      status: "succeeded",
      finishedAt: observedAt,
      portfolio: {
        run: {
          id: runId,
          taskId,
          taskRevision: 1n,
          market,
          queryStrategyVersion: "retrieval-spike-v1",
          startedAt: observedAt,
        },
        hypotheses: [
          {
            id: literalHypothesisId,
            runId,
            kind: "literal",
            rationale: "Preserve the shopper wording.",
            sourceTextIsBasis: true,
            basisCriterionIds: [],
          },
          {
            id: briefHypothesisId,
            runId,
            kind: "brief_expansion",
            rationale: "Use the authoritative brief.",
            sourceTextIsBasis: true,
            basisCriterionIds: [],
          },
        ],
        queries: [
          {
            id: literalQueryId,
            runId,
            taskId,
            taskRevision: 1n,
            hypothesisId: literalHypothesisId,
            purpose: "literal_precision",
            text: "light breathable running cap",
            market,
            surface: "shopping",
            limit: 8,
          },
          {
            id: briefQueryId,
            runId,
            taskId,
            taskRevision: 1n,
            hypothesisId: briefHypothesisId,
            purpose: "brief_recall",
            text: "running cap airflow lightweight hot weather",
            market,
            surface: "shopping",
            limit: 8,
          },
        ],
      },
      queryExecutions: [],
      listings: [
        listing({
          id: "50000000-0000-4000-8000-000000000001",
          executionId: "60000000-0000-4000-8000-000000000001",
          queryId: literalQueryId,
          providerResultId: "shared-catalogue-row",
          rank: 1,
          title: "Shared product",
          canonicalUrl: "https://example.test/shared",
        }),
        listing({
          id: "50000000-0000-4000-8000-000000000002",
          executionId: "60000000-0000-4000-8000-000000000001",
          queryId: literalQueryId,
          providerResultId: "shared-catalogue-row",
          rank: 1,
          title: "Shared product duplicate",
          canonicalUrl: "https://example.test/shared",
        }),
        listing({
          id: "50000000-0000-4000-8000-000000000003",
          executionId: "60000000-0000-4000-8000-000000000001",
          queryId: literalQueryId,
          providerResultId: "literal-second",
          rank: 2,
          title: "Literal query second result",
          canonicalUrl: "https://example.test/literal-second",
        }),
        listing({
          id: "50000000-0000-4000-8000-000000000004",
          executionId: "60000000-0000-4000-8000-000000000002",
          queryId: briefQueryId,
          providerResultId: "expanded-first",
          rank: 1,
          title: "Expanded query first result",
          canonicalUrl: "https://example.test/expanded-first",
        }),
        listing({
          id: "50000000-0000-4000-8000-000000000005",
          executionId: "60000000-0000-4000-8000-000000000002",
          queryId: briefQueryId,
          providerResultId: "shared-catalogue-row",
          rank: 2,
          title: "Shared product",
          canonicalUrl: "https://example.test/shared",
        }),
      ],
    });

    const presented = displayListings(run);

    expect(presented.map(({ title }) => title)).toEqual([
      "Shared product",
      "Literal query second result",
      "Expanded query first result",
    ]);
    expect(presented[0]?.foundAcrossQueries).toBe(2);
  });
});
