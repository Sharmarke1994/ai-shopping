import {
  candidateListingSchema,
  providerSearchResultSchema,
  type SearchQuery,
  type ShoppingSearchProvider,
} from "./contracts";

export class FakeShoppingProvider implements ShoppingSearchProvider {
  readonly provider = "fixture" as const;
  readonly maxRequestDurationMs = 0;
  #callCount = 0;

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly options: Readonly<{
      purchasePaths?: "direct" | "mixed";
    }> = {},
  ) {}

  async search(query: SearchQuery) {
    this.#callCount += 1;
    const slug = encodeURIComponent(query.text.toLocaleLowerCase("en-GB"));
    const direct =
      this.options.purchasePaths !== "mixed" || this.#callCount % 2 === 1;
    const sourceUrl = direct
      ? `https://example.test/products/${slug}`
      : `https://www.google.com/shopping/product/fixture-${query.id}`;
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
            url: sourceUrl,
            canonicalUrl: sourceUrl,
            merchantDestinationUrl: direct ? sourceUrl : null,
            merchantDestinationSource: direct ? "shopping_result" : null,
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
