import { describe, expect, it, vi } from "vitest";
import { buildSearchQueryPortfolio } from "./query-strategy";
import {
  parseObservedGbpPrice,
  SerperShoppingAdapter,
  SerperShoppingError,
  verifyOrganicMerchantDestination,
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
            {
              title: "Untrusted destination",
              link: "javascript:alert('not a product page')",
            },
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
      receivedResultCount: 3,
      rejectedResultCount: 2,
    });
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]).toMatchObject({
      providerResultId: "product-1",
      sourceRank: 2,
      merchant: "Example Sports",
      price: { amountMinor: 123456, currency: "GBP" },
      canonicalUrl: "https://shop.example/cap?variant=blue",
      merchantDestinationUrl:
        "https://shop.example/cap?variant=blue&utm_source=test#g",
      availabilityText: null,
    });
  });

  it("keeps a Google Shopping intermediary as evidence without pretending it is a merchant link", async () => {
    const googleUrl =
      "https://www.google.com/search?ibp=oshop&q=running+cap&prds=catalogid:123";
    const provider = new SerperShoppingAdapter({
      apiKey: "test-key",
      fetchImpl: vi.fn(async () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              shopping: [
                {
                  position: 1,
                  title: "Running cap",
                  link: googleUrl,
                  source: "Example Sports",
                  productId: "123",
                },
              ],
            }),
            { status: 200 },
          ),
        ),
      ) as unknown as typeof fetch,
    });

    const result = await provider.search(query());

    expect(result.listings[0]).toMatchObject({
      url: googleUrl,
      merchantDestinationUrl: null,
    });
  });

  it("does not label UK or Google-owned intermediary hosts as retailers", async () => {
    for (const googleUrl of [
      "https://www.google.co.uk/search?ibp=oshop&q=running+cap",
      "https://shopping.googleusercontent.com/offer/123",
    ]) {
      const provider = new SerperShoppingAdapter({
        apiKey: "test-key",
        fetchImpl: vi.fn(async () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                shopping: [
                  {
                    position: 1,
                    title: "Running cap",
                    link: googleUrl,
                    source: "Example Sports",
                  },
                ],
              }),
              { status: 200 },
            ),
          ),
        ) as unknown as typeof fetch,
      });

      const result = await provider.search(query());
      expect(result.listings[0]?.merchantDestinationUrl).toBeNull();
    }
  });

  it("adds a verified exact-title merchant page for the leading Google listing", async () => {
    const fetchSpy = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        void init;
        if (String(input).endsWith("/shopping")) {
          return new Response(
            JSON.stringify({
              shopping: [
                {
                  position: 1,
                  title: "Trust Bayo II Ergonomic Wireless Mouse",
                  link: "https://www.google.co.uk/search?ibp=oshop&q=trust+bayo",
                  source: "Argos",
                  price: "£25.99",
                  productId: "trust-bayo-ii",
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            organic: [
              {
                position: 1,
                title:
                  "Buy Trust Bayo II Ergonomic Wireless Mouse - Black - Argos",
                link: "https://www.argos.co.uk/product/6827043?srsltid=tracking",
                rating: 4.6,
                ratingCount: 29,
              },
            ],
          }),
          { status: 200 },
        );
      },
    );
    const fetchImpl = fetchSpy as unknown as typeof fetch;
    const provider = new SerperShoppingAdapter({
      apiKey: "test-key",
      fetchImpl,
    });

    const result = await provider.search(query());

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.listings[0]).toMatchObject({
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

    const repeated = await provider.search(query());
    expect(repeated.listings[0]?.merchantDestinationUrl).toBe(
      "https://www.argos.co.uk/product/6827043",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("rejects comparison, search and merchant-mismatched destinations", () => {
    const candidate = {
      candidateTitle: "Trust Bayo II Ergonomic Wireless Mouse",
      merchant: "Argos",
      resultTitle: "Trust Bayo II Ergonomic Wireless Mouse",
    };
    expect(
      verifyOrganicMerchantDestination({
        ...candidate,
        resultUrl: "https://www.pricespy.co.uk/product/trust-bayo-ii-wireless",
      }),
    ).toBeNull();
    expect(
      verifyOrganicMerchantDestination({
        ...candidate,
        resultUrl: "https://www.argos.co.uk/search/trust-bayo-ii",
      }),
    ).toBeNull();
    expect(
      verifyOrganicMerchantDestination({
        ...candidate,
        resultUrl: "https://www.amazon.co.uk/dp/example",
      }),
    ).toBeNull();
    expect(
      verifyOrganicMerchantDestination({
        candidateTitle: "Ergonomic 2.4G Wireless Mouse",
        merchant: "Amazon.co.uk - Amazon.co.uk-Seller",
        resultTitle:
          "Phefop Portable Ergonomic 2.4G Wireless Mouse Rechargeable",
        resultUrl: "https://www.amazon.co.uk/dp/example",
      }),
    ).toBeNull();
  });

  it("keeps a verified destination when optional review fields are malformed", async () => {
    const provider = new SerperShoppingAdapter({
      apiKey: "test-key",
      fetchImpl: vi.fn(async (input) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              String(input).endsWith("/shopping")
                ? {
                    shopping: [
                      {
                        title: "Trust Bayo II Ergonomic Wireless Mouse",
                        link: "https://www.google.co.uk/search?ibp=oshop&q=trust+bayo",
                        source: "Argos",
                      },
                    ],
                  }
                : {
                    organic: [
                      {
                        title: "Trust Bayo II Ergonomic Wireless Mouse - Argos",
                        link: "https://www.argos.co.uk/product/6827043",
                        rating: "excellent",
                        ratingCount: -1,
                      },
                    ],
                  },
            ),
            { status: 200 },
          ),
        ),
      ) as unknown as typeof fetch,
    });

    const result = await provider.search(query());

    expect(result.listings[0]).toMatchObject({
      merchantDestinationUrl: "https://www.argos.co.uk/product/6827043",
      merchantDestinationSource: "verified_organic",
      reviewEvidence: null,
    });
  });

  it("bounds organic lookups to three distinct leading merchants", async () => {
    const fetchSpy = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        void init;
        if (String(input).endsWith("/shopping")) {
          return new Response(
            JSON.stringify({
              shopping: [
                {
                  title: "A one",
                  link: "https://google.com/a",
                  source: "A Shop",
                },
                {
                  title: "A two",
                  link: "https://google.com/b",
                  source: "A Shop",
                },
                {
                  title: "B one",
                  link: "https://google.com/c",
                  source: "B Shop",
                },
                {
                  title: "C one",
                  link: "https://google.com/d",
                  source: "C Shop",
                },
                {
                  title: "D one",
                  link: "https://google.com/e",
                  source: "D Shop",
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ organic: [] }), { status: 200 });
      },
    );
    const fetchImpl = fetchSpy as unknown as typeof fetch;
    const provider = new SerperShoppingAdapter({
      apiKey: "test-key",
      fetchImpl,
    });

    await provider.search(query());

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const organicBodies = fetchSpy.mock.calls
      .slice(1)
      .map(([, init]) => JSON.parse(String(init?.body)).q);
    expect(organicBodies).toEqual([
      '"A one" A Shop',
      '"B one" B Shop',
      '"C one" C Shop',
    ]);
  });

  it("keeps ambiguous/non-GBP price text but does not manufacture money", () => {
    expect(parseObservedGbpPrice("From £19.99")).toBeNull();
    expect(parseObservedGbpPrice("$19.99")).toBeNull();
    expect(parseObservedGbpPrice("£19.99")).toEqual({
      amountMinor: 1999,
      currency: "GBP",
    });
  });

  it("enforces the requested candidate budget when Serper over-returns", async () => {
    const shopping = Array.from({ length: 40 }, (_, index) => ({
      position: index + 1,
      title: `Result ${index + 1}`,
      link: `https://shop.example/products/${index + 1}`,
      source: "Example Sports",
      price: "£20.00",
      productId: `product-${index + 1}`,
    }));
    const provider = new SerperShoppingAdapter({
      apiKey: "test-key",
      fetchImpl: vi.fn(async () =>
        Promise.resolve(
          new Response(JSON.stringify({ shopping }), { status: 200 }),
        ),
      ) as unknown as typeof fetch,
    });

    const result = await provider.search(query());

    expect(result.diagnostics.receivedResultCount).toBe(40);
    expect(result.listings).toHaveLength(8);
    expect(result.listings.at(-1)?.sourceRank).toBe(8);
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
