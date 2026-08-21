import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type {
  ContextAcquisitionModel,
  ModelCallMetadata,
} from "../../src/features/context-acquisition/model-port";
import type {
  ContextActionProviderWireV1,
  InterpretationProviderWireV1,
} from "../../src/features/context-acquisition/provider-wire";
import { acquireShoppingContext } from "../../src/features/context-acquisition/coordinator";
import { recordContextActionAnswer } from "../../src/features/context-acquisition/persistence/context-action-answers";
import { recordTaskInput } from "../../src/features/shopping-state/persistence/inputs-and-messages";
import { loadCurrentShoppingState } from "../../src/features/shopping-state/persistence/state-loaders";
import { createShoppingTask } from "../../src/features/shopping-state/persistence/tasks";
import {
  createTestDatabaseConnection,
  resetShoppingState,
  type TestDatabaseConnection,
} from "./helpers";

const metadata: ModelCallMetadata = {
  provider: "fake",
  model: "deterministic",
  promptVersion: "test-v1",
  providerSchemaVersion: 1,
  providerRequestId: "fake-response",
  durationMs: 1,
  inputTokens: 10,
  outputTokens: 10,
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
  rationale: { summary: "The request is actionable." },
};

function completed<T>(value: T) {
  return Promise.resolve({ status: "completed" as const, value, metadata });
}

describe("context-acquisition coordinator", () => {
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

  it("applies once, persists SEARCH, and recovers exact retries without another model call", async () => {
    const task = await createShoppingTask(connection.db);
    const input = await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: "exact-lookup",
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 0n,
        kind: "message",
        body: "Sony WH-1000XM6",
      },
    });
    const model: ContextAcquisitionModel = {
      interpret: vi.fn(() => completed(noChange)),
      selectAction: vi.fn(() => completed(search)),
    };

    const first = await acquireShoppingContext({
      db: connection.db,
      model,
      taskId: task.id,
      sourceInputId: input.input.id,
    });
    expect(first.status).toBe("completed");
    if (first.status !== "completed") throw new Error("Expected completion");
    expect(first.action.action).toBe("search");

    const retryModel: ContextAcquisitionModel = {
      interpret: vi.fn(() => {
        throw new Error("retry must not reinterpret");
      }),
      selectAction: vi.fn(() => {
        throw new Error("retry must not reselect");
      }),
    };
    const retry = await acquireShoppingContext({
      db: connection.db,
      model: retryModel,
      taskId: task.id,
      sourceInputId: input.input.id,
    });
    expect(retry).toEqual(first);
    expect(retryModel.interpret).not.toHaveBeenCalled();
    expect(retryModel.selectAction).not.toHaveBeenCalled();
  });

  it("supports message to ASK to V2 answer to SEARCH and an explicit relaxation", async () => {
    const task = await createShoppingTask(connection.db);
    const initial = await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: "shelving-initial",
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 0n,
        kind: "message",
        body: "I need visually light shelving for this alcove",
      },
    });
    const askModel: ContextAcquisitionModel = {
      interpret: () => completed(noChange),
      selectAction: () =>
        completed({
          providerSchemaVersion: 1,
          action: "ask" as const,
          question: {
            prompt: "What is the maximum height it can be?",
            responseMode: "open_text" as const,
            options: [],
            expectedImpact: "eligibility" as const,
            whyNow: "Height determines whether a shelf can fit the alcove.",
            canSearchWithoutAnswer: true,
          },
          rationale: null,
        }),
    };
    const asked = await acquireShoppingContext({
      db: connection.db,
      model: askModel,
      taskId: task.id,
      sourceInputId: initial.input.id,
    });
    expect(asked.status).toBe("completed");
    if (asked.status !== "completed" || asked.action.action !== "ask") {
      throw new Error("Expected ASK");
    }

    const answer = await recordContextActionAnswer({
      db: connection.db,
      taskId: task.id,
      clientActionId: "height-answer",
      request: {
        inputSchemaVersion: 2,
        expectedRevision: 0n,
        kind: "question_answer",
        questionId: asked.action.id,
        answer: { mode: "open_text", text: "60 cm high at most" },
      },
    });
    const answerModel: ContextAcquisitionModel = {
      interpret: () =>
        completed({
          providerSchemaVersion: 1,
          outcome: "change" as const,
          operations: [
            {
              op: "create_concept" as const,
              localRef: "maximum_height",
              label: "Maximum height",
              definition:
                "Maximum overall shelving height that fits the alcove",
              valueFamily: "measurement" as const,
              canonicalUnit: "cm" as const,
            },
            {
              op: "add_criterion" as const,
              concept: { kind: "created" as const, localRef: "maximum_height" },
              target: {
                strength: "hard" as const,
                targetSemantics: "range" as const,
                semanticValue: {
                  schemaVersion: 1 as const,
                  kind: "measurement_range" as const,
                  lower: null,
                  upper: { amount: "60", inclusive: true },
                  unit: "cm" as const,
                },
              },
            },
          ],
          ambiguities: [],
        }),
      selectAction: () => completed(search),
    };
    const answered = await acquireShoppingContext({
      db: connection.db,
      model: answerModel,
      taskId: task.id,
      sourceInputId: answer.input.id,
    });
    expect(answered.status).toBe("completed");
    if (answered.status !== "completed") throw new Error("Expected completion");
    expect(answered.action.action).toBe("search");

    const stateAfterAnswer = await loadCurrentShoppingState(
      connection.db,
      task.id,
    );
    const heightCriterion = stateAfterAnswer.activeCriteria[0]?.criterion;
    if (heightCriterion === undefined)
      throw new Error("Expected height criterion");
    const change = await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: "relax-height",
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 1n,
        kind: "message",
        body: "Actually 70 cm high is fine",
      },
    });
    const changeModel: ContextAcquisitionModel = {
      interpret: () =>
        completed({
          providerSchemaVersion: 1,
          outcome: "change" as const,
          operations: [
            {
              op: "relax" as const,
              targetCriterionId: heightCriterion.id,
              result: {
                strength: "hard" as const,
                targetSemantics: "range" as const,
                semanticValue: {
                  schemaVersion: 1 as const,
                  kind: "measurement_range" as const,
                  lower: null,
                  upper: { amount: "70", inclusive: true },
                  unit: "cm" as const,
                },
              },
            },
          ],
          ambiguities: [],
        }),
      selectAction: () => completed(search),
    };
    const changed = await acquireShoppingContext({
      db: connection.db,
      model: changeModel,
      taskId: task.id,
      sourceInputId: change.input.id,
    });
    expect(changed.status).toBe("completed");
    const finalState = await loadCurrentShoppingState(connection.db, task.id);
    expect(finalState.task.currentRevision).toBe(2n);
    expect(finalState.activeCriteria[0]?.criterion.semanticValue).toMatchObject(
      {
        kind: "measurement_range",
        upper: { amount: "70", inclusive: true },
        unit: "cm",
      },
    );
  });
});
