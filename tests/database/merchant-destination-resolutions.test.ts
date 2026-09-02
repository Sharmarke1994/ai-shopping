import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { PersistedDataCorruptionError } from "../../src/domain/shopping-state/errors";
import {
  refineLiveShopping,
  researchLiveShopping,
  resolveLivePurchaseDestinations,
  startLiveShopping,
} from "../../src/features/live-shopping/application";
import { candidateListingIdSchema } from "../../src/domain/shopping-state/ids";
import { rejectCandidateListing } from "../../src/features/live-shopping/rejected-listings";
import { saveCandidateListing } from "../../src/features/live-shopping/saved-listings";
import type {
  ContextAcquisitionModel,
  ModelCallMetadata,
} from "../../src/features/context-acquisition/model-port";
import type {
  ContextActionProviderWireV1,
  InterpretationProviderWireV1,
} from "../../src/features/context-acquisition/provider-wire";
import { executeOrResumeMerchantDestinationResolution } from "../../src/features/purchase-destinations/orchestrator";
import {
  claimMerchantDestinationResolution,
  loadMerchantDestinationResolutionMap,
  MerchantDestinationResolutionLeaseError,
  validateMerchantDestinationResolutionExecution,
} from "../../src/features/purchase-destinations/persistence";
import type { MerchantDestinationResolver } from "../../src/features/purchase-destinations/contracts";
import {
  FakeEvidencePageFetcher,
  FakeEvidenceSearchProvider,
  FakeProductUnderstandingModel,
} from "../../src/features/product-understanding/fakes";
import {
  candidateListingSchema,
  providerSearchResultSchema,
  type ShoppingSearchProvider,
} from "../../src/features/retrieval-spike/contracts";
import { loadPersistedSearchRun } from "../../src/features/retrieval-spike/persistence/search-runs";
import { executeOrResumeRetrieval } from "../../src/features/retrieval-spike/retrieval-orchestrator";
import {
  candidateListings,
  founderLiveSessions,
  merchantDestinationResolutions,
  searchRuns,
} from "../../src/infrastructure/database/schema";
import {
  createTestDatabaseConnection,
  resetShoppingState,
  type TestDatabaseConnection,
  waitForDatabaseLock,
} from "./helpers";

const metadata: ModelCallMetadata = {
  provider: "fixture",
  model: "destination-test",
  promptVersion: "test-v1",
  providerSchemaVersion: 1,
  providerRequestId: "fixture",
  durationMs: 1,
  inputTokens: null,
  outputTokens: null,
};

function completed<T>(value: T) {
  return Promise.resolve({ status: "completed" as const, value, metadata });
}

const noChange: InterpretationProviderWireV1 = {
  providerSchemaVersion: 1,
  outcome: "no_change",
  operations: [],
  ambiguities: [],
};

const exactProductPreference: InterpretationProviderWireV1 = {
  providerSchemaVersion: 1,
  outcome: "change",
  operations: [
    {
      op: "create_concept",
      localRef: "exact_product_fit",
      label: "Exact product fit",
      definition: "Whether this exact product suits the shopper's request",
      valueFamily: "qualitative",
      canonicalUnit: null,
    },
    {
      op: "add_criterion",
      concept: { kind: "created", localRef: "exact_product_fit" },
      target: {
        strength: "preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative_text",
          text: "a suitable exact product",
        },
      },
    },
  ],
  ambiguities: [],
};

const search: ContextActionProviderWireV1 = {
  providerSchemaVersion: 1,
  action: "search",
  question: null,
  rationale: { summary: "The request is ready for retrieval." },
};

function directModel(): ContextAcquisitionModel {
  return {
    interpret: vi.fn(() => completed(noChange)),
    selectAction: vi.fn(() => completed(search)),
  };
}

function researchableRefinementModel(): ContextAcquisitionModel {
  let interpretationCall = 0;
  return {
    interpret: vi.fn(() => {
      interpretationCall += 1;
      return completed(
        interpretationCall === 1 ? exactProductPreference : noChange,
      );
    }),
    selectAction: vi.fn(() => completed(search)),
  };
}

function googleFallbackProvider(): ShoppingSearchProvider {
  return {
    provider: "serper",
    maxRequestDurationMs: 0,
    search: async (query) =>
      providerSearchResultSchema.parse({
        listings: [
          ["Trust Bayo II Ergonomic Wireless Mouse Black", "Argos"],
          ["Sony WH1000XM5 Wireless Headphones Black", "John Lewis"],
          ["Dyson V8 Absolute Cordless Vacuum", "AO.com"],
        ].map(([title, merchant], index) =>
          candidateListingSchema.parse({
            taskId: query.taskId,
            runId: query.runId,
            queryId: query.id,
            provider: "serper",
            providerResultId: `${query.id}:offer:${index + 1}`,
            sourceRank: index + 1,
            surface: "shopping",
            title,
            url: `https://www.google.co.uk/search?ibp=oshop&prds=offer:${index + 1}`,
            canonicalUrl: `https://www.google.co.uk/search?ibp=oshop&prds=offer:${index + 1}`,
            merchantDestinationUrl: null,
            merchantDestinationSource: null,
            merchant,
            price: { amountMinor: 10_000 + index, currency: "GBP" },
            priceText: `£100.0${index}`,
            imageUrl: null,
            deliveryText: null,
            availabilityText: null,
            reviewEvidence: null,
            retrievedAt: new Date("2026-08-29T10:00:00.000Z"),
          }),
        ),
        diagnostics: { receivedResultCount: 3, rejectedResultCount: 0 },
      }),
  };
}

async function startedSession(connection: TestDatabaseConnection) {
  const provider = googleFallbackProvider();
  await startLiveShopping({
    dependencies: {
      db: connection.db,
      model: directModel(),
      provider,
    },
    input: {
      operation: "start",
      sessionId: "10000000-0000-4000-8000-000000000001",
      turnId: "20000000-0000-4000-8000-000000000002",
      message: "A useful exact product",
    },
  });
  const [session] = await connection.db.select().from(founderLiveSessions);
  const [run] = await connection.db.select().from(searchRuns);
  if (session === undefined || run === undefined) {
    throw new Error("Expected a persisted live search");
  }
  const listings = await connection.db
    .select()
    .from(candidateListings)
    .orderBy(candidateListings.sourceRank);
  return { listings, provider, run, session };
}

function exactMerchantDestination(options: {
  candidateListingId: string;
  merchant: string;
}) {
  const hostname =
    options.merchant === "Argos"
      ? "www.argos.co.uk"
      : options.merchant === "John Lewis"
        ? "www.johnlewis.com"
        : options.merchant === "AO.com"
          ? "ao.com"
          : null;
  if (hostname === null) {
    throw new Error(`Unexpected fixture merchant ${options.merchant}`);
  }
  return `https://${hostname}/product/${options.candidateListingId}`;
}

function acceptedResolver(
  calls: string[],
  beforeResolve?: () => Promise<void>,
): MerchantDestinationResolver {
  return {
    provider: "serper",
    maxRequestDurationMs: 1_000,
    resolve: async (request) => {
      calls.push(request.candidateListingId);
      await beforeResolve?.();
      return {
        outcome: "resolved",
        destinationUrl: exactMerchantDestination(request),
        acceptedResultTitle: request.title,
        observedResultUrl: null,
        consideredResultCount: 1,
      };
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("merchant destination resolution persistence", () => {
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

  it("keeps the original search receipt equal after enrichment and makes a lost-response retry free", async () => {
    const { listings, provider, run, session } =
      await startedSession(connection);
    const candidate = listings[0]!;
    const before = await loadPersistedSearchRun({
      db: connection.db,
      taskId: session.taskId,
      runId: run.id,
    });
    const originalRows = await connection.db.select().from(candidateListings);
    const calls: string[] = [];

    const first = await executeOrResumeMerchantDestinationResolution({
      db: connection.db,
      taskId: session.taskId,
      visibleTopCandidateListingIds: [candidate.id],
      visibleTopAuthority: {
        sessionId: session.id,
        contextActionId: run.contextActionId,
        searchRunId: run.id,
        taskRevision: run.taskRevision,
      },
      resolver: acceptedResolver(calls),
    });
    const retry = await executeOrResumeMerchantDestinationResolution({
      db: connection.db,
      taskId: session.taskId,
      visibleTopCandidateListingIds: [candidate.id],
      visibleTopAuthority: {
        sessionId: session.id,
        contextActionId: run.contextActionId,
        searchRunId: run.id,
        taskRevision: run.taskRevision,
      },
      resolver: {
        provider: "serper",
        maxRequestDurationMs: 1_000,
        resolve: vi.fn(() => {
          throw new Error("A terminal retry must not call the provider");
        }),
      },
    });
    const after = await loadPersistedSearchRun({
      db: connection.db,
      taskId: session.taskId,
      runId: run.id,
    });
    const retrievalRetry = await executeOrResumeRetrieval({
      db: connection.db,
      taskId: session.taskId,
      contextActionId: run.contextActionId,
      provider: {
        ...provider,
        search: vi.fn(() => {
          throw new Error("Enrichment must not invalidate the search receipt");
        }),
      },
    });

    expect(first.results[0]).toMatchObject({
      state: "completed",
      created: true,
      resolution: { status: "resolved" },
    });
    expect(retry.results[0]).toEqual({
      ...first.results[0],
      created: false,
    });
    expect(calls).toEqual([candidate.id]);
    expect(after).toEqual(before);
    expect(retrievalRetry.run).toEqual(before);
    expect(await connection.db.select().from(candidateListings)).toEqual(
      originalRows,
    );
    const resolutionMap = await loadMerchantDestinationResolutionMap({
      db: connection.db,
      taskId: session.taskId,
      candidateListingIds: [candidate.id],
    });
    expect(
      resolutionMap.get(candidateListingIdSchema.parse(candidate.id)),
    ).toMatchObject({
      status: "resolved",
      destinationUrl: `https://www.argos.co.uk/product/${candidate.id}`,
      acceptedResultTitle: candidate.title,
      observedResultUrl: null,
    });
  });

  it("binds every receipt to its exact task, search run and candidate", async () => {
    const { listings, run, session } = await startedSession(connection);
    const [candidate, otherCandidate] = listings;
    if (candidate === undefined || otherCandidate === undefined) {
      throw new Error("Expected two exact candidate scopes");
    }
    const claimed = await claimMerchantDestinationResolution({
      db: connection.db,
      taskId: session.taskId,
      candidateListingId: candidate.id,
      provider: "serper",
      leaseDurationMs: 5_000,
      topAuthority: {
        sessionId: session.id,
        contextActionId: run.contextActionId,
        searchRunId: run.id,
        taskRevision: run.taskRevision,
      },
    });
    if (claimed.state !== "acquired") {
      throw new Error("Expected an exact destination receipt");
    }

    await expect(
      connection.db
        .update(merchantDestinationResolutions)
        .set({ taskId: "90000000-0000-4000-8000-000000000009" })
        .where(eq(merchantDestinationResolutions.id, claimed.resolution.id)),
    ).rejects.toThrow();
    await expect(
      connection.db
        .update(merchantDestinationResolutions)
        .set({ searchRunId: "a0000000-0000-4000-8000-00000000000a" })
        .where(eq(merchantDestinationResolutions.id, claimed.resolution.id)),
    ).rejects.toThrow();

    await connection.db
      .update(merchantDestinationResolutions)
      .set({ candidateListingId: otherCandidate.id })
      .where(eq(merchantDestinationResolutions.id, claimed.resolution.id));
    await expect(
      loadMerchantDestinationResolutionMap({
        db: connection.db,
        taskId: session.taskId,
        candidateListingIds: [otherCandidate.id],
      }),
    ).rejects.toBeInstanceOf(PersistedDataCorruptionError);
  });

  it("persists accepted organic provenance and fails closed when raw title or URL evidence is mutated", async () => {
    const { listings, run, session } = await startedSession(connection);
    const candidate = listings[0]!;
    const destinationUrl = exactMerchantDestination({
      candidateListingId: candidate.id,
      merchant: candidate.merchant!,
    });
    const observedResultUrl = `${destinationUrl}?utm_source=fixture`;
    await executeOrResumeMerchantDestinationResolution({
      db: connection.db,
      taskId: session.taskId,
      visibleTopCandidateListingIds: [candidate.id],
      visibleTopAuthority: {
        sessionId: session.id,
        contextActionId: run.contextActionId,
        searchRunId: run.id,
        taskRevision: run.taskRevision,
      },
      resolver: {
        provider: "serper",
        maxRequestDurationMs: 0,
        resolve: async (request) => ({
          outcome: "resolved",
          destinationUrl,
          acceptedResultTitle: request.title,
          observedResultUrl,
          consideredResultCount: 1,
        }),
      },
    });
    const [persisted] = await connection.db
      .select()
      .from(merchantDestinationResolutions);
    expect(persisted).toMatchObject({
      status: "resolved",
      destinationUrl,
      acceptedResultTitle: candidate.title,
      observedResultUrl,
    });
    if (persisted === undefined) {
      throw new Error("Expected persisted merchant destination provenance");
    }

    await connection.db
      .update(merchantDestinationResolutions)
      .set({ acceptedResultTitle: "Different Product ZX900" })
      .where(eq(merchantDestinationResolutions.id, persisted.id));
    await expect(
      loadMerchantDestinationResolutionMap({
        db: connection.db,
        taskId: session.taskId,
        candidateListingIds: [candidate.id],
      }),
    ).rejects.toBeInstanceOf(PersistedDataCorruptionError);

    await connection.db
      .update(merchantDestinationResolutions)
      .set({
        acceptedResultTitle: candidate.title,
        observedResultUrl: "https://merchant.example.test/product/zx900",
      })
      .where(eq(merchantDestinationResolutions.id, persisted.id));
    await expect(
      loadMerchantDestinationResolutionMap({
        db: connection.db,
        taskId: session.taskId,
        candidateListingIds: [candidate.id],
      }),
    ).rejects.toBeInstanceOf(PersistedDataCorruptionError);
  });

  it("turns a schema-valid but inexact resolver result into a closed failure", async () => {
    const { listings, run, session } = await startedSession(connection);
    const candidate = listings[0]!;
    const result = await executeOrResumeMerchantDestinationResolution({
      db: connection.db,
      taskId: session.taskId,
      visibleTopCandidateListingIds: [candidate.id],
      visibleTopAuthority: {
        sessionId: session.id,
        contextActionId: run.contextActionId,
        searchRunId: run.id,
        taskRevision: run.taskRevision,
      },
      resolver: {
        provider: "serper",
        maxRequestDurationMs: 0,
        resolve: async (request) => ({
          outcome: "resolved",
          destinationUrl: `https://merchant.example.test/product/${request.candidateListingId}`,
          acceptedResultTitle: request.title,
          observedResultUrl: null,
          consideredResultCount: 1,
        }),
      },
    });

    expect(result.results[0]?.resolution).toMatchObject({
      status: "failed",
      destinationUrl: null,
      acceptedResultTitle: null,
      observedResultUrl: null,
      outcomeCode: "invalid_provider_result",
    });
  });

  it("requires non-null outcome codes for valid rejected and failed terminal rows", async () => {
    const { listings, run, session } = await startedSession(connection);
    const [rejectedCandidate, failedCandidate] = listings;
    if (rejectedCandidate === undefined || failedCandidate === undefined) {
      throw new Error("Expected two candidates for terminal lifecycle checks");
    }
    await executeOrResumeMerchantDestinationResolution({
      db: connection.db,
      taskId: session.taskId,
      visibleTopCandidateListingIds: [rejectedCandidate.id, failedCandidate.id],
      visibleTopAuthority: {
        sessionId: session.id,
        contextActionId: run.contextActionId,
        searchRunId: run.id,
        taskRevision: run.taskRevision,
      },
      resolver: {
        provider: "serper",
        maxRequestDurationMs: 0,
        resolve: async (request) => {
          if (request.candidateListingId === rejectedCandidate.id) {
            return {
              outcome: "rejected" as const,
              rejectionCode: "no_results" as const,
              consideredResultCount: 0,
            };
          }
          throw new Error("Fixture provider failure");
        },
      },
    });
    const terminals = await connection.db
      .select()
      .from(merchantDestinationResolutions);
    const rejected = terminals.find(({ status }) => status === "rejected");
    const failed = terminals.find(({ status }) => status === "failed");
    expect(rejected).toMatchObject({ outcomeCode: "no_results" });
    expect(failed).toMatchObject({ outcomeCode: "provider_failed" });
    if (rejected === undefined || failed === undefined) {
      throw new Error("Expected valid rejected and failed receipts");
    }

    await expect(
      connection.db
        .update(merchantDestinationResolutions)
        .set({ outcomeCode: null })
        .where(eq(merchantDestinationResolutions.id, rejected.id)),
    ).rejects.toThrow();
    await expect(
      connection.db
        .update(merchantDestinationResolutions)
        .set({ outcomeCode: null })
        .where(eq(merchantDestinationResolutions.id, failed.id)),
    ).rejects.toThrow();
    expect(
      await connection.db
        .select({ outcomeCode: merchantDestinationResolutions.outcomeCode })
        .from(merchantDestinationResolutions)
        .where(
          inArray(merchantDestinationResolutions.id, [rejected.id, failed.id]),
        ),
    ).toEqual(
      expect.arrayContaining([
        { outcomeCode: "no_results" },
        { outcomeCode: "provider_failed" },
      ]),
    );
  });

  it("prioritises saved offers, then visible top options, and gives rejected listings no work", async () => {
    const { listings, run, session } = await startedSession(connection);
    const [visible, saved, rejected] = listings;
    if (
      visible === undefined ||
      saved === undefined ||
      rejected === undefined
    ) {
      throw new Error("Expected three candidates");
    }
    await saveCandidateListing({
      db: connection.db,
      taskId: session.taskId,
      candidateListingId: saved.id,
    });
    await rejectCandidateListing({
      db: connection.db,
      taskId: session.taskId,
      candidateListingId: rejected.id,
    });
    const calls: string[] = [];

    const result = await executeOrResumeMerchantDestinationResolution({
      db: connection.db,
      taskId: session.taskId,
      visibleTopCandidateListingIds: [visible.id, rejected.id],
      visibleTopAuthority: {
        sessionId: session.id,
        contextActionId: run.contextActionId,
        searchRunId: run.id,
        taskRevision: run.taskRevision,
      },
      resolver: acceptedResolver(calls),
    });

    expect(
      result.results.map(({ candidateListingId }) => candidateListingId),
    ).toEqual([saved.id, visible.id]);
    expect(new Set(calls)).toEqual(new Set([saved.id, visible.id]));
    expect(calls).not.toContain(rejected.id);
    expect(
      await connection.db.select().from(merchantDestinationResolutions),
    ).toHaveLength(2);
  });

  it("derives saved and current-top destinations from the live session and retries terminal receipts without provider work", async () => {
    const sessionId = "30000000-0000-4000-8000-000000000003";
    const evidenceProvider = new FakeEvidenceSearchProvider();
    const researchModel = new FakeProductUnderstandingModel();
    const dependencies = {
      db: connection.db,
      model: researchableRefinementModel(),
      provider: googleFallbackProvider(),
      research: {
        evidenceProvider,
        pageFetcher: new FakeEvidencePageFetcher(),
        model: researchModel,
        modelIdentity: {
          provider: "fixture" as const,
          model: "fixture-product-understanding",
          promptVersion: "product-understanding-v1",
        },
      },
    };
    const initial = await startLiveShopping({
      dependencies,
      input: {
        operation: "start",
        sessionId,
        turnId: "40000000-0000-4000-8000-000000000004",
        message: "Find a useful exact product",
      },
    });
    if (initial.action.kind !== "search" || initial.action.search === null) {
      throw new Error("Expected the initial live search");
    }
    const historicalSavedCandidateId =
      initial.action.search.listings[0]?.candidateListingId;
    if (historicalSavedCandidateId === undefined) {
      throw new Error("Expected an offer to save from the first search");
    }

    const refined = await refineLiveShopping({
      dependencies,
      input: {
        operation: "refine",
        sessionId,
        turnId: "50000000-0000-4000-8000-000000000005",
        message: "Refresh the shortlist with the current brief",
      },
    });
    if (refined.action.kind !== "search" || refined.action.search === null) {
      throw new Error("Expected the refined live search");
    }
    const rejectedCandidateId =
      refined.action.search.listings.at(-1)?.candidateListingId;
    if (rejectedCandidateId === undefined) {
      throw new Error("Expected a current offer to reject");
    }
    const [session] = await connection.db
      .select()
      .from(founderLiveSessions)
      .where(eq(founderLiveSessions.id, sessionId));
    if (session === undefined) throw new Error("Expected the live session");
    await rejectCandidateListing({
      db: connection.db,
      taskId: session.taskId,
      candidateListingId: rejectedCandidateId,
    });

    const researched = await researchLiveShopping({
      dependencies,
      input: { operation: "research", sessionId },
    });
    if (researched.decisionSupport === null) {
      throw new Error("Expected a researched decision-support view");
    }
    const visibleTopCandidateIds = researched.decisionSupport.topOptions.map(
      ({ listing }) => listing.candidateListingId,
    );
    expect(visibleTopCandidateIds.length).toBeGreaterThan(0);
    expect(visibleTopCandidateIds).not.toContain(historicalSavedCandidateId);
    expect(visibleTopCandidateIds).not.toContain(rejectedCandidateId);
    expect(
      researched.decisionSupport.topOptions.map(
        ({ listing }) => listing.purchaseState,
      ),
    ).toEqual(visibleTopCandidateIds.map(() => "fallback"));

    await saveCandidateListing({
      db: connection.db,
      taskId: session.taskId,
      candidateListingId: historicalSavedCandidateId,
    });

    const resolverCandidateIds: string[] = [];
    const destinationByCandidateId = new Map<string, string>();
    const destinationResolver: MerchantDestinationResolver = {
      provider: "serper",
      maxRequestDurationMs: 0,
      resolve: vi.fn(async (request) => {
        resolverCandidateIds.push(request.candidateListingId);
        const destinationUrl = exactMerchantDestination(request);
        destinationByCandidateId.set(
          request.candidateListingId,
          destinationUrl,
        );
        return {
          outcome: "resolved" as const,
          destinationUrl,
          acceptedResultTitle: request.title,
          observedResultUrl: null,
          consideredResultCount: 1,
        };
      }),
    };
    const resolved = await resolveLivePurchaseDestinations({
      dependencies: { ...dependencies, destinationResolver },
      input: { operation: "resolve_destinations", sessionId },
    });
    if (resolved.decisionSupport === null) {
      throw new Error("Expected decision support after destination resolution");
    }
    const expectedCandidateIds = [
      historicalSavedCandidateId,
      ...visibleTopCandidateIds,
    ];

    expect([...resolverCandidateIds].sort()).toEqual(
      [...expectedCandidateIds].sort(),
    );
    const receipts = await connection.db
      .select()
      .from(merchantDestinationResolutions);
    expect(receipts).toHaveLength(expectedCandidateIds.length);
    expect(receipts.every(({ status }) => status === "resolved")).toBe(true);
    expect(
      receipts.map(({ candidateListingId }) => candidateListingId).sort(),
    ).toEqual([...expectedCandidateIds].sort());
    expect(
      receipts.some(
        ({ candidateListingId }) => candidateListingId === rejectedCandidateId,
      ),
    ).toBe(false);

    const projectedListings = [
      ...resolved.savedListings,
      ...resolved.decisionSupport.topOptions.map(({ listing }) => listing),
    ];
    for (const candidateListingId of expectedCandidateIds) {
      expect(
        projectedListings.find(
          (listing) => listing.candidateListingId === candidateListingId,
        ),
      ).toMatchObject({
        destinationUrl: destinationByCandidateId.get(candidateListingId),
        purchaseState: "direct",
        sourceLabel: "View Google Shopping source",
      });
    }
    expect(
      resolved.rejectedListings.find(
        ({ candidateListingId }) => candidateListingId === rejectedCandidateId,
      ),
    ).toMatchObject({ purchaseState: "fallback" });

    const retryResolve = vi.fn(async () => {
      throw new Error("A terminal live retry must not call the resolver");
    });
    const retried = await resolveLivePurchaseDestinations({
      dependencies: {
        ...dependencies,
        destinationResolver: {
          provider: "serper",
          maxRequestDurationMs: 0,
          resolve: retryResolve,
        },
      },
      input: { operation: "resolve_destinations", sessionId },
    });

    expect(retryResolve).not.toHaveBeenCalled();
    expect(retried).toEqual(resolved);
  });

  it("fences a stale current top before the paid call without poisoning a later saved-offer retry", async () => {
    const sessionId = "60000000-0000-4000-8000-000000000006";
    const dependencies = {
      db: connection.db,
      model: researchableRefinementModel(),
      provider: googleFallbackProvider(),
      research: {
        evidenceProvider: new FakeEvidenceSearchProvider(),
        pageFetcher: new FakeEvidencePageFetcher(),
        model: new FakeProductUnderstandingModel(),
        modelIdentity: {
          provider: "fixture" as const,
          model: "fixture-product-understanding",
          promptVersion: "product-understanding-v1",
        },
      },
    };
    await startLiveShopping({
      dependencies,
      input: {
        operation: "start",
        sessionId,
        turnId: "70000000-0000-4000-8000-000000000007",
        message: "Find an exact product with a current shortlist",
      },
    });
    const researched = await researchLiveShopping({
      dependencies,
      input: { operation: "research", sessionId },
    });
    if (researched.decisionSupport === null) {
      throw new Error("Expected current researched options");
    }
    const topCandidateIds = researched.decisionSupport.topOptions.map(
      ({ listing }) => listing.candidateListingId,
    );
    const [alreadySavedCandidateId, laterSavedCandidateId] = topCandidateIds;
    if (
      alreadySavedCandidateId === undefined ||
      laterSavedCandidateId === undefined
    ) {
      throw new Error("Expected at least two researched top options");
    }
    const [session] = await connection.db
      .select()
      .from(founderLiveSessions)
      .where(eq(founderLiveSessions.id, sessionId));
    if (session === undefined) throw new Error("Expected the live session");
    await saveCandidateListing({
      db: connection.db,
      taskId: session.taskId,
      candidateListingId: alreadySavedCandidateId,
    });

    const locksHeld = deferred();
    const releaseLocks = deferred();
    const blockerConnection = createTestDatabaseConnection(
      "destination-stale-blocker",
    );
    const resolverConnection = createTestDatabaseConnection(
      "destination-stale-resolver",
    );
    const blocker = blockerConnection.db.transaction(async (tx) => {
      await tx
        .select({ id: candidateListings.id })
        .from(candidateListings)
        .where(
          and(
            eq(candidateListings.taskId, session.taskId),
            inArray(candidateListings.id, topCandidateIds),
          ),
        )
        .for("update");
      locksHeld.resolve();
      await releaseLocks.promise;
    });
    await locksHeld.promise;

    const firstResolverCandidateIds: string[] = [];
    const firstResolution = resolveLivePurchaseDestinations({
      dependencies: {
        ...dependencies,
        db: resolverConnection.db,
        destinationResolver: {
          provider: "serper",
          maxRequestDurationMs: 0,
          resolve: async (request) => {
            firstResolverCandidateIds.push(request.candidateListingId);
            return {
              outcome: "resolved" as const,
              destinationUrl: exactMerchantDestination(request),
              acceptedResultTitle: request.title,
              observedResultUrl: null,
              consideredResultCount: 1,
            };
          },
        },
      },
      input: { operation: "resolve_destinations", sessionId },
    });
    try {
      await waitForDatabaseLock({
        observer: connection,
        applicationNames: ["destination-stale-resolver"],
      });
      await refineLiveShopping({
        dependencies,
        input: {
          operation: "refine",
          sessionId,
          turnId: "80000000-0000-4000-8000-000000000008",
          message: "Refresh this into a newer search run",
        },
      });
    } finally {
      releaseLocks.resolve();
      await blocker;
    }
    await firstResolution;
    await Promise.all([blockerConnection.close(), resolverConnection.close()]);

    expect(firstResolverCandidateIds).toEqual([alreadySavedCandidateId]);
    expect(firstResolverCandidateIds).not.toContain(laterSavedCandidateId);
    expect(
      (await connection.db.select().from(merchantDestinationResolutions)).map(
        ({ candidateListingId }) => candidateListingId,
      ),
    ).toEqual([alreadySavedCandidateId]);

    await saveCandidateListing({
      db: connection.db,
      taskId: session.taskId,
      candidateListingId: laterSavedCandidateId,
    });
    const retryResolverCandidateIds: string[] = [];
    await resolveLivePurchaseDestinations({
      dependencies: {
        ...dependencies,
        destinationResolver: {
          provider: "serper",
          maxRequestDurationMs: 0,
          resolve: async (request) => {
            retryResolverCandidateIds.push(request.candidateListingId);
            return {
              outcome: "resolved" as const,
              destinationUrl: exactMerchantDestination(request),
              acceptedResultTitle: request.title,
              observedResultUrl: null,
              consideredResultCount: 1,
            };
          },
        },
      },
      input: { operation: "resolve_destinations", sessionId },
    });

    expect(retryResolverCandidateIds).toEqual([laterSavedCandidateId]);
    expect(
      (await connection.db.select().from(merchantDestinationResolutions)).map(
        ({ candidateListingId, status }) => ({ candidateListingId, status }),
      ),
    ).toEqual(
      expect.arrayContaining([
        { candidateListingId: alreadySavedCandidateId, status: "resolved" },
        { candidateListingId: laterSavedCandidateId, status: "resolved" },
      ]),
    );
  }, 15_000);

  it("rejects an expired lease before provider work and lets one later owner take over", async () => {
    const { listings, run, session } = await startedSession(connection);
    const candidate = listings[0]!;
    const topAuthority = {
      sessionId: session.id,
      contextActionId: run.contextActionId,
      searchRunId: run.id,
      taskRevision: run.taskRevision,
    };
    const claimed = await claimMerchantDestinationResolution({
      db: connection.db,
      taskId: session.taskId,
      candidateListingId: candidate.id,
      provider: "serper",
      leaseDurationMs: 5_000,
      topAuthority,
    });
    if (claimed.state !== "acquired") {
      throw new Error(
        "Expected the first destination owner to acquire a lease",
      );
    }

    await connection.db
      .update(merchantDestinationResolutions)
      .set({
        startedAt: new Date("2000-01-01T00:00:00.000Z"),
        leaseExpiresAt: new Date("2000-01-01T00:00:01.000Z"),
      })
      .where(eq(merchantDestinationResolutions.id, claimed.resolution.id));

    const expiredOwnerProvider = vi.fn();
    await expect(
      (async () => {
        const validated = await validateMerchantDestinationResolutionExecution({
          db: connection.db,
          taskId: session.taskId,
          resolutionId: claimed.resolution.id,
          leaseToken: claimed.resolution.leaseToken,
          topAuthority,
        });
        if (validated.state === "ready") {
          expiredOwnerProvider(validated.request);
        }
      })(),
    ).rejects.toBeInstanceOf(MerchantDestinationResolutionLeaseError);
    expect(expiredOwnerProvider).not.toHaveBeenCalled();

    const takeoverCalls: string[] = [];
    await expect(
      executeOrResumeMerchantDestinationResolution({
        db: connection.db,
        taskId: session.taskId,
        visibleTopCandidateListingIds: [candidate.id],
        visibleTopAuthority: topAuthority,
        resolver: acceptedResolver(takeoverCalls),
      }),
    ).resolves.toMatchObject({
      results: [{ state: "completed", created: false }],
    });
    expect(takeoverCalls).toEqual([candidate.id]);

    const retryProvider = vi.fn(() => {
      throw new Error("A terminal takeover retry must not call the provider");
    });
    await executeOrResumeMerchantDestinationResolution({
      db: connection.db,
      taskId: session.taskId,
      visibleTopCandidateListingIds: [candidate.id],
      visibleTopAuthority: topAuthority,
      resolver: {
        provider: "serper",
        maxRequestDurationMs: 1_000,
        resolve: retryProvider,
      },
    });
    expect(retryProvider).not.toHaveBeenCalled();
    expect(
      await connection.db.select().from(merchantDestinationResolutions),
    ).toEqual([
      expect.objectContaining({
        id: claimed.resolution.id,
        status: "resolved",
      }),
    ]);
  });

  it("fences a concurrent refresh with one active lease and one provider call", async () => {
    const { listings, run, session } = await startedSession(connection);
    const candidate = listings[0]!;
    const providerStarted = deferred();
    const allowProviderToFinish = deferred();
    const calls: string[] = [];
    const first = executeOrResumeMerchantDestinationResolution({
      db: connection.db,
      taskId: session.taskId,
      visibleTopCandidateListingIds: [candidate.id],
      visibleTopAuthority: {
        sessionId: session.id,
        contextActionId: run.contextActionId,
        searchRunId: run.id,
        taskRevision: run.taskRevision,
      },
      resolver: acceptedResolver(calls, async () => {
        providerStarted.resolve();
        await allowProviderToFinish.promise;
      }),
    });
    await providerStarted.promise;

    const refresh = await executeOrResumeMerchantDestinationResolution({
      db: connection.db,
      taskId: session.taskId,
      visibleTopCandidateListingIds: [candidate.id],
      visibleTopAuthority: {
        sessionId: session.id,
        contextActionId: run.contextActionId,
        searchRunId: run.id,
        taskRevision: run.taskRevision,
      },
      resolver: acceptedResolver(calls),
    });

    expect(refresh.results[0]).toMatchObject({ state: "in_progress" });
    expect(calls).toEqual([candidate.id]);
    allowProviderToFinish.resolve();
    await expect(first).resolves.toMatchObject({
      results: [{ state: "completed", created: true }],
    });
    expect(
      await connection.db.select().from(merchantDestinationResolutions),
    ).toHaveLength(1);
  });
});
