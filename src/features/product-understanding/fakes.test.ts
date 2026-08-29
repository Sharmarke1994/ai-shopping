import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FakeShoppingProvider } from "@/features/retrieval-spike/fake-shopping-provider";
import { searchQuerySchema } from "@/features/retrieval-spike/contracts";
import { FakeEvidencePageFetcher } from "./fakes";

function query() {
  return searchQuerySchema.parse({
    id: randomUUID(),
    runId: randomUUID(),
    taskId: randomUUID(),
    taskRevision: 1n,
    hypothesisId: randomUUID(),
    purpose: "literal_precision",
    text: `fixture query ${randomUUID()}`,
    market: { country: "GB", language: "en-GB", currency: "GBP" },
    surface: "shopping",
    limit: 5,
  });
}

const pageInput = {
  url: "https://example.test/product",
  candidateTitle: "Fixture product",
  merchant: "Fixture Outfitters",
  discoveredTitle: "Fixture product official specifications",
  discoveredRole: "manufacturer" as const,
};

describe("visual-review fixture controls", () => {
  it("can preserve one direct path and one honest Google Shopping fallback", async () => {
    const provider = new FakeShoppingProvider(() => new Date(), {
      purchasePaths: "mixed",
    });

    const direct = await provider.search(query());
    const fallback = await provider.search(query());

    expect(direct.listings[0]).toMatchObject({
      merchantDestinationSource: "shopping_result",
    });
    expect(direct.listings[0]?.merchantDestinationUrl).not.toBeNull();
    expect(fallback.listings[0]).toMatchObject({
      merchantDestinationUrl: null,
      merchantDestinationSource: null,
    });
    expect(fallback.listings[0]?.url).toMatch(
      /^https:\/\/www\.google\.com\/shopping\/product\//,
    );
  });

  it("delays and fails only the configured product-page calls", async () => {
    const fetcher = new FakeEvidencePageFetcher({
      delayOnCalls: { 1: 1 },
      failOnCalls: [2],
    });

    await expect(fetcher.fetch(pageInput)).resolves.toMatchObject({
      requestedUrl: pageInput.url,
      contentType: "text/html",
    });
    await expect(fetcher.fetch(pageInput)).rejects.toThrow(
      "Fixture product-page failure on call 2",
    );
    expect(fetcher.calls).toEqual([pageInput.url, pageInput.url]);
  });
});
