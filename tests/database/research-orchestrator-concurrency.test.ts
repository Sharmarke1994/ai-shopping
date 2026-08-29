import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ContextAcquisitionModel } from "../../src/features/context-acquisition/model-port";
import type {
  ContextActionProviderWireV1,
  InterpretationProviderWireV1,
} from "../../src/features/context-acquisition/provider-wire";
import {
  startLiveShopping,
  type LiveShoppingDependencies,
} from "../../src/features/live-shopping/application";
import {
  FakeEvidencePageFetcher,
  FakeProductUnderstandingModel,
} from "../../src/features/product-understanding/fakes";
import {
  evidenceSearchResponseSchema,
  type EvidenceSearchProvider,
} from "../../src/features/product-understanding/evidence-search";
import type {
  ProductUnderstandingCallPolicy,
  ProductUnderstandingModel,
  ProductUnderstandingModelResult,
} from "../../src/features/product-understanding/model-port";
import { PageFetchError } from "../../src/features/product-understanding/page-fetch";
import {
  loadEvidenceResearchRun,
  prepareEvidenceResearch,
} from "../../src/features/product-understanding/persistence";
import {
  EVIDENCE_SEARCH_CONCURRENCY,
  executeOrResumeEvidenceResearch,
  PAGE_FETCH_CONCURRENCY,
  PRODUCT_UNDERSTANDING_CONCURRENCY,
  type EvidencePageFetcher,
  type EvidenceResearchDependencies,
} from "../../src/features/product-understanding/research-orchestrator";
import {
  candidateListingSchema,
  providerSearchResultSchema,
  type SearchQuery,
  type ShoppingSearchProvider,
} from "../../src/features/retrieval-spike/contracts";
import { loadPersistedSearchRun } from "../../src/features/retrieval-spike/persistence/search-runs";
import {
  evidenceResearchRuns,
  founderLiveSessions,
  searchRuns,
} from "../../src/infrastructure/database/schema";
import {
  createTestDatabaseConnection,
  resetShoppingState,
  type TestDatabaseConnection,
} from "./helpers";

const acquisitionMetadata = {
  provider: "fixture",
  model: "fixture-context",
  promptVersion: "fixture-context-v1",
  providerSchemaVersion: 1,
  providerRequestId: "fixture-context",
  durationMs: 0,
  inputTokens: null,
  outputTokens: null,
} as const;

const interpretation: InterpretationProviderWireV1 = {
  providerSchemaVersion: 1,
  outcome: "change",
  operations: [
    {
      op: "create_concept",
      localRef: "breathability",
      label: "Breathability",
      definition: "Airflow in hot weather",
      valueFamily: "qualitative",
      canonicalUnit: null,
    },
    {
      op: "add_criterion",
      concept: { kind: "created", localRef: "breathability" },
      target: {
        strength: "strong_preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative_text",
          text: "breathable in hot weather",
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
  rationale: { summary: "The brief is ready." },
};

function contextModel(): ContextAcquisitionModel {
  return {
    interpret: vi.fn(() =>
      Promise.resolve({
        status: "completed" as const,
        value: interpretation,
        metadata: acquisitionMetadata,
      }),
    ),
    selectAction: vi.fn(() =>
      Promise.resolve({
        status: "completed" as const,
        value: search,
        metadata: acquisitionMetadata,
      }),
    ),
  };
}

class FourCandidateShoppingProvider implements ShoppingSearchProvider {
  readonly provider = "fixture" as const;
  readonly maxRequestDurationMs = 0;
  readonly calls: SearchQuery[] = [];

  async search(query: SearchQuery) {
    this.calls.push(query);
    const callOrdinal = this.calls.length;
    return providerSearchResultSchema.parse({
      listings: [1, 2].map((resultOrdinal) => {
        const productOrdinal = (callOrdinal - 1) * 2 + resultOrdinal;
        const slug = `nimbus-aero-${productOrdinal}`;
        return candidateListingSchema.parse({
          taskId: query.taskId,
          runId: query.runId,
          queryId: query.id,
          provider: "fixture",
          providerResultId: `fixture:${query.id}:${resultOrdinal}`,
          sourceRank: resultOrdinal,
          surface: "shopping",
          title: `Nimbus Aero ${productOrdinal} Running Cap`,
          url: `https://shopping.example.test/products/${slug}`,
          canonicalUrl: `https://shopping.example.test/products/${slug}`,
          merchantDestinationUrl: `https://shopping.example.test/products/${slug}`,
          merchantDestinationSource: "shopping_result",
          merchant: "Fixture Outfitters",
          price: { amountMinor: 2000 + productOrdinal, currency: "GBP" },
          priceText: `£${20 + productOrdinal}.00`,
          imageUrl: null,
          deliveryText: null,
          availabilityText: "In stock",
          reviewEvidence: null,
          retrievedAt: new Date(Date.UTC(2026, 7, 29, 10, 0, productOrdinal)),
        });
      }),
      diagnostics: { receivedResultCount: 2, rejectedResultCount: 0 },
    });
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function slug(value: string) {
  return value.toLocaleLowerCase("en-GB").replace(/[^a-z0-9]+/g, "-");
}

function evidenceResponse(
  input: Parameters<EvidenceSearchProvider["search"]>[0],
  ordinal: number,
) {
  return evidenceSearchResponseSchema.parse({
    providerRequestId: `fixture-evidence-${ordinal}`,
    receivedResultCount: 1,
    results: [
      {
        providerResultId: `fixture-evidence-result-${ordinal}`,
        rank: 1,
        title: `${input.candidateTitle} official product details`,
        url: `https://evidence.example.test/products/${slug(input.candidateTitle)}`,
        snippet:
          "The manufacturer describes lightweight construction with ventilation for warm-weather running.",
        sourceRole: "manufacturer",
      },
    ],
  });
}

class ControlledEvidenceProvider implements EvidenceSearchProvider {
  readonly provider = "fixture" as const;
  readonly calls: Parameters<EvidenceSearchProvider["search"]>[0][] = [];
  readonly gates: ReturnType<typeof deferred>[];
  active = 0;
  maximumActive = 0;

  constructor(count: number) {
    this.gates = Array.from({ length: count }, deferred);
  }

  async search(input: Parameters<EvidenceSearchProvider["search"]>[0]) {
    const ordinal = this.calls.length;
    this.calls.push(input);
    this.active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    try {
      const gate = this.gates[ordinal];
      if (gate === undefined) throw new Error("Unexpected evidence call");
      await gate.promise;
      return evidenceResponse(input, ordinal + 1);
    } finally {
      this.active -= 1;
    }
  }

  releaseAll() {
    for (const gate of this.gates) gate.resolve();
  }
}

class ControlledPageFetcher implements EvidencePageFetcher {
  readonly provider = "fixture" as const;
  readonly calls: Parameters<EvidencePageFetcher["fetch"]>[0][] = [];
  readonly gates: ReturnType<typeof deferred>[];
  readonly base = new FakeEvidencePageFetcher();
  active = 0;
  maximumActive = 0;

  constructor(
    count: number,
    readonly behavior: "success" | "fail_first" | "invalid_hash" = "success",
  ) {
    this.gates = Array.from({ length: count }, deferred);
  }

  async fetch(input: Parameters<EvidencePageFetcher["fetch"]>[0]) {
    const ordinal = this.calls.length;
    this.calls.push(input);
    this.active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    try {
      const gate = this.gates[ordinal];
      if (gate === undefined) throw new Error("Unexpected page call");
      await gate.promise;
      if (this.behavior === "fail_first" && ordinal === 0) {
        throw new PageFetchError("timeout", "Deferred fixture page timed out");
      }
      const fetched = await this.base.fetch(input);
      return this.behavior === "invalid_hash"
        ? { ...fetched, responseHash: "not-a-sha256" }
        : fetched;
    } finally {
      this.active -= 1;
    }
  }

  releaseAll() {
    for (const gate of this.gates) gate.resolve();
  }
}

class ControlledUnderstandingModel implements ProductUnderstandingModel {
  readonly calls: Array<{
    input: Parameters<ProductUnderstandingModel["understand"]>[0];
    policy: ProductUnderstandingCallPolicy;
  }> = [];
  readonly gates: ReturnType<typeof deferred>[];
  readonly base = new FakeProductUnderstandingModel();
  active = 0;
  maximumActive = 0;

  constructor(
    count: number,
    readonly invalidProviderRequestId = false,
  ) {
    this.gates = Array.from({ length: count }, deferred);
  }

  async understand(
    input: Parameters<ProductUnderstandingModel["understand"]>[0],
    policy: ProductUnderstandingCallPolicy,
  ): Promise<ProductUnderstandingModelResult> {
    const ordinal = this.calls.length;
    this.calls.push({ input, policy });
    this.active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    try {
      const gate = this.gates[ordinal];
      if (gate === undefined) throw new Error("Unexpected model call");
      await gate.promise;
      const result = await this.base.understand(input);
      return this.invalidProviderRequestId
        ? {
            ...result,
            metadata: {
              ...result.metadata,
              providerRequestId: "x".repeat(241),
            },
          }
        : result;
    } finally {
      this.active -= 1;
    }
  }

  releaseAll() {
    for (const gate of this.gates) gate.resolve();
  }
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  description: string,
) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

describe("V0-09 staged evidence research concurrency", () => {
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

  async function seedSearch() {
    const shoppingProvider = new FourCandidateShoppingProvider();
    const dependencies = {
      db: connection.db,
      model: contextModel(),
      provider: shoppingProvider,
    } satisfies LiveShoppingDependencies;
    const sessionId = randomUUID();
    await startLiveShopping({
      dependencies,
      input: {
        operation: "start",
        sessionId,
        turnId: randomUUID(),
        message: "A light running cap for hot weather",
      },
    });
    const [session] = await connection.db
      .select()
      .from(founderLiveSessions)
      .where(eq(founderLiveSessions.id, sessionId));
    if (session === undefined) throw new Error("Expected founder session");
    const [run] = await connection.db
      .select()
      .from(searchRuns)
      .where(eq(searchRuns.taskId, session.taskId));
    if (run === undefined) throw new Error("Expected completed search run");
    const persistedRun = await loadPersistedSearchRun({
      db: connection.db,
      taskId: session.taskId,
      runId: run.id,
    });
    if (persistedRun === null) throw new Error("Expected persisted search run");
    expect(persistedRun.listings).toHaveLength(4);
    return { session, run: persistedRun };
  }

  async function prepare(
    seeded: Awaited<ReturnType<typeof seedSearch>>,
    modelName = "controlled-understanding",
  ) {
    const snapshot = await prepareEvidenceResearch({
      db: connection.db,
      taskId: seeded.session.taskId,
      searchRunId: seeded.run.portfolio.run.id,
      evidenceProvider: "fixture",
      modelProvider: "fixture",
      model: modelName,
      promptVersion: "product-understanding-v1",
    });
    expect(snapshot.run.selectedCandidateCount).toBe(4);
    expect(
      snapshot.attempts.filter(({ stage }) => stage === "organic_search"),
    ).toHaveLength(4);
    return snapshot;
  }

  function dependencies(options: {
    evidenceProvider: EvidenceSearchProvider;
    pageFetcher?: EvidencePageFetcher;
    model: ProductUnderstandingModel;
    modelName?: string;
  }): EvidenceResearchDependencies {
    return {
      db: connection.db,
      evidenceProvider: options.evidenceProvider,
      ...(options.pageFetcher === undefined
        ? {}
        : { pageFetcher: options.pageFetcher }),
      model: options.model,
      modelIdentity: {
        provider: "fixture",
        model: options.modelName ?? "controlled-understanding",
        promptVersion: "product-understanding-v1",
      },
    };
  }

  it("continues each candidate independently across durable capped stages", async () => {
    const seeded = await seedSearch();
    const prepared = await prepare(seeded);
    const evidenceProvider = new ControlledEvidenceProvider(4);
    const pageFetcher = new ControlledPageFetcher(4);
    const model = new ControlledUnderstandingModel(4);
    let orchestrationSettled = false;
    const orchestration = executeOrResumeEvidenceResearch({
      dependencies: dependencies({ evidenceProvider, pageFetcher, model }),
      taskId: seeded.session.taskId,
      searchRunId: seeded.run.portfolio.run.id,
    }).finally(() => {
      orchestrationSettled = true;
    });

    try {
      await waitFor(
        () => evidenceProvider.calls.length === EVIDENCE_SEARCH_CONCURRENCY,
        "three active organic searches",
      );
      expect(evidenceProvider.maximumActive).toBe(EVIDENCE_SEARCH_CONCURRENCY);
      expect(pageFetcher.calls).toHaveLength(0);
      expect(model.calls).toHaveLength(0);

      evidenceProvider.gates[0]?.resolve();
      await waitFor(
        () => evidenceProvider.calls.length === 4,
        "the queued fourth organic search",
      );
      await waitFor(
        () => pageFetcher.calls.length === 1,
        "the first candidate page fetch before other organic searches finish",
      );
      const firstPageCall = pageFetcher.calls[0];
      if (firstPageCall === undefined) {
        throw new Error("Expected the first candidate page fetch");
      }
      const firstCandidate = seeded.run.listings.find(
        ({ title }) => title === firstPageCall.candidateTitle,
      );
      if (firstCandidate === undefined) {
        throw new Error("Expected the first candidate listing");
      }
      const afterFirstPageStarted = await loadEvidenceResearchRun({
        db: connection.db,
        taskId: seeded.session.taskId,
        researchRunId: prepared.run.id,
      });
      expect(
        afterFirstPageStarted?.attempts.find(
          ({ candidateListingId, stage }) =>
            candidateListingId === firstCandidate.id &&
            stage === "organic_search",
        )?.status,
      ).toBe("succeeded");
      expect(
        afterFirstPageStarted?.attempts.filter(
          ({ stage, status }) =>
            stage === "organic_search" && status === "planned",
        ),
      ).toHaveLength(3);
      expect(evidenceProvider.maximumActive).toBe(EVIDENCE_SEARCH_CONCURRENCY);
      expect(model.calls).toHaveLength(0);

      evidenceProvider.gates[1]?.resolve();
      await waitFor(
        () => pageFetcher.calls.length === PAGE_FETCH_CONCURRENCY,
        "two active page fetches",
      );
      const blockedPageCall = pageFetcher.calls[1];
      if (blockedPageCall === undefined) {
        throw new Error("Expected the second blocked candidate page fetch");
      }
      const blockedCandidate = seeded.run.listings.find(
        ({ title }) => title === blockedPageCall.candidateTitle,
      );
      if (blockedCandidate === undefined) {
        throw new Error("Expected the blocked candidate listing");
      }
      expect(pageFetcher.maximumActive).toBe(PAGE_FETCH_CONCURRENCY);
      expect(model.calls).toHaveLength(0);

      evidenceProvider.gates[2]?.resolve();
      evidenceProvider.gates[3]?.resolve();
      pageFetcher.gates[0]?.resolve();
      await waitFor(
        () => pageFetcher.calls.length === 3,
        "a queued page fetch after one page permit is released",
      );
      await waitFor(
        () => model.calls.length === 1,
        "the first candidate model while another candidate page stays blocked",
      );
      expect(pageFetcher.maximumActive).toBe(PAGE_FETCH_CONCURRENCY);
      const firstModelCall = model.calls[0];
      if (firstModelCall === undefined) {
        throw new Error("Expected the first candidate model call");
      }
      expect(firstModelCall.input.candidate.title).toBe(
        firstPageCall.candidateTitle,
      );
      expect(
        firstModelCall.input.sources.find(({ kind }) => kind === "fetched_page")
          ?.url,
      ).toBe(firstPageCall.url);

      model.gates[0]?.resolve();
      await waitFor(async () => {
        const snapshot = await loadEvidenceResearchRun({
          db: connection.db,
          taskId: seeded.session.taskId,
          researchRunId: prepared.run.id,
        });
        return (
          snapshot?.attempts
            .filter(
              ({ candidateListingId, stage }) =>
                candidateListingId === firstCandidate.id &&
                (stage === "observation_extraction" ||
                  stage === "criterion_assessment"),
            )
            .every(({ status }) => status === "succeeded") === true &&
          snapshot.assessments.some(
            ({ candidateListingId }) =>
              candidateListingId === firstCandidate.id,
          )
        );
      }, "the first candidate assessment to become durably visible");
      const partial = await loadEvidenceResearchRun({
        db: connection.db,
        taskId: seeded.session.taskId,
        researchRunId: prepared.run.id,
      });
      expect(partial?.run.status).toBe("running");
      expect(
        partial?.attempts
          .filter(
            ({ candidateListingId, stage }) =>
              candidateListingId === firstCandidate.id &&
              (stage === "observation_extraction" ||
                stage === "criterion_assessment"),
          )
          .map(({ status }) => status),
      ).toEqual(["succeeded", "succeeded"]);
      expect(
        partial?.attempts.some(
          ({ candidateListingId, stage, status }) =>
            candidateListingId === blockedCandidate.id &&
            stage === "page_fetch" &&
            status === "planned",
        ),
      ).toBe(true);
      expect(orchestrationSettled).toBe(false);

      pageFetcher.gates[1]?.resolve();
      pageFetcher.gates[2]?.resolve();
      await waitFor(
        () => pageFetcher.calls.length === 4,
        "the fourth page fetch",
      );
      await waitFor(
        () => model.calls.length === 3,
        "two additional active model calls",
      );
      expect(model.maximumActive).toBe(PRODUCT_UNDERSTANDING_CONCURRENCY);
      pageFetcher.gates[3]?.resolve();
      await waitFor(async () => {
        const snapshot = await loadEvidenceResearchRun({
          db: connection.db,
          taskId: seeded.session.taskId,
          researchRunId: prepared.run.id,
        });
        return (
          snapshot?.attempts.filter(
            ({ stage, status }) =>
              stage === "page_fetch" && status === "succeeded",
          ).length === 4
        );
      }, "the fourth durable page receipt");
      expect(model.calls).toHaveLength(3);

      model.gates[1]?.resolve();
      await waitFor(() => model.calls.length === 4, "the fourth model call");
      expect(model.maximumActive).toBe(PRODUCT_UNDERSTANDING_CONCURRENCY);
      model.releaseAll();
      const completed = await orchestration;
      for (const { input } of model.calls) {
        const fetched = input.sources.find(
          ({ kind }) => kind === "fetched_page",
        );
        expect(fetched).toBeDefined();
        expect(
          pageFetcher.calls.some(
            (call) =>
              call.candidateTitle === input.candidate.title &&
              call.url === fetched?.url,
          ),
        ).toBe(true);
      }
      expect(completed.run.status).toBe("succeeded");
      expect(
        completed.attempts.every(({ status }) => status === "succeeded"),
      ).toBe(true);
    } finally {
      evidenceProvider.releaseAll();
      pageFetcher.releaseAll();
      model.releaseAll();
    }
  });

  it("keeps one page failure terminal and lets that candidate model proceed from remaining attributable sources", async () => {
    const seeded = await seedSearch();
    await prepare(seeded);
    const evidenceProvider = new ControlledEvidenceProvider(4);
    evidenceProvider.releaseAll();
    const pageFetcher = new ControlledPageFetcher(4, "fail_first");
    pageFetcher.releaseAll();
    const model = new ControlledUnderstandingModel(4);
    model.releaseAll();

    const completed = await executeOrResumeEvidenceResearch({
      dependencies: dependencies({ evidenceProvider, pageFetcher, model }),
      taskId: seeded.session.taskId,
      searchRunId: seeded.run.portfolio.run.id,
    });
    const failedPages = completed.attempts.filter(
      ({ stage, status }) => stage === "page_fetch" && status === "failed",
    );
    expect(failedPages).toEqual([
      expect.objectContaining({ failureCode: "timeout" }),
    ]);
    expect(
      completed.attempts.filter(
        ({ stage, status }) => stage === "page_fetch" && status === "succeeded",
      ),
    ).toHaveLength(3);
    const failedCandidateTitle = pageFetcher.calls[0]?.candidateTitle;
    if (failedCandidateTitle === undefined) {
      throw new Error("Expected the failed page candidate");
    }
    const failedCandidateModelInput = model.calls.find(
      ({ input }) => input.candidate.title === failedCandidateTitle,
    )?.input;
    expect(failedCandidateModelInput).toBeDefined();
    expect(
      failedCandidateModelInput?.sources.some(
        ({ kind }) => kind === "fetched_page",
      ),
    ).toBe(false);
    expect(
      failedCandidateModelInput?.sources.some(
        ({ kind }) => kind === "organic_result",
      ),
    ).toBe(true);
    const failedCandidate = seeded.run.listings.find(
      ({ title }) => title === failedCandidateTitle,
    );
    if (failedCandidate === undefined) {
      throw new Error("Expected failed page candidate listing");
    }
    expect(
      completed.attempts
        .filter(
          ({ candidateListingId, stage }) =>
            candidateListingId === failedCandidate.id &&
            (stage === "observation_extraction" ||
              stage === "criterion_assessment"),
        )
        .map(({ status }) => status),
    ).toEqual(["succeeded", "succeeded"]);
    expect(completed.run.status).toBe("partial");
  });

  it.each(["page", "model"] as const)(
    "retains the research lease after a %s call whose terminal persistence fails",
    async (failureStage) => {
      const seeded = await seedSearch();
      const prepared = await prepare(seeded);
      const evidenceProvider = new ControlledEvidenceProvider(4);
      evidenceProvider.releaseAll();
      const pageFetcher = new ControlledPageFetcher(4, "invalid_hash");
      pageFetcher.releaseAll();
      const model = new ControlledUnderstandingModel(
        4,
        failureStage === "model",
      );
      model.releaseAll();
      const selectedDependencies = dependencies({
        evidenceProvider,
        ...(failureStage === "page" ? { pageFetcher } : {}),
        model,
      });

      await expect(
        executeOrResumeEvidenceResearch({
          dependencies: selectedDependencies,
          taskId: seeded.session.taskId,
          searchRunId: seeded.run.portfolio.run.id,
        }),
      ).rejects.toThrow();
      const [runRow] = await connection.db
        .select({
          status: evidenceResearchRuns.status,
          leaseToken: evidenceResearchRuns.leaseToken,
          leaseExpiresAt: evidenceResearchRuns.leaseExpiresAt,
        })
        .from(evidenceResearchRuns)
        .where(eq(evidenceResearchRuns.id, prepared.run.id));
      expect(runRow).toMatchObject({ status: "running" });
      expect(runRow?.leaseToken).not.toBeNull();
      expect(runRow?.leaseExpiresAt).not.toBeNull();

      const callsBeforeRetry = {
        evidence: evidenceProvider.calls.length,
        page: pageFetcher.calls.length,
        model: model.calls.length,
      };
      const retry = await executeOrResumeEvidenceResearch({
        dependencies: selectedDependencies,
        taskId: seeded.session.taskId,
        searchRunId: seeded.run.portfolio.run.id,
      });
      expect(retry.run.status).toBe("running");
      expect(evidenceProvider.calls).toHaveLength(callsBeforeRetry.evidence);
      expect(pageFetcher.calls).toHaveLength(callsBeforeRetry.page);
      expect(model.calls).toHaveLength(callsBeforeRetry.model);
    },
  );
});
