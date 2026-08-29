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
  deepenLiveShoppingResearch,
  loadLiveShoppingSession,
  researchLiveCandidate,
  researchLiveShopping,
  setLiveListingSaved,
  startLiveShopping,
  type LiveShoppingDependencies,
} from "../../src/features/live-shopping/application";
import { saveCandidateListing } from "../../src/features/live-shopping/saved-listings";
import {
  FakeEvidenceSearchProvider,
  FakeProductUnderstandingModel,
} from "../../src/features/product-understanding/fakes";
import {
  claimEvidenceResearch,
  loadCurrentDecisionSupport,
  loadCurrentDecisionSupportInTransaction,
  loadEvidenceResearchRun,
  prepareEvidenceResearch,
  recordCandidateUnderstanding,
  recordEvidenceSearchSuccess,
  releaseEvidenceResearchLease,
} from "../../src/features/product-understanding/persistence";
import { evidenceSearchResponseSchema } from "../../src/features/product-understanding/evidence-search";
import { executeOrResumeEvidenceResearch } from "../../src/features/product-understanding/research-orchestrator";
import { FakeShoppingProvider } from "../../src/features/retrieval-spike/fake-shopping-provider";
import { loadPersistedSearchRun } from "../../src/features/retrieval-spike/persistence/search-runs";
import { recordTaskInput } from "../../src/features/shopping-state/persistence/inputs-and-messages";
import { applyStatePatch } from "../../src/features/shopping-state/persistence/state-transitions";
import {
  criterionAssessmentObservations,
  criterionAssessments,
  evidenceAttemptTargetCriteria,
  evidenceResearchRuns,
  founderLiveSessions,
  productObservations,
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

describe("evidence-backed product understanding persistence", () => {
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

  async function seedSearch(acquisitionModel = contextModel()) {
    const dependencies = {
      db: connection.db,
      model: acquisitionModel,
      provider: new FakeShoppingProvider(
        () => new Date("2026-08-28T00:00:00.000Z"),
      ),
    } satisfies LiveShoppingDependencies;
    const sessionId = randomUUID();
    await startLiveShopping({
      dependencies,
      input: {
        operation: "start",
        sessionId,
        turnId: randomUUID(),
        message: "A light breathable cap for running in hot weather",
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
    if (run === undefined) throw new Error("Expected search run");
    return { session, run };
  }

  it("persists bounded research, attributable observations and revision-bound assessments idempotently", async () => {
    const { session, run } = await seedSearch();
    const evidenceProvider = new FakeEvidenceSearchProvider();
    const model = new FakeProductUnderstandingModel();
    const dependencies = {
      db: connection.db,
      evidenceProvider,
      model,
      modelIdentity: {
        provider: "fixture" as const,
        model: "fixture-product-understanding",
        promptVersion: "product-understanding-v1",
      },
    };
    const completed = await executeOrResumeEvidenceResearch({
      dependencies,
      taskId: session.taskId,
      searchRunId: run.id,
    });
    expect(completed.run.status).toBe("succeeded");
    expect(completed.run.selectedCandidateCount).toBeLessThanOrEqual(6);
    expect(completed.run.plannedSearchCount).toBeLessThanOrEqual(
      completed.run.selectedCandidateCount * 2,
    );
    expect(completed.sources.length).toBeGreaterThan(0);
    expect(completed.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          observationKind: "structured_field",
          propertyLabel: "Observed price",
        }),
      ]),
    );
    expect(completed.assessments).toHaveLength(
      completed.run.selectedCandidateCount,
    );
    expect(
      completed.assessments.every(
        (assessment) => assessment.taskRevision === 1n,
      ),
    ).toBe(true);
    const searchCallCount = evidenceProvider.calls.length;
    const modelCallCount = model.calls.length;

    const exactRetry = await executeOrResumeEvidenceResearch({
      dependencies,
      taskId: session.taskId,
      searchRunId: run.id,
    });
    expect(exactRetry).toEqual(completed);
    expect(evidenceProvider.calls).toHaveLength(searchCallCount);
    expect(model.calls).toHaveLength(modelCallCount);
  });

  it("prepares research for an authoritative brief with thirteen criteria", async () => {
    const operations = Array.from({ length: 13 }, (_, index) => {
      const localRef = `criterion_${index + 1}`;
      return [
        {
          op: "create_concept" as const,
          localRef,
          label: `Criterion ${index + 1}`,
          definition: `Explicit shopping criterion ${index + 1}`,
          valueFamily: "qualitative" as const,
          canonicalUnit: null,
        },
        {
          op: "add_criterion" as const,
          concept: { kind: "created" as const, localRef },
          target: {
            strength: "preference" as const,
            targetSemantics: "qualitative" as const,
            semanticValue: {
              schemaVersion: 1 as const,
              kind: "qualitative_text" as const,
              text: `Preference ${index + 1}`,
            },
          },
        },
      ];
    }).flat();
    const acquisitionModel: ContextAcquisitionModel = {
      interpret: vi.fn(() =>
        Promise.resolve({
          status: "completed" as const,
          value: {
            providerSchemaVersion: 1 as const,
            outcome: "change" as const,
            operations,
            ambiguities: [],
          },
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
    const { session, run } = await seedSearch(acquisitionModel);
    const prepared = await prepareEvidenceResearch({
      db: connection.db,
      taskId: session.taskId,
      searchRunId: run.id,
      evidenceProvider: "fixture",
      modelProvider: "fixture",
      model: "fixture-product-understanding",
      promptVersion: "product-understanding-v1",
    });
    const modelAttempts = prepared.attempts.filter(
      ({ stage }) =>
        stage === "observation_extraction" || stage === "criterion_assessment",
    );
    expect(modelAttempts.length).toBeGreaterThan(0);
    expect(
      modelAttempts.every(
        ({ targetCriterionIds }) => targetCriterionIds.length === 13,
      ),
    ).toBe(true);
  });

  it("keeps unassessed saved listings visible and compareable as unknown", async () => {
    const { session, run } = await seedSearch();
    const searchRun = await loadPersistedSearchRun({
      db: connection.db,
      taskId: session.taskId,
      runId: run.id,
    });
    const candidates = searchRun?.listings.slice(0, 2) ?? [];
    if (candidates.length !== 2) {
      throw new Error("Expected two factual listings before research");
    }
    for (const candidate of candidates) {
      await saveCandidateListing({
        db: connection.db,
        taskId: session.taskId,
        candidateListingId: candidate.id,
      });
    }

    const view = await loadLiveShoppingSession({
      db: connection.db,
      sessionId: session.id,
    });
    expect(view.savedListings).toHaveLength(2);
    expect(view.decisionSupport?.comparison?.candidates).toHaveLength(2);
    expect(view.decisionSupport?.comparison?.researchStates).toEqual(
      expect.arrayContaining(
        candidates.map((candidate) => ({
          candidateListingId: candidate.id,
          state: "available",
        })),
      ),
    );
    expect(
      view.decisionSupport?.comparison?.rows.every(({ cells }) =>
        cells.every(({ status }) => status === "uncertain"),
      ),
    ).toBe(true);
    expect(view.decisionSupport?.comparison?.judgement).toContain(
      "does not meaningfully separate",
    );
  });

  it("does not persist an unrelated organic result as candidate evidence", async () => {
    const { session, run } = await seedSearch();
    const prepared = await prepareEvidenceResearch({
      db: connection.db,
      taskId: session.taskId,
      searchRunId: run.id,
      evidenceProvider: "fixture",
      modelProvider: "fixture",
      model: "fixture-product-understanding",
      promptVersion: "product-understanding-v1",
    });
    const attempt = prepared.attempts.find(
      (entry) => entry.stage === "organic_search",
    );
    if (attempt === undefined) throw new Error("Expected organic attempt");
    const searchRun = await loadPersistedSearchRun({
      db: connection.db,
      taskId: session.taskId,
      runId: run.id,
    });
    const listing = searchRun?.listings.find(
      ({ id }) => id === attempt.candidateListingId,
    );
    if (listing === undefined) throw new Error("Expected candidate listing");
    const leaseToken = await claimEvidenceResearch({
      db: connection.db,
      taskId: session.taskId,
      researchRunId: prepared.run.id,
    });
    if (leaseToken === null) throw new Error("Expected evidence lease");
    await recordEvidenceSearchSuccess({
      db: connection.db,
      taskId: session.taskId,
      researchRunId: prepared.run.id,
      attemptId: attempt.id,
      leaseToken,
      response: evidenceSearchResponseSchema.parse({
        providerRequestId: "fixture-relevance",
        receivedResultCount: 2,
        results: [
          {
            providerResultId: "b-and-q-phone-cases",
            rank: 1,
            title: "Phone cases | Mobile accessories - B&Q",
            url: "https://www.diy.com/departments/technology/mobile-accessories/phone-cases/DIY123456.cat",
            snippet: "Mobile accessories and phone cases",
            sourceRole: "other",
          },
          {
            providerResultId: "candidate-exact",
            rank: 2,
            title: listing.title,
            url: "https://example.test/exact-candidate-source",
            snippet: "The supplied result names the candidate product.",
            sourceRole: "retailer",
          },
        ],
      }),
      startedAt: new Date("2026-08-28T00:00:00.000Z"),
      finishedAt: new Date("2026-08-28T00:00:01.000Z"),
    });
    const snapshot = await loadEvidenceResearchRun({
      db: connection.db,
      taskId: session.taskId,
      researchRunId: prepared.run.id,
    });
    expect(
      snapshot?.sources.map(({ sourceTitle }) => sourceTitle),
    ).not.toContain("Phone cases | Mobile accessories - B&Q");
    expect(snapshot?.sources.map(({ sourceTitle }) => sourceTitle)).toContain(
      listing.title,
    );
  });

  it("loads current decision support from one repeatable shopping-state snapshot", async () => {
    const { session } = await seedSearch();
    const writer = createTestDatabaseConnection("decision-support-writer");
    try {
      const historical = await connection.db.transaction(
        async (reader) => {
          const anchored = await loadCurrentDecisionSupportInTransaction({
            tx: reader,
            taskId: session.taskId,
          });
          expect(anchored.brief.revision).toBe(1n);

          const laterInput = await recordTaskInput({
            db: writer.db,
            taskId: session.taskId,
            clientActionId: "decision-support-concurrent-update",
            request: {
              inputSchemaVersion: 1,
              expectedRevision: 1n,
              kind: "message",
              body: "No white",
            },
          });
          await applyStatePatch(writer.db, {
            applicationSchemaVersion: 1,
            applicationKind: "patch",
            taskId: session.taskId,
            expectedRevision: 1n,
            source: {
              kind: "user_explicit",
              inputId: laterInput.input.id,
            },
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

          return loadCurrentDecisionSupportInTransaction({
            tx: reader,
            taskId: session.taskId,
          });
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );

      expect(historical.brief.revision).toBe(1n);
      expect(
        historical.brief.items.map(({ conceptLabel }) => conceptLabel),
      ).not.toContain("Colour");
      const fresh = await loadCurrentDecisionSupport({
        db: connection.db,
        taskId: session.taskId,
      });
      expect(fresh.brief.revision).toBe(2n);
      expect(
        fresh.brief.items.map(({ conceptLabel }) => conceptLabel),
      ).toContain("Colour");
    } finally {
      await writer.close();
    }
  });

  it("resumes only planned acquisition work after a partial checkpoint", async () => {
    const { session, run } = await seedSearch();
    const evidenceProvider = new FakeEvidenceSearchProvider();
    const model = new FakeProductUnderstandingModel();
    const prepared = await prepareEvidenceResearch({
      db: connection.db,
      taskId: session.taskId,
      searchRunId: run.id,
      evidenceProvider: "fixture",
      modelProvider: "fixture",
      model: "fixture-product-understanding",
      promptVersion: "product-understanding-v1",
    });
    const firstSearch = prepared.attempts.find(
      (attempt) => attempt.stage === "organic_search",
    );
    if (firstSearch?.query === null || firstSearch === undefined) {
      throw new Error("Expected a planned organic search");
    }
    const leaseToken = await claimEvidenceResearch({
      db: connection.db,
      taskId: session.taskId,
      researchRunId: prepared.run.id,
    });
    if (leaseToken === null) throw new Error("Expected research lease");
    const response = await evidenceProvider.search({
      query: firstSearch.query,
      candidateTitle: "Checkpoint candidate",
      merchant: null,
    });
    await recordEvidenceSearchSuccess({
      db: connection.db,
      taskId: session.taskId,
      researchRunId: prepared.run.id,
      attemptId: firstSearch.id,
      leaseToken,
      response,
      startedAt: new Date("2026-08-28T00:00:00.000Z"),
      finishedAt: new Date("2026-08-28T00:00:01.000Z"),
    });
    await releaseEvidenceResearchLease({
      db: connection.db,
      taskId: session.taskId,
      researchRunId: prepared.run.id,
      leaseToken,
    });

    const completed = await executeOrResumeEvidenceResearch({
      dependencies: {
        db: connection.db,
        evidenceProvider,
        model,
        modelIdentity: {
          provider: "fixture",
          model: "fixture-product-understanding",
          promptVersion: "product-understanding-v1",
        },
      },
      taskId: session.taskId,
      searchRunId: run.id,
    });

    expect(completed.run.status).toBe("succeeded");
    expect(
      evidenceProvider.calls.filter((query) => query === firstSearch.query),
    ).toHaveLength(1);
    expect(evidenceProvider.calls).toHaveLength(
      completed.run.plannedSearchCount,
    );
  });

  it("keeps useful evidence when one focused source search fails", async () => {
    const { session, run } = await seedSearch();
    const successful = new FakeEvidenceSearchProvider();
    const calls: string[] = [];
    const evidenceProvider = {
      provider: "fixture" as const,
      search: async (input: Parameters<typeof successful.search>[0]) => {
        calls.push(input.query);
        if (calls.length === 1) throw new Error("isolated provider failure");
        return successful.search(input);
      },
    };
    const completed = await executeOrResumeEvidenceResearch({
      dependencies: {
        db: connection.db,
        evidenceProvider,
        model: new FakeProductUnderstandingModel(),
        modelIdentity: {
          provider: "fixture",
          model: "fixture-product-understanding",
          promptVersion: "product-understanding-v1",
        },
      },
      taskId: session.taskId,
      searchRunId: run.id,
    });

    expect(completed.run.status).toBe("partial");
    expect(
      completed.attempts.filter(({ status }) => status === "failed"),
    ).toHaveLength(1);
    expect(
      completed.attempts.filter(({ status }) => status === "succeeded").length,
    ).toBeGreaterThan(0);
    expect(completed.sources.length).toBeGreaterThan(0);
    expect(completed.observations.length).toBeGreaterThan(0);
    expect(completed.assessments.length).toBeGreaterThan(0);
  });

  it("resumes targeted deepening without repeating its completed evidence search", async () => {
    const { session, run } = await seedSearch();
    const firstDependencies = {
      db: connection.db,
      evidenceProvider: new FakeEvidenceSearchProvider(),
      model: new FakeProductUnderstandingModel(),
      modelIdentity: {
        provider: "fixture" as const,
        model: "fixture-product-understanding",
        promptVersion: "product-understanding-v1",
      },
    };
    const first = await executeOrResumeEvidenceResearch({
      dependencies: firstDependencies,
      taskId: session.taskId,
      searchRunId: run.id,
      mode: "first_pass",
    });
    const candidateListingId = first.assessments[0]?.candidateListingId;
    if (candidateListingId === undefined) {
      throw new Error("Expected a first-pass candidate");
    }
    const prepared = await prepareEvidenceResearch({
      db: connection.db,
      taskId: session.taskId,
      searchRunId: run.id,
      evidenceProvider: "fixture",
      modelProvider: "fixture",
      model: "fixture-product-understanding",
      promptVersion: "product-understanding-v1",
      mode: "targeted",
      targetCandidateListingId: candidateListingId,
    });
    const searchAttempt = prepared.attempts.find(
      ({ stage }) => stage === "organic_search",
    );
    const candidate = (
      await loadPersistedSearchRun({
        db: connection.db,
        taskId: session.taskId,
        runId: run.id,
      })
    )?.listings.find(({ id }) => id === candidateListingId);
    if (searchAttempt === undefined || candidate === undefined) {
      throw new Error("Expected a targeted evidence attempt");
    }
    const leaseToken = await claimEvidenceResearch({
      db: connection.db,
      taskId: session.taskId,
      researchRunId: prepared.run.id,
    });
    if (leaseToken === null) throw new Error("Expected a research lease");
    await recordEvidenceSearchSuccess({
      db: connection.db,
      taskId: session.taskId,
      researchRunId: prepared.run.id,
      attemptId: searchAttempt.id,
      leaseToken,
      response: evidenceSearchResponseSchema.parse({
        providerRequestId: "completed-before-resume",
        receivedResultCount: 1,
        results: [
          {
            providerResultId: "deep-source",
            rank: 1,
            title: `${candidate.title} independent review`,
            url: "https://trustedreviews.com/deep-source",
            snippet: "An exact-product review with bounded evidence.",
            sourceRole: "independent_review",
          },
        ],
      }),
      startedAt: new Date("2026-08-28T00:00:00.000Z"),
      finishedAt: new Date("2026-08-28T00:00:01.000Z"),
    });
    await releaseEvidenceResearchLease({
      db: connection.db,
      taskId: session.taskId,
      researchRunId: prepared.run.id,
      leaseToken,
    });
    const resumedEvidence = new FakeEvidenceSearchProvider();
    const resumedModel = new FakeProductUnderstandingModel();
    const resumed = await executeOrResumeEvidenceResearch({
      dependencies: {
        ...firstDependencies,
        evidenceProvider: resumedEvidence,
        model: resumedModel,
      },
      taskId: session.taskId,
      searchRunId: run.id,
      mode: "targeted",
      targetCandidateListingId: candidateListingId,
    });
    expect(resumed.run.status).toBe("succeeded");
    expect(resumedEvidence.calls).toHaveLength(0);
    expect(resumedModel.calls).toHaveLength(1);
  });

  it("drives the founder research, strongest-options and saved-comparison flow", async () => {
    const evidenceProvider = new FakeEvidenceSearchProvider();
    const understanding = new FakeProductUnderstandingModel();
    const dependencies = {
      db: connection.db,
      model: contextModel(),
      provider: new FakeShoppingProvider(
        () => new Date("2026-08-28T00:00:00.000Z"),
      ),
      research: {
        evidenceProvider,
        model: understanding,
        modelIdentity: {
          provider: "fixture" as const,
          model: "fixture-product-understanding",
          promptVersion: "product-understanding-v1",
        },
      },
    } satisfies LiveShoppingDependencies;
    const sessionId = randomUUID();
    const initial = await startLiveShopping({
      dependencies,
      input: {
        operation: "start",
        sessionId,
        turnId: randomUUID(),
        message: "A light breathable cap for running in hot weather",
      },
    });
    expect(initial.decisionSupport?.researchStatus).toBe("not_started");

    const researched = await researchLiveShopping({
      dependencies,
      input: { operation: "research", sessionId },
    });
    expect(researched.decisionSupport).toMatchObject({
      researchStatus: "ready",
      researchedCandidateCount: 2,
      sectionMode: "qualified_options",
    });
    expect(researched.decisionSupport?.topOptions).toHaveLength(2);
    expect(researched.decisionSupport?.topOptions[0]?.strongestSupported).toBe(
      false,
    );
    expect(JSON.stringify(researched)).not.toContain(
      "IGNORE PREVIOUS INSTRUCTIONS",
    );
    const [first, second] = researched.decisionSupport?.topOptions ?? [];
    if (first === undefined || second === undefined) {
      throw new Error("Expected two strongest options");
    }
    await setLiveListingSaved({
      dependencies,
      input: {
        operation: "save_listing",
        sessionId,
        candidateListingId: first.listing.candidateListingId,
      },
    });
    const compared = await setLiveListingSaved({
      dependencies,
      input: {
        operation: "save_listing",
        sessionId,
        candidateListingId: second.listing.candidateListingId,
      },
    });
    expect(compared.decisionSupport?.comparison?.candidates).toHaveLength(2);
    expect(compared.decisionSupport?.comparison?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Breathability" }),
      ]),
    );
    expect(compared.decisionSupport?.comparison?.judgement).toContain(
      "current",
    );
    const evidenceCalls = evidenceProvider.calls.length;
    const modelCalls = understanding.calls.length;
    await researchLiveShopping({
      dependencies,
      input: { operation: "research", sessionId },
    });
    expect(evidenceProvider.calls).toHaveLength(evidenceCalls);
    expect(understanding.calls).toHaveLength(modelCalls);

    const [deepened] = await Promise.all([
      deepenLiveShoppingResearch({
        dependencies,
        input: { operation: "deepen_research", sessionId },
      }),
      researchLiveCandidate({
        dependencies,
        input: {
          operation: "research_candidate",
          sessionId,
          candidateListingId: first.listing.candidateListingId,
        },
      }),
    ]);
    expect(deepened.decisionSupport?.researchActivity).toMatchObject({
      firstPassEvidenceCalls: 2,
      deepeningEvidenceCalls: 2,
    });
    expect(evidenceProvider.calls.length).toBeLessThanOrEqual(
      evidenceCalls + 2,
    );
    expect(new Set(evidenceProvider.calls).size).toBe(
      evidenceProvider.calls.length,
    );
    const deepEvidenceCalls = evidenceProvider.calls.length;
    const deepModelCalls = understanding.calls.length;
    await researchLiveCandidate({
      dependencies,
      input: {
        operation: "research_candidate",
        sessionId,
        candidateListingId: first.listing.candidateListingId,
      },
    });
    expect(evidenceProvider.calls).toHaveLength(deepEvidenceCalls);
    expect(understanding.calls).toHaveLength(deepModelCalls);
    const [persistedSession] = await connection.db
      .select({ taskId: founderLiveSessions.taskId })
      .from(founderLiveSessions)
      .where(eq(founderLiveSessions.id, sessionId));
    if (persistedSession === undefined) {
      throw new Error("Expected founder session");
    }
    const targetRows = await connection.db
      .select()
      .from(evidenceAttemptTargetCriteria)
      .where(eq(evidenceAttemptTargetCriteria.taskId, persistedSession.taskId));
    expect(targetRows.length).toBeGreaterThan(0);
    const assessmentRows = await connection.db
      .select()
      .from(criterionAssessments)
      .where(eq(criterionAssessments.taskId, persistedSession.taskId));
    const firstLineage = assessmentRows
      .filter(
        ({ candidateListingId }) =>
          candidateListingId === first.listing.candidateListingId,
      )
      .sort((left, right) => left.generation - right.generation);
    expect(firstLineage.map(({ generation }) => generation)).toEqual([1, 2]);
    expect(firstLineage[0]).toMatchObject({ supersededAt: expect.any(Date) });
    expect(firstLineage[1]).toMatchObject({
      supersedesAssessmentId: firstLineage[0]?.id,
      supersededAt: null,
    });
  });

  it("preserves observations while a later authoritative revision gets new assessments", async () => {
    const { session, run } = await seedSearch();
    const dependencies = {
      db: connection.db,
      evidenceProvider: new FakeEvidenceSearchProvider(),
      model: new FakeProductUnderstandingModel(),
      modelIdentity: {
        provider: "fixture" as const,
        model: "fixture-product-understanding",
        promptVersion: "product-understanding-v1",
      },
    };
    const first = await executeOrResumeEvidenceResearch({
      dependencies,
      taskId: session.taskId,
      searchRunId: run.id,
    });
    const savedCandidateListingId = first.assessments[0]?.candidateListingId;
    if (savedCandidateListingId === undefined) {
      throw new Error("Expected an assessed candidate to save");
    }
    await saveCandidateListing({
      db: connection.db,
      taskId: session.taskId,
      candidateListingId: savedCandidateListingId,
    });
    const priorObservationIds = new Set(
      first.observations
        .filter(
          ({ candidateListingId }) =>
            candidateListingId === savedCandidateListingId,
        )
        .map(({ id }) => id),
    );
    const input = await recordTaskInput({
      db: connection.db,
      taskId: session.taskId,
      clientActionId: `test-refinement:${randomUUID()}`,
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 1n,
        kind: "message",
        body: "Comfort for long workdays matters most now",
      },
    });
    await applyStatePatch(connection.db, {
      applicationSchemaVersion: 1,
      applicationKind: "patch",
      taskId: session.taskId,
      expectedRevision: 1n,
      source: { kind: "user_explicit", inputId: input.input.id },
      patch: {
        schemaVersion: 1,
        outcome: "change",
        operations: [
          {
            op: "create_concept",
            localRef: "long_session_comfort",
            label: "Long-session comfort",
            definition: "Comfort over a full workday",
            valueFamily: "qualitative",
            canonicalUnit: null,
          },
          {
            op: "add_criterion",
            concept: { kind: "created", localRef: "long_session_comfort" },
            target: {
              strength: "strong_preference",
              targetSemantics: "qualitative",
              semanticValue: {
                schemaVersion: 1,
                kind: "qualitative",
                mode: "text",
                text: "comfortable over a full workday",
              },
            },
          },
        ],
      },
    });
    const second = await executeOrResumeEvidenceResearch({
      dependencies,
      taskId: session.taskId,
      searchRunId: run.id,
      savedCandidateListingIds: [savedCandidateListingId],
    });
    expect(second.run.taskRevision).toBe(2n);
    expect(second.run.selectedCandidateCount).toBe(1);
    expect(
      [...priorObservationIds].every((id) =>
        second.observations.some((observation) => observation.id === id),
      ),
    ).toBe(true);
    const persistedAssessments = await connection.db
      .select()
      .from(criterionAssessments)
      .where(eq(criterionAssessments.taskId, session.taskId));
    expect(
      new Set(persistedAssessments.map(({ taskRevision }) => taskRevision)),
    ).toEqual(new Set([1n, 2n]));
  });

  it("keeps the prior current assessment when targeted deep understanding fails", async () => {
    const { session, run } = await seedSearch();
    const initialModel = new FakeProductUnderstandingModel();
    const baseDependencies = {
      db: connection.db,
      evidenceProvider: new FakeEvidenceSearchProvider(),
      model: initialModel,
      modelIdentity: {
        provider: "fixture" as const,
        model: "fixture-product-understanding",
        promptVersion: "product-understanding-v1",
      },
    };
    const first = await executeOrResumeEvidenceResearch({
      dependencies: baseDependencies,
      taskId: session.taskId,
      searchRunId: run.id,
      mode: "first_pass",
    });
    const candidateListingId = first.assessments[0]?.candidateListingId;
    if (candidateListingId === undefined) {
      throw new Error("Expected a first-pass assessment");
    }
    const before = await loadCurrentDecisionSupport({
      db: connection.db,
      taskId: session.taskId,
    });
    const beforeIds = before.assessments
      .filter(
        (assessment) => assessment.candidateListingId === candidateListingId,
      )
      .map(({ id }) => id)
      .sort();
    const failingModel = {
      understand: vi.fn(() =>
        Promise.resolve({
          status: "provider_failed" as const,
          errorCode: "fixture_deep_failure",
          metadata: {
            provider: "fixture",
            model: "fixture-product-understanding",
            promptVersion: "product-understanding-v1",
            providerSchemaVersion: 1,
            providerRequestId: "fixture-deep-failure",
            durationMs: 0,
            inputTokens: null,
            outputTokens: null,
          },
        }),
      ),
    };
    const deep = await executeOrResumeEvidenceResearch({
      dependencies: {
        ...baseDependencies,
        evidenceProvider: new FakeEvidenceSearchProvider(),
        model: failingModel,
      },
      taskId: session.taskId,
      searchRunId: run.id,
      mode: "targeted",
      targetCandidateListingId: candidateListingId,
    });
    expect(deep.run.phase).toBe("deepening");
    expect(deep.run.status).toBe("partial");
    expect(failingModel.understand).toHaveBeenCalledTimes(1);
    const after = await loadCurrentDecisionSupport({
      db: connection.db,
      taskId: session.taskId,
    });
    expect(
      after.assessments
        .filter(
          (assessment) => assessment.candidateListingId === candidateListingId,
        )
        .map(({ id }) => id)
        .sort(),
    ).toEqual(beforeIds);
    expect(after.deepResearchCoverage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidateListingId,
          runStatus: "partial",
          status: "failed",
        }),
      ]),
    );
  });

  it("rejects assessment publication after authoritative truth advances", async () => {
    const { session, run } = await seedSearch();
    const prepared = await prepareEvidenceResearch({
      db: connection.db,
      taskId: session.taskId,
      searchRunId: run.id,
      evidenceProvider: "fixture",
      modelProvider: "fixture",
      model: "fixture-product-understanding",
      promptVersion: "product-understanding-v1",
    });
    const candidateListingId = prepared.attempts[0]?.candidateListingId;
    const extraction = prepared.attempts.find(
      (attempt) =>
        attempt.candidateListingId === candidateListingId &&
        attempt.stage === "observation_extraction",
    );
    const assessment = prepared.attempts.find(
      (attempt) =>
        attempt.candidateListingId === candidateListingId &&
        attempt.stage === "criterion_assessment",
    );
    if (
      candidateListingId === undefined ||
      extraction === undefined ||
      assessment === undefined
    ) {
      throw new Error("Expected model attempts for a candidate");
    }
    const leaseToken = await claimEvidenceResearch({
      db: connection.db,
      taskId: session.taskId,
      researchRunId: prepared.run.id,
    });
    if (leaseToken === null) throw new Error("Expected research lease");
    const input = await recordTaskInput({
      db: connection.db,
      taskId: session.taskId,
      clientActionId: `stale-research:${randomUUID()}`,
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 1n,
        kind: "message",
        body: "Comfort now matters too",
      },
    });
    await applyStatePatch(connection.db, {
      applicationSchemaVersion: 1,
      applicationKind: "patch",
      taskId: session.taskId,
      expectedRevision: 1n,
      source: { kind: "user_explicit", inputId: input.input.id },
      patch: {
        schemaVersion: 1,
        outcome: "change",
        operations: [
          {
            op: "create_concept",
            localRef: "comfort",
            label: "Comfort",
            definition: "Comfort during use",
            valueFamily: "qualitative",
            canonicalUnit: null,
          },
          {
            op: "add_criterion",
            concept: { kind: "created", localRef: "comfort" },
            target: {
              strength: "preference",
              targetSemantics: "qualitative",
              semanticValue: {
                schemaVersion: 1,
                kind: "qualitative",
                mode: "text",
                text: "comfortable",
              },
            },
          },
        ],
      },
    });

    await expect(
      recordCandidateUnderstanding({
        db: connection.db,
        taskId: session.taskId,
        researchRunId: prepared.run.id,
        candidateListingId,
        extractionAttemptId: extraction.id,
        assessmentAttemptId: assessment.id,
        leaseToken,
        sourceIdsInOrder: prepared.sources
          .filter((source) => source.candidateListingId === candidateListingId)
          .map(({ id }) => id),
        result: null,
        failureCode: "model_failed",
        metadata: null,
        startedAt: new Date("2026-08-28T00:00:00.000Z"),
        finishedAt: new Date("2026-08-28T00:00:01.000Z"),
      }),
    ).rejects.toMatchObject({ name: "StaleTaskRevisionError" });
  });

  it("rejects cross-candidate assessment evidence and revision mismatch at raw SQL boundaries", async () => {
    const { session, run } = await seedSearch();
    const completed = await executeOrResumeEvidenceResearch({
      dependencies: {
        db: connection.db,
        evidenceProvider: new FakeEvidenceSearchProvider(),
        model: new FakeProductUnderstandingModel(),
        modelIdentity: {
          provider: "fixture",
          model: "fixture-product-understanding",
          promptVersion: "product-understanding-v1",
        },
      },
      taskId: session.taskId,
      searchRunId: run.id,
    });
    const [left, right] = completed.assessments;
    if (left === undefined || right === undefined) {
      throw new Error("Expected two assessment candidates");
    }
    const foreignObservation = completed.observations.find(
      ({ candidateListingId }) =>
        candidateListingId === right.candidateListingId,
    );
    if (foreignObservation === undefined) {
      throw new Error("Expected a foreign-candidate observation");
    }
    await expect(
      connection.db.insert(criterionAssessmentObservations).values({
        taskId: left.taskId,
        candidateRunId: left.candidateRunId,
        candidateListingId: left.candidateListingId,
        assessmentId: left.id,
        observationId: foreignObservation.id,
      }),
    ).rejects.toThrow();

    const [research] = await connection.db
      .select()
      .from(evidenceResearchRuns)
      .where(eq(evidenceResearchRuns.id, completed.run.id));
    if (research === undefined) throw new Error("Expected research run");
    await expect(
      connection.db.insert(criterionAssessments).values({
        id: randomUUID(),
        taskId: left.taskId,
        researchRunId: research.id,
        taskRevision: research.taskRevision + 1n,
        candidateRunId: left.candidateRunId,
        candidateListingId: left.candidateListingId,
        criterionId: left.criterionId,
        status: "uncertain",
        relation: "raw_invalid_revision",
        explanation: "This raw row must be structurally rejected.",
        method: "deterministic",
      }),
    ).rejects.toThrow();
  });

  it("keeps failed source work isolated and loads persisted records fail closed", async () => {
    const { session, run } = await seedSearch();
    const prepared = await prepareEvidenceResearch({
      db: connection.db,
      taskId: session.taskId,
      searchRunId: run.id,
      evidenceProvider: "fixture",
      modelProvider: "fixture",
      model: "fixture-product-understanding",
      promptVersion: "product-understanding-v1",
    });
    expect(prepared.run.status).toBe("running");
    const loaded = await loadEvidenceResearchRun({
      db: connection.db,
      taskId: session.taskId,
      researchRunId: prepared.run.id,
    });
    expect(loaded).toEqual(prepared);

    const [observation] = await connection.db
      .select()
      .from(productObservations)
      .where(eq(productObservations.taskId, session.taskId));
    if (observation === undefined)
      throw new Error("Expected direct observation");
    await connection.db
      .update(productObservations)
      .set({ value: { schemaVersion: 1, kind: "text" } })
      .where(eq(productObservations.id, observation.id));
    await expect(
      loadEvidenceResearchRun({
        db: connection.db,
        taskId: session.taskId,
        researchRunId: prepared.run.id,
      }),
    ).rejects.toMatchObject({ name: "PersistedDataCorruptionError" });
  });
});
