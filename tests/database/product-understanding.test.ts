import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
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
import { rejectCandidateListing } from "../../src/features/live-shopping/rejected-listings";
import {
  FakeEvidencePageFetcher,
  FakeEvidenceSearchProvider,
  FakeProductUnderstandingModel,
} from "../../src/features/product-understanding/fakes";
import type { ProductUnderstandingFailureDiagnostic } from "../../src/features/product-understanding/failure-taxonomy";
import type { ProductUnderstandingCallPolicy } from "../../src/features/product-understanding/model-port";
import {
  claimEvidenceResearch,
  EvidenceResearchAuthorityError,
  EvidenceResearchNotNeededError,
  loadCurrentDecisionSupport,
  loadCurrentDecisionSupportInTransaction,
  loadEvidenceResearchRun,
  prepareEvidenceResearch,
  recordCandidateUnderstanding,
  recordEvidenceSearchSuccess,
  releaseEvidenceResearchLease,
} from "../../src/features/product-understanding/persistence";
import { evidenceSearchResponseSchema } from "../../src/features/product-understanding/evidence-search";
import { buildDecisionSupport } from "../../src/features/product-understanding/decision-support";
import { executeOrResumeEvidenceResearch } from "../../src/features/product-understanding/research-orchestrator";
import {
  MAX_FIRST_PASS_MODEL_CALLS_PER_CANDIDATE,
  pairFirstPassUnderstandingAttempts,
  planFirstPassUnderstandingBatches,
} from "../../src/features/product-understanding/understanding-batches";
import { FakeShoppingProvider } from "../../src/features/retrieval-spike/fake-shopping-provider";
import { loadPersistedSearchRun } from "../../src/features/retrieval-spike/persistence/search-runs";
import { recordTaskInput } from "../../src/features/shopping-state/persistence/inputs-and-messages";
import { applyStatePatch } from "../../src/features/shopping-state/persistence/state-transitions";
import {
  criterionAssessmentObservations,
  criterionAssessments,
  candidateListings,
  evidenceAcquisitionAttempts,
  evidenceAttemptTargetCriteria,
  evidenceResearchRuns,
  evidenceSources,
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

function fourCriteriaContextModel(): ContextAcquisitionModel {
  const definitions = [
    ["criterion_a", "Criterion A", "First researchable fact"],
    ["battery_life", "Battery life", "Battery endurance"],
    ["criterion_c", "Criterion C", "Third researchable fact"],
    ["criterion_d", "Criterion D", "Fourth researchable fact"],
  ] as const;
  return {
    interpret: vi.fn(() =>
      Promise.resolve({
        status: "completed" as const,
        value: {
          providerSchemaVersion: 1 as const,
          outcome: "change" as const,
          operations: definitions.flatMap(([localRef, label, definition]) => [
            {
              op: "create_concept" as const,
              localRef,
              label,
              definition,
              valueFamily: "qualitative" as const,
              canonicalUnit: null,
            },
            {
              op: "add_criterion" as const,
              concept: { kind: "created" as const, localRef },
              target: {
                strength: "strong_preference" as const,
                targetSemantics: "qualitative" as const,
                semanticValue: {
                  schemaVersion: 1 as const,
                  kind: "qualitative_text" as const,
                  text: `Evidence for ${label}`,
                },
              },
            },
          ]),
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
}

function manyCriteriaContextModel(count: number): ContextAcquisitionModel {
  const operations = Array.from({ length: count }, (_, index) => {
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
  return {
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
}

function appearanceContextModel(): ContextAcquisitionModel {
  return {
    interpret: vi.fn(() =>
      Promise.resolve({
        status: "completed" as const,
        value: {
          providerSchemaVersion: 1 as const,
          outcome: "change" as const,
          operations: [
            {
              op: "create_concept" as const,
              localRef: "appearance",
              label: "Chair appearance",
              definition: "Avoid an overt gaming-chair appearance",
              valueFamily: "qualitative" as const,
              canonicalUnit: null,
            },
            {
              op: "add_criterion" as const,
              concept: { kind: "created" as const, localRef: "appearance" },
              target: {
                strength: "preference" as const,
                targetSemantics: "qualitative" as const,
                semanticValue: {
                  schemaVersion: 1 as const,
                  kind: "qualitative_text" as const,
                  text: "not huge or gamer-looking",
                },
              },
            },
          ],
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
}

const understandingMetadata = {
  provider: "fixture" as const,
  model: "fixture-product-understanding",
  promptVersion: "product-understanding-v1",
  providerSchemaVersion: 1,
  providerRequestId: "fixture-assessment-only",
  durationMs: 0,
  inputTokens: null,
  outputTokens: null,
};

function assessmentOnlyModel(status: "meets" | "uncertain" = "uncertain") {
  const calls: Parameters<FakeProductUnderstandingModel["understand"]>[0][] =
    [];
  const policies: ProductUnderstandingCallPolicy[] = [];
  return {
    calls,
    policies,
    understand: vi.fn(
      (
        input: Parameters<FakeProductUnderstandingModel["understand"]>[0],
        policy: ProductUnderstandingCallPolicy,
      ) => {
        calls.push(input);
        policies.push(policy);
        const source =
          input.sources.find(({ kind }) => kind === "fetched_page") ??
          input.sources.find(({ kind }) => kind !== "listing_image");
        const observations =
          status === "meets" && source !== undefined
            ? input.criteria.map((criterion) => ({
                localRef: `criterion_${criterion.ordinal}`,
                sourceOrdinal: source.ordinal,
                criterionOrdinal: criterion.ordinal,
                support: "supported" as const,
                observationKind: "source_assertion" as const,
                propertyLabel: criterion.label,
                claim: `The supplied source directly addresses ${criterion.label}.`,
                value: {
                  schemaVersion: 1 as const,
                  kind: "text" as const,
                  text: `Supported ${criterion.label}`,
                },
                derivation: "model_text" as const,
              }))
            : [];
        return Promise.resolve({
          status: "completed" as const,
          value: {
            providerSchemaVersion: 1 as const,
            observations,
            assessments: input.criteria.map(({ ordinal }) => ({
              criterionOrdinal: ordinal,
              status,
              relation:
                status === "meets"
                  ? "fixture_supported"
                  : "insufficient_evidence",
              explanation:
                status === "meets"
                  ? "The fixture marks this criterion supported."
                  : "The fixture leaves this criterion unresolved.",
              observationRefs:
                status === "meets" ? [`criterion_${ordinal}`] : [],
            })),
          },
          metadata: understandingMetadata,
        });
      },
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
      pageFetcher: new FakeEvidencePageFetcher(),
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

  it("keeps batched first-pass calls exact and reassessment broad while preserving a title trade-off", async () => {
    const { session, run } = await seedSearch(appearanceContextModel());
    await connection.db
      .update(candidateListings)
      .set({ title: "Mesh Gaming Chair with Footrest" })
      .where(eq(candidateListings.taskId, session.taskId));
    const firstPassModel = assessmentOnlyModel("uncertain");
    const dependencies = {
      db: connection.db,
      evidenceProvider: new FakeEvidenceSearchProvider(),
      model: firstPassModel,
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
    expect(firstPassModel.policies.length).toBeGreaterThan(0);
    expect(
      firstPassModel.policies.every(
        ({ requireCriterionBinding }) => requireCriterionBinding,
      ),
    ).toBe(true);
    expect(
      firstPassModel.calls.every(({ criteria }) => criteria.length <= 2),
    ).toBe(true);
    const titleAssessment = completed.assessments.find(
      ({ relation }) => relation === "direct_title_preference_mismatch",
    );
    if (titleAssessment === undefined) {
      throw new Error("Expected an evidence-backed title assessment");
    }
    const descriptor = completed.observations.find(({ id }) =>
      titleAssessment.observationIds.includes(id),
    );
    const support = await loadCurrentDecisionSupport({
      db: connection.db,
      taskId: session.taskId,
    });
    const appearanceItem = support.brief.items.find(
      ({ criterionId }) => criterionId === titleAssessment.criterionId,
    );
    if (appearanceItem === undefined) {
      throw new Error("Expected the authoritative appearance criterion");
    }
    expect(descriptor).toMatchObject({
      researchRunId: completed.run.id,
      conceptId: appearanceItem.conceptId,
      propertyLabel: "Listing title descriptor",
      claim: "The exact listing title uses “Gaming”.",
      value: { schemaVersion: 1, kind: "text", text: "Gaming" },
      derivation: "deterministic",
    });
    const decision = buildDecisionSupport({
      support,
      savedListingIds: new Set(),
    });
    expect(
      decision.topOptions.find(
        ({ listing }) => listing.id === titleAssessment.candidateListingId,
      ),
    ).toMatchObject({
      readiness: "trade_off",
      watchouts: [expect.stringContaining("stated preference")],
    });

    await saveCandidateListing({
      db: connection.db,
      taskId: session.taskId,
      candidateListingId: titleAssessment.candidateListingId,
    });
    const reassessmentModel = assessmentOnlyModel("uncertain");
    const reassessed = await executeOrResumeEvidenceResearch({
      dependencies: {
        ...dependencies,
        model: reassessmentModel,
      },
      taskId: session.taskId,
      searchRunId: run.id,
      mode: "reassessment",
      savedCandidateListingIds: [titleAssessment.candidateListingId],
    });
    expect(reassessed.run.id).not.toBe(completed.run.id);
    expect(reassessmentModel.policies).toEqual([
      { requireCriterionBinding: false },
    ]);
    const [storedDescriptor] = await connection.db
      .select({
        observationRunId: productObservations.researchRunId,
        sourceRunId: evidenceSources.researchRunId,
      })
      .from(productObservations)
      .innerJoin(
        evidenceSources,
        and(
          eq(evidenceSources.taskId, productObservations.taskId),
          eq(evidenceSources.id, productObservations.evidenceSourceId),
        ),
      )
      .where(
        and(
          eq(productObservations.taskId, session.taskId),
          eq(productObservations.id, descriptor!.id),
        ),
      );
    expect(storedDescriptor).toEqual({
      observationRunId: completed.run.id,
      sourceRunId: completed.run.id,
    });
  });

  it("reserves complete disjoint first-pass batches for thirteen authoritative criteria", async () => {
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
        ({ targetCriterionIds }) =>
          targetCriterionIds.length >= 1 && targetCriterionIds.length <= 2,
      ),
    ).toBe(true);
    const candidateIds = [
      ...new Set(
        modelAttempts.map(({ candidateListingId }) => candidateListingId),
      ),
    ];
    for (const candidateListingId of candidateIds) {
      const candidateAttempts = modelAttempts.filter(
        (attempt) => attempt.candidateListingId === candidateListingId,
      );
      const extraction = candidateAttempts.filter(
        ({ stage }) => stage === "observation_extraction",
      );
      const assessment = candidateAttempts.filter(
        ({ stage }) => stage === "criterion_assessment",
      );
      expect(extraction).toHaveLength(7);
      expect(assessment).toHaveLength(7);
      const extractionCriteria = extraction.flatMap(
        ({ targetCriterionIds }) => targetCriterionIds,
      );
      expect(new Set(extractionCriteria).size).toBe(13);
      expect(
        new Set(
          assessment.flatMap(({ targetCriterionIds }) => targetCriterionIds),
        ),
      ).toEqual(new Set(extractionCriteria));
    }
  });

  it("keeps successful first-pass batches while one malformed batch yields honest uncertainty and an idempotent partial run", async () => {
    const { session, run } = await seedSearch(manyCriteriaContextModel(8));
    const baseModel = new FakeProductUnderstandingModel();
    const calls: Array<{
      input: Parameters<FakeProductUnderstandingModel["understand"]>[0];
      policy: ProductUnderstandingCallPolicy;
    }> = [];
    let failNextBatch = true;
    const model = {
      understand: vi.fn(
        async (
          input: Parameters<FakeProductUnderstandingModel["understand"]>[0],
          policy: ProductUnderstandingCallPolicy,
        ) => {
          calls.push({ input, policy });
          if (failNextBatch) {
            failNextBatch = false;
            return {
              status: "malformed" as const,
              errorCode: "fixture_batch_contract_failure",
              metadata: understandingMetadata,
            };
          }
          return baseModel.understand(input);
        },
      ),
    };
    const pageFetcher = new FakeEvidencePageFetcher();
    const dependencies = {
      db: connection.db,
      evidenceProvider: new FakeEvidenceSearchProvider(),
      pageFetcher,
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

    expect(completed.run.status).toBe("partial");
    expect(pageFetcher.calls.length).toBeGreaterThan(0);
    expect(
      completed.attempts.filter(({ stage }) => stage === "page_fetch").length,
    ).toBe(pageFetcher.calls.length);
    expect(calls).toHaveLength(completed.run.selectedCandidateCount * 4);
    expect(
      calls.every(
        ({ input, policy }) =>
          policy.requireCriterionBinding && input.criteria.length <= 2,
      ),
    ).toBe(true);
    const callsByCandidate = new Map<string, typeof calls>();
    for (const call of calls) {
      const candidateCalls =
        callsByCandidate.get(call.input.candidate.title) ?? [];
      candidateCalls.push(call);
      callsByCandidate.set(call.input.candidate.title, candidateCalls);
      expect(call.input.criteria.map(({ ordinal }) => ordinal)).toEqual([0, 1]);
    }
    for (const candidateCalls of callsByCandidate.values()) {
      expect(candidateCalls.map(({ input }) => input.criteria.length)).toEqual([
        2, 2, 2, 2,
      ]);
    }
    const failedModelAttempts = completed.attempts.filter(
      ({ stage, status }) =>
        (stage === "observation_extraction" ||
          stage === "criterion_assessment") &&
        status === "failed",
    );
    expect(failedModelAttempts).toHaveLength(2);
    expect(
      failedModelAttempts.every(
        ({ failureCode }) => failureCode === "invalid_model_output",
      ),
    ).toBe(true);
    const failedCandidateListingId = failedModelAttempts[0]!.candidateListingId;
    const failedCriterionIds = new Set(
      failedModelAttempts[0]!.targetCriterionIds,
    );
    expect(failedCriterionIds.size).toBe(2);
    const failedAssessments = completed.assessments.filter(
      ({ candidateListingId, criterionId }) =>
        candidateListingId === failedCandidateListingId &&
        failedCriterionIds.has(criterionId),
    );
    expect(failedAssessments).toEqual([
      expect.objectContaining({
        generation: 1,
        status: "uncertain",
        observationIds: [],
      }),
      expect.objectContaining({
        generation: 1,
        status: "uncertain",
        observationIds: [],
      }),
    ]);
    expect(completed.assessments).toHaveLength(
      completed.run.selectedCandidateCount * 8,
    );
    const generationsBeforeRetry = completed.assessments.map(
      ({ id, generation }) => [id, generation] as const,
    );
    const callCountBeforeRetry = calls.length;

    const exactRetry = await executeOrResumeEvidenceResearch({
      dependencies,
      taskId: session.taskId,
      searchRunId: run.id,
    });
    expect(exactRetry.run.status).toBe("partial");
    expect(calls).toHaveLength(callCountBeforeRetry);
    expect(
      exactRetry.assessments.map(
        ({ id, generation }) => [id, generation] as const,
      ),
    ).toEqual(generationsBeforeRetry);
  });

  it("uses exact local ordinals for seven criteria and accepts zero-observation uncertainty", async () => {
    const { session, run } = await seedSearch(manyCriteriaContextModel(7));
    const model = assessmentOnlyModel("uncertain");
    const completed = await executeOrResumeEvidenceResearch({
      dependencies: {
        db: connection.db,
        evidenceProvider: new FakeEvidenceSearchProvider(),
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
    expect(model.calls).toHaveLength(completed.run.selectedCandidateCount * 4);
    const callsByCandidate = new Map<string, typeof model.calls>();
    for (const call of model.calls) {
      const calls = callsByCandidate.get(call.candidate.title) ?? [];
      calls.push(call);
      callsByCandidate.set(call.candidate.title, calls);
      expect(call.criteria.map(({ ordinal }) => ordinal)).toEqual(
        call.criteria.map((_, ordinal) => ordinal),
      );
    }
    for (const calls of callsByCandidate.values()) {
      expect(calls.map(({ criteria }) => criteria.length)).toEqual([
        2, 2, 2, 1,
      ]);
    }
    expect(completed.observations).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ derivation: "model_text" }),
      ]),
    );
    expect(completed.assessments).toHaveLength(
      completed.run.selectedCandidateCount * 7,
    );
    expect(
      completed.assessments.every(
        ({ status, observationIds }) =>
          status === "uncertain" && observationIds.length === 0,
      ),
    ).toBe(true);
  });

  it("keeps an eight-criterion reassessment as one broad unbound call with normal generation supersession", async () => {
    const { session, run } = await seedSearch(manyCriteriaContextModel(8));
    const first = await executeOrResumeEvidenceResearch({
      dependencies: {
        db: connection.db,
        evidenceProvider: new FakeEvidenceSearchProvider(),
        model: assessmentOnlyModel("uncertain"),
        modelIdentity: {
          provider: "fixture",
          model: "fixture-product-understanding",
          promptVersion: "product-understanding-v1",
        },
      },
      taskId: session.taskId,
      searchRunId: run.id,
    });
    const candidateListingId = first.assessments[0]?.candidateListingId;
    if (candidateListingId === undefined) {
      throw new Error("Expected a first-pass candidate");
    }
    await saveCandidateListing({
      db: connection.db,
      taskId: session.taskId,
      candidateListingId,
    });
    const model = assessmentOnlyModel("uncertain");
    const reassessed = await executeOrResumeEvidenceResearch({
      dependencies: {
        db: connection.db,
        evidenceProvider: new FakeEvidenceSearchProvider(),
        model,
        modelIdentity: {
          provider: "fixture",
          model: "fixture-product-understanding",
          promptVersion: "product-understanding-v1",
        },
      },
      taskId: session.taskId,
      searchRunId: run.id,
      mode: "reassessment",
      savedCandidateListingIds: [candidateListingId],
    });
    expect(model.calls).toHaveLength(1);
    expect(model.policies).toEqual([{ requireCriterionBinding: false }]);
    expect(model.calls[0]?.criteria.map(({ ordinal }) => ordinal)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(reassessed.assessments).toHaveLength(8);
    expect(
      reassessed.assessments.every(({ generation }) => generation === 2),
    ).toBe(true);
  });

  it.each(["missing_pair", "substitute_partition", "overlap"] as const)(
    "rejects raw %s batch corruption before any provider call",
    async (corruption) => {
      const { session, run } = await seedSearch(manyCriteriaContextModel(8));
      const prepared = await prepareEvidenceResearch({
        db: connection.db,
        taskId: session.taskId,
        searchRunId: run.id,
        evidenceProvider: "fixture",
        modelProvider: "fixture",
        model: "fixture-product-understanding",
        promptVersion: "product-understanding-v1",
      });
      const candidateListingId = prepared.attempts.find(
        ({ stage }) => stage === "observation_extraction",
      )?.candidateListingId;
      if (candidateListingId === undefined) {
        throw new Error("Expected a first-pass candidate reservation");
      }
      const pairs = pairFirstPassUnderstandingAttempts(
        prepared.attempts.filter(
          (attempt) => attempt.candidateListingId === candidateListingId,
        ),
      );
      const replacePair = async (options: {
        pair: (typeof pairs)[number];
        criterionIds: readonly string[];
        extractionPlanKey: string;
        assessmentPlanKey: string;
      }) => {
        const attemptIds = [
          options.pair.extraction.id,
          options.pair.assessment.id,
        ];
        await connection.db
          .delete(evidenceAttemptTargetCriteria)
          .where(inArray(evidenceAttemptTargetCriteria.attemptId, attemptIds));
        await connection.db
          .update(evidenceAcquisitionAttempts)
          .set({ planKey: options.extractionPlanKey })
          .where(eq(evidenceAcquisitionAttempts.id, attemptIds[0]!));
        await connection.db
          .update(evidenceAcquisitionAttempts)
          .set({ planKey: options.assessmentPlanKey })
          .where(eq(evidenceAcquisitionAttempts.id, attemptIds[1]!));
        await connection.db.insert(evidenceAttemptTargetCriteria).values(
          attemptIds.flatMap((attemptId) =>
            options.criterionIds.map((criterionId) => ({
              taskId: options.pair.extraction.taskId,
              researchRunId: options.pair.extraction.researchRunId,
              candidateRunId: options.pair.extraction.candidateRunId,
              candidateListingId,
              attemptId,
              criterionId,
            })),
          ),
        );
      };

      if (corruption === "missing_pair") {
        const removed = pairs.at(-1)!;
        const attemptIds = [removed.extraction.id, removed.assessment.id];
        await connection.db
          .delete(evidenceAttemptTargetCriteria)
          .where(inArray(evidenceAttemptTargetCriteria.attemptId, attemptIds));
        await connection.db
          .delete(evidenceAcquisitionAttempts)
          .where(inArray(evidenceAcquisitionAttempts.id, attemptIds));
      } else if (corruption === "substitute_partition") {
        const authoritativeIds = pairs.flatMap(
          ({ extraction }) => extraction.targetCriterionIds,
        );
        const substitutedIds = [...authoritativeIds];
        [substitutedIds[1], substitutedIds[2]] = [
          substitutedIds[2]!,
          substitutedIds[1]!,
        ];
        const substitutedPlans =
          planFirstPassUnderstandingBatches(substitutedIds);
        for (const ordinal of [0, 1]) {
          await replacePair({
            pair: pairs[ordinal]!,
            criterionIds: substitutedPlans[ordinal]!.criterionIds,
            extractionPlanKey: substitutedPlans[ordinal]!.extractionPlanKey,
            assessmentPlanKey: substitutedPlans[ordinal]!.assessmentPlanKey,
          });
        }
      } else {
        const first = pairs[0]!;
        const second = pairs[1]!;
        const firstHash = first.extraction.planKey.split(":").at(-1)!;
        const withFirstHash = (planKey: string) =>
          `${planKey.slice(0, planKey.lastIndexOf(":") + 1)}${firstHash}`;
        await replacePair({
          pair: second,
          criterionIds: first.extraction.targetCriterionIds,
          extractionPlanKey: withFirstHash(second.extraction.planKey),
          assessmentPlanKey: withFirstHash(second.assessment.planKey),
        });
      }

      const evidenceProvider = new FakeEvidenceSearchProvider();
      const model = assessmentOnlyModel();
      await expect(
        executeOrResumeEvidenceResearch({
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
        }),
      ).rejects.toThrow();
      expect(evidenceProvider.calls).toHaveLength(0);
      expect(model.calls).toHaveLength(0);
    },
  );

  it("rejects a terminal historical run whose self-consistent batch reservation omits authoritative criteria", async () => {
    const { session, run } = await seedSearch(manyCriteriaContextModel(8));
    const completed = await executeOrResumeEvidenceResearch({
      dependencies: {
        db: connection.db,
        evidenceProvider: new FakeEvidenceSearchProvider(),
        model: assessmentOnlyModel("uncertain"),
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
    const candidateListingId = completed.attempts.find(
      ({ stage }) => stage === "observation_extraction",
    )?.candidateListingId;
    if (candidateListingId === undefined) {
      throw new Error("Expected a completed first-pass candidate");
    }
    const pairs = pairFirstPassUnderstandingAttempts(
      completed.attempts.filter(
        (attempt) => attempt.candidateListingId === candidateListingId,
      ),
    );
    expect(pairs).toHaveLength(4);
    const omitted = pairs.at(-1)!;
    const omittedAttemptIds = [omitted.extraction.id, omitted.assessment.id];
    await connection.db
      .delete(evidenceAttemptTargetCriteria)
      .where(
        inArray(evidenceAttemptTargetCriteria.attemptId, omittedAttemptIds),
      );
    await connection.db
      .delete(evidenceAcquisitionAttempts)
      .where(inArray(evidenceAcquisitionAttempts.id, omittedAttemptIds));
    const retainedCriterionIds = pairs
      .slice(0, -1)
      .flatMap(({ extraction }) => extraction.targetCriterionIds);
    const replacementPlans =
      planFirstPassUnderstandingBatches(retainedCriterionIds);
    for (const [index, pair] of pairs.slice(0, -1).entries()) {
      await connection.db
        .update(evidenceAcquisitionAttempts)
        .set({ planKey: replacementPlans[index]!.extractionPlanKey })
        .where(eq(evidenceAcquisitionAttempts.id, pair.extraction.id));
      await connection.db
        .update(evidenceAcquisitionAttempts)
        .set({ planKey: replacementPlans[index]!.assessmentPlanKey })
        .where(eq(evidenceAcquisitionAttempts.id, pair.assessment.id));
    }

    await expect(
      loadEvidenceResearchRun({
        db: connection.db,
        taskId: session.taskId,
        researchRunId: completed.run.id,
      }),
    ).rejects.toMatchObject({ name: "PersistedDataCorruptionError" });
  });

  it("rejects a terminal historical run whose coherent batch pair mutates the reserved model identity", async () => {
    const { session, run } = await seedSearch(manyCriteriaContextModel(8));
    const model = assessmentOnlyModel("uncertain");
    const completed = await executeOrResumeEvidenceResearch({
      dependencies: {
        db: connection.db,
        evidenceProvider: new FakeEvidenceSearchProvider(),
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
    const providerCallCount = model.calls.length;
    const candidateListingId = completed.attempts.find(
      ({ stage }) => stage === "observation_extraction",
    )?.candidateListingId;
    if (candidateListingId === undefined) {
      throw new Error("Expected a completed first-pass candidate");
    }
    const pairs = pairFirstPassUnderstandingAttempts(
      completed.attempts.filter(
        (attempt) => attempt.candidateListingId === candidateListingId,
      ),
    );
    const mutatedPair = pairs[1];
    if (mutatedPair === undefined) {
      throw new Error("Expected a second completed batch");
    }
    await connection.db
      .update(evidenceAcquisitionAttempts)
      .set({
        model: "coherently-mutated-model",
        promptVersion: "coherently-mutated-prompt-v1",
      })
      .where(
        inArray(evidenceAcquisitionAttempts.id, [
          mutatedPair.extraction.id,
          mutatedPair.assessment.id,
        ]),
      );

    await expect(
      loadEvidenceResearchRun({
        db: connection.db,
        taskId: session.taskId,
        researchRunId: completed.run.id,
      }),
    ).rejects.toMatchObject({ name: "PersistedDataCorruptionError" });
    expect(model.calls).toHaveLength(providerCallCount);
  });

  it("rejects a terminal historical run with an oversized encoded batch total before provider work", async () => {
    const { session, run } = await seedSearch(manyCriteriaContextModel(8));
    const model = assessmentOnlyModel("uncertain");
    const completed = await executeOrResumeEvidenceResearch({
      dependencies: {
        db: connection.db,
        evidenceProvider: new FakeEvidenceSearchProvider(),
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
    const providerCallCount = model.calls.length;
    const candidateListingId = completed.attempts.find(
      ({ stage }) => stage === "observation_extraction",
    )?.candidateListingId;
    if (candidateListingId === undefined) {
      throw new Error("Expected a completed first-pass candidate");
    }
    const pair = pairFirstPassUnderstandingAttempts(
      completed.attempts.filter(
        (attempt) => attempt.candidateListingId === candidateListingId,
      ),
    )[0];
    if (pair === undefined) {
      throw new Error("Expected a completed first-pass batch");
    }
    const oversizedTotal = MAX_FIRST_PASS_MODEL_CALLS_PER_CANDIDATE + 1;
    for (const attempt of [pair.extraction, pair.assessment]) {
      await connection.db
        .update(evidenceAcquisitionAttempts)
        .set({
          planKey: attempt.planKey.replace(
            /-of-\d+:/,
            `-of-${oversizedTotal}:`,
          ),
        })
        .where(eq(evidenceAcquisitionAttempts.id, attempt.id));
    }

    await expect(
      loadEvidenceResearchRun({
        db: connection.db,
        taskId: session.taskId,
        researchRunId: completed.run.id,
      }),
    ).rejects.toMatchObject({ name: "PersistedDataCorruptionError" });
    expect(model.calls).toHaveLength(providerCallCount);
  });

  it("resumes only unfinished first-pass batches while preserving a failed terminal pair under concurrent retry", async () => {
    const { session, run } = await seedSearch(manyCriteriaContextModel(8));
    const prepared = await prepareEvidenceResearch({
      db: connection.db,
      taskId: session.taskId,
      searchRunId: run.id,
      evidenceProvider: "fixture",
      modelProvider: "fixture",
      model: "fixture-product-understanding",
      promptVersion: "product-understanding-v1",
    });
    const candidateListingId = prepared.attempts.find(
      ({ stage }) => stage === "observation_extraction",
    )?.candidateListingId;
    if (candidateListingId === undefined) {
      throw new Error("Expected a first-pass candidate reservation");
    }
    const firstPair = pairFirstPassUnderstandingAttempts(
      prepared.attempts.filter(
        (attempt) => attempt.candidateListingId === candidateListingId,
      ),
    )[0];
    if (firstPair === undefined) {
      throw new Error("Expected a first-pass batch pair");
    }
    const leaseToken = await claimEvidenceResearch({
      db: connection.db,
      taskId: session.taskId,
      researchRunId: prepared.run.id,
    });
    if (leaseToken === null) throw new Error("Expected research lease");
    const precompleted = await recordCandidateUnderstanding({
      db: connection.db,
      taskId: session.taskId,
      researchRunId: prepared.run.id,
      candidateListingId,
      extractionAttemptId: firstPair.extraction.id,
      assessmentAttemptId: firstPair.assessment.id,
      leaseToken,
      sourceIdsInOrder: [],
      result: null,
      metadata: null,
      failureCode: "model_failed",
      startedAt: new Date("2026-08-30T20:00:00.000Z"),
      finishedAt: new Date("2026-08-30T20:00:01.000Z"),
    });
    expect(precompleted).toBe(true);
    await releaseEvidenceResearchLease({
      db: connection.db,
      taskId: session.taskId,
      researchRunId: prepared.run.id,
      leaseToken,
    });

    const evidenceProvider = new FakeEvidenceSearchProvider();
    const model = assessmentOnlyModel();
    const dependencies = {
      db: connection.db,
      evidenceProvider,
      pageFetcher: new FakeEvidencePageFetcher(),
      model,
      modelIdentity: {
        provider: "fixture" as const,
        model: "fixture-product-understanding",
        promptVersion: "product-understanding-v1",
      },
    };
    await Promise.all([
      executeOrResumeEvidenceResearch({
        dependencies,
        taskId: session.taskId,
        searchRunId: run.id,
      }),
      executeOrResumeEvidenceResearch({
        dependencies,
        taskId: session.taskId,
        searchRunId: run.id,
      }),
    ]);
    const completed = await loadEvidenceResearchRun({
      db: connection.db,
      taskId: session.taskId,
      researchRunId: prepared.run.id,
    });
    if (completed === null) throw new Error("Expected completed research");
    expect(completed.run.status).toBe("partial");
    const totalReservedPairs =
      prepared.run.selectedCandidateCount * Math.ceil(8 / 2);
    expect(model.calls).toHaveLength(totalReservedPairs - 1);
    expect(evidenceProvider.calls).toHaveLength(
      prepared.run.selectedCandidateCount,
    );
    expect(completed.assessments).toHaveLength(
      prepared.run.selectedCandidateCount * 8,
    );
    expect(
      completed.assessments.every(({ generation }) => generation === 1),
    ).toBe(true);
    expect(
      completed.assessments.filter(
        ({ candidateListingId: id, criterionId }) =>
          id === candidateListingId &&
          firstPair.extraction.targetCriterionIds.includes(criterionId),
      ),
    ).toEqual([
      expect.objectContaining({
        generation: 1,
        status: "uncertain",
        observationIds: [],
      }),
      expect.objectContaining({
        generation: 1,
        status: "uncertain",
        observationIds: [],
      }),
    ]);
    expect(
      completed.attempts.filter(({ id }) =>
        [firstPair.extraction.id, firstPair.assessment.id].includes(id),
      ),
    ).toEqual([
      expect.objectContaining({
        status: "failed",
        failureCode: "model_failed",
      }),
      expect.objectContaining({
        status: "failed",
        failureCode: "model_failed",
      }),
    ]);
  });

  it("requires criterion binding while scoping targeted supersession to one exact criterion", async () => {
    const { session, run } = await seedSearch(fourCriteriaContextModel());
    const initialModel = assessmentOnlyModel();
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
    expect(initialModel.policies.length).toBeGreaterThan(0);
    expect(
      initialModel.policies.every(
        ({ requireCriterionBinding }) => requireCriterionBinding,
      ),
    ).toBe(true);
    const candidateListingId = first.assessments[0]?.candidateListingId;
    if (candidateListingId === undefined) {
      throw new Error("Expected a first-pass candidate");
    }
    const beforeSupport = await loadCurrentDecisionSupport({
      db: connection.db,
      taskId: session.taskId,
    });
    const target = beforeSupport.brief.items.find(
      ({ conceptLabel }) => conceptLabel === "Battery life",
    );
    if (target === undefined) throw new Error("Expected Battery life");
    const before = await connection.db
      .select()
      .from(criterionAssessments)
      .where(
        and(
          eq(criterionAssessments.taskId, session.taskId),
          eq(criterionAssessments.candidateListingId, candidateListingId),
          isNull(criterionAssessments.supersededAt),
        ),
      );
    expect(before).toHaveLength(4);

    const targetedModel = assessmentOnlyModel("meets");
    const targeted = await executeOrResumeEvidenceResearch({
      dependencies: {
        ...baseDependencies,
        evidenceProvider: new FakeEvidenceSearchProvider(),
        model: targetedModel,
      },
      taskId: session.taskId,
      searchRunId: run.id,
      mode: "targeted",
      targetCandidateListingId: candidateListingId,
      targetCriterionId: target.criterionId,
    });

    expect(targetedModel.calls).toHaveLength(1);
    expect(targetedModel.policies).toEqual([{ requireCriterionBinding: true }]);
    expect(targetedModel.calls[0]?.criteria).toEqual([
      expect.objectContaining({ ordinal: 0, label: "Battery life" }),
    ]);
    expect(
      targeted.attempts.every(
        ({ targetCriterionIds }) =>
          targetCriterionIds.length === 1 &&
          targetCriterionIds[0] === target.criterionId,
      ),
    ).toBe(true);
    expect(targeted.assessments).toEqual([
      expect.objectContaining({
        criterionId: target.criterionId,
        generation: 2,
      }),
    ]);

    const allAfter = await connection.db
      .select()
      .from(criterionAssessments)
      .where(
        and(
          eq(criterionAssessments.taskId, session.taskId),
          eq(criterionAssessments.candidateListingId, candidateListingId),
        ),
      );
    const beforeByCriterion = new Map(
      before.map((assessment) => [assessment.criterionId, assessment]),
    );
    for (const item of beforeSupport.brief.items) {
      const previous = beforeByCriterion.get(item.criterionId);
      if (previous === undefined) throw new Error("Expected prior assessment");
      const lineage = allAfter
        .filter(({ criterionId }) => criterionId === item.criterionId)
        .sort((left, right) => left.generation - right.generation);
      if (item.criterionId === target.criterionId) {
        expect(lineage).toHaveLength(2);
        expect(lineage[0]).toMatchObject({
          id: previous.id,
          generation: 1,
          supersededAt: expect.any(Date),
        });
        expect(lineage[1]).toMatchObject({
          generation: 2,
          supersedesAssessmentId: previous.id,
          supersededAt: null,
        });
      } else {
        expect(lineage).toEqual([previous]);
      }
    }
  });

  it("requires criterion binding for every automatic deepening model call", async () => {
    const { session, run } = await seedSearch(fourCriteriaContextModel());
    const firstPassModel = assessmentOnlyModel();
    const baseDependencies = {
      db: connection.db,
      evidenceProvider: new FakeEvidenceSearchProvider(),
      model: firstPassModel,
      modelIdentity: {
        provider: "fixture" as const,
        model: "fixture-product-understanding",
        promptVersion: "product-understanding-v1",
      },
    };
    await executeOrResumeEvidenceResearch({
      dependencies: baseDependencies,
      taskId: session.taskId,
      searchRunId: run.id,
      mode: "first_pass",
    });

    const deepeningModel = assessmentOnlyModel("meets");
    const deepening = await executeOrResumeEvidenceResearch({
      dependencies: {
        ...baseDependencies,
        evidenceProvider: new FakeEvidenceSearchProvider(),
        model: deepeningModel,
      },
      taskId: session.taskId,
      searchRunId: run.id,
      mode: "deepening",
    });

    expect(deepening.run.phase).toBe("deepening");
    expect(deepeningModel.calls.length).toBeGreaterThan(0);
    expect(deepeningModel.policies).toHaveLength(deepeningModel.calls.length);
    expect(
      deepeningModel.policies.every(
        ({ requireCriterionBinding }) => requireCriterionBinding,
      ),
    ).toBe(true);
  });

  it("fails malformed non-target model output closed without changing any current assessment", async () => {
    const { session, run } = await seedSearch(fourCriteriaContextModel());
    const baseDependencies = {
      db: connection.db,
      evidenceProvider: new FakeEvidenceSearchProvider(),
      model: assessmentOnlyModel(),
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
      throw new Error("Expected a first-pass candidate");
    }
    const support = await loadCurrentDecisionSupport({
      db: connection.db,
      taskId: session.taskId,
    });
    const target = support.brief.items.find(
      ({ conceptLabel }) => conceptLabel === "Battery life",
    );
    const nonTargetOrdinal = support.brief.items.findIndex(
      ({ criterionId }, ordinal) =>
        criterionId !== target?.criterionId && ordinal > 0,
    );
    if (target === undefined || nonTargetOrdinal < 0) {
      throw new Error("Expected target and non-target criteria");
    }
    const before = support.assessments
      .filter(
        (assessment) => assessment.candidateListingId === candidateListingId,
      )
      .map(({ id, criterionId, generation }) => ({
        id,
        criterionId,
        generation,
      }))
      .sort((left, right) => left.criterionId.localeCompare(right.criterionId));
    const calls: unknown[] = [];
    const diagnostics: ProductUnderstandingFailureDiagnostic[] = [];
    const malformedModel = {
      understand: vi.fn(
        (input: Parameters<FakeProductUnderstandingModel["understand"]>[0]) => {
          calls.push(input);
          return Promise.resolve({
            status: "completed" as const,
            value: {
              providerSchemaVersion: 1 as const,
              observations: [],
              assessments: [
                {
                  criterionOrdinal: nonTargetOrdinal,
                  status: "uncertain" as const,
                  relation: "attempted_non_target",
                  explanation:
                    "This global ordinal is outside the one-item target subset.",
                  observationRefs: [],
                },
              ],
            },
            metadata: understandingMetadata,
          });
        },
      ),
    };
    const deep = await executeOrResumeEvidenceResearch({
      dependencies: {
        ...baseDependencies,
        evidenceProvider: new FakeEvidenceSearchProvider(),
        model: malformedModel,
        reportProductUnderstandingFailure: (diagnostic) =>
          diagnostics.push(diagnostic),
      },
      taskId: session.taskId,
      searchRunId: run.id,
      mode: "targeted",
      targetCandidateListingId: candidateListingId,
      targetCriterionId: target.criterionId,
    });
    expect(calls).toEqual([
      expect.objectContaining({
        criteria: [
          expect.objectContaining({ ordinal: 0, label: "Battery life" }),
        ],
      }),
    ]);
    expect(deep.run.status).toBe("partial");
    expect(diagnostics).toEqual([
      expect.objectContaining({
        failureCode: "invalid_model_output",
        category: "application_scope_contract",
        rule: "assessment_criterion_ordinal_out_of_scope",
        candidateListingId,
        researchPhase: "deepening",
        requireCriterionBinding: true,
        criterionCount: 1,
        offendingCriterionOrdinal: nonTargetOrdinal,
        providerRequestId: understandingMetadata.providerRequestId,
      }),
    ]);
    const modelAttempts = await connection.db
      .select()
      .from(evidenceAcquisitionAttempts)
      .where(
        and(
          eq(evidenceAcquisitionAttempts.taskId, session.taskId),
          eq(evidenceAcquisitionAttempts.researchRunId, deep.run.id),
        ),
      );
    expect(
      modelAttempts
        .filter(({ stage }) => stage !== "organic_search")
        .map(({ status, failureCode }) => ({ status, failureCode })),
    ).toEqual([
      { status: "failed", failureCode: "invalid_model_output" },
      { status: "failed", failureCode: "invalid_model_output" },
    ]);
    const after = (
      await loadCurrentDecisionSupport({
        db: connection.db,
        taskId: session.taskId,
      })
    ).assessments
      .filter(
        (assessment) => assessment.candidateListingId === candidateListingId,
      )
      .map(({ id, criterionId, generation }) => ({
        id,
        criterionId,
        generation,
      }))
      .sort((left, right) => left.criterionId.localeCompare(right.criterionId));
    expect(after).toEqual(before);
  });

  it("fails a raw deep run whose search and model target scopes diverge before paid work", async () => {
    const { session, run } = await seedSearch(fourCriteriaContextModel());
    const first = await executeOrResumeEvidenceResearch({
      dependencies: {
        db: connection.db,
        evidenceProvider: new FakeEvidenceSearchProvider(),
        model: assessmentOnlyModel(),
        modelIdentity: {
          provider: "fixture",
          model: "fixture-product-understanding",
          promptVersion: "product-understanding-v1",
        },
      },
      taskId: session.taskId,
      searchRunId: run.id,
      mode: "first_pass",
    });
    const candidateListingId = first.assessments[0]?.candidateListingId;
    if (candidateListingId === undefined) {
      throw new Error("Expected a first-pass candidate");
    }
    const support = await loadCurrentDecisionSupport({
      db: connection.db,
      taskId: session.taskId,
    });
    const target = support.brief.items.find(
      ({ conceptLabel }) => conceptLabel === "Battery life",
    );
    const nonTarget = support.brief.items.find(
      ({ criterionId }) => criterionId !== target?.criterionId,
    );
    if (target === undefined || nonTarget === undefined) {
      throw new Error("Expected distinct target and non-target criteria");
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
      targetCriterionId: target.criterionId,
    });
    const modelAttempts = prepared.attempts.filter(
      ({ stage }) =>
        stage === "observation_extraction" || stage === "criterion_assessment",
    );
    expect(modelAttempts).toHaveLength(2);
    for (const attempt of modelAttempts) {
      await connection.db
        .update(evidenceAttemptTargetCriteria)
        .set({ criterionId: nonTarget.criterionId })
        .where(
          and(
            eq(evidenceAttemptTargetCriteria.taskId, session.taskId),
            eq(evidenceAttemptTargetCriteria.attemptId, attempt.id),
          ),
        );
    }

    await expect(
      loadEvidenceResearchRun({
        db: connection.db,
        taskId: session.taskId,
        researchRunId: prepared.run.id,
      }),
    ).rejects.toMatchObject({ name: "PersistedDataCorruptionError" });

    const evidenceProvider = new FakeEvidenceSearchProvider();
    const model = assessmentOnlyModel("meets");
    await expect(
      executeOrResumeEvidenceResearch({
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
        mode: "targeted",
        targetCandidateListingId: candidateListingId,
        targetCriterionId: target.criterionId,
      }),
    ).rejects.toMatchObject({ name: "PersistedDataCorruptionError" });
    expect(evidenceProvider.calls).toHaveLength(0);
    expect(model.calls).toHaveLength(0);
  });

  it("validates exact targeted candidate and criterion authority before paid work", async () => {
    const { session, run } = await seedSearch(fourCriteriaContextModel());
    const evidenceProvider = new FakeEvidenceSearchProvider();
    const model = assessmentOnlyModel("meets");
    const dependencies = {
      db: connection.db,
      evidenceProvider,
      pageFetcher: new FakeEvidencePageFetcher(),
      model,
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
      mode: "first_pass",
    });
    const candidateListingId = first.assessments[0]?.candidateListingId;
    if (candidateListingId === undefined) {
      throw new Error("Expected a first-pass candidate");
    }
    const support = await loadCurrentDecisionSupport({
      db: connection.db,
      taskId: session.taskId,
    });
    const battery = support.brief.items.find(
      ({ conceptLabel }) => conceptLabel === "Battery life",
    );
    if (battery === undefined) throw new Error("Expected Battery life");
    const evidenceCalls = evidenceProvider.calls.length;
    const modelCalls = model.calls.length;

    await expect(
      prepareEvidenceResearch({
        db: connection.db,
        taskId: session.taskId,
        searchRunId: run.id,
        evidenceProvider: "fixture",
        modelProvider: "fixture",
        model: "fixture-product-understanding",
        promptVersion: "product-understanding-v1",
        mode: "targeted",
        targetCandidateListingId: candidateListingId,
        targetCriterionId: battery.criterionId,
      }),
    ).rejects.toBeInstanceOf(EvidenceResearchNotNeededError);
    await expect(
      prepareEvidenceResearch({
        db: connection.db,
        taskId: session.taskId,
        searchRunId: run.id,
        evidenceProvider: "fixture",
        modelProvider: "fixture",
        model: "fixture-product-understanding",
        promptVersion: "product-understanding-v1",
        mode: "targeted",
        targetCandidateListingId: candidateListingId,
        targetCriterionId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(EvidenceResearchAuthorityError);
    await expect(
      prepareEvidenceResearch({
        db: connection.db,
        taskId: session.taskId,
        searchRunId: run.id,
        evidenceProvider: "fixture",
        modelProvider: "fixture",
        model: "fixture-product-understanding",
        promptVersion: "product-understanding-v1",
        mode: "targeted",
        targetCandidateListingId: randomUUID(),
        targetCriterionId: battery.criterionId,
      }),
    ).rejects.toBeInstanceOf(EvidenceResearchAuthorityError);

    const revisionInput = await recordTaskInput({
      db: connection.db,
      taskId: session.taskId,
      clientActionId: `remove-target:${randomUUID()}`,
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 1n,
        kind: "message",
        body: "Battery life no longer matters",
      },
    });
    await applyStatePatch(connection.db, {
      applicationSchemaVersion: 1,
      applicationKind: "patch",
      taskId: session.taskId,
      expectedRevision: 1n,
      source: { kind: "user_explicit", inputId: revisionInput.input.id },
      patch: {
        schemaVersion: 1,
        outcome: "change",
        operations: [{ op: "remove", targetCriterionId: battery.criterionId }],
      },
    });
    await expect(
      prepareEvidenceResearch({
        db: connection.db,
        taskId: session.taskId,
        searchRunId: run.id,
        evidenceProvider: "fixture",
        modelProvider: "fixture",
        model: "fixture-product-understanding",
        promptVersion: "product-understanding-v1",
        mode: "first_pass",
      }),
    ).rejects.toBeInstanceOf(EvidenceResearchAuthorityError);
    await expect(
      prepareEvidenceResearch({
        db: connection.db,
        taskId: session.taskId,
        searchRunId: run.id,
        evidenceProvider: "fixture",
        modelProvider: "fixture",
        model: "fixture-product-understanding",
        promptVersion: "product-understanding-v1",
        mode: "targeted",
        targetCandidateListingId: candidateListingId,
        targetCriterionId: battery.criterionId,
      }),
    ).rejects.toBeInstanceOf(EvidenceResearchAuthorityError);

    const current = await loadCurrentDecisionSupport({
      db: connection.db,
      taskId: session.taskId,
    });
    const currentCriterion = current.brief.items[0];
    if (currentCriterion === undefined) {
      throw new Error("Expected a remaining current criterion");
    }
    await expect(
      prepareEvidenceResearch({
        db: connection.db,
        taskId: session.taskId,
        searchRunId: run.id,
        evidenceProvider: "fixture",
        modelProvider: "fixture",
        model: "fixture-product-understanding",
        promptVersion: "product-understanding-v1",
        mode: "targeted",
        targetCandidateListingId: candidateListingId,
        targetCriterionId: currentCriterion.criterionId,
      }),
    ).rejects.toBeInstanceOf(EvidenceResearchAuthorityError);
    await rejectCandidateListing({
      db: connection.db,
      taskId: session.taskId,
      candidateListingId,
    });
    await expect(
      prepareEvidenceResearch({
        db: connection.db,
        taskId: session.taskId,
        searchRunId: run.id,
        evidenceProvider: "fixture",
        modelProvider: "fixture",
        model: "fixture-product-understanding",
        promptVersion: "product-understanding-v1",
        mode: "targeted",
        targetCandidateListingId: candidateListingId,
        targetCriterionId: currentCriterion.criterionId,
      }),
    ).rejects.toBeInstanceOf(EvidenceResearchAuthorityError);
    expect(evidenceProvider.calls).toHaveLength(evidenceCalls);
    expect(model.calls).toHaveLength(modelCalls);
  });

  it("reserves active candidate-criterion coverage across concurrent subset policies while leaving distinct criteria available", async () => {
    const { session, run } = await seedSearch(fourCriteriaContextModel());
    const dependencies = {
      db: connection.db,
      evidenceProvider: new FakeEvidenceSearchProvider(),
      model: assessmentOnlyModel(),
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
      mode: "first_pass",
    });
    const candidateListingId = first.assessments[0]?.candidateListingId;
    if (candidateListingId === undefined) {
      throw new Error("Expected a first-pass candidate");
    }
    const support = await loadCurrentDecisionSupport({
      db: connection.db,
      taskId: session.taskId,
    });
    const requestedCriterion = support.brief.items[0];
    if (requestedCriterion === undefined) {
      throw new Error("Expected an unresolved criterion");
    }
    const contender = createTestDatabaseConnection("target-reservation-racer");
    const prepare = (db: typeof connection.db) => ({
      db,
      taskId: session.taskId,
      searchRunId: run.id,
      evidenceProvider: "fixture" as const,
      modelProvider: "fixture" as const,
      model: "fixture-product-understanding",
      promptVersion: "product-understanding-v1",
    });
    try {
      const [automatic, exact] = await Promise.allSettled([
        prepareEvidenceResearch({
          ...prepare(connection.db),
          mode: "deepening",
        }),
        prepareEvidenceResearch({
          ...prepare(contender.db),
          mode: "targeted",
          targetCandidateListingId: candidateListingId,
          targetCriterionId: requestedCriterion.criterionId,
        }),
      ]);
      expect(automatic.status).toBe("fulfilled");
      if (automatic.status !== "fulfilled") throw automatic.reason;
      expect(automatic.value.run.selectedCandidateCount).toBeGreaterThan(1);
      if (exact.status === "rejected") {
        expect(exact.reason).toBeInstanceOf(EvidenceResearchNotNeededError);
      }

      const active = await loadCurrentDecisionSupport({
        db: connection.db,
        taskId: session.taskId,
      });
      const occurrenceCount = new Map<string, number>();
      for (const coverage of active.deepResearchCoverage) {
        expect(coverage.runStatus).toBe("running");
        for (const criterionId of coverage.criterionIds) {
          const identity = `${coverage.candidateListingId}:${criterionId}`;
          occurrenceCount.set(
            identity,
            (occurrenceCount.get(identity) ?? 0) + 1,
          );
        }
      }
      expect([...occurrenceCount.values()].every((count) => count === 1)).toBe(
        true,
      );

      const reservedForCandidate = new Set(
        active.deepResearchCoverage
          .filter(
            ({ candidateListingId: coveredCandidateId }) =>
              coveredCandidateId === candidateListingId,
          )
          .flatMap(({ criterionIds }) => criterionIds),
      );
      const distinctCriterion = active.brief.items.find(
        ({ criterionId }) => !reservedForCandidate.has(criterionId),
      );
      if (distinctCriterion === undefined) {
        throw new Error("Expected a distinct unreserved criterion");
      }
      const distinct = await prepareEvidenceResearch({
        ...prepare(connection.db),
        mode: "targeted",
        targetCandidateListingId: candidateListingId,
        targetCriterionId: distinctCriterion.criterionId,
      });
      expect(
        distinct.attempts
          .filter(({ stage }) => stage === "organic_search")
          .map(({ targetCriterionIds }) => targetCriterionIds),
      ).toEqual([[distinctCriterion.criterionId]]);
      const alreadyReserved = active.brief.items.find(({ criterionId }) =>
        reservedForCandidate.has(criterionId),
      );
      if (alreadyReserved === undefined) {
        throw new Error("Expected an active reserved criterion");
      }
      const owner = active.deepResearchCoverage.find(
        ({ candidateListingId: coveredCandidateId, criterionIds }) =>
          coveredCandidateId === candidateListingId &&
          criterionIds.includes(alreadyReserved.criterionId),
      );
      if (owner === undefined) throw new Error("Expected reservation owner");
      const runCountBeforeOverlap = (
        await connection.db
          .select({ id: evidenceResearchRuns.id })
          .from(evidenceResearchRuns)
          .where(eq(evidenceResearchRuns.taskId, session.taskId))
      ).length;
      try {
        const reused = await prepareEvidenceResearch({
          ...prepare(connection.db),
          mode: "targeted",
          targetCandidateListingId: candidateListingId,
          targetCriterionId: alreadyReserved.criterionId,
        });
        expect(reused.run.id).toBe(owner.researchRunId);
      } catch (error) {
        expect(error).toBeInstanceOf(EvidenceResearchNotNeededError);
      }
      expect(
        (
          await connection.db
            .select({ id: evidenceResearchRuns.id })
            .from(evidenceResearchRuns)
            .where(eq(evidenceResearchRuns.taskId, session.taskId))
        ).length,
      ).toBe(runCountBeforeOverlap);
    } finally {
      await contender.close();
    }
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

  it("rejects direct first-pass publication with missing assessment coverage or an unbound observation", async () => {
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
    const extraction = prepared.attempts.find(
      ({ stage }) => stage === "observation_extraction",
    );
    const assessment = prepared.attempts.find(
      ({ candidateListingId, stage }) =>
        candidateListingId === extraction?.candidateListingId &&
        stage === "criterion_assessment",
    );
    if (extraction === undefined || assessment === undefined) {
      throw new Error("Expected a reserved first-pass batch");
    }
    const candidateSources = prepared.sources.filter(
      ({ candidateListingId }) =>
        candidateListingId === extraction.candidateListingId,
    );
    const textualSourceOrdinal = candidateSources.findIndex(
      ({ sourceKind }) => sourceKind !== "listing_image",
    );
    if (textualSourceOrdinal < 0) {
      throw new Error("Expected a textual candidate source");
    }
    const leaseToken = await claimEvidenceResearch({
      db: connection.db,
      taskId: session.taskId,
      researchRunId: prepared.run.id,
    });
    if (leaseToken === null) throw new Error("Expected research lease");
    const common = {
      db: connection.db,
      taskId: session.taskId,
      researchRunId: prepared.run.id,
      candidateListingId: extraction.candidateListingId,
      extractionAttemptId: extraction.id,
      assessmentAttemptId: assessment.id,
      leaseToken,
      sourceIdsInOrder: candidateSources.map(({ id }) => id),
      metadata: understandingMetadata,
      startedAt: new Date("2026-08-30T19:00:00.000Z"),
      finishedAt: new Date("2026-08-30T19:00:01.000Z"),
    };

    await expect(
      recordCandidateUnderstanding({
        ...common,
        result: {
          providerSchemaVersion: 1,
          observations: [],
          assessments: [],
        },
      }),
    ).rejects.toMatchObject({ name: "EvidenceAttemptConflictError" });

    await expect(
      recordCandidateUnderstanding({
        ...common,
        result: {
          providerSchemaVersion: 1,
          observations: [
            {
              localRef: "unbound",
              sourceOrdinal: textualSourceOrdinal,
              criterionOrdinal: null,
              support: "ambiguous",
              observationKind: "source_assertion",
              propertyLabel: "Unbound product property",
              claim: "The supplied source contains an unbound product claim.",
              value: {
                schemaVersion: 1,
                kind: "text",
                text: "unbound claim",
              },
              derivation: "model_text",
            },
          ],
          assessments: extraction.targetCriterionIds.map((_, ordinal) => ({
            criterionOrdinal: ordinal,
            status: "uncertain" as const,
            relation: "insufficient_evidence",
            explanation: "The available evidence is insufficient.",
            observationRefs: [],
          })),
        },
      }),
    ).rejects.toMatchObject({ name: "EvidenceAttemptConflictError" });

    await releaseEvidenceResearchLease({
      db: connection.db,
      taskId: session.taskId,
      researchRunId: prepared.run.id,
      leaseToken,
    });
  });

  it("fails a raw mixed-status first-pass batch closed instead of treating it as an exact retry", async () => {
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
    const extraction = prepared.attempts.find(
      ({ stage }) => stage === "observation_extraction",
    );
    const assessment = prepared.attempts.find(
      ({ candidateListingId, stage }) =>
        candidateListingId === extraction?.candidateListingId &&
        stage === "criterion_assessment",
    );
    if (extraction === undefined || assessment === undefined) {
      throw new Error("Expected a reserved first-pass batch");
    }
    const startedAt = new Date("2026-08-30T19:10:00.000Z");
    const finishedAt = new Date("2026-08-30T19:10:01.000Z");
    await connection.db
      .update(evidenceAcquisitionAttempts)
      .set({
        status: "succeeded",
        receivedResultCount: 0,
        startedAt,
        finishedAt,
      })
      .where(eq(evidenceAcquisitionAttempts.id, extraction.id));
    const leaseToken = await claimEvidenceResearch({
      db: connection.db,
      taskId: session.taskId,
      researchRunId: prepared.run.id,
    });
    if (leaseToken === null) throw new Error("Expected research lease");

    await expect(
      recordCandidateUnderstanding({
        db: connection.db,
        taskId: session.taskId,
        researchRunId: prepared.run.id,
        candidateListingId: extraction.candidateListingId,
        extractionAttemptId: extraction.id,
        assessmentAttemptId: assessment.id,
        leaseToken,
        sourceIdsInOrder: [],
        result: null,
        metadata: null,
        failureCode: "model_failed",
        startedAt,
        finishedAt,
      }),
    ).rejects.toMatchObject({ name: "PersistedDataCorruptionError" });
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
