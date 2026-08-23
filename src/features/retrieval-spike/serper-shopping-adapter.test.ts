import { describe, expect, it, vi } from "vitest";
import { buildSearchQueryPortfolio } from "./query-strategy";
import {
  parseObservedGbpPrice,
  SerperShoppingAdapter,
  SerperShoppingError,
} from "./serper-shopping-adapter";

function query() {
  let index = 0;
  const ids = [
    "10000000-0000-4000-8000-000000000001",
    "10000000-0000-4000-8000-000000000002",
    "10000000-0000-4000-8000-000000000003",
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
      marketVocabulary: [],
    },
    { createId: () => ids[index++]! },
  ).queries[0]!;
}

describe("Serper shopping adapter", () => {
  it("sends a GB-localised request and conservatively normalises listings", async () => {
    const fetchImpl = vi.fn(async (_input, init) => {
      expect(init?.headers).toEqual({
        "Content-Type": "application/json",
        "X-API-KEY": "test-key",
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        q: "running cap",
        gl: "gb",
        hl: "en",
        location: "United Kingdom",
        num: 8,
      });
      return new Response(
        JSON.stringify({
          shopping: [
            {
              position: 2,
              title: "Kestrel Mesh Runner",
              link: "https://shop.example/cap?variant=blue&utm_source=test#g",
              source: "Example Sports",
              price: "£1,234.56",
              imageUrl: "https://images.example/cap.jpg",
              productId: "product-1",
              delivery: "Free delivery",
            },
            { title: "Missing URL" },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const provider = new SerperShoppingAdapter({
      apiKey: "test-key",
      fetchImpl,
      now: () => new Date("2026-08-23T12:00:00.000Z"),
    });

    const result = await provider.search(query());

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://google.serper.dev/shopping",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.diagnostics).toEqual({
      receivedResultCount: 2,
      rejectedResultCount: 1,
    });
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]).toMatchObject({
      providerResultId: "product-1",
      sourceRank: 2,
      merchant: "Example Sports",
      price: { amountMinor: 123456, currency: "GBP" },
      canonicalUrl: "https://shop.example/cap?variant=blue",
      availabilityText: null,
    });
  });

  it("keeps ambiguous/non-GBP price text but does not manufacture money", () => {
    expect(parseObservedGbpPrice("From £19.99")).toBeNull();
    expect(parseObservedGbpPrice("$19.99")).toBeNull();
    expect(parseObservedGbpPrice("£19.99")).toEqual({
      amountMinor: 1999,
      currency: "GBP",
    });
  });

  it("fails without leaking a provider response body", async () => {
    const provider = new SerperShoppingAdapter({
      apiKey: "secret-key",
      fetchImpl: vi.fn(async () =>
        Promise.resolve(
          new Response("sensitive upstream body", { status: 429 }),
        ),
      ) as unknown as typeof fetch,
    });

    await expect(provider.search(query())).rejects.toEqual(
      expect.objectContaining<Partial<SerperShoppingError>>({
        message: "Serper returned HTTP 429",
        status: 429,
      }),
    );
  });
});
