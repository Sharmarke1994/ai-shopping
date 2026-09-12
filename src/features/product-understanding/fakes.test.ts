import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FakeShoppingProvider } from "@/features/retrieval-spike/fake-shopping-provider";
import { searchQuerySchema } from "@/features/retrieval-spike/contracts";
import {
  FakeEvidencePageFetcher,
  FakeProductUnderstandingModel,
} from "./fakes";

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
  it("preserves extended-use source wording without a title or rank-dependent outcome", async () => {
    const model = new FakeProductUnderstandingModel();
    const excerpt =
      "After several full workdays the reviewer found the product comfortable with no wrist fatigue.";
    const input = {
      schemaVersion: 1 as const,
      market: {
        country: "GB" as const,
        language: "en-GB" as const,
        currency: "GBP" as const,
      },
      candidate: {
        title: "First arbitrary product",
        merchant: null,
        observedPriceText: null,
      },
      criteria: [
        {
          ordinal: 0,
          label: "Comfort for long workdays",
          definition: "Extended-use comfort",
          strength: "strong_preference" as const,
          targetSemantics: "qualitative" as const,
          value: {},
        },
      ],
      sources: [
        {
          ordinal: 0,
          role: "independent_review" as const,
          kind: "fetched_page" as const,
          title: "Exact review",
          url: "https://example.test/review",
          excerpt,
        },
      ],
    };
    const first = await model.understand(input);
    const second = await model.understand({
      ...input,
      candidate: { ...input.candidate, title: "Completely different product" },
    });
    expect(first.value).toEqual(second.value);
    expect(first.value.observations[0]?.claim).toBe(excerpt);
  });
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
