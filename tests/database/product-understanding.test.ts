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
  FakeEvidenceSearchProvider,
  FakeProductUnderstandingModel,
} from "../../src/features/product-understanding/fakes";
import {
  loadEvidenceResearchRun,
  prepareEvidenceResearch,
} from "../../src/features/product-understanding/persistence";
import { executeOrResumeEvidenceResearch } from "../../src/features/product-understanding/research-orchestrator";
import { FakeShoppingProvider } from "../../src/features/retrieval-spike/fake-shopping-provider";
import { recordTaskInput } from "../../src/features/shopping-state/persistence/inputs-and-messages";
import { applyStatePatch } from "../../src/features/shopping-state/persistence/state-transitions";
import {
  criterionAssessmentObservations,
  criterionAssessments,
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

  async function seedSearch() {
    const dependencies = {
      db: connection.db,
      model: contextModel(),
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
    const priorObservationIds = new Set(first.observations.map(({ id }) => id));
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
    });
    expect(second.run.taskRevision).toBe(2n);
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
