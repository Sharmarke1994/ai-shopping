import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PersistedDataCorruptionError } from "../../src/domain/shopping-state/errors";
import { persistContextAction } from "../../src/features/context-acquisition/persistence/context-actions";
import { loadRetrievalContextFromPersistedState } from "../../src/features/retrieval-spike/context-from-persisted-state";
import type { CandidateListing } from "../../src/features/retrieval-spike/contracts";
import type { QueryExecution } from "../../src/features/retrieval-spike/execution";
import {
  loadPersistedSearchRun,
  persistSearchPlan,
  recordSearchQueryExecution,
  SearchPlanAuthorityError,
  SearchQueryExecutionConflictError,
  SearchTriggerConflictError,
} from "../../src/features/retrieval-spike/persistence/search-runs";
import { recordInitialShoppingSubject } from "../../src/features/retrieval-spike/persistence/shopping-subjects";
import { buildSearchQueryPortfolio } from "../../src/features/retrieval-spike/query-strategy";
import { recordTaskInput } from "../../src/features/shopping-state/persistence/inputs-and-messages";
import { applyStatePatch } from "../../src/features/shopping-state/persistence/state-transitions";
import { createShoppingTask } from "../../src/features/shopping-state/persistence/tasks";
import {
  candidateListings,
  searchQueries,
  searchQueryExecutions,
  searchRuns,
} from "../../src/infrastructure/database/schema";
import {
  createTestDatabaseConnection,
  resetShoppingState,
  type TestDatabaseConnection,
  waitForDatabaseLock,
} from "./helpers";

const actionConfig = {
  provider: "fake",
  model: "deterministic-retrieval-persistence",
  promptVersion: "test-v1",
  providerSchemaVersion: 1,
} as const;

const runStartedAt = new Date("2026-08-23T12:00:00.000Z");

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("retrieval persistence", () => {
  let connection: TestDatabaseConnection;

  beforeAll(() => {
    connection = createTestDatabaseConnection();
  });
  beforeEach(async () => {
    await resetShoppingState(connection);
  });
  afterAll(async () => {
    await connection.close();
  });

  async function authority() {
    const task = await createShoppingTask(connection.db);
    const source = await recordInitialShoppingSubject({
      db: connection.db,
      taskId: task.id,
      clientActionId: "retrieval-persistence-source",
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 0n,
        kind: "message",
        body: "I need a lightweight running cap",
      },
    });
    const application = await applyStatePatch(connection.db, {
      applicationSchemaVersion: 1,
      applicationKind: "patch",
      taskId: task.id,
      expectedRevision: 0n,
      source: { kind: "user_explicit", inputId: source.input.id },
      patch: {
        schemaVersion: 1,
        outcome: "change",
        operations: [
          {
            op: "create_concept",
            localRef: "weight",
            label: "Weight",
            definition: "How light the cap should feel",
            valueFamily: "qualitative",
            canonicalUnit: null,
          },
          {
            op: "add_criterion",
            concept: { kind: "created", localRef: "weight" },
            target: {
              strength: "preference",
              targetSemantics: "qualitative",
              semanticValue: {
                schemaVersion: 1,
                kind: "qualitative",
                mode: "text",
                text: "very lightweight",
              },
            },
          },
        ],
      },
    });
    const action = await persistContextAction({
      db: connection.db,
      taskId: task.id,
      stateChangeApplicationId: application.application.id,
      selectedAtRevision: 1n,
      proposal: {
        schemaVersion: 1,
        action: "search",
        rationale: { summary: "The brief is ready to retrieve." },
      },
      config: actionConfig,
    });
    const criterionId = application.brief.items[0]?.criterionId;
    if (criterionId === undefined)
      throw new Error("Expected a brief criterion");
    const retrievalAuthority = await loadRetrievalContextFromPersistedState({
      db: connection.db,
      taskId: task.id,
      contextActionId: action.action.id,
      marketVocabulary: [
        {
          term: "race cap",
          rationale: "Explore commercial running-cap language.",
          basisCriterionIds: [criterionId],
        },
      ],
    });
    const portfolio = buildSearchQueryPortfolio(retrievalAuthority.context, {
      now: () => runStartedAt,
    });
    return { task, source, application, action: action.action, portfolio };
  }

  function listing(
    query: ReturnType<typeof buildSearchQueryPortfolio>["queries"][number],
    options: {
      providerResultId: string;
      sourceRank?: number;
      title?: string;
      merchant?: string;
      canonicalUrl?: string;
      reviewEvidence?: CandidateListing["reviewEvidence"];
    },
  ): CandidateListing {
    const canonicalUrl =
      options.canonicalUrl ?? "https://merchant.example/products/race-cap";
    return {
      taskId: query.taskId,
      runId: query.runId,
      queryId: query.id,
      provider: "fixture",
      providerResultId: options.providerResultId,
      sourceRank: options.sourceRank ?? 1,
      surface: "shopping",
      title: options.title ?? "Lightweight Race Cap",
      url: `${canonicalUrl}?offer=${encodeURIComponent(options.providerResultId)}`,
      canonicalUrl,
      merchantDestinationUrl: canonicalUrl,
      merchantDestinationSource:
        options.reviewEvidence === undefined
          ? "shopping_result"
          : "verified_organic",
      merchant: options.merchant ?? "Runner Shop",
      price: { amountMinor: 2499, currency: "GBP" },
      priceText: "£24.99",
      imageUrl: "https://merchant.example/images/race-cap.jpg",
      deliveryText: null,
      availabilityText: null,
      reviewEvidence: options.reviewEvidence ?? null,
      retrievedAt: new Date("2026-08-23T12:00:01.500Z"),
    };
  }

  function completed(
    query: ReturnType<typeof buildSearchQueryPortfolio>["queries"][number],
    listings: readonly CandidateListing[],
  ): QueryExecution {
    return {
      status: "completed",
      query,
      listings,
      receivedResultCount: listings.length,
      rejectedResultCount: 0,
    };
  }

  function failed(
    query: ReturnType<typeof buildSearchQueryPortfolio>["queries"][number],
    error = "secret-bearing raw provider detail must not persist",
  ): QueryExecution {
    return {
      status: "failed",
      query,
      errorCode: "provider_failed",
      error,
    };
  }

  async function rawCandidateListing(
    query: ReturnType<typeof buildSearchQueryPortfolio>["queries"][number],
    queryExecutionId: string,
    overrides: Partial<{
      merchantDestinationUrl: string | null;
      merchantDestinationSource: string | null;
      reviewRatingHundredths: number | null;
      reviewCount: number | null;
      reviewEvidenceSourceUrl: string | null;
    }> = {},
  ) {
    const id = randomUUID();
    const values = {
      merchantDestinationUrl: null,
      merchantDestinationSource: null,
      reviewRatingHundredths: null,
      reviewCount: null,
      reviewEvidenceSourceUrl: null,
      ...overrides,
    };
    await connection.client.unsafe(
      `insert into shopping_private.candidate_listings (
        id, task_id, run_id, query_id, query_execution_id, provider,
        provider_result_id, source_rank, surface, title, url, canonical_url,
        merchant_destination_url, merchant_destination_source, merchant,
        price_amount_minor, price_currency_code, price_text, image_url,
        delivery_text, availability_text, review_rating_hundredths,
        review_count, review_evidence_source_url, retrieved_at
      ) values (
        $1, $2, $3, $4, $5, 'fixture', $6, 1, 'shopping',
        'Raw candidate listing', 'https://shopping.example/result',
        'https://shopping.example/result', $7, $8, 'Example Merchant',
        2499, 'GBP', '£24.99', null, null, null, $9, $10, $11, $12
      )`,
      [
        id,
        query.taskId,
        query.runId,
        query.id,
        queryExecutionId,
        `raw-${id}`,
        values.merchantDestinationUrl,
        values.merchantDestinationSource,
        values.reviewRatingHundredths,
        values.reviewCount,
        values.reviewEvidenceSourceUrl,
        "2026-08-27T12:00:00.000Z",
      ],
    );
  }

  it("persists the plan before calls and derives a partial terminal run", async () => {
    const { task, action, portfolio } = await authority();
    const planned = await persistSearchPlan({
      db: connection.db,
      contextActionId: action.id,
      provider: "fixture",
      portfolio,
    });

    expect(planned.created).toBe(true);
    expect(planned.run).toMatchObject({
      contextActionId: action.id,
      provider: "fixture",
      status: "running",
      finishedAt: null,
      queryExecutions: [],
      listings: [],
    });
    expect(planned.run.portfolio).toEqual(portfolio);

    const firstQuery = portfolio.queries[0]!;
    const secondQuery = portfolio.queries[1]!;
    const afterSuccess = await recordSearchQueryExecution({
      db: connection.db,
      execution: completed(firstQuery, [
        listing(firstQuery, {
          providerResultId: "cap-offer-1",
          reviewEvidence: {
            kind: "provider_structured_rating",
            ratingHundredths: 460,
            scaleHundredths: 500,
            reviewCount: 29,
            sourceUrl: "https://merchant.example/products/race-cap",
          },
        }),
      ]),
      startedAt: new Date("2026-08-23T12:00:01.000Z"),
      finishedAt: new Date("2026-08-23T12:00:02.000Z"),
    });
    expect(afterSuccess.run.status).toBe("running");
    expect(afterSuccess.run.listings).toHaveLength(1);
    expect(afterSuccess.run.listings[0]?.reviewEvidence).toEqual({
      kind: "provider_structured_rating",
      ratingHundredths: 460,
      scaleHundredths: 500,
      reviewCount: 29,
      sourceUrl: "https://merchant.example/products/race-cap",
    });

    const afterFailure = await recordSearchQueryExecution({
      db: connection.db,
      execution: failed(secondQuery),
      startedAt: new Date("2026-08-23T12:00:01.000Z"),
      finishedAt: new Date("2026-08-23T12:00:03.000Z"),
    });
    expect(afterFailure.run.status).toBe("running");

    const thirdQuery = portfolio.queries[2]!;
    const terminal = await recordSearchQueryExecution({
      db: connection.db,
      execution: failed(thirdQuery, "another raw provider exception"),
      startedAt: new Date("2026-08-23T12:00:01.000Z"),
      finishedAt: new Date("2026-08-23T12:00:04.000Z"),
    });

    expect(terminal.run.status).toBe("partial");
    expect(terminal.run.finishedAt).toEqual(
      new Date("2026-08-23T12:00:04.000Z"),
    );
    expect(terminal.run.queryExecutions.map((entry) => entry.status)).toEqual([
      "succeeded",
      "failed",
      "failed",
    ]);
    expect(
      terminal.run.queryExecutions.every(
        (execution) =>
          !("error" in execution) && !("failureMessage" in execution),
      ),
    ).toBe(true);
    expect(
      await loadPersistedSearchRun({
        db: connection.db,
        taskId: task.id,
        runId: portfolio.run.id,
      }),
    ).toEqual(terminal.run);
  });

  it("returns exact retries, rejects conflicts, and keeps distinct offers", async () => {
    const { action, portfolio } = await authority();
    const firstPlan = await persistSearchPlan({
      db: connection.db,
      contextActionId: action.id,
      provider: "fixture",
      portfolio,
    });
    const planRetry = await persistSearchPlan({
      db: connection.db,
      contextActionId: action.id,
      provider: "fixture",
      portfolio,
    });
    expect(firstPlan.created).toBe(true);
    expect(planRetry.created).toBe(false);

    await expect(
      persistSearchPlan({
        db: connection.db,
        contextActionId: action.id,
        provider: "serper",
        portfolio,
      }),
    ).rejects.toBeInstanceOf(SearchTriggerConflictError);

    const query = portfolio.queries[0]!;
    const sharedProviderProductId = "shared-google-catalog-id";
    const execution = completed(query, [
      listing(query, {
        providerResultId: sharedProviderProductId,
        sourceRank: 1,
        merchant: "Retailer A",
        canonicalUrl: "https://retailer-a.example/products/shared-cap",
      }),
      listing(query, {
        providerResultId: sharedProviderProductId,
        sourceRank: 2,
        merchant: "Retailer B",
        canonicalUrl: "https://retailer-b.example/products/shared-cap",
      }),
    ]);
    const timestamps = {
      startedAt: new Date("2026-08-23T12:00:01.000Z"),
      finishedAt: new Date("2026-08-23T12:00:02.000Z"),
    };
    const first = await recordSearchQueryExecution({
      db: connection.db,
      execution,
      ...timestamps,
    });
    const retry = await recordSearchQueryExecution({
      db: connection.db,
      execution,
      ...timestamps,
    });

    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(retry.run.listings).toHaveLength(2);
    expect(retry.run.listings.map((entry) => entry.id)).toEqual(
      first.run.listings.map((entry) => entry.id),
    );
    expect(retry.run.listings.map((entry) => entry.providerResultId)).toEqual([
      sharedProviderProductId,
      sharedProviderProductId,
    ]);
    expect(retry.run.listings.map((entry) => entry.merchant)).toEqual([
      "Retailer A",
      "Retailer B",
    ]);

    if (execution.status !== "completed") {
      throw new Error("Expected completed test execution");
    }
    const changed = completed(query, [
      { ...execution.listings[0]!, title: "Changed result" },
      execution.listings[1]!,
    ]);
    await expect(
      recordSearchQueryExecution({
        db: connection.db,
        execution: changed,
        ...timestamps,
      }),
    ).rejects.toBeInstanceOf(SearchQueryExecutionConflictError);
  });

  it("elects one exact search-plan winner under concurrent retries", async () => {
    const { action, portfolio } = await authority();
    const results = await Promise.all([
      persistSearchPlan({
        db: connection.db,
        contextActionId: action.id,
        provider: "fixture",
        portfolio,
      }),
      persistSearchPlan({
        db: connection.db,
        contextActionId: action.id,
        provider: "fixture",
        portfolio,
      }),
    ]);

    expect(results.map((result) => result.created).sort()).toEqual([
      false,
      true,
    ]);
    expect(results[0]?.run).toEqual(results[1]?.run);
  });

  it("holds a shared run lock across an exact multi-table plan retry", async () => {
    const { action, portfolio } = await authority();
    await persistSearchPlan({
      db: connection.db,
      contextActionId: action.id,
      provider: "fixture",
      portfolio,
    });

    const blockerConnection = createTestDatabaseConnection(
      "retrieval_plan_child_blocker",
    );
    const retryConnection = createTestDatabaseConnection(
      "retrieval_plan_exact_retry",
    );
    const probeConnection = createTestDatabaseConnection(
      "retrieval_plan_finalizer_probe",
    );
    const childTableLocked = deferred();
    const releaseChildTable = deferred();
    const blocker = blockerConnection.db.transaction(async (tx) => {
      await tx.execute(
        sql`LOCK TABLE ${searchQueries} IN ACCESS EXCLUSIVE MODE`,
      );
      childTableLocked.resolve();
      await releaseChildTable.promise;
    });

    try {
      await childTableLocked.promise;
      const retry = persistSearchPlan({
        db: retryConnection.db,
        contextActionId: action.id,
        provider: "fixture",
        portfolio,
      });
      await waitForDatabaseLock({
        observer: connection,
        applicationNames: ["retrieval_plan_exact_retry"],
      });

      await expect(
        probeConnection.db.transaction(async (tx) => {
          await tx
            .select({ id: searchRuns.id })
            .from(searchRuns)
            .where(eq(searchRuns.id, portfolio.run.id))
            .for("update", { noWait: true });
        }),
      ).rejects.toThrow();

      releaseChildTable.resolve();
      await blocker;
      await expect(retry).resolves.toMatchObject({ created: false });
    } finally {
      releaseChildTable.resolve();
      await blocker;
      await Promise.all([
        blockerConnection.close(),
        retryConnection.close(),
        probeConnection.close(),
      ]);
    }
  });

  it("rejects a stale plan without writing retrieval state", async () => {
    const { task, action, portfolio } = await authority();
    const laterInput = await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: "retrieval-plan-stale",
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 1n,
        kind: "message",
        body: "No white",
      },
    });
    await applyStatePatch(connection.db, {
      applicationSchemaVersion: 1,
      applicationKind: "patch",
      taskId: task.id,
      expectedRevision: 1n,
      source: { kind: "user_explicit", inputId: laterInput.input.id },
      patch: {
        schemaVersion: 1,
        outcome: "change",
        operations: [
          {
            op: "create_concept",
            localRef: "colour",
            label: "Colour",
            definition: "Colours the shopper excludes",
            valueFamily: "categorical",
            canonicalUnit: null,
          },
          {
            op: "add_criterion",
            concept: { kind: "created", localRef: "colour" },
            target: {
              strength: "hard",
              targetSemantics: "categorical",
              semanticValue: {
                schemaVersion: 1,
                kind: "categorical",
                operator: "exclude",
                values: ["white"],
              },
            },
          },
        ],
      },
    });

    await expect(
      persistSearchPlan({
        db: connection.db,
        contextActionId: action.id,
        provider: "fixture",
        portfolio,
      }),
    ).rejects.toBeInstanceOf(SearchPlanAuthorityError);
    expect(
      await connection.db
        .select()
        .from(searchRuns)
        .where(eq(searchRuns.taskId, task.id)),
    ).toEqual([]);
  });

  it("fails closed on a structurally stored but semantically corrupt listing", async () => {
    const { task, action, portfolio } = await authority();
    await persistSearchPlan({
      db: connection.db,
      contextActionId: action.id,
      provider: "fixture",
      portfolio,
    });
    const query = portfolio.queries[0]!;
    await recordSearchQueryExecution({
      db: connection.db,
      execution: completed(query, [
        listing(query, { providerResultId: "currency-corruption" }),
      ]),
      startedAt: new Date("2026-08-23T12:00:01.000Z"),
      finishedAt: new Date("2026-08-23T12:00:02.000Z"),
    });
    await connection.db
      .update(candidateListings)
      .set({ priceCurrencyCode: "USD" })
      .where(
        and(
          eq(candidateListings.runId, portfolio.run.id),
          eq(candidateListings.queryId, query.id),
        ),
      );

    await expect(
      loadPersistedSearchRun({
        db: connection.db,
        taskId: task.id,
        runId: portfolio.run.id,
      }),
    ).rejects.toBeInstanceOf(PersistedDataCorruptionError);
  });

  it("fails closed if a failed receipt is made to own a candidate", async () => {
    const { task, action, portfolio } = await authority();
    await persistSearchPlan({
      db: connection.db,
      contextActionId: action.id,
      provider: "fixture",
      portfolio,
    });
    const query = portfolio.queries[0]!;
    await recordSearchQueryExecution({
      db: connection.db,
      execution: failed(query),
      startedAt: new Date("2026-08-23T12:00:01.000Z"),
      finishedAt: new Date("2026-08-23T12:00:02.000Z"),
    });
    const [receipt] = await connection.db
      .select({ id: searchQueryExecutions.id })
      .from(searchQueryExecutions)
      .where(
        and(
          eq(searchQueryExecutions.runId, portfolio.run.id),
          eq(searchQueryExecutions.queryId, query.id),
        ),
      );
    if (receipt === undefined) throw new Error("Expected failed receipt");
    const candidate = listing(query, {
      providerResultId: "impossible-failure",
    });
    await connection.db.insert(candidateListings).values({
      taskId: candidate.taskId,
      runId: candidate.runId,
      queryId: candidate.queryId,
      queryExecutionId: receipt.id,
      provider: candidate.provider,
      providerResultId: candidate.providerResultId,
      sourceRank: candidate.sourceRank,
      surface: candidate.surface,
      title: candidate.title,
      url: candidate.url,
      canonicalUrl: candidate.canonicalUrl,
      merchant: candidate.merchant,
      priceAmountMinor: candidate.price?.amountMinor ?? null,
      priceCurrencyCode: candidate.price?.currency ?? null,
      priceText: candidate.priceText,
      imageUrl: candidate.imageUrl,
      deliveryText: candidate.deliveryText,
      availabilityText: candidate.availabilityText,
      retrievedAt: candidate.retrievedAt,
    });

    await expect(
      loadPersistedSearchRun({
        db: connection.db,
        taskId: task.id,
        runId: portfolio.run.id,
      }),
    ).rejects.toBeInstanceOf(PersistedDataCorruptionError);
  });

  it("rejects partial nullable provenance tuples at the PostgreSQL boundary", async () => {
    const { task, action, portfolio } = await authority();
    await persistSearchPlan({
      db: connection.db,
      contextActionId: action.id,
      provider: "fixture",
      portfolio,
    });
    const query = portfolio.queries[0]!;
    await recordSearchQueryExecution({
      db: connection.db,
      execution: completed(query, []),
      startedAt: new Date("2026-08-27T12:00:01.000Z"),
      finishedAt: new Date("2026-08-27T12:00:02.000Z"),
    });
    const [receipt] = await connection.db
      .select({ id: searchQueryExecutions.id })
      .from(searchQueryExecutions)
      .where(
        and(
          eq(searchQueryExecutions.taskId, task.id),
          eq(searchQueryExecutions.runId, portfolio.run.id),
          eq(searchQueryExecutions.queryId, query.id),
        ),
      );
    if (receipt === undefined) throw new Error("Expected query receipt");

    const invalidRows = [
      {
        merchantDestinationUrl: "https://merchant.example/item",
        merchantDestinationSource: null,
      },
      {
        merchantDestinationUrl: null,
        merchantDestinationSource: "shopping_result",
      },
      {
        reviewRatingHundredths: 460,
        reviewCount: null,
        reviewEvidenceSourceUrl: null,
      },
      {
        reviewRatingHundredths: 460,
        reviewCount: 29,
        reviewEvidenceSourceUrl: null,
      },
      {
        reviewRatingHundredths: null,
        reviewCount: null,
        reviewEvidenceSourceUrl: "https://merchant.example/item",
      },
      {
        merchantDestinationUrl: null,
        merchantDestinationSource: null,
        reviewRatingHundredths: 460,
        reviewCount: 29,
        reviewEvidenceSourceUrl: "https://merchant.example/item",
      },
      {
        merchantDestinationUrl: "https://merchant.example/item",
        merchantDestinationSource: "verified_organic",
        reviewRatingHundredths: 460,
        reviewCount: 29,
        reviewEvidenceSourceUrl: "https://other.example/item",
      },
      {
        merchantDestinationUrl: "https://merchant.example/item",
        merchantDestinationSource: "shopping_result",
        reviewRatingHundredths: 460,
        reviewCount: 29,
        reviewEvidenceSourceUrl: "https://merchant.example/item",
      },
    ] as const;
    for (const invalid of invalidRows) {
      await expect(
        rawCandidateListing(query, receipt.id, invalid),
      ).rejects.toThrow();
    }

    await expect(
      rawCandidateListing(query, receipt.id),
    ).resolves.toBeUndefined();
    await expect(
      rawCandidateListing(query, receipt.id, {
        merchantDestinationUrl: "https://merchant.example/item",
        merchantDestinationSource: "shopping_result",
      }),
    ).resolves.toBeUndefined();
    await expect(
      rawCandidateListing(query, receipt.id, {
        merchantDestinationUrl: "https://merchant.example/item",
        merchantDestinationSource: "verified_organic",
        reviewRatingHundredths: 460,
        reviewCount: 29,
        reviewEvidenceSourceUrl: "https://merchant.example/item",
      }),
    ).resolves.toBeUndefined();
  });
});
