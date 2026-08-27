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
import {
  conceptDefinitionIdSchema,
  criterionIdSchema,
} from "../../src/domain/shopping-state/ids";
import {
  answerLiveShoppingQuestion,
  loadLiveShoppingSession,
  refineLiveShopping,
  retryLiveShoppingContext,
  setLiveListingSaved,
  startLiveShopping,
  type LiveShoppingDependencies,
} from "../../src/features/live-shopping/application";
import { recordContextActionAnswer } from "../../src/features/context-acquisition/persistence/context-action-answers";
import { loadContextActionByIdInTransaction } from "../../src/features/context-acquisition/persistence/context-actions";
import type {
  ContextAcquisitionModel,
  ModelCallMetadata,
} from "../../src/features/context-acquisition/model-port";
import type {
  ContextActionProviderWireV1,
  InterpretationProviderWireV1,
} from "../../src/features/context-acquisition/provider-wire";
import type { ShoppingSearchProvider } from "../../src/features/retrieval-spike/contracts";
import { FakeShoppingProvider } from "../../src/features/retrieval-spike/fake-shopping-provider";
import { loadRetrievalContextFromPersistedState } from "../../src/features/retrieval-spike/context-from-persisted-state";
import { loadCurrentShoppingState } from "../../src/features/shopping-state/persistence/state-loaders";
import {
  contextActionAnswers,
  founderLiveSessions,
  savedCandidateListings,
  searchRuns,
  shoppingTasks,
  shoppingTaskSubjects,
  taskInputs,
} from "../../src/infrastructure/database/schema";
import {
  createTestDatabaseConnection,
  resetShoppingState,
  type TestDatabaseConnection,
} from "./helpers";

const metadata: ModelCallMetadata = {
  provider: "fixture",
  model: "live-application-test",
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

const capChange: InterpretationProviderWireV1 = {
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

const widthChange: InterpretationProviderWireV1 = {
  providerSchemaVersion: 1,
  outcome: "change",
  operations: [
    {
      op: "create_concept",
      localRef: "maximum_width",
      label: "Maximum width",
      definition: "Maximum overall shelving width",
      valueFamily: "measurement",
      canonicalUnit: "cm",
    },
    {
      op: "add_criterion",
      concept: { kind: "created", localRef: "maximum_width" },
      target: {
        strength: "hard",
        targetSemantics: "range",
        semanticValue: {
          schemaVersion: 1,
          kind: "measurement_range",
          lower: null,
          upper: { amount: "60", inclusive: true },
          unit: "cm",
        },
      },
    },
  ],
  ambiguities: [],
};

const waterproofChange: InterpretationProviderWireV1 = {
  providerSchemaVersion: 1,
  outcome: "change",
  operations: [
    {
      op: "create_concept",
      localRef: "water_resistance",
      label: "Water resistance",
      definition: "Whether the cap should resist rain",
      valueFamily: "boolean",
      canonicalUnit: null,
    },
    {
      op: "add_criterion",
      concept: { kind: "created", localRef: "water_resistance" },
      target: {
        strength: "strong_preference",
        targetSemantics: "exact",
        semanticValue: {
          schemaVersion: 1,
          kind: "boolean",
          value: true,
        },
      },
    },
  ],
  ambiguities: [],
};

const noChange: InterpretationProviderWireV1 = {
  providerSchemaVersion: 1,
  outcome: "no_change",
  operations: [],
  ambiguities: [],
};

const search: ContextActionProviderWireV1 = {
  providerSchemaVersion: 1,
  action: "search",
  question: null,
  rationale: { summary: "The brief is ready for retrieval." },
};

const ask: ContextActionProviderWireV1 = {
  providerSchemaVersion: 1,
  action: "ask",
  question: {
    prompt: "What is the maximum width that will fit?",
    responseMode: "single_select",
    options: ["Up to 60 cm", "Up to 80 cm", "I'm flexible"],
    expectedImpact: "eligibility",
    whyNow: "Width removes products that cannot fit.",
    canSearchWithoutAnswer: true,
  },
  rationale: null,
};

const waterproofQuestion: ContextActionProviderWireV1 = {
  providerSchemaVersion: 1,
  action: "ask",
  question: {
    prompt: "Should rain protection be a must-have or a preference?",
    responseMode: "single_select",
    options: ["Must-have", "Strong preference"],
    expectedImpact: "retrieval",
    whyNow: "This changes how narrowly the next product search should filter.",
    canSearchWithoutAnswer: true,
  },
  rationale: null,
};

function directModel(): ContextAcquisitionModel {
  return {
    interpret: vi.fn(() => completed(capChange)),
    selectAction: vi.fn(() => completed(search)),
  };
}

function askThenSearchModel(): ContextAcquisitionModel {
  return {
    interpret: vi.fn((input) =>
      completed(
        (input.payload.source as { kind?: string }).kind === "question_answer"
          ? widthChange
          : noChange,
      ),
    ),
    selectAction: vi.fn((input) =>
      completed(
        (input.payload.source as { kind?: string }).kind === "question_answer"
          ? search
          : ask,
      ),
    ),
  };
}

function recursiveCapModel(): ContextAcquisitionModel {
  return {
    interpret: vi.fn((input) => {
      const source = input.payload.source as { body?: string };
      return completed(
        source.body?.toLocaleLowerCase("en-GB").includes("waterproof")
          ? waterproofChange
          : capChange,
      );
    }),
    selectAction: vi.fn(() => completed(search)),
  };
}

function recursiveAskModel(): ContextAcquisitionModel {
  return {
    interpret: vi.fn((input) => {
      const source = input.payload.source as { kind?: string; body?: string };
      if (source.kind === "question_answer") return completed(noChange);
      return completed(
        source.body?.toLocaleLowerCase("en-GB").includes("waterproof")
          ? waterproofChange
          : capChange,
      );
    }),
    selectAction: vi.fn((input) => {
      const source = input.payload.source as { kind?: string; body?: string };
      if (source.kind === "question_answer") return completed(search);
      return completed(
        source.body?.toLocaleLowerCase("en-GB").includes("waterproof")
          ? waterproofQuestion
          : search,
      );
    }),
  };
}

function brandChangeOfMindModel(): ContextAcquisitionModel {
  return {
    interpret: vi.fn((input) => {
      const source = input.payload.source as { body?: string };
      if (source.body?.toLocaleLowerCase("en-GB").includes("doesn't matter")) {
        const concepts = input.payload.concepts as {
          id: string;
          label: string;
        }[];
        const activeCriteria = input.payload.activeCriteria as {
          id: string;
          conceptId: string;
        }[];
        const concept = concepts.find(
          ({ label }) => label === "Brand reputation",
        );
        const criterion = activeCriteria.find(
          ({ conceptId }) => conceptId === concept?.id,
        );
        if (concept === undefined || criterion === undefined) {
          throw new Error("Expected the current brand criterion");
        }
        return completed<InterpretationProviderWireV1>({
          providerSchemaVersion: 1,
          outcome: "change",
          operations: [
            {
              op: "mark_indifferent",
              concept: {
                kind: "existing",
                conceptId: conceptDefinitionIdSchema.parse(concept.id),
              },
              replacesCriterionIds: [criterionIdSchema.parse(criterion.id)],
            },
          ],
          ambiguities: [],
        });
      }
      return completed<InterpretationProviderWireV1>({
        providerSchemaVersion: 1,
        outcome: "change",
        operations: [
          {
            op: "create_concept",
            localRef: "brand_reputation",
            label: "Brand reputation",
            definition: "Whether the manufacturer should be established",
            valueFamily: "qualitative",
            canonicalUnit: null,
          },
          {
            op: "add_criterion",
            concept: { kind: "created", localRef: "brand_reputation" },
            target: {
              strength: "hard",
              targetSemantics: "qualitative",
              semanticValue: {
                schemaVersion: 1,
                kind: "qualitative_text",
                text: "established reputable brand",
              },
            },
          },
        ],
        ambiguities: [],
      });
    }),
    selectAction: vi.fn(() => completed(search)),
  };
}

function countedProvider(options?: { failAfter?: number }) {
  const fixture = new FakeShoppingProvider(
    () => new Date("2026-08-25T12:00:00.000Z"),
  );
  const calls: string[] = [];
  const provider: ShoppingSearchProvider = {
    provider: "fixture",
    maxRequestDurationMs: 0,
    search: async (query) => {
      calls.push(query.id);
      if (
        options?.failAfter !== undefined &&
        calls.length > options.failAfter
      ) {
        throw new Error("fixture provider unavailable");
      }
      return fixture.search(query);
    },
  };
  return { calls, provider };
}

describe("founder live-shopping application", () => {
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

  it("creates one task and subject, then makes an exact lost-response retry free", async () => {
    const model = directModel();
    const counted = countedProvider();
    const dependencies: LiveShoppingDependencies = {
      db: connection.db,
      model,
      provider: counted.provider,
    };
    const input = {
      operation: "start" as const,
      sessionId: "0b7ca14d-7961-4d33-85f7-3fa78c6ec811",
      turnId: "4f09815d-68ee-49ca-acbb-46d47d8d8f35",
      message: "A light breathable cap for running in hot weather",
    };

    const first = await startLiveShopping({ dependencies, input });
    expect(first.action.kind).toBe("search");
    if (first.action.kind !== "search") throw new Error("Expected search");
    expect(first.action.search).toMatchObject({ status: "succeeded" });
    expect(first.brief).toEqual([
      expect.objectContaining({
        label: "Breathability",
        emphasis: "strong",
      }),
    ]);
    const callCount = counted.calls.length;

    const recovered = await startLiveShopping({
      dependencies: {
        db: connection.db,
        model: {
          interpret: vi.fn(() => {
            throw new Error("completed retry must not reinterpret");
          }),
          selectAction: vi.fn(() => {
            throw new Error("completed retry must not reselect");
          }),
        },
        provider: {
          provider: "fixture",
          maxRequestDurationMs: 0,
          search: vi.fn(() => {
            throw new Error("completed retry must not search again");
          }),
        },
      },
      input,
    });

    expect(recovered).toEqual(first);
    expect(counted.calls).toHaveLength(callCount);
    expect(await connection.db.select().from(shoppingTasks)).toHaveLength(1);
    expect(
      await connection.db.select().from(shoppingTaskSubjects),
    ).toHaveLength(1);
    expect(await connection.db.select().from(founderLiveSessions)).toHaveLength(
      1,
    );
    expect(await connection.db.select().from(searchRuns)).toHaveLength(1);
  });

  it("keeps the first message as subject while an answer becomes the SEARCH trigger", async () => {
    const model = askThenSearchModel();
    const counted = countedProvider();
    const dependencies = {
      db: connection.db,
      model,
      provider: counted.provider,
    } satisfies LiveShoppingDependencies;
    const sessionId = "f67ab782-40cf-45e2-9041-45fc679d9c19";
    const initial = await startLiveShopping({
      dependencies,
      input: {
        operation: "start",
        sessionId,
        turnId: "78fac7ea-9ea1-4a57-9258-f07ab0a65af0",
        message: "A visually light shelving unit for a narrow alcove",
      },
    });
    expect(initial.action.kind).toBe("ask");

    const answered = await answerLiveShoppingQuestion({
      dependencies,
      input: {
        operation: "answer",
        sessionId,
        turnId: "d9d76691-b5cd-4551-b26b-fac84f194f80",
        answer: { mode: "single_select", optionOrdinal: 0 },
      },
    });
    expect(answered.action.kind).toBe("search");
    expect(answered.subject).toBe(
      "A visually light shelving unit for a narrow alcove",
    );
    expect(answered.brief).toEqual([
      expect.objectContaining({ label: "Maximum width", emphasis: "must" }),
    ]);

    const [session] = await connection.db
      .select()
      .from(founderLiveSessions)
      .where(eq(founderLiveSessions.id, sessionId));
    if (session?.currentContextActionId === null || session === undefined) {
      throw new Error("Expected current SEARCH action");
    }
    const authority = await loadRetrievalContextFromPersistedState({
      db: connection.db,
      taskId: session.taskId,
      contextActionId: session.currentContextActionId,
    });
    const [answerBinding] = await connection.db
      .select()
      .from(contextActionAnswers);
    expect(answerBinding).toBeDefined();
    expect(authority.context.shoppingSubject.text).toBe(answered.subject);
    expect(authority.triggerInputId).toBe(answerBinding?.answerTaskInputId);
  });

  it("recovers when an ASK answer commits before the founder session pending pointer", async () => {
    const model = askThenSearchModel();
    const counted = countedProvider();
    const dependencies = {
      db: connection.db,
      model,
      provider: counted.provider,
    } satisfies LiveShoppingDependencies;
    const sessionId = "8937609b-1fe7-4829-a1d9-cff7897747ce";
    const initial = await startLiveShopping({
      dependencies,
      input: {
        operation: "start",
        sessionId,
        turnId: "4932ad18-58c0-451b-a80a-68c31a05a32d",
        message: "A visually light shelving unit for a narrow alcove",
      },
    });
    expect(initial.action.kind).toBe("ask");

    const [session] = await connection.db
      .select()
      .from(founderLiveSessions)
      .where(eq(founderLiveSessions.id, sessionId));
    if (session?.currentContextActionId === null || session === undefined) {
      throw new Error("Expected current ASK action");
    }
    const action = await connection.db.transaction((tx) =>
      loadContextActionByIdInTransaction({
        tx,
        taskId: session.taskId,
        contextActionId: session.currentContextActionId!,
      }),
    );
    if (action?.action !== "ask") throw new Error("Expected persisted ASK");

    const recorded = await recordContextActionAnswer({
      db: connection.db,
      taskId: session.taskId,
      clientActionId: "live:8d17e07b-58b4-4580-ac2b-871fa4e6e790",
      request: {
        inputSchemaVersion: 2,
        expectedRevision: action.selectedAtRevision,
        kind: "question_answer",
        questionId: action.id,
        answer: {
          mode: "single_select",
          optionId: action.question.options[0]!.id,
        },
      },
    });
    expect(recorded.created).toBe(true);

    const interrupted = await loadLiveShoppingSession({
      db: connection.db,
      sessionId,
    });
    expect(interrupted.action).toMatchObject({
      kind: "understanding_failed",
      retryable: true,
    });

    const recovered = await retryLiveShoppingContext({
      dependencies,
      sessionId,
    });
    expect(recovered.action.kind).toBe("search");
    expect(recovered.subject).toBe(
      "A visually light shelving unit for a narrow alcove",
    );
    expect(recovered.brief).toEqual([
      expect.objectContaining({ label: "Maximum width", emphasis: "must" }),
    ]);
    expect(
      await connection.db.select().from(contextActionAnswers),
    ).toHaveLength(1);
    const [recoveredSession] = await connection.db
      .select()
      .from(founderLiveSessions)
      .where(eq(founderLiveSessions.id, sessionId));
    expect(recoveredSession?.pendingTaskInputId).toBeNull();
    expect(recoveredSession?.currentContextActionId).not.toBe(action.id);
  });

  it("loads a completed task on refresh without calling either external provider", async () => {
    const counted = countedProvider();
    const input = {
      operation: "start" as const,
      sessionId: "ba8f9428-d026-4a6e-a47c-cc340d8a8748",
      turnId: "96a7fc4e-667d-4ef3-b015-b985baebea28",
      message: "A breathable cap",
    };
    const created = await startLiveShopping({
      dependencies: {
        db: connection.db,
        model: directModel(),
        provider: counted.provider,
      },
      input,
    });
    const callsAfterCompletion = counted.calls.length;

    const refreshed = await loadLiveShoppingSession({
      db: connection.db,
      sessionId: input.sessionId,
    });

    expect(refreshed).toEqual(created);
    expect(counted.calls).toHaveLength(callsAfterCompletion);
  });

  it("refines one authoritative task, preserves earlier truth and saved products, and retries exactly", async () => {
    const counted = countedProvider();
    const dependencies = {
      db: connection.db,
      model: recursiveCapModel(),
      provider: counted.provider,
    } satisfies LiveShoppingDependencies;
    const sessionId = "e5b5cce0-241a-41bc-9f72-5339f1bdc1f8";
    const first = await startLiveShopping({
      dependencies,
      input: {
        operation: "start",
        sessionId,
        turnId: "059152f4-fbbd-480f-b310-6003f2ea3f10",
        message: "A light breathable cap for running in hot weather",
      },
    });
    if (first.action.kind !== "search" || first.action.search === null) {
      throw new Error("Expected initial search results");
    }
    const candidateListingId =
      first.action.search.listings[0]?.candidateListingId;
    if (candidateListingId === undefined) {
      throw new Error("Expected a candidate listing");
    }

    const saved = await setLiveListingSaved({
      dependencies,
      input: { operation: "save_listing", sessionId, candidateListingId },
    });
    await setLiveListingSaved({
      dependencies,
      input: { operation: "save_listing", sessionId, candidateListingId },
    });
    expect(saved.savedListings).toEqual([
      expect.objectContaining({ candidateListingId, saved: true }),
    ]);
    expect(
      await connection.db.select().from(savedCandidateListings),
    ).toHaveLength(1);

    const refinement = {
      operation: "refine" as const,
      sessionId,
      turnId: "92f536f0-5529-4823-ab4c-6198770d5a77",
      message: "Make waterproofing important too",
    };
    const refined = await refineLiveShopping({
      dependencies,
      input: refinement,
    });
    expect(refined.subject).toBe(
      "A light breathable cap for running in hot weather",
    );
    expect(refined.brief.map(({ label }) => label)).toEqual([
      "Breathability",
      "Water resistance",
    ]);
    expect(refined.savedListings).toEqual([
      expect.objectContaining({ candidateListingId, saved: true }),
    ]);
    expect(await connection.db.select().from(searchRuns)).toHaveLength(2);
    const callsAfterRefinement = counted.calls.length;

    const exactRetry = await refineLiveShopping({
      dependencies,
      input: refinement,
    });
    expect(exactRetry).toEqual(refined);
    expect(counted.calls).toHaveLength(callsAfterRefinement);
    expect(await connection.db.select().from(searchRuns)).toHaveLength(2);

    const refreshed = await loadLiveShoppingSession({
      db: connection.db,
      sessionId,
    });
    expect(refreshed).toEqual(refined);

    const unsaved = await setLiveListingSaved({
      dependencies,
      input: { operation: "unsave_listing", sessionId, candidateListingId },
    });
    expect(unsaved.savedListings).toEqual([]);
    expect(await connection.db.select().from(savedCandidateListings)).toEqual(
      [],
    );

    const otherSessionId = "31bd9398-c1fc-4880-be3b-b7d30a3f704a";
    await startLiveShopping({
      dependencies,
      input: {
        operation: "start",
        sessionId: otherSessionId,
        turnId: "468207ad-f04f-470a-8565-2ab3e1b723ed",
        message: "Another breathable cap",
      },
    });
    await expect(
      setLiveListingSaved({
        dependencies,
        input: {
          operation: "save_listing",
          sessionId: otherSessionId,
          candidateListingId,
        },
      }),
    ).rejects.toThrow("not available in this shopping task");
  });

  it("allows a post-result refinement to ASK, then answers and searches without replacing the subject", async () => {
    const counted = countedProvider();
    const dependencies = {
      db: connection.db,
      model: recursiveAskModel(),
      provider: counted.provider,
    } satisfies LiveShoppingDependencies;
    const sessionId = "216488f2-d369-42f5-9b1e-78a26ac98c6f";
    await startLiveShopping({
      dependencies,
      input: {
        operation: "start",
        sessionId,
        turnId: "9715a60c-3b30-44a6-9010-497996c4fd51",
        message: "A breathable running cap",
      },
    });
    const asked = await refineLiveShopping({
      dependencies,
      input: {
        operation: "refine",
        sessionId,
        turnId: "ffda8ed4-56bf-44f3-ab7c-535721515c7e",
        message: "Make waterproofing important too",
      },
    });
    expect(asked.action).toMatchObject({
      kind: "ask",
      prompt: "Should rain protection be a must-have or a preference?",
    });
    expect(asked.brief.map(({ label }) => label)).toEqual([
      "Breathability",
      "Water resistance",
    ]);

    const answered = await answerLiveShoppingQuestion({
      dependencies,
      input: {
        operation: "answer",
        sessionId,
        turnId: "ce893466-1ba9-4379-82d1-7d527fd8caa4",
        answer: { mode: "single_select", optionOrdinal: 1 },
      },
    });
    expect(answered.action.kind).toBe("search");
    expect(answered.subject).toBe("A breathable running cap");
    expect(await connection.db.select().from(searchRuns)).toHaveLength(2);
  });

  it("represents explicit indifference without leaving contradictory active brand truth", async () => {
    const counted = countedProvider();
    const dependencies = {
      db: connection.db,
      model: brandChangeOfMindModel(),
      provider: counted.provider,
    } satisfies LiveShoppingDependencies;
    const sessionId = "47dd4b02-0023-4774-80ed-6b08257a293f";
    await startLiveShopping({
      dependencies,
      input: {
        operation: "start",
        sessionId,
        turnId: "49d5a077-436d-462c-9e90-6ddfcb78f5d3",
        message: "An ergonomic mouse from an established reputable brand",
      },
    });
    const changed = await refineLiveShopping({
      dependencies,
      input: {
        operation: "refine",
        sessionId,
        turnId: "793ec61a-0573-4be3-8d2d-38b18cb6e364",
        message: "Actually brand doesn't matter anymore",
      },
    });
    expect(changed.brief).toEqual([]);
    const [session] = await connection.db
      .select()
      .from(founderLiveSessions)
      .where(eq(founderLiveSessions.id, sessionId));
    if (session === undefined) throw new Error("Expected session");
    const state = await loadCurrentShoppingState(connection.db, session.taskId);
    expect(state.activeCriteria).toHaveLength(1);
    expect(state.activeCriteria[0]?.criterion.semanticValue.kind).toBe(
      "indifferent",
    );
    expect(await connection.db.select().from(searchRuns)).toHaveLength(2);
  });

  it("recovers an interrupted interpretation from the persisted initial subject", async () => {
    const sessionId = "f0fb47f4-ecc7-4584-bba0-92daffc68e04";
    const failedModel: ContextAcquisitionModel = {
      interpret: vi.fn(() =>
        Promise.resolve({
          status: "provider_failed" as const,
          errorCode: "provider_connection_failed",
          metadata,
        }),
      ),
      selectAction: vi.fn(() => {
        throw new Error("failed interpretation must not select an action");
      }),
    };
    const failed = await startLiveShopping({
      dependencies: {
        db: connection.db,
        model: failedModel,
        provider: countedProvider().provider,
      },
      input: {
        operation: "start",
        sessionId,
        turnId: "4e56536e-9382-4a21-b71a-fffd8f77ec25",
        message: "A breathable running cap",
      },
    });
    expect(failed.action).toMatchObject({
      kind: "understanding_failed",
      retryable: true,
    });

    // Simulate a process interruption after subject persistence but before the
    // live-session pending pointer was durably recorded.
    await connection.db
      .update(founderLiveSessions)
      .set({ pendingTaskInputId: null })
      .where(eq(founderLiveSessions.id, sessionId));

    const recovered = await retryLiveShoppingContext({
      dependencies: {
        db: connection.db,
        model: directModel(),
        provider: countedProvider().provider,
      },
      sessionId,
    });
    expect(recovered.action.kind).toBe("search");
    expect(recovered.subject).toBe("A breathable running cap");
    expect(await connection.db.select().from(shoppingTasks)).toHaveLength(1);
    expect(
      await connection.db.select().from(shoppingTaskSubjects),
    ).toHaveLength(1);
  });

  it("keeps successful rows renderable when later provider queries fail", async () => {
    const counted = countedProvider({ failAfter: 1 });
    const result = await startLiveShopping({
      dependencies: {
        db: connection.db,
        model: directModel(),
        provider: counted.provider,
      },
      input: {
        operation: "start",
        sessionId: "3e5ddc8f-08f1-4ae1-9979-81dd0d2108e2",
        turnId: "ab326cc1-2c4f-4ccf-a482-010e6139c1b2",
        message: "A light cap for running",
      },
    });
    expect(result.action.kind).toBe("search");
    if (result.action.kind !== "search") throw new Error("Expected search");
    expect(result.action.search).toMatchObject({
      status: "partial",
      completedQueryCount: 2,
    });
    expect(result.action.search?.listings).toHaveLength(1);
    expect(result.action.search?.listings[0]).toMatchObject({
      merchant: "Fixture Outfitters",
      priceText: "£24.99",
      destinationLabel: "View at Fixture Outfitters",
    });
  });

  it("keeps identical client turn keys task-scoped across two sessions", async () => {
    const dependencies = {
      db: connection.db,
      model: askThenSearchModel(),
      provider: countedProvider().provider,
    } satisfies LiveShoppingDependencies;
    await startLiveShopping({
      dependencies,
      input: {
        operation: "start",
        sessionId: "76f69660-d09f-4cd9-985e-0708f253c0dd",
        turnId: "c9df801f-a069-4826-89dd-5c06db383a30",
        message: "Shelving for one room",
      },
    });
    await startLiveShopping({
      dependencies,
      input: {
        operation: "start",
        sessionId: "581f3898-08bc-4167-9881-a9490685739b",
        turnId: "5f54bd33-952e-4b66-9441-9ddfc4b78ab7",
        message: "Shelving for another room",
      },
    });

    const answered = await answerLiveShoppingQuestion({
      dependencies,
      input: {
        operation: "answer",
        sessionId: "76f69660-d09f-4cd9-985e-0708f253c0dd",
        turnId: "5f54bd33-952e-4b66-9441-9ddfc4b78ab7",
        answer: { mode: "single_select", optionOrdinal: 0 },
      },
    });
    expect(answered.action.kind).toBe("search");
    const sessions = await connection.db.select().from(founderLiveSessions);
    const firstSession = sessions.find(
      ({ id }) => id === "76f69660-d09f-4cd9-985e-0708f253c0dd",
    );
    const secondSession = sessions.find(
      ({ id }) => id === "581f3898-08bc-4167-9881-a9490685739b",
    );
    const [binding] = await connection.db.select().from(contextActionAnswers);
    expect(binding?.taskId).toBe(firstSession?.taskId);
    expect(binding?.taskId).not.toBe(secondSession?.taskId);
    expect(await connection.db.select().from(taskInputs)).toHaveLength(3);
  });
});
