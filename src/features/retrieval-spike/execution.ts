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
        error:
          result.reason instanceof Error
            ? result.reason.message
            : "Unknown provider failure",
      };
    }
    const providerResult = providerSearchResultSchema.parse(result.value);
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
