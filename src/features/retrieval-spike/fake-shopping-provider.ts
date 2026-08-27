import {
  candidateListingSchema,
  providerSearchResultSchema,
  type SearchQuery,
  type ShoppingSearchProvider,
} from "./contracts";

export class FakeShoppingProvider implements ShoppingSearchProvider {
  readonly provider = "fixture" as const;
  readonly maxRequestDurationMs = 0;

  constructor(private readonly now: () => Date = () => new Date()) {}

  async search(query: SearchQuery) {
    const slug = encodeURIComponent(query.text.toLocaleLowerCase("en-GB"));
    return Promise.resolve(
      providerSearchResultSchema.parse({
        listings: [
          candidateListingSchema.parse({
            taskId: query.taskId,
            runId: query.runId,
            queryId: query.id,
            provider: "fixture",
            providerResultId: `fake:${query.id}`,
            sourceRank: 1,
            surface: "shopping",
            title: `Fixture result for ${query.text}`,
            url: `https://example.test/products/${slug}`,
            canonicalUrl: `https://example.test/products/${slug}`,
            merchantDestinationUrl: `https://example.test/products/${slug}`,
            merchantDestinationSource: "shopping_result",
            merchant: "Fixture Outfitters",
            price: { amountMinor: 2499, currency: "GBP" },
            priceText: "£24.99",
            imageUrl: "https://example.test/images/fixture.jpg",
            deliveryText: "Fixture delivery",
            availabilityText: null,
            retrievedAt: this.now(),
          }),
        ],
        diagnostics: { receivedResultCount: 1, rejectedResultCount: 0 },
      }),
    );
  }
}
