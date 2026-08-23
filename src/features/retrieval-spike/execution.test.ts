import { describe, expect, it } from "vitest";
import { buildSearchQueryPortfolio } from "./query-strategy";
import { executeSearchQueryPortfolio } from "./execution";
import { FakeShoppingProvider } from "./fake-shopping-provider";

function portfolio() {
  let index = 0;
  const ids = [
    "10000000-0000-4000-8000-000000000001",
    "10000000-0000-4000-8000-000000000002",
    "10000000-0000-4000-8000-000000000003",
    "10000000-0000-4000-8000-000000000004",
    "10000000-0000-4000-8000-000000000005",
    "10000000-0000-4000-8000-000000000006",
  ];
  return buildSearchQueryPortfolio(
    {
      schemaVersion: 1,
      taskId: "11111111-1111-4111-8111-111111111111",
      revision: 0n,
      market: { country: "GB", language: "en-GB", currency: "GBP" },
      shoppingSubject: {
        text: "running cap",
        sourceInputId: "22222222-2222-4222-8222-222222222222",
      },
      brief: {
        schemaVersion: 1,
        taskId: "11111111-1111-4111-8111-111111111111",
        revision: 0n,
        market: { country: "GB", language: "en-GB", currency: "GBP" },
        items: [],
      },
      marketVocabulary: [
        {
          term: "race cap",
          rationale: "Explore commercial market language.",
          basisCriterionIds: [],
        },
      ],
    },
    { createId: () => ids[index++]! },
  );
}

describe("retrieval-spike execution", () => {
  it("executes independent queries and keeps their listing lineage", async () => {
    const input = portfolio();
    const result = await executeSearchQueryPortfolio({
      portfolio: input,
      provider: new FakeShoppingProvider(
        () => new Date("2026-08-23T12:00:00.000Z"),
      ),
    });

    expect(result.queries).toHaveLength(2);
    expect(result.listings).toHaveLength(2);
    expect(result.listings.map((listing) => listing.queryId)).toEqual(
      input.queries.map((query) => query.id),
    );
  });

  it("preserves a successful query when another provider call fails", async () => {
    const input = portfolio();
    const fake = new FakeShoppingProvider();
    const result = await executeSearchQueryPortfolio({
      portfolio: input,
      provider: {
        provider: "fixture",
        search: (query) =>
          query.purpose === "market_language"
            ? Promise.reject(new Error("provider unavailable"))
            : fake.search(query),
      },
    });

    expect(result.queries.map((query) => query.status)).toEqual([
      "completed",
      "failed",
    ]);
    expect(result.listings).toHaveLength(1);
  });

  it("isolates a fulfilled provider result with mismatched lineage", async () => {
    const input = portfolio();
    const fake = new FakeShoppingProvider();
    const result = await executeSearchQueryPortfolio({
      portfolio: input,
      provider: {
        provider: "fixture",
        search: async (query) => {
          const response = await fake.search(query);
          if (query.purpose !== "market_language") return response;
          return {
            ...response,
            listings: response.listings.map((listing) => ({
              ...listing,
              queryId: input.queries[0]!.id,
            })),
          };
        },
      },
    });

    expect(result.queries.map((query) => query.status)).toEqual([
      "completed",
      "failed",
    ]);
    expect(result.queries[1]).toMatchObject({
      status: "failed",
      errorCode: "invalid_provider_result",
    });
    expect(result.listings).toHaveLength(1);
  });

  it("isolates fulfilled provider diagnostics that cannot account for listings", async () => {
    const input = portfolio();
    const fake = new FakeShoppingProvider();
    const result = await executeSearchQueryPortfolio({
      portfolio: input,
      provider: {
        provider: "fixture",
        search: async (query) => {
          const response = await fake.search(query);
          if (query.purpose !== "market_language") return response;
          return {
            ...response,
            diagnostics: {
              receivedResultCount: 1,
              rejectedResultCount: 1,
            },
          };
        },
      },
    });

    expect(result.queries.map((query) => query.status)).toEqual([
      "completed",
      "failed",
    ]);
    expect(result.queries[1]).toMatchObject({
      status: "failed",
      errorCode: "invalid_provider_result",
    });
    expect(result.listings).toHaveLength(1);
  });
});
