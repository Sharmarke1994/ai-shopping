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
  answerLiveShoppingQuestion,
  loadLiveShoppingSession,
  retryLiveShoppingContext,
  startLiveShopping,
  type LiveShoppingDependencies,
} from "../../src/features/live-shopping/application";
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
import {
  contextActionAnswers,
  founderLiveSessions,
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
      destinationLabel: "View on Google Shopping",
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
