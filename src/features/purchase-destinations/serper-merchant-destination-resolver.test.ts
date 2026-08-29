import { describe, expect, it, vi } from "vitest";
import {
  merchantDestinationResolutionRequestSchema,
  MerchantDestinationResolverError,
} from "./contracts";
import {
  SerperMerchantDestinationError,
  SerperMerchantDestinationResolver,
} from "./serper-merchant-destination-resolver";

const request = merchantDestinationResolutionRequestSchema.parse({
  requestId: "10000000-0000-4000-8000-000000000001",
  taskId: "20000000-0000-4000-8000-000000000002",
  searchRunId: "30000000-0000-4000-8000-000000000003",
  candidateListingId: "40000000-0000-4000-8000-000000000004",
  title: "Trust Bayo II Ergonomic Wireless Mouse Black",
  merchant: "Argos",
  googleShoppingUrl: "https://www.google.co.uk/search?ibp=oshop&q=trust+bayo",
  queryText: '"Trust Bayo II Ergonomic Wireless Mouse Black" Argos',
});

describe("Serper merchant destination resolver", () => {
  it("searches the exact title and merchant, then accepts only the exact offer", async () => {
    const fetchImpl = vi.fn(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        q: request.queryText,
        gl: "gb",
        hl: "en",
        location: "United Kingdom",
        num: 5,
      });
      return new Response(
        JSON.stringify({
          organic: [
            {
              title: "Trust Bayo I Ergonomic Wireless Mouse Black at Argos",
              link: "https://www.argos.co.uk/product/wrong-variant",
            },
            {
              title:
                "Buy Trust Bayo II Ergonomic Wireless Mouse Black at Argos",
              link: "https://www.argos.co.uk/product/6827043?srsltid=tracking",
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const resolver = new SerperMerchantDestinationResolver({
      apiKey: "test-key",
      fetchImpl,
    });

    await expect(resolver.resolve(request)).resolves.toEqual({
      outcome: "resolved",
      destinationUrl: "https://www.argos.co.uk/product/6827043",
      acceptedResultTitle:
        "Buy Trust Bayo II Ergonomic Wireless Mouse Black at Argos",
      observedResultUrl:
        "https://www.argos.co.uk/product/6827043?srsltid=tracking",
      consideredResultCount: 2,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns the leading exact rejection reason without inventing a CTA", async () => {
    const resolver = new SerperMerchantDestinationResolver({
      apiKey: "test-key",
      fetchImpl: vi.fn(async () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              organic: [
                {
                  title: "Trust Bayo I Ergonomic Wireless Mouse Black at Argos",
                  link: "https://www.argos.co.uk/product/wrong-variant",
                },
              ],
            }),
            { status: 200 },
          ),
        ),
      ) as unknown as typeof fetch,
    });

    await expect(resolver.resolve(request)).resolves.toEqual({
      outcome: "rejected",
      rejectionCode: "variant_mismatch",
      consideredResultCount: 1,
    });
  });

  it("fails with a typed, body-free error for malformed provider output", async () => {
    const resolver = new SerperMerchantDestinationResolver({
      apiKey: "test-key",
      fetchImpl: vi.fn(async () =>
        Promise.resolve(
          new Response("sensitive upstream body", {
            status: 429,
          }),
        ),
      ) as unknown as typeof fetch,
    });

    await expect(resolver.resolve(request)).rejects.toEqual(
      expect.objectContaining<Partial<SerperMerchantDestinationError>>({
        message: "Serper returned HTTP 429",
        code: "provider_failed",
        status: 429,
      }),
    );
    await expect(resolver.resolve(request)).rejects.toBeInstanceOf(
      MerchantDestinationResolverError,
    );
  });
});
