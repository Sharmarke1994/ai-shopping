import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PersistedDataCorruptionError } from "../../src/domain/shopping-state/errors";
import type { ContextAcquisitionModel } from "../../src/features/context-acquisition/model-port";
import type {
  ContextActionProviderWireV1,
  InterpretationProviderWireV1,
} from "../../src/features/context-acquisition/provider-wire";
import {
  startLiveShopping,
  type LiveShoppingDependencies,
} from "../../src/features/live-shopping/application";
import { MAX_PAGE_TRANSPORT_BYTES } from "../../src/features/product-understanding/page-budgets";
import { admitFetchedPageEvidence } from "../../src/features/product-understanding/page-evidence-admission";
import { extractProductPageDocument } from "../../src/features/product-understanding/page-extraction";
import {
  claimEvidenceResearch,
  EvidenceAttemptConflictError,
  EvidenceResearchAuthorityError,
  EvidenceResearchLeaseError,
  loadCurrentDecisionSupport,
  loadEvidenceResearchRun,
  loadFetchedEvidenceDocuments,
  planEvidencePageFetches,
  prepareEvidenceResearch,
  recordCandidateUnderstanding,
  recordEvidencePageFetchFailure,
  recordEvidenceSearchSuccess,
  recordFetchedPageSuccess,
} from "../../src/features/product-understanding/persistence";
import { evidenceSearchResponseSchema } from "../../src/features/product-understanding/evidence-search";
import { FakeShoppingProvider } from "../../src/features/retrieval-spike/fake-shopping-provider";
import { loadPersistedSearchRun } from "../../src/features/retrieval-spike/persistence/search-runs";
import {
  evidenceAcquisitionAttempts,
  evidencePageFetchTargets,
  evidenceSources,
  fetchedEvidenceDocuments,
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
      localRef: "comfort",
      label: "Comfort",
      definition: "Comfort during long use",
      valueFamily: "qualitative",
      canonicalUnit: null,
    },
    {
      op: "add_criterion",
      concept: { kind: "created", localRef: "comfort" },
      target: {
        strength: "strong_preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative_text",
          text: "comfortable during long use",
        },
      },
    },
  ],
  ambiguities: [],
};

const searchAction: ContextActionProviderWireV1 = {
  providerSchemaVersion: 1,
  action: "search",
  question: null,
  rationale: { summary: "The exact product brief is ready." },
};

function contextModel(): ContextAcquisitionModel {
  return contextModelFor(interpretation);
}

function contextModelFor(
  value: InterpretationProviderWireV1,
): ContextAcquisitionModel {
  return {
    interpret: vi.fn(() =>
      Promise.resolve({
        status: "completed" as const,
        value,
        metadata: acquisitionMetadata,
      }),
    ),
    selectAction: vi.fn(() =>
      Promise.resolve({
        status: "completed" as const,
        value: searchAction,
        metadata: acquisitionMetadata,
      }),
    ),
  };
}

const sixCriterionInterpretation: InterpretationProviderWireV1 = {
  providerSchemaVersion: 1,
  outcome: "change",
  operations: ["a", "b", "c", "d", "e", "f"].flatMap((letter) => [
    {
      op: "create_concept" as const,
      localRef: `concept_${letter}`,
      label: `Criterion ${letter}`,
      definition: `A fixture definition for criterion ${letter}`,
      valueFamily: "qualitative" as const,
      canonicalUnit: null,
    },
    {
      op: "add_criterion" as const,
      concept: { kind: "created" as const, localRef: `concept_${letter}` },
      target: {
        strength: "preference" as const,
        targetSemantics: "qualitative" as const,
        semanticValue: {
          schemaVersion: 1 as const,
          kind: "qualitative_text" as const,
          text: `Preference ${letter}`,
        },
      },
    },
  ]),
  ambiguities: [],
};

describe("bounded fetched-page persistence", () => {
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

  async function seedPlannedPage() {
    const dependencies = {
      db: connection.db,
      model: contextModel(),
      provider: new FakeShoppingProvider(
        () => new Date("2026-08-29T09:00:00.000Z"),
      ),
    } satisfies LiveShoppingDependencies;
    const sessionId = randomUUID();
    await startLiveShopping({
      dependencies,
      input: {
        operation: "start",
        sessionId,
        turnId: randomUUID(),
        message: "Nimbus Aero Pro wireless mouse with comfortable long use",
      },
    });
    const [session] = await connection.db
      .select()
      .from(founderLiveSessions)
      .where(eq(founderLiveSessions.id, sessionId));
    if (session === undefined) throw new Error("Expected shopping session");
    const [run] = await connection.db
      .select()
      .from(searchRuns)
      .where(eq(searchRuns.taskId, session.taskId));
    if (run === undefined) throw new Error("Expected shopping search run");
    const prepared = await prepareEvidenceResearch({
      db: connection.db,
      taskId: session.taskId,
      searchRunId: run.id,
      evidenceProvider: "fixture",
      modelProvider: "fixture",
      model: "fixture-product-understanding",
      promptVersion: "product-understanding-v1",
    });
    const organicAttempt = prepared.attempts.find(
      ({ stage }) => stage === "organic_search",
    );
    if (organicAttempt === undefined) {
      throw new Error("Expected organic evidence attempt");
    }
    const searchSnapshot = await loadPersistedSearchRun({
      db: connection.db,
      taskId: session.taskId,
      runId: run.id,
    });
    const listing = searchSnapshot?.listings.find(
      ({ id }) => id === organicAttempt.candidateListingId,
    );
    if (listing === undefined) throw new Error("Expected research listing");
    const leaseToken = await claimEvidenceResearch({
      db: connection.db,
      taskId: session.taskId,
      researchRunId: prepared.run.id,
    });
    if (leaseToken === null) throw new Error("Expected research lease");
    const discoveredUrl = "https://reviews.example.test/nimbus-aero-pro";
    await recordEvidenceSearchSuccess({
      db: connection.db,
      taskId: session.taskId,
      researchRunId: prepared.run.id,
      attemptId: organicAttempt.id,
      leaseToken,
      response: evidenceSearchResponseSchema.parse({
        providerRequestId: "fixture-page-discovery",
        receivedResultCount: 1,
        results: [
          {
            providerResultId: "fixture-review-page",
            rank: 1,
            title: listing.title,
            url: discoveredUrl,
            snippet: "An exact independent review of the named product.",
            sourceRole: "independent_review",
          },
        ],
      }),
      startedAt: new Date("2026-08-29T09:00:01.000Z"),
      finishedAt: new Date("2026-08-29T09:00:02.000Z"),
    });
    const plans = await planEvidencePageFetches({
      db: connection.db,
      taskId: session.taskId,
      researchRunId: prepared.run.id,
      candidateListingId: listing.id,
      leaseToken,
      provider: "fixture",
    });
    const plan = plans[0];
    if (plan === undefined) throw new Error("Expected fetched-page plan");
    const extractionAttempt = prepared.attempts.find(
      (attempt) =>
        attempt.candidateListingId === listing.id &&
        attempt.stage === "observation_extraction",
    );
    const assessmentAttempt = prepared.attempts.find(
      (attempt) =>
        attempt.candidateListingId === listing.id &&
        attempt.stage === "criterion_assessment",
    );
    if (extractionAttempt === undefined || assessmentAttempt === undefined) {
      throw new Error("Expected candidate model attempts");
    }
    return {
      session,
      run,
      prepared,
      listing,
      leaseToken,
      plans,
      plan,
      extractionAttempt,
      assessmentAttempt,
    };
  }

  function successfulPage(seeded: Awaited<ReturnType<typeof seedPlannedPage>>) {
    const html = `<!doctype html><html><head><title>${seeded.listing.title}</title><meta property="og:title" content="${seeded.listing.title}"><link rel="canonical" href="${seeded.plan.requestedUrl}"></head><body><h1>${seeded.listing.title}</h1><p>The comfort remains supportive during long use.</p><script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name: seeded.listing.title, brand: { "@type": "Brand", name: "Nimbus" }, model: "Aero Pro" })}</script></body></html>`;
    const document = extractProductPageDocument({
      html,
      sourceUrl: seeded.plan.requestedUrl,
    });
    const fetch = {
      requestedUrl: seeded.plan.requestedUrl,
      finalUrl: seeded.plan.requestedUrl,
      contentType: "text/html" as const,
      encodedBytes: Buffer.byteLength(html, "utf8"),
      decodedBytes: Buffer.byteLength(html, "utf8"),
      fetchedAt: new Date("2026-08-29T09:00:03.000Z"),
      responseHash: createHash("sha256").update(html).digest("hex"),
    };
    const admission = admitFetchedPageEvidence({
      candidateTitle: seeded.listing.title,
      merchant: seeded.listing.merchant,
      discovered: {
        sourceRole: seeded.plan.discoveredSource.sourceRole,
        url: seeded.plan.discoveredSource.sourceUrl,
        title: seeded.plan.discoveredSource.sourceTitle,
      },
      page: {
        finalUrl: fetch.finalUrl,
        canonicalUrl: document.canonicalUrlCandidate,
        title: document.title,
        openGraphTitle: document.metadata.openGraphTitle,
        products: document.jsonLdProducts.map((product) => ({
          productName: product.name,
          brand: product.brand,
          model: product.model,
          sku: product.sku,
          mpn: product.mpn,
        })),
      },
    });
    if (admission.decision !== "admit") {
      throw new Error(`Expected admission, received ${admission.reason}`);
    }
    return { html, document, fetch, admission };
  }

  async function persistSuccessfulPage(
    seeded: Awaited<ReturnType<typeof seedPlannedPage>>,
  ) {
    const page = successfulPage(seeded);
    const stored = await recordFetchedPageSuccess({
      db: connection.db,
      taskId: seeded.session.taskId,
      researchRunId: seeded.prepared.run.id,
      attemptId: seeded.plan.attempt.id,
      leaseToken: seeded.leaseToken,
      fetch: page.fetch,
      document: page.document,
      admission: page.admission,
      startedAt: new Date("2026-08-29T09:00:02.100Z"),
      finishedAt: new Date("2026-08-29T09:00:03.100Z"),
    });
    return { page, stored };
  }

  it("plans at most two server-owned exact sources and replays the same plan", async () => {
    const seeded = await seedPlannedPage();
    expect(seeded.plans).toHaveLength(1);
    expect(seeded.plans.length).toBeLessThanOrEqual(2);
    expect(seeded.plan.attempt).toMatchObject({
      stage: "page_fetch",
      purpose: "source_depth",
      provider: "fixture",
      status: "planned",
    });
    expect(seeded.plan.attempt.targetCriterionIds).toEqual(
      seeded.extractionAttempt.targetCriterionIds,
    );
    const exactRetry = await planEvidencePageFetches({
      db: connection.db,
      taskId: seeded.session.taskId,
      researchRunId: seeded.prepared.run.id,
      candidateListingId: seeded.listing.id,
      leaseToken: seeded.leaseToken,
      provider: "fixture",
    });
    expect(exactRetry).toEqual(seeded.plans);
    await expect(
      planEvidencePageFetches({
        db: connection.db,
        taskId: seeded.session.taskId,
        researchRunId: seeded.prepared.run.id,
        candidateListingId: seeded.listing.id,
        leaseToken: randomUUID(),
        provider: "fixture",
      }),
    ).rejects.toBeInstanceOf(EvidenceResearchLeaseError);

    const [attemptRows, targetRows] = await Promise.all([
      connection.db
        .select()
        .from(evidenceAcquisitionAttempts)
        .where(
          and(
            eq(
              evidenceAcquisitionAttempts.researchRunId,
              seeded.prepared.run.id,
            ),
            eq(evidenceAcquisitionAttempts.stage, "page_fetch"),
          ),
        ),
      connection.db
        .select()
        .from(evidencePageFetchTargets)
        .where(
          eq(evidencePageFetchTargets.researchRunId, seeded.prepared.run.id),
        ),
    ]);
    expect(attemptRows).toHaveLength(1);
    expect(targetRows).toEqual([
      expect.objectContaining({
        attemptId: seeded.plan.attempt.id,
        discoveredSourceId: seeded.plan.discoveredSource.id,
        requestedUrl: seeded.plan.requestedUrl,
      }),
    ]);
  });

  it("allows first-pass prioritized organic targets while keeping page targets scoped", async () => {
    const dependencies = {
      db: connection.db,
      model: contextModelFor(sixCriterionInterpretation),
      provider: new FakeShoppingProvider(
        () => new Date("2026-08-29T09:00:00.000Z"),
      ),
    } satisfies LiveShoppingDependencies;
    const sessionId = randomUUID();
    await startLiveShopping({
      dependencies,
      input: {
        operation: "start",
        sessionId,
        turnId: randomUUID(),
        message: "A product with six independent fixture criteria",
      },
    });
    const [session] = await connection.db
      .select()
      .from(founderLiveSessions)
      .where(eq(founderLiveSessions.id, sessionId));
    if (session === undefined) throw new Error("Expected shopping session");
    const [run] = await connection.db
      .select()
      .from(searchRuns)
      .where(eq(searchRuns.taskId, session.taskId));
    if (run === undefined) throw new Error("Expected shopping search run");
    const prepared = await prepareEvidenceResearch({
      db: connection.db,
      taskId: session.taskId,
      searchRunId: run.id,
      evidenceProvider: "fixture",
      modelProvider: "fixture",
      model: "fixture-product-understanding",
      promptVersion: "product-understanding-v1",
      mode: "first_pass",
    });
    const organicAttempt = prepared.attempts.find(
      ({ stage }) => stage === "organic_search",
    );
    if (organicAttempt === undefined) {
      throw new Error("Expected first-pass candidate attempts");
    }
    const extractionAttempts = prepared.attempts.filter(
      ({ stage, candidateListingId }) =>
        stage === "observation_extraction" &&
        candidateListingId === organicAttempt.candidateListingId,
    );
    const assessmentAttempts = prepared.attempts.filter(
      ({ stage, candidateListingId }) =>
        stage === "criterion_assessment" &&
        candidateListingId === organicAttempt.candidateListingId,
    );
    const extractionCriterionIds = extractionAttempts.flatMap(
      ({ targetCriterionIds }) => targetCriterionIds,
    );
    const assessmentCriterionIds = assessmentAttempts.flatMap(
      ({ targetCriterionIds }) => targetCriterionIds,
    );
    expect(extractionAttempts).toHaveLength(3);
    expect(assessmentAttempts).toHaveLength(3);
    expect(new Set(extractionCriterionIds).size).toBe(6);
    expect(new Set(assessmentCriterionIds)).toEqual(
      new Set(extractionCriterionIds),
    );
    expect(organicAttempt.targetCriterionIds).toHaveLength(5);
    const searchSnapshot = await loadPersistedSearchRun({
      db: connection.db,
      taskId: session.taskId,
      runId: run.id,
    });
    const listing = searchSnapshot?.listings.find(
      ({ id }) => id === organicAttempt.candidateListingId,
    );
    if (listing === undefined) throw new Error("Expected research listing");
    const leaseToken = await claimEvidenceResearch({
      db: connection.db,
      taskId: session.taskId,
      researchRunId: prepared.run.id,
    });
    if (leaseToken === null) throw new Error("Expected research lease");
    await recordEvidenceSearchSuccess({
      db: connection.db,
      taskId: session.taskId,
      researchRunId: prepared.run.id,
      attemptId: organicAttempt.id,
      leaseToken,
      response: evidenceSearchResponseSchema.parse({
        providerRequestId: "fixture-first-pass-subset",
        receivedResultCount: 1,
        results: [
          {
            providerResultId: "fixture-first-pass-page",
            rank: 1,
            title: listing.title,
            url: "https://reviews.example.test/first-pass-subset",
            snippet: "An exact independent review of the named product.",
            sourceRole: "independent_review",
          },
        ],
      }),
      startedAt: new Date("2026-08-29T09:00:01.000Z"),
      finishedAt: new Date("2026-08-29T09:00:02.000Z"),
    });
    const plans = await planEvidencePageFetches({
      db: connection.db,
      taskId: session.taskId,
      researchRunId: prepared.run.id,
      candidateListingId: listing.id,
      leaseToken,
      provider: "fixture",
    });
    expect(plans.length).toBeGreaterThan(0);
    const organicAttemptsById = new Map(
      prepared.attempts
        .filter(
          ({ stage, candidateListingId }) =>
            stage === "organic_search" && candidateListingId === listing.id,
        )
        .map((attempt) => [attempt.id, attempt] as const),
    );
    expect(organicAttemptsById.size).toBeGreaterThan(0);
    const omittedCriterionIds = extractionCriterionIds.filter(
      (criterionId) => !organicAttempt.targetCriterionIds.includes(criterionId),
    );
    expect(omittedCriterionIds).toHaveLength(1);
    const plansForFirstOrganic = plans.filter(
      ({ discoveredSource }) =>
        discoveredSource.acquisitionAttemptId === organicAttempt.id,
    );
    expect(plansForFirstOrganic.length).toBeGreaterThan(0);
    for (const plan of plansForFirstOrganic) {
      for (const omittedCriterionId of omittedCriterionIds) {
        expect(plan.attempt.targetCriterionIds).not.toContain(
          omittedCriterionId,
        );
      }
    }
    for (const plan of plans) {
      const discoveryAttempt = organicAttemptsById.get(
        plan.discoveredSource.acquisitionAttemptId,
      );
      if (discoveryAttempt === undefined) {
        throw new Error("Expected page plan to retain organic lineage");
      }
      for (const criterionId of plan.attempt.targetCriterionIds) {
        expect(discoveryAttempt.targetCriterionIds).toContain(criterionId);
        expect(extractionCriterionIds).toContain(criterionId);
      }
    }
  });

  it("writes one admitted bounded document without HTML and enforces exact retry content", async () => {
    const seeded = await seedPlannedPage();
    const page = successfulPage(seeded);
    await expect(
      recordFetchedPageSuccess({
        db: connection.db,
        taskId: seeded.session.taskId,
        researchRunId: seeded.prepared.run.id,
        attemptId: seeded.plan.attempt.id,
        leaseToken: seeded.leaseToken,
        fetch: {
          ...page.fetch,
          text: page.html,
        } as unknown as typeof page.fetch,
        document: page.document,
        admission: page.admission,
        startedAt: new Date("2026-08-29T09:00:02.100Z"),
        finishedAt: new Date("2026-08-29T09:00:03.100Z"),
      }),
    ).rejects.toThrow();
    const write = () =>
      recordFetchedPageSuccess({
        db: connection.db,
        taskId: seeded.session.taskId,
        researchRunId: seeded.prepared.run.id,
        attemptId: seeded.plan.attempt.id,
        leaseToken: seeded.leaseToken,
        fetch: page.fetch,
        document: page.document,
        admission: page.admission,
        startedAt: new Date("2026-08-29T09:00:02.100Z"),
        finishedAt: new Date("2026-08-29T09:00:03.100Z"),
      });
    const stored = await write();
    expect(await write()).toEqual(stored);
    await expect(
      recordFetchedPageSuccess({
        db: connection.db,
        taskId: seeded.session.taskId,
        researchRunId: seeded.prepared.run.id,
        attemptId: seeded.plan.attempt.id,
        leaseToken: seeded.leaseToken,
        fetch: { ...page.fetch, responseHash: "f".repeat(64) },
        document: page.document,
        admission: page.admission,
        startedAt: new Date("2026-08-29T09:00:02.100Z"),
        finishedAt: new Date("2026-08-29T09:00:03.100Z"),
      }),
    ).rejects.toBeInstanceOf(EvidenceAttemptConflictError);

    const bySource = await loadFetchedEvidenceDocuments({
      db: connection.db,
      taskId: seeded.session.taskId,
      researchRunId: seeded.prepared.run.id,
      candidateListingId: seeded.listing.id,
      evidenceSourceIdsInOrder: [stored.evidenceSourceId],
    });
    const byAttempt = await loadFetchedEvidenceDocuments({
      db: connection.db,
      taskId: seeded.session.taskId,
      researchRunId: seeded.prepared.run.id,
      candidateListingId: seeded.listing.id,
      attemptIdsInOrder: [seeded.plan.attempt.id],
    });
    expect(bySource).toEqual([stored]);
    expect(byAttempt).toEqual([stored]);
    expect(JSON.stringify(stored.document)).not.toContain("<html");
    expect(JSON.stringify(stored.document)).not.toContain("<script");
    const [sourceRows, documentRows] = await Promise.all([
      connection.db
        .select()
        .from(evidenceSources)
        .where(
          eq(evidenceSources.acquisitionAttemptId, seeded.plan.attempt.id),
        ),
      connection.db
        .select()
        .from(fetchedEvidenceDocuments)
        .where(eq(fetchedEvidenceDocuments.attemptId, seeded.plan.attempt.id)),
    ]);
    expect(sourceRows).toHaveLength(1);
    expect(sourceRows[0]).toMatchObject({
      sourceKind: "fetched_page",
      researchRunId: seeded.prepared.run.id,
      candidateListingId: seeded.listing.id,
    });
    expect(documentRows).toHaveLength(1);
    expect(
      (
        await loadEvidenceResearchRun({
          db: connection.db,
          taskId: seeded.session.taskId,
          researchRunId: seeded.prepared.run.id,
        })
      )?.sources.find(({ id }) => id === stored.evidenceSourceId),
    ).toMatchObject({ sourceKind: "fetched_page" });

    await connection.client`
      UPDATE shopping_private.fetched_evidence_documents
      SET document = ${JSON.stringify({})}::jsonb
      WHERE id = ${stored.id}
    `;
    await expect(
      loadFetchedEvidenceDocuments({
        db: connection.db,
        taskId: seeded.session.taskId,
        researchRunId: seeded.prepared.run.id,
        candidateListingId: seeded.listing.id,
        evidenceSourceIdsInOrder: [stored.evidenceSourceId],
      }),
    ).rejects.toBeInstanceOf(PersistedDataCorruptionError);
    await expect(
      loadEvidenceResearchRun({
        db: connection.db,
        taskId: seeded.session.taskId,
        researchRunId: seeded.prepared.run.id,
      }),
    ).rejects.toBeInstanceOf(PersistedDataCorruptionError);
  });

  it("replays historical fetched-page metadata at the former 1.5 MB ceiling", async () => {
    const seeded = await seedPlannedPage();
    const page = successfulPage(seeded);
    const fetch = {
      ...page.fetch,
      encodedBytes: 1_500_000,
      decodedBytes: 1_500_000,
    };
    const write = () =>
      recordFetchedPageSuccess({
        db: connection.db,
        taskId: seeded.session.taskId,
        researchRunId: seeded.prepared.run.id,
        attemptId: seeded.plan.attempt.id,
        leaseToken: seeded.leaseToken,
        fetch,
        document: page.document,
        admission: page.admission,
        startedAt: new Date("2026-08-29T09:00:02.100Z"),
        finishedAt: new Date("2026-08-29T09:00:03.100Z"),
      });

    const stored = await write();
    await expect(write()).resolves.toEqual(stored);
    await expect(
      loadFetchedEvidenceDocuments({
        db: connection.db,
        taskId: seeded.session.taskId,
        researchRunId: seeded.prepared.run.id,
        candidateListingId: seeded.listing.id,
        attemptIdsInOrder: [seeded.plan.attempt.id],
      }),
    ).resolves.toEqual([stored]);
  });

  it("rejects raw fetched-page metadata above the shared transport ceiling", async () => {
    const seeded = await seedPlannedPage();
    const { stored } = await persistSuccessfulPage(seeded);

    await expect(
      connection.client`
        UPDATE shopping_private.fetched_evidence_documents
        SET encoded_bytes = ${MAX_PAGE_TRANSPORT_BYTES + 1}
        WHERE task_id = ${seeded.session.taskId}
          AND id = ${stored.id}
      `,
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("does not project an orphan fetched-page source after its raw document is removed", async () => {
    const seeded = await seedPlannedPage();
    const { stored } = await persistSuccessfulPage(seeded);

    await connection.client`
      DELETE FROM shopping_private.fetched_evidence_documents
      WHERE task_id = ${seeded.session.taskId}
        AND id = ${stored.id}
    `;

    await expect(
      loadEvidenceResearchRun({
        db: connection.db,
        taskId: seeded.session.taskId,
        researchRunId: seeded.prepared.run.id,
      }),
    ).rejects.toBeInstanceOf(PersistedDataCorruptionError);
  });

  it("does not project a raw-mutated fetched-page source", async () => {
    const seeded = await seedPlannedPage();
    const { stored } = await persistSuccessfulPage(seeded);

    await connection.client`
      UPDATE shopping_private.evidence_sources
      SET excerpt = 'Forged unchecked page evidence'
      WHERE task_id = ${seeded.session.taskId}
        AND id = ${stored.evidenceSourceId}
    `;

    await expect(
      loadEvidenceResearchRun({
        db: connection.db,
        taskId: seeded.session.taskId,
        researchRunId: seeded.prepared.run.id,
      }),
    ).rejects.toBeInstanceOf(PersistedDataCorruptionError);
  });

  it("projects criterion-exact checked source IDs only from validated fetched pages", async () => {
    const seeded = await seedPlannedPage();
    const { stored } = await persistSuccessfulPage(seeded);
    await connection.client`
      UPDATE shopping_private.evidence_research_runs
      SET phase = 'deepening'
      WHERE task_id = ${seeded.session.taskId}
        AND id = ${seeded.prepared.run.id}
    `;

    const support = await loadCurrentDecisionSupport({
      db: connection.db,
      taskId: seeded.session.taskId,
    });
    const coverage = support.deepResearchCoverage.find(
      ({ candidateListingId }) => candidateListingId === seeded.listing.id,
    );
    if (coverage === undefined) throw new Error("Expected deep page coverage");
    expect(coverage.checkedSourcesByCriterion).toEqual(
      coverage.criterionIds.map((criterionId) => ({
        criterionId,
        sourceIds: seeded.plan.attempt.targetCriterionIds.includes(criterionId)
          ? [stored.evidenceSourceId]
          : [],
      })),
    );
  });

  it("does not project fetched-page children attached to a raw nonterminal attempt", async () => {
    const seeded = await seedPlannedPage();
    await persistSuccessfulPage(seeded);

    await connection.client`
      UPDATE shopping_private.evidence_acquisition_attempts
      SET status = 'planned',
          provider_request_id = NULL,
          received_result_count = NULL,
          failure_code = NULL,
          started_at = NULL,
          finished_at = NULL
      WHERE task_id = ${seeded.session.taskId}
        AND id = ${seeded.plan.attempt.id}
    `;

    await expect(
      loadEvidenceResearchRun({
        db: connection.db,
        taskId: seeded.session.taskId,
        researchRunId: seeded.prepared.run.id,
      }),
    ).rejects.toBeInstanceOf(PersistedDataCorruptionError);
  });

  it("records page-specific failure once and rejects conflicting terminal content", async () => {
    const seeded = await seedPlannedPage();
    const failure = () =>
      recordEvidencePageFetchFailure({
        db: connection.db,
        taskId: seeded.session.taskId,
        researchRunId: seeded.prepared.run.id,
        attemptId: seeded.plan.attempt.id,
        leaseToken: seeded.leaseToken,
        failureCode: "unsafe_url",
        startedAt: new Date("2026-08-29T09:00:02.100Z"),
        finishedAt: new Date("2026-08-29T09:00:02.200Z"),
      });
    expect(await failure()).toBe(true);
    expect(await failure()).toBe(false);
    await expect(
      recordEvidencePageFetchFailure({
        db: connection.db,
        taskId: seeded.session.taskId,
        researchRunId: seeded.prepared.run.id,
        attemptId: seeded.plan.attempt.id,
        leaseToken: seeded.leaseToken,
        failureCode: "timeout",
        startedAt: new Date("2026-08-29T09:00:02.100Z"),
        finishedAt: new Date("2026-08-29T09:00:02.200Z"),
      }),
    ).rejects.toBeInstanceOf(EvidenceAttemptConflictError);
    expect(
      await connection.db
        .select()
        .from(fetchedEvidenceDocuments)
        .where(eq(fetchedEvidenceDocuments.attemptId, seeded.plan.attempt.id)),
    ).toHaveLength(0);
  });

  it("requires an explicit page failure code at the raw database boundary", async () => {
    const seeded = await seedPlannedPage();
    const finishedAt = "2026-08-29T09:00:02.200Z";

    await expect(
      connection.client`
        UPDATE shopping_private.evidence_acquisition_attempts
        SET status = 'failed',
            failure_code = NULL,
            received_result_count = NULL,
            started_at = ${finishedAt},
            finished_at = ${finishedAt}
        WHERE task_id = ${seeded.session.taskId}
          AND id = ${seeded.plan.attempt.id}
      `,
    ).rejects.toMatchObject({ code: "23514" });

    await connection.client`
      UPDATE shopping_private.evidence_acquisition_attempts
      SET status = 'failed',
          failure_code = 'timeout',
          received_result_count = NULL,
          started_at = ${finishedAt},
          finished_at = ${finishedAt}
      WHERE task_id = ${seeded.session.taskId}
        AND id = ${seeded.plan.attempt.id}
    `;
    const snapshot = await loadEvidenceResearchRun({
      db: connection.db,
      taskId: seeded.session.taskId,
      researchRunId: seeded.prepared.run.id,
    });
    expect(
      snapshot?.attempts.find(({ id }) => id === seeded.plan.attempt.id),
    ).toMatchObject({ status: "failed", failureCode: "timeout" });
  });

  it("fails closed when a raw page binding points at an organic source from another research run", async () => {
    const seeded = await seedPlannedPage();
    const foreignRunId = randomUUID();
    const foreignAttemptId = randomUUID();
    const foreignSourceId = randomUUID();
    const criterionId = seeded.plan.attempt.targetCriterionIds[0];
    if (criterionId === undefined) throw new Error("Expected target criterion");
    const now = new Date("2026-08-29T09:00:02.050Z");
    const nowText = now.toISOString();
    await connection.client`
      INSERT INTO shopping_private.evidence_research_runs
        (id, task_id, search_run_id, task_revision, policy_version, phase, status,
         selected_candidate_count, planned_search_count, started_at)
      VALUES
        (${foreignRunId}, ${seeded.session.taskId}, ${seeded.run.id},
         ${seeded.prepared.run.taskRevision.toString()}::bigint,
         ${`raw-cross-scope:${foreignRunId}`},
         'first_pass', 'running', 1, 1, ${nowText})
    `;
    await connection.client`
      INSERT INTO shopping_private.evidence_acquisition_attempts
        (id, task_id, research_run_id, candidate_run_id, candidate_listing_id,
         stage, purpose, plan_key, query, status, provider,
         received_result_count, started_at, finished_at)
      VALUES
        (${foreignAttemptId}, ${seeded.session.taskId}, ${foreignRunId},
         ${seeded.run.id}, ${seeded.listing.id}, 'organic_search', 'first_pass',
         ${`raw-cross-organic:${foreignAttemptId}`}, 'exact raw discovery',
         'succeeded', 'fixture', 1, ${nowText}, ${nowText})
    `;
    await connection.client`
      INSERT INTO shopping_private.evidence_attempt_target_criteria
        (task_id, research_run_id, candidate_run_id, candidate_listing_id,
         attempt_id, criterion_id)
      VALUES
        (${seeded.session.taskId}, ${foreignRunId}, ${seeded.run.id},
         ${seeded.listing.id}, ${foreignAttemptId}, ${criterionId})
    `;
    await connection.client`
      INSERT INTO shopping_private.evidence_sources
        (id, task_id, research_run_id, candidate_run_id, candidate_listing_id,
         acquisition_attempt_id, source_role, source_kind, source_url,
         source_title, excerpt, provider, provider_result_id, observed_at,
         fingerprint)
      VALUES
        (${foreignSourceId}, ${seeded.session.taskId}, ${foreignRunId},
         ${seeded.run.id}, ${seeded.listing.id}, ${foreignAttemptId},
         'independent_review', 'organic_result',
         'https://foreign.example.test/nimbus-aero-pro', ${seeded.listing.title},
         'Raw cross-run source', 'fixture', 'raw-cross-source', ${nowText},
         ${createHash("sha256").update(foreignSourceId).digest("hex")})
    `;
    await connection.client`
      UPDATE shopping_private.evidence_page_fetch_targets
      SET discovered_source_id = ${foreignSourceId},
          requested_url = 'https://foreign.example.test/nimbus-aero-pro'
      WHERE task_id = ${seeded.session.taskId}
        AND attempt_id = ${seeded.plan.attempt.id}
    `;

    await expect(
      loadEvidenceResearchRun({
        db: connection.db,
        taskId: seeded.session.taskId,
        researchRunId: seeded.prepared.run.id,
      }),
    ).rejects.toBeInstanceOf(PersistedDataCorruptionError);
    await expect(
      recordEvidencePageFetchFailure({
        db: connection.db,
        taskId: seeded.session.taskId,
        researchRunId: seeded.prepared.run.id,
        attemptId: seeded.plan.attempt.id,
        leaseToken: seeded.leaseToken,
        failureCode: "unsafe_url",
        startedAt: now,
        finishedAt: now,
      }),
    ).rejects.toBeInstanceOf(PersistedDataCorruptionError);
  });

  it("keeps an admitted provider success after the later model stage fails", async () => {
    const seeded = await seedPlannedPage();
    const page = successfulPage(seeded);
    const stored = await recordFetchedPageSuccess({
      db: connection.db,
      taskId: seeded.session.taskId,
      researchRunId: seeded.prepared.run.id,
      attemptId: seeded.plan.attempt.id,
      leaseToken: seeded.leaseToken,
      fetch: page.fetch,
      document: page.document,
      admission: page.admission,
      startedAt: new Date("2026-08-29T09:00:02.100Z"),
      finishedAt: new Date("2026-08-29T09:00:03.100Z"),
    });
    expect(
      await recordCandidateUnderstanding({
        db: connection.db,
        taskId: seeded.session.taskId,
        researchRunId: seeded.prepared.run.id,
        candidateListingId: seeded.listing.id,
        extractionAttemptId: seeded.extractionAttempt.id,
        assessmentAttemptId: seeded.assessmentAttempt.id,
        leaseToken: seeded.leaseToken,
        sourceIdsInOrder: [stored.evidenceSourceId],
        result: null,
        metadata: null,
        failureCode: "model_failed",
        startedAt: new Date("2026-08-29T09:00:03.200Z"),
        finishedAt: new Date("2026-08-29T09:00:04.200Z"),
      }),
    ).toBe(true);
    expect(
      await loadFetchedEvidenceDocuments({
        db: connection.db,
        taskId: seeded.session.taskId,
        researchRunId: seeded.prepared.run.id,
        candidateListingId: seeded.listing.id,
        evidenceSourceIdsInOrder: [stored.evidenceSourceId],
      }),
    ).toEqual([stored]);
    const snapshot = await loadEvidenceResearchRun({
      db: connection.db,
      taskId: seeded.session.taskId,
      researchRunId: seeded.prepared.run.id,
    });
    expect(
      snapshot?.sources.find(({ id }) => id === stored.evidenceSourceId),
    ).toMatchObject({
      sourceKind: "fetched_page",
      researchRunId: seeded.prepared.run.id,
    });
    const modelAttempts = snapshot?.attempts.filter(
      (attempt) =>
        attempt.id === seeded.extractionAttempt.id ||
        attempt.id === seeded.assessmentAttempt.id,
    );
    expect(modelAttempts?.every(({ status }) => status === "failed")).toBe(
      true,
    );
  });

  it("does not load another candidate or arbitrary ID as fetched evidence", async () => {
    const seeded = await seedPlannedPage();
    await expect(
      loadFetchedEvidenceDocuments({
        db: connection.db,
        taskId: seeded.session.taskId,
        researchRunId: seeded.prepared.run.id,
        candidateListingId: randomUUID(),
        attemptIdsInOrder: [seeded.plan.attempt.id],
      }),
    ).rejects.toBeInstanceOf(EvidenceResearchAuthorityError);
  });
});
