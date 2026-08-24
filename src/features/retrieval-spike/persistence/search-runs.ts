import { isDeepStrictEqual } from "node:util";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { projectShoppingBrief } from "@/domain/shopping-state/brief";
import { PersistedDataCorruptionError } from "@/domain/shopping-state/errors";
import {
  candidateListingIdSchema,
  contextActionIdSchema,
  shoppingTaskIdSchema,
} from "@/domain/shopping-state/ids";
import { loadContextActionByIdInTransaction } from "@/features/context-acquisition/persistence/context-actions";
import {
  loadCurrentShoppingState,
  loadShoppingStateAtRevision,
} from "@/features/shopping-state/persistence/state-loaders";
import { mapShoppingTask } from "@/features/shopping-state/persistence/mappers";
import type {
  ShoppingDatabase,
  ShoppingTransaction,
} from "@/infrastructure/database/clients";
import {
  candidateListings,
  searchHypotheses,
  searchHypothesisBasisCriteria,
  searchQueries,
  searchQueryExecutions,
  searchRuns,
  shoppingTasks,
} from "@/infrastructure/database/schema";
import {
  candidateListingSchema,
  searchHypothesisSchema,
  searchQueryIdSchema,
  searchQueryPortfolioSchema,
  searchQuerySchema,
  searchRunIdSchema,
  shoppingProviderSchema,
  type CandidateListing,
  type SearchQuery,
  type SearchQueryPortfolio,
} from "../contracts";
import type { QueryExecution } from "../execution";
import {
  persistedCandidateListingSchema,
  persistedSearchQueryExecutionSchema,
  persistedSearchRunSchema,
  type PersistedCandidateListing,
  type PersistedSearchQueryExecution,
  type PersistedSearchRun,
} from "./contracts";

const runStatusSchema = z.enum(["running", "succeeded", "partial", "failed"]);
const failureCodeSchema = z.enum([
  "provider_failed",
  "invalid_provider_result",
]);

const completedExecutionInputSchema = z.strictObject({
  status: z.literal("completed"),
  query: searchQuerySchema,
  listings: z.array(candidateListingSchema).max(20).readonly(),
  receivedResultCount: z.number().int().nonnegative(),
  rejectedResultCount: z.number().int().nonnegative(),
});

const failedExecutionInputSchema = z.strictObject({
  status: z.literal("failed"),
  query: searchQuerySchema,
  errorCode: failureCodeSchema,
  error: z.string().min(1).max(500),
});

const queryExecutionInputSchema = z.discriminatedUnion("status", [
  completedExecutionInputSchema,
  failedExecutionInputSchema,
]);

export class SearchPlanAuthorityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchPlanAuthorityError";
  }
}

export class SearchRunNotFoundError extends Error {
  constructor(readonly runId: string) {
    super(`Search run ${runId} was not found in this task`);
    this.name = "SearchRunNotFoundError";
  }
}

export class SearchRunConflictError extends Error {
  constructor(readonly runId: string) {
    super(`Search run ${runId} already has different persisted content`);
    this.name = "SearchRunConflictError";
  }
}

export class SearchTriggerConflictError extends Error {
  constructor(readonly contextActionId: string) {
    super(
      `SEARCH action ${contextActionId} already owns a different retrieval plan`,
    );
    this.name = "SearchTriggerConflictError";
  }
}

export class SearchQueryExecutionConflictError extends Error {
  constructor(readonly queryId: string) {
    super(`Search query ${queryId} already has a different terminal receipt`);
    this.name = "SearchQueryExecutionConflictError";
  }
}

export class SearchRunExecutionLeaseError extends Error {
  constructor(readonly runId: string) {
    super(`Search run ${runId} is owned by a different execution lease`);
    this.name = "SearchRunExecutionLeaseError";
  }
}

function sameMarket(
  left: { country: string; language: string; currency: string },
  right: { country: string; language: string; currency: string },
) {
  return (
    left.country === right.country &&
    left.language === right.language &&
    left.currency === right.currency
  );
}

function persisted<T>(options: {
  recordType: string;
  recordId: string;
  parse: () => T;
}): T {
  try {
    return options.parse();
  } catch (cause) {
    if (cause instanceof PersistedDataCorruptionError) throw cause;
    throw new PersistedDataCorruptionError({
      recordType: options.recordType,
      recordId: options.recordId,
      cause,
    });
  }
}

function corrupt(runId: string, message: string): never {
  throw new PersistedDataCorruptionError({
    recordType: "SearchRun",
    recordId: runId,
    cause: new Error(message),
  });
}

function normalizedListings(listings: readonly CandidateListing[]) {
  return [...listings]
    .sort(
      (left, right) =>
        left.sourceRank - right.sourceRank ||
        left.providerResultId.localeCompare(right.providerResultId) ||
        (left.merchant ?? "").localeCompare(right.merchant ?? "") ||
        left.url.localeCompare(right.url),
    )
    .map((listing) => structuredClone(listing));
}

function logicalPortfolioIdentity(portfolio: SearchQueryPortfolio) {
  const hypothesisOrdinalById = new Map(
    portfolio.hypotheses.map((hypothesis, ordinal) => [hypothesis.id, ordinal]),
  );
  return {
    run: {
      taskId: portfolio.run.taskId,
      taskRevision: portfolio.run.taskRevision,
      market: portfolio.run.market,
      queryStrategyVersion: portfolio.run.queryStrategyVersion,
    },
    hypotheses: portfolio.hypotheses.map((hypothesis) => ({
      kind: hypothesis.kind,
      rationale: hypothesis.rationale,
      sourceTextIsBasis: hypothesis.sourceTextIsBasis,
      basisCriterionIds: hypothesis.basisCriterionIds,
    })),
    queries: portfolio.queries.map((query) => ({
      hypothesisOrdinal: hypothesisOrdinalById.get(query.hypothesisId),
      taskId: query.taskId,
      taskRevision: query.taskRevision,
      purpose: query.purpose,
      text: query.text,
      market: query.market,
      surface: query.surface,
      limit: query.limit,
    })),
  };
}

function stripPersistedListing(
  listing: PersistedCandidateListing,
): CandidateListing {
  return {
    taskId: listing.taskId,
    runId: listing.runId,
    queryId: listing.queryId,
    provider: listing.provider,
    providerResultId: listing.providerResultId,
    sourceRank: listing.sourceRank,
    surface: listing.surface,
    title: listing.title,
    url: listing.url,
    canonicalUrl: listing.canonicalUrl,
    merchant: listing.merchant,
    price: listing.price,
    priceText: listing.priceText,
    imageUrl: listing.imageUrl,
    deliveryText: listing.deliveryText,
    availabilityText: listing.availabilityText,
    retrievedAt: listing.retrievedAt,
  };
}

function expectedRunStatus(
  executions: readonly PersistedSearchQueryExecution[],
) {
  const succeeded = executions.filter(
    (execution) => execution.status === "succeeded",
  ).length;
  if (succeeded === executions.length) return "succeeded" as const;
  if (succeeded === 0) return "failed" as const;
  return "partial" as const;
}

async function loadSearchRunInTransaction(
  tx: ShoppingTransaction,
  taskId: ReturnType<typeof shoppingTaskIdSchema.parse>,
  runId: ReturnType<typeof searchRunIdSchema.parse>,
): Promise<PersistedSearchRun | null> {
  const [runRow] = await tx
    .select()
    .from(searchRuns)
    .where(and(eq(searchRuns.taskId, taskId), eq(searchRuns.id, runId)))
    .limit(1);
  if (runRow === undefined) return null;

  return (async () => {
    const provider = persisted({
      recordType: "SearchRun",
      recordId: runId,
      parse: () => shoppingProviderSchema.parse(runRow.provider),
    });
    const status = persisted({
      recordType: "SearchRun",
      recordId: runId,
      parse: () => runStatusSchema.parse(runRow.status),
    });
    if (
      (runRow.leaseToken === null) !== (runRow.leaseExpiresAt === null) ||
      (status !== "running" && runRow.leaseToken !== null)
    ) {
      return corrupt(runId, "Run lease fields are incoherent");
    }
    const contextActionId = persisted({
      recordType: "SearchRun",
      recordId: runId,
      parse: () => contextActionIdSchema.parse(runRow.contextActionId),
    });
    const task = await (async () => {
      const [taskRow] = await tx
        .select()
        .from(shoppingTasks)
        .where(eq(shoppingTasks.id, taskId))
        .limit(1);
      if (taskRow === undefined) return corrupt(runId, "Run task is missing");
      return mapShoppingTask(taskRow);
    })();
    if (runRow.taskRevision > task.currentRevision) {
      return corrupt(runId, "Run revision is later than its task");
    }
    const runMarket = {
      country: runRow.marketCountry,
      language: runRow.languageTag,
      currency: runRow.currencyCode,
    };
    if (!sameMarket(runMarket, task.market)) {
      return corrupt(runId, "Run market differs from its task market");
    }

    const action = await loadContextActionByIdInTransaction({
      tx,
      taskId,
      contextActionId,
    });
    if (
      action === null ||
      action.action !== "search" ||
      action.selectedAtRevision !== runRow.taskRevision
    ) {
      return corrupt(
        runId,
        "Run is not bound to a SEARCH selected at its exact revision",
      );
    }

    const [hypothesisRows, basisRows, queryRows, executionRows, listingRows] =
      await Promise.all([
        tx
          .select()
          .from(searchHypotheses)
          .where(
            and(
              eq(searchHypotheses.taskId, taskId),
              eq(searchHypotheses.runId, runId),
            ),
          )
          .orderBy(asc(searchHypotheses.ordinal)),
        tx
          .select()
          .from(searchHypothesisBasisCriteria)
          .where(
            and(
              eq(searchHypothesisBasisCriteria.taskId, taskId),
              eq(searchHypothesisBasisCriteria.runId, runId),
            ),
          )
          .orderBy(
            asc(searchHypothesisBasisCriteria.hypothesisId),
            asc(searchHypothesisBasisCriteria.ordinal),
          ),
        tx
          .select()
          .from(searchQueries)
          .where(
            and(
              eq(searchQueries.taskId, taskId),
              eq(searchQueries.runId, runId),
            ),
          )
          .orderBy(asc(searchQueries.ordinal)),
        tx
          .select()
          .from(searchQueryExecutions)
          .where(
            and(
              eq(searchQueryExecutions.taskId, taskId),
              eq(searchQueryExecutions.runId, runId),
            ),
          ),
        tx
          .select()
          .from(candidateListings)
          .where(
            and(
              eq(candidateListings.taskId, taskId),
              eq(candidateListings.runId, runId),
            ),
          )
          .orderBy(
            asc(candidateListings.queryId),
            asc(candidateListings.sourceRank),
            asc(candidateListings.providerResultId),
          ),
      ]);

    if (
      hypothesisRows.some((row, index) => row.ordinal !== index) ||
      queryRows.some((row, index) => row.ordinal !== index)
    ) {
      return corrupt(runId, "Run child ordinals are not contiguous");
    }

    const runState = await loadShoppingStateAtRevision(
      tx,
      taskId,
      runRow.taskRevision,
    );
    const runBriefIds = new Set<string>(
      projectShoppingBrief(runState).items.map((item) => item.criterionId),
    );
    const basisByHypothesis = new Map<string, string[]>();
    for (const row of basisRows) {
      const entries = basisByHypothesis.get(row.hypothesisId) ?? [];
      if (row.ordinal !== entries.length) {
        return corrupt(runId, "Hypothesis basis ordinals are not contiguous");
      }
      entries.push(row.criterionId);
      basisByHypothesis.set(row.hypothesisId, entries);
    }
    if (basisRows.some((row) => !runBriefIds.has(row.criterionId))) {
      return corrupt(runId, "Hypothesis basis is not in the run brief");
    }

    const hypotheses = hypothesisRows.map((row) =>
      persisted({
        recordType: "SearchHypothesis",
        recordId: row.id,
        parse: () =>
          searchHypothesisSchema.parse({
            id: row.id,
            runId: row.runId,
            kind: row.kind,
            rationale: row.rationale,
            sourceTextIsBasis: row.sourceTextIsBasis,
            basisCriterionIds: basisByHypothesis.get(row.id) ?? [],
          }),
      }),
    );
    const queries = queryRows.map((row) => {
      if (row.provider !== provider) {
        return corrupt(row.runId, "Query provider differs from its run");
      }
      return persisted({
        recordType: "SearchQuery",
        recordId: row.id,
        parse: () =>
          searchQuerySchema.parse({
            id: row.id,
            runId: row.runId,
            taskId: row.taskId,
            taskRevision: runRow.taskRevision,
            hypothesisId: row.hypothesisId,
            purpose: row.purpose,
            text: row.queryText,
            market: runMarket,
            surface: row.surface,
            limit: row.candidateLimit,
          }),
      });
    });
    const portfolio = persisted({
      recordType: "SearchRun",
      recordId: runId,
      parse: () =>
        searchQueryPortfolioSchema.parse({
          run: {
            id: runRow.id,
            taskId: runRow.taskId,
            taskRevision: runRow.taskRevision,
            market: runMarket,
            queryStrategyVersion: runRow.queryStrategyVersion,
            startedAt: runRow.startedAt,
          },
          hypotheses,
          queries,
        }),
    });
    const queryById = new Map<string, SearchQuery>(
      portfolio.queries.map((query) => [query.id, query] as const),
    );

    const executions = executionRows.map((row) => {
      if (!queryById.has(row.queryId)) {
        return corrupt(runId, "Execution does not belong to a planned query");
      }
      if (row.finishedAt < row.startedAt || row.startedAt < runRow.startedAt) {
        return corrupt(runId, "Execution timestamps are outside the run");
      }
      const base = {
        id: row.id,
        queryId: row.queryId,
        status: row.status,
        providerRequestId: row.providerRequestId,
        receivedResultCount: row.receivedResultCount,
        rejectedResultCount: row.rejectedResultCount,
        failureCode: row.failureCode,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
      };
      return persisted({
        recordType: "SearchQueryExecution",
        recordId: row.id,
        parse: () => persistedSearchQueryExecutionSchema.parse(base),
      });
    });
    const executionByQuery = new Map<string, PersistedSearchQueryExecution>(
      executions.map((execution) => [execution.queryId, execution] as const),
    );

    const listings = listingRows.map((row) => {
      const execution = executionByQuery.get(row.queryId);
      const query = queryById.get(row.queryId);
      if (
        execution === undefined ||
        execution.status !== "succeeded" ||
        execution.id !== row.queryExecutionId ||
        query === undefined ||
        row.provider !== provider ||
        row.surface !== query.surface
      ) {
        return corrupt(
          runId,
          "Listing is not attached to its successful exact query execution",
        );
      }
      const price =
        row.priceAmountMinor === null && row.priceCurrencyCode === null
          ? null
          : {
              amountMinor: row.priceAmountMinor,
              currency: row.priceCurrencyCode,
            };
      return persisted({
        recordType: "CandidateListing",
        recordId: row.id,
        parse: () =>
          persistedCandidateListingSchema.parse({
            id: candidateListingIdSchema.parse(row.id),
            queryExecutionId: row.queryExecutionId,
            taskId: row.taskId,
            runId: row.runId,
            queryId: row.queryId,
            provider: row.provider,
            providerResultId: row.providerResultId,
            sourceRank: row.sourceRank,
            surface: row.surface,
            title: row.title,
            url: row.url,
            canonicalUrl: row.canonicalUrl,
            merchant: row.merchant,
            price,
            priceText: row.priceText,
            imageUrl: row.imageUrl,
            deliveryText: row.deliveryText,
            availabilityText: row.availabilityText,
            retrievedAt: row.retrievedAt,
          }),
      });
    });

    for (const query of portfolio.queries) {
      const execution = executionByQuery.get(query.id);
      const queryListings = listings.filter(
        (listing) => listing.queryId === query.id,
      );
      if (queryListings.length > query.limit) {
        return corrupt(runId, "Persisted candidates exceed the query limit");
      }
      if (execution?.status === "succeeded") {
        if (
          queryListings.length >
          execution.receivedResultCount - execution.rejectedResultCount
        ) {
          return corrupt(
            runId,
            "Persisted candidates exceed validated provider results",
          );
        }
      } else if (queryListings.length > 0) {
        return corrupt(runId, "A failed or pending query has candidates");
      }
    }

    const derivedStatus =
      executions.length < portfolio.queries.length
        ? ("running" as const)
        : expectedRunStatus(executions);
    if (status !== derivedStatus) {
      return corrupt(runId, "Run status differs from its terminal receipts");
    }
    if (derivedStatus === "running") {
      if (runRow.finishedAt !== null) {
        return corrupt(runId, "A running run has a finish timestamp");
      }
    } else {
      const latestFinishedAt = new Date(
        Math.max(
          ...executions.map((execution) => execution.finishedAt.getTime()),
        ),
      );
      if (
        runRow.finishedAt === null ||
        runRow.finishedAt.getTime() !== latestFinishedAt.getTime()
      ) {
        return corrupt(
          runId,
          "Finished run timestamp is not its latest query receipt",
        );
      }
    }

    return persisted({
      recordType: "SearchRun",
      recordId: runId,
      parse: () =>
        persistedSearchRunSchema.parse({
          contextActionId,
          provider,
          status,
          finishedAt: runRow.finishedAt,
          portfolio,
          queryExecutions: portfolio.queries.flatMap((query) => {
            const execution = executionByQuery.get(query.id);
            return execution === undefined ? [] : [execution];
          }),
          listings,
        }),
    });
  })();
}

function assertPlanMatchesCurrentAuthority(options: {
  task: ReturnType<typeof mapShoppingTask>;
  action: Awaited<ReturnType<typeof loadContextActionByIdInTransaction>>;
  portfolio: SearchQueryPortfolio;
  visibleCriterionIds: ReadonlySet<string>;
}) {
  const { task, action, portfolio } = options;
  if (
    action === null ||
    action.action !== "search" ||
    action.taskId !== task.id ||
    action.selectedAtRevision !== portfolio.run.taskRevision ||
    task.currentRevision !== portfolio.run.taskRevision ||
    portfolio.run.taskId !== task.id ||
    !sameMarket(portfolio.run.market, task.market)
  ) {
    throw new SearchPlanAuthorityError(
      "Search plan task, revision, market, or SEARCH authority is stale",
    );
  }
  for (const hypothesis of portfolio.hypotheses) {
    if (
      hypothesis.basisCriterionIds.some(
        (criterionId) => !options.visibleCriterionIds.has(criterionId),
      )
    ) {
      throw new SearchPlanAuthorityError(
        "Search hypothesis basis is not in the current deterministic brief",
      );
    }
  }
}

async function loadExactExistingPlan(options: {
  tx: ShoppingTransaction;
  portfolio: SearchQueryPortfolio;
  contextActionId: ReturnType<typeof contextActionIdSchema.parse>;
  provider: ReturnType<typeof shoppingProviderSchema.parse>;
}) {
  const [sameId] = await options.tx
    .select({ taskId: searchRuns.taskId })
    .from(searchRuns)
    .where(eq(searchRuns.id, options.portfolio.run.id))
    .for("share")
    .limit(1);
  if (sameId === undefined) return null;
  if (sameId.taskId !== options.portfolio.run.taskId) {
    throw new SearchRunConflictError(options.portfolio.run.id);
  }
  const existing = await loadSearchRunInTransaction(
    options.tx,
    options.portfolio.run.taskId,
    options.portfolio.run.id,
  );
  if (
    existing === null ||
    existing.contextActionId !== options.contextActionId ||
    existing.provider !== options.provider ||
    !isDeepStrictEqual(existing.portfolio, options.portfolio)
  ) {
    throw new SearchRunConflictError(options.portfolio.run.id);
  }
  return existing;
}

async function loadExistingPlanByTrigger(options: {
  tx: ShoppingTransaction;
  taskId: ReturnType<typeof shoppingTaskIdSchema.parse>;
  contextActionId: ReturnType<typeof contextActionIdSchema.parse>;
  lock?: boolean;
}) {
  const query = options.tx
    .select({ runId: searchRuns.id })
    .from(searchRuns)
    .where(
      and(
        eq(searchRuns.taskId, options.taskId),
        eq(searchRuns.contextActionId, options.contextActionId),
      ),
    )
    .limit(1);
  const rows = options.lock === false ? await query : await query.for("share");
  const [row] = rows;
  if (row === undefined) return null;
  const run = await loadSearchRunInTransaction(
    options.tx,
    options.taskId,
    searchRunIdSchema.parse(row.runId),
  );
  if (run === null) {
    return corrupt(row.runId, "Trigger-owned run disappeared while loading");
  }
  return run;
}

function exactLogicalTriggerWinner(options: {
  existing: PersistedSearchRun;
  portfolio: SearchQueryPortfolio;
  provider: ReturnType<typeof shoppingProviderSchema.parse>;
  contextActionId: ReturnType<typeof contextActionIdSchema.parse>;
}) {
  if (options.existing.status !== "running") return options.existing;
  if (
    options.existing.provider !== options.provider ||
    !isDeepStrictEqual(
      logicalPortfolioIdentity(options.existing.portfolio),
      logicalPortfolioIdentity(options.portfolio),
    )
  ) {
    throw new SearchTriggerConflictError(options.contextActionId);
  }
  return options.existing;
}

export async function persistSearchPlan(options: {
  db: ShoppingDatabase;
  contextActionId: unknown;
  provider: unknown;
  portfolio: unknown;
}): Promise<{ created: boolean; run: PersistedSearchRun }> {
  return options.db.transaction((tx) =>
    persistSearchPlanInTransaction({
      tx,
      contextActionId: options.contextActionId,
      provider: options.provider,
      portfolio: options.portfolio,
    }),
  );
}

export async function persistSearchPlanInTransaction(options: {
  tx: ShoppingTransaction;
  contextActionId: unknown;
  provider: unknown;
  portfolio: unknown;
}): Promise<{ created: boolean; run: PersistedSearchRun }> {
  const portfolio = searchQueryPortfolioSchema.parse(options.portfolio);
  const contextActionId = contextActionIdSchema.parse(options.contextActionId);
  const provider = shoppingProviderSchema.parse(options.provider);

  const tx = options.tx;
  return (async () => {
    const triggerWinner = await loadExistingPlanByTrigger({
      tx,
      taskId: portfolio.run.taskId,
      contextActionId,
    });
    if (triggerWinner !== null) {
      return {
        created: false,
        run: exactLogicalTriggerWinner({
          existing: triggerWinner,
          portfolio,
          provider,
          contextActionId,
        }),
      };
    }
    const existing = await loadExactExistingPlan({
      tx,
      portfolio,
      contextActionId,
      provider,
    });
    if (existing !== null) return { created: false, run: existing };

    const [taskRow] = await tx
      .select()
      .from(shoppingTasks)
      .where(eq(shoppingTasks.id, portfolio.run.taskId))
      .for("update")
      .limit(1);
    if (taskRow === undefined) {
      throw new SearchPlanAuthorityError("Search plan task does not exist");
    }

    const actionWinner = await loadExistingPlanByTrigger({
      tx,
      taskId: portfolio.run.taskId,
      contextActionId,
    });
    if (actionWinner !== null) {
      return {
        created: false,
        run: exactLogicalTriggerWinner({
          existing: actionWinner,
          portfolio,
          provider,
          contextActionId,
        }),
      };
    }

    const winner = await loadExactExistingPlan({
      tx,
      portfolio,
      contextActionId,
      provider,
    });
    if (winner !== null) return { created: false, run: winner };

    const task = mapShoppingTask(taskRow);
    const action = await loadContextActionByIdInTransaction({
      tx,
      taskId: task.id,
      contextActionId,
    });
    const currentState = await loadCurrentShoppingState(tx, task.id);
    const visibleCriterionIds = new Set(
      projectShoppingBrief(currentState).items.map((item) => item.criterionId),
    );
    assertPlanMatchesCurrentAuthority({
      task,
      action,
      portfolio,
      visibleCriterionIds,
    });

    await tx.insert(searchRuns).values({
      id: portfolio.run.id,
      taskId: portfolio.run.taskId,
      contextActionId,
      taskRevision: portfolio.run.taskRevision,
      marketCountry: portfolio.run.market.country,
      languageTag: portfolio.run.market.language,
      currencyCode: portfolio.run.market.currency,
      provider,
      queryStrategyVersion: portfolio.run.queryStrategyVersion,
      status: "running",
      startedAt: portfolio.run.startedAt,
      finishedAt: null,
    });
    await tx.insert(searchHypotheses).values(
      portfolio.hypotheses.map((hypothesis, ordinal) => ({
        id: hypothesis.id,
        taskId: portfolio.run.taskId,
        runId: portfolio.run.id,
        ordinal,
        kind: hypothesis.kind,
        rationale: hypothesis.rationale,
        sourceTextIsBasis: hypothesis.sourceTextIsBasis,
      })),
    );
    const basisRows = portfolio.hypotheses.flatMap((hypothesis) =>
      hypothesis.basisCriterionIds.map((criterionId, ordinal) => ({
        taskId: portfolio.run.taskId,
        runId: portfolio.run.id,
        hypothesisId: hypothesis.id,
        criterionId,
        ordinal,
      })),
    );
    if (basisRows.length > 0) {
      await tx.insert(searchHypothesisBasisCriteria).values(basisRows);
    }
    await tx.insert(searchQueries).values(
      portfolio.queries.map((query, ordinal) => ({
        id: query.id,
        taskId: query.taskId,
        runId: query.runId,
        hypothesisId: query.hypothesisId,
        ordinal,
        purpose: query.purpose,
        queryText: query.text,
        surface: query.surface,
        candidateLimit: query.limit,
        provider,
      })),
    );

    const run = await loadSearchRunInTransaction(
      tx,
      portfolio.run.taskId,
      portfolio.run.id,
    );
    if (run === null) throw new Error("Inserted search run was not visible");
    return { created: true, run };
  })();
}

function storedExecutionMatches(options: {
  run: PersistedSearchRun;
  execution: z.infer<typeof queryExecutionInputSchema>;
  startedAt: Date;
  finishedAt: Date;
  providerRequestId: string | null;
}) {
  const stored = options.run.queryExecutions.find(
    (execution) => execution.queryId === options.execution.query.id,
  );
  if (
    stored === undefined ||
    stored.startedAt.getTime() !== options.startedAt.getTime() ||
    stored.finishedAt.getTime() !== options.finishedAt.getTime() ||
    stored.providerRequestId !== options.providerRequestId
  ) {
    return false;
  }
  if (options.execution.status === "failed") {
    return (
      stored.status === "failed" &&
      stored.failureCode === options.execution.errorCode
    );
  }
  if (
    stored.status !== "succeeded" ||
    stored.receivedResultCount !== options.execution.receivedResultCount ||
    stored.rejectedResultCount !== options.execution.rejectedResultCount
  ) {
    return false;
  }
  const storedListings = options.run.listings
    .filter((listing) => listing.queryId === options.execution.query.id)
    .map(stripPersistedListing);
  return isDeepStrictEqual(
    normalizedListings(storedListings),
    normalizedListings(options.execution.listings),
  );
}

export async function recordSearchQueryExecution(options: {
  db: ShoppingDatabase;
  execution: QueryExecution;
  startedAt: Date;
  finishedAt: Date;
  providerRequestId?: string | null;
  expectedLeaseToken?: unknown;
}): Promise<{ created: boolean; run: PersistedSearchRun }> {
  return options.db.transaction((tx) =>
    recordSearchQueryExecutionInTransaction({
      tx,
      execution: options.execution,
      startedAt: options.startedAt,
      finishedAt: options.finishedAt,
      ...(options.providerRequestId === undefined
        ? {}
        : { providerRequestId: options.providerRequestId }),
      ...(options.expectedLeaseToken === undefined
        ? {}
        : { expectedLeaseToken: options.expectedLeaseToken }),
    }),
  );
}

export async function recordSearchQueryExecutionInTransaction(options: {
  tx: ShoppingTransaction;
  execution: QueryExecution;
  startedAt: Date;
  finishedAt: Date;
  providerRequestId?: string | null;
  expectedLeaseToken?: unknown;
}): Promise<{ created: boolean; run: PersistedSearchRun }> {
  const execution = queryExecutionInputSchema.parse(options.execution);
  const startedAt = z.date().parse(options.startedAt);
  const finishedAt = z.date().parse(options.finishedAt);
  const providerRequestId = z
    .string()
    .min(1)
    .max(240)
    .nullable()
    .parse(options.providerRequestId ?? null);
  const expectedLeaseToken =
    options.expectedLeaseToken === undefined
      ? undefined
      : z.uuid().parse(options.expectedLeaseToken);
  if (finishedAt < startedAt) {
    throw new TypeError("Query execution finished before it started");
  }

  const tx = options.tx;
  return (async () => {
    const query = execution.query;
    const [lockedRun] = await tx
      .select({
        status: searchRuns.status,
        leaseToken: searchRuns.leaseToken,
      })
      .from(searchRuns)
      .where(
        and(
          eq(searchRuns.taskId, query.taskId),
          eq(searchRuns.id, query.runId),
        ),
      )
      .for("update")
      .limit(1);
    if (lockedRun === undefined) throw new SearchRunNotFoundError(query.runId);

    const run = await loadSearchRunInTransaction(tx, query.taskId, query.runId);
    if (run === null) throw new SearchRunNotFoundError(query.runId);
    const storedQuery = run.portfolio.queries.find(
      (planned) => planned.id === query.id,
    );
    if (storedQuery === undefined || !isDeepStrictEqual(storedQuery, query)) {
      throw new SearchQueryExecutionConflictError(query.id);
    }
    const existing = run.queryExecutions.find(
      (receipt) => receipt.queryId === query.id,
    );
    if (existing !== undefined) {
      if (
        !storedExecutionMatches({
          run,
          execution,
          startedAt,
          finishedAt,
          providerRequestId,
        })
      ) {
        throw new SearchQueryExecutionConflictError(query.id);
      }
      return { created: false, run };
    }
    if (
      lockedRun.leaseToken !== (expectedLeaseToken ?? null) ||
      (lockedRun.leaseToken === null && expectedLeaseToken !== undefined)
    ) {
      throw new SearchRunExecutionLeaseError(query.runId);
    }
    if (run.status !== "running") {
      throw new SearchQueryExecutionConflictError(query.id);
    }

    if (execution.status === "completed") {
      if (
        execution.rejectedResultCount > execution.receivedResultCount ||
        execution.listings.length > query.limit ||
        execution.listings.length >
          execution.receivedResultCount - execution.rejectedResultCount
      ) {
        throw new TypeError(
          "Completed query diagnostics do not fit its listings",
        );
      }
    }

    const [executionRow] = await tx
      .insert(searchQueryExecutions)
      .values({
        taskId: query.taskId,
        runId: query.runId,
        queryId: query.id,
        status: execution.status === "completed" ? "succeeded" : "failed",
        receivedResultCount:
          execution.status === "completed"
            ? execution.receivedResultCount
            : null,
        rejectedResultCount:
          execution.status === "completed"
            ? execution.rejectedResultCount
            : null,
        providerRequestId,
        failureCode: execution.status === "failed" ? execution.errorCode : null,
        startedAt,
        finishedAt,
      })
      .returning({ id: searchQueryExecutions.id });
    if (executionRow === undefined) {
      throw new Error("Search query execution insert returned no row");
    }

    if (execution.status === "completed" && execution.listings.length > 0) {
      await tx.insert(candidateListings).values(
        execution.listings.map((listing) => ({
          taskId: listing.taskId,
          runId: listing.runId,
          queryId: listing.queryId,
          queryExecutionId: executionRow.id,
          provider: listing.provider,
          providerResultId: listing.providerResultId,
          sourceRank: listing.sourceRank,
          surface: listing.surface,
          title: listing.title,
          url: listing.url,
          canonicalUrl: listing.canonicalUrl,
          merchant: listing.merchant,
          priceAmountMinor: listing.price?.amountMinor ?? null,
          priceCurrencyCode: listing.price?.currency ?? null,
          priceText: listing.priceText,
          imageUrl: listing.imageUrl,
          deliveryText: listing.deliveryText,
          availabilityText: listing.availabilityText,
          retrievedAt: listing.retrievedAt,
        })),
      );
    }

    const receipts = await tx
      .select({
        status: searchQueryExecutions.status,
        finishedAt: searchQueryExecutions.finishedAt,
      })
      .from(searchQueryExecutions)
      .where(
        and(
          eq(searchQueryExecutions.taskId, query.taskId),
          eq(searchQueryExecutions.runId, query.runId),
        ),
      );
    if (receipts.length === run.portfolio.queries.length) {
      const succeeded = receipts.filter(
        (receipt) => receipt.status === "succeeded",
      ).length;
      const status =
        succeeded === receipts.length
          ? "succeeded"
          : succeeded === 0
            ? "failed"
            : "partial";
      const latestFinishedAt = new Date(
        Math.max(...receipts.map((receipt) => receipt.finishedAt.getTime())),
      );
      await tx
        .update(searchRuns)
        .set({
          status,
          finishedAt: latestFinishedAt,
          leaseToken: null,
          leaseExpiresAt: null,
        })
        .where(
          and(
            eq(searchRuns.taskId, query.taskId),
            eq(searchRuns.id, query.runId),
          ),
        );
    }

    const stored = await loadSearchRunInTransaction(
      tx,
      query.taskId,
      query.runId,
    );
    if (stored === null) throw new Error("Updated search run was not visible");
    return { created: true, run: stored };
  })();
}

export async function loadPersistedSearchRun(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  runId: unknown;
}): Promise<PersistedSearchRun | null> {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const runId = searchRunIdSchema.parse(options.runId);
  return options.db.transaction(
    (tx) => loadSearchRunInTransaction(tx, taskId, runId),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export async function loadPersistedSearchRunInTransaction(options: {
  tx: ShoppingTransaction;
  taskId: unknown;
  runId: unknown;
}): Promise<PersistedSearchRun | null> {
  return loadSearchRunInTransaction(
    options.tx,
    shoppingTaskIdSchema.parse(options.taskId),
    searchRunIdSchema.parse(options.runId),
  );
}

export async function loadPersistedSearchRunByTrigger(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  contextActionId: unknown;
}): Promise<PersistedSearchRun | null> {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const contextActionId = contextActionIdSchema.parse(options.contextActionId);
  return options.db.transaction(
    (tx) =>
      loadExistingPlanByTrigger({
        tx,
        taskId,
        contextActionId,
        lock: false,
      }),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export function findQuery(
  run: PersistedSearchRun,
  queryIdInput: unknown,
): SearchQuery {
  const queryId = searchQueryIdSchema.parse(queryIdInput);
  const query = run.portfolio.queries.find((entry) => entry.id === queryId);
  if (query === undefined)
    throw new Error(`Query ${queryId} is not in this run`);
  return query;
}
