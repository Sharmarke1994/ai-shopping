import {
  providerSearchResultSchema,
  searchQueryPortfolioSchema,
  type CandidateListing,
  type SearchQuery,
  type SearchQueryPortfolio,
  type ShoppingSearchProvider,
} from "./contracts";

export type QueryExecution =
  | Readonly<{
      status: "completed";
      query: SearchQuery;
      listings: readonly CandidateListing[];
      receivedResultCount: number;
      rejectedResultCount: number;
    }>
  | Readonly<{
      status: "failed";
      query: SearchQuery;
      errorCode: "provider_failed" | "invalid_provider_result";
      error: string;
    }>;

export type RetrievalExecution = Readonly<{
  portfolio: SearchQueryPortfolio;
  queries: readonly QueryExecution[];
  listings: readonly CandidateListing[];
}>;

export async function executeSearchQueryPortfolio(options: {
  portfolio: unknown;
  provider: ShoppingSearchProvider;
}): Promise<RetrievalExecution> {
  const portfolio = searchQueryPortfolioSchema.parse(options.portfolio);
  const settled = await Promise.allSettled(
    portfolio.queries.map((query) => options.provider.search(query)),
  );
  const queries: QueryExecution[] = settled.map((result, index) => {
    const query = portfolio.queries[index]!;
    if (result.status === "rejected") {
      return {
        status: "failed",
        query,
        errorCode: "provider_failed",
        error:
          result.reason instanceof Error
            ? result.reason.message.trim().slice(0, 500) ||
              "Provider request failed"
            : "Unknown provider failure",
      };
    }
    const parsed = providerSearchResultSchema.safeParse(result.value);
    if (!parsed.success) {
      return {
        status: "failed",
        query,
        errorCode: "invalid_provider_result",
        error: "Provider returned a malformed shopping result",
      };
    }
    const providerResult = parsed.data;
    if (
      providerResult.listings.length > query.limit ||
      providerResult.listings.some(
        (listing) =>
          listing.taskId !== query.taskId ||
          listing.runId !== query.runId ||
          listing.queryId !== query.id ||
          listing.provider !== options.provider.provider,
      )
    ) {
      return {
        status: "failed",
        query,
        errorCode: "invalid_provider_result",
        error: "Provider result lineage does not match the invoked query",
      };
    }
    return {
      status: "completed",
      query,
      listings: providerResult.listings,
      receivedResultCount: providerResult.diagnostics.receivedResultCount,
      rejectedResultCount: providerResult.diagnostics.rejectedResultCount,
    };
  });
  return {
    portfolio,
    queries,
    listings: queries.flatMap((execution) =>
      execution.status === "completed" ? execution.listings : [],
    ),
  };
}
