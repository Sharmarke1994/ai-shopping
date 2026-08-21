import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  IdempotencyConflictError,
  PersistedDataCorruptionError,
} from "../../src/domain/shopping-state/errors";
import {
  ContextQuestionAlreadyAnsweredError,
  ContextQuestionAnswerMismatchError,
  StaleContextQuestionError,
  recordContextActionAnswer,
} from "../../src/features/context-acquisition/persistence/context-action-answers";
import {
  ContextActionReceiptError,
  StaleContextActionSelectionError,
  loadContextActionByApplication,
  persistContextAction,
} from "../../src/features/context-acquisition/persistence/context-actions";
import { recordTaskInput } from "../../src/features/shopping-state/persistence/inputs-and-messages";
import { applyStatePatch } from "../../src/features/shopping-state/persistence/state-transitions";
import { createShoppingTask } from "../../src/features/shopping-state/persistence/tasks";
import {
  contextActionAnswers,
  shoppingTasks,
  taskInputs,
} from "../../src/infrastructure/database/schema";
import {
  createTestDatabaseConnection,
  resetShoppingState,
  type TestDatabaseConnection,
} from "./helpers";

const config = {
  provider: "openai",
  model: "test-model",
  promptVersion: "context-action-v1",
  providerSchemaVersion: 1,
} as const;

const openQuestion = {
  schemaVersion: 1,
  action: "ask",
  question: {
    prompt: "What dimensions must it fit within?",
    responseMode: "open_text",
    options: [],
    expectedImpact: "eligibility",
    whyNow: "Dimensions decide whether shelving can fit.",
    canSearchWithoutAnswer: true,
  },
} as const;

const selectQuestion = {
  schemaVersion: 1,
  action: "ask",
  question: {
    prompt: "Which matters more for this cap?",
    responseMode: "single_select",
    options: ["Maximum airflow", "Minimal structure"],
    expectedImpact: "judgement",
    whyNow: "The answer separates the strongest candidates.",
    canSearchWithoutAnswer: true,
  },
} as const;

async function noChangeReceipt(
  connection: TestDatabaseConnection,
  taskId: string,
  key: string,
) {
  const input = await recordTaskInput({
    db: connection.db,
    taskId,
    clientActionId: key,
    request: {
      inputSchemaVersion: 1,
      expectedRevision: 0n,
      kind: "message",
      body: "Show me some options",
    },
  });
  return applyStatePatch(connection.db, {
    applicationSchemaVersion: 1,
    applicationKind: "patch",
    taskId,
    expectedRevision: 0n,
    source: { kind: "user_explicit", inputId: input.input.id },
    patch: { schemaVersion: 1, outcome: "no_change" },
  });
}

describe("context action and V2 answer persistence", () => {
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

  it("binds one action to a validated patch receipt and returns its first winner", async () => {
    const task = await createShoppingTask(connection.db);
    const receipt = await noChangeReceipt(connection, task.id, "action-source");
    const first = await persistContextAction({
      db: connection.db,
      taskId: task.id,
      stateChangeApplicationId: receipt.application.id,
      selectedAtRevision: 0n,
      proposal: selectQuestion,
      config,
    });
    const retryWithDifferentProposal = await persistContextAction({
      db: connection.db,
      taskId: task.id,
      stateChangeApplicationId: receipt.application.id,
      selectedAtRevision: 0n,
      proposal: {
        schemaVersion: 1,
        action: "search",
        rationale: { summary: "Enough is known to search." },
      },
      config,
    });

    expect(first.created).toBe(true);
    expect(retryWithDifferentProposal.created).toBe(false);
    expect(retryWithDifferentProposal.action).toEqual(first.action);
    expect(first.action.action).toBe("ask");
    if (first.action.action !== "ask") throw new Error("Expected ASK");
    expect(first.action.question.options).toHaveLength(2);
    expect(first.action.question.options.map((option) => option.label)).toEqual(
      selectQuestion.question.options,
    );
    expect(
      first.action.question.options.every((option) =>
        /^[0-9a-f-]{36}$/.test(option.id),
      ),
    ).toBe(true);
  });

  it("rejects a missing/cross-task receipt and a stale selection", async () => {
    const task = await createShoppingTask(connection.db);
    const otherTask = await createShoppingTask(connection.db);
    const receipt = await noChangeReceipt(
      connection,
      otherTask.id,
      "foreign-action-source",
    );

    await expect(
      persistContextAction({
        db: connection.db,
        taskId: task.id,
        stateChangeApplicationId: receipt.application.id,
        selectedAtRevision: 0n,
        proposal: openQuestion,
        config,
      }),
    ).rejects.toBeInstanceOf(ContextActionReceiptError);

    const ownReceipt = await noChangeReceipt(
      connection,
      task.id,
      "stale-action-source",
    );
    await connection.db
      .update(shoppingTasks)
      .set({ currentRevision: 1n })
      .where(eq(shoppingTasks.id, task.id));
    await expect(
      persistContextAction({
        db: connection.db,
        taskId: task.id,
        stateChangeApplicationId: ownReceipt.application.id,
        selectedAtRevision: 0n,
        proposal: openQuestion,
        config,
      }),
    ).rejects.toBeInstanceOf(StaleContextActionSelectionError);
  });

  it("fails closed when an action claims a future authoritative revision", async () => {
    const task = await createShoppingTask(connection.db);
    const receipt = await noChangeReceipt(
      connection,
      task.id,
      "corrupt-action-source",
    );
    const selected = await persistContextAction({
      db: connection.db,
      taskId: task.id,
      stateChangeApplicationId: receipt.application.id,
      selectedAtRevision: 0n,
      proposal: openQuestion,
      config,
    });
    await connection.client.unsafe(
      `update shopping_private.context_actions set selected_at_revision = 99 where id = $1`,
      [selected.action.id],
    );

    await expect(
      loadContextActionByApplication({
        db: connection.db,
        taskId: task.id,
        stateChangeApplicationId: receipt.application.id,
      }),
    ).rejects.toBeInstanceOf(PersistedDataCorruptionError);
  });

  it("atomically records exact open text and returns its retry before stale checks", async () => {
    const task = await createShoppingTask(connection.db);
    const receipt = await noChangeReceipt(connection, task.id, "open-source");
    const selected = await persistContextAction({
      db: connection.db,
      taskId: task.id,
      stateChangeApplicationId: receipt.application.id,
      selectedAtRevision: 0n,
      proposal: openQuestion,
      config,
    });
    const request = {
      inputSchemaVersion: 2,
      expectedRevision: 0n,
      kind: "question_answer",
      questionId: selected.action.id,
      answer: { mode: "open_text", text: " 60 cm high at most " },
    } as const;

    const first = await recordContextActionAnswer({
      db: connection.db,
      taskId: task.id,
      clientActionId: "open-answer",
      request,
    });
    await connection.db
      .update(shoppingTasks)
      .set({ currentRevision: 1n })
      .where(eq(shoppingTasks.id, task.id));
    const retry = await recordContextActionAnswer({
      db: connection.db,
      taskId: task.id,
      clientActionId: "open-answer",
      request,
    });

    expect(first.created).toBe(true);
    expect(first.resolvedAnswer).toEqual({
      mode: "open_text",
      text: " 60 cm high at most ",
    });
    expect(retry.created).toBe(false);
    expect(retry.input.id).toBe(first.input.id);
    await expect(
      recordContextActionAnswer({
        db: connection.db,
        taskId: task.id,
        clientActionId: "open-answer",
        request: {
          ...request,
          answer: { mode: "open_text", text: "Different text" },
        },
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("resolves only an owned visible option and rolls back invalid answers", async () => {
    const task = await createShoppingTask(connection.db);
    const receipt = await noChangeReceipt(connection, task.id, "select-source");
    const selected = await persistContextAction({
      db: connection.db,
      taskId: task.id,
      stateChangeApplicationId: receipt.application.id,
      selectedAtRevision: 0n,
      proposal: selectQuestion,
      config,
    });
    if (selected.action.action !== "ask") throw new Error("Expected ASK");
    const option = selected.action.question.options[0];
    if (option === undefined) throw new Error("Expected option");

    await expect(
      recordContextActionAnswer({
        db: connection.db,
        taskId: task.id,
        clientActionId: "wrong-option",
        request: {
          inputSchemaVersion: 2,
          expectedRevision: 0n,
          kind: "question_answer",
          questionId: selected.action.id,
          answer: {
            mode: "single_select",
            optionId: "33333333-3333-4333-8333-333333333333",
          },
        },
      }),
    ).rejects.toBeInstanceOf(ContextQuestionAnswerMismatchError);
    const rolledBack = await connection.db
      .select()
      .from(taskInputs)
      .where(
        and(
          eq(taskInputs.taskId, task.id),
          eq(taskInputs.clientActionId, "wrong-option"),
        ),
      );
    expect(rolledBack).toEqual([]);

    const answer = await recordContextActionAnswer({
      db: connection.db,
      taskId: task.id,
      clientActionId: "owned-option",
      request: {
        inputSchemaVersion: 2,
        expectedRevision: 0n,
        kind: "question_answer",
        questionId: selected.action.id,
        answer: { mode: "single_select", optionId: option.id },
      },
    });
    expect(answer.resolvedAnswer).toEqual({
      mode: "single_select",
      optionId: option.id,
      label: option.label,
    });
  });

  it("rejects stale and second answers without retaining their TaskInputs", async () => {
    const task = await createShoppingTask(connection.db);
    const firstReceipt = await noChangeReceipt(
      connection,
      task.id,
      "answered-source",
    );
    const answeredQuestion = await persistContextAction({
      db: connection.db,
      taskId: task.id,
      stateChangeApplicationId: firstReceipt.application.id,
      selectedAtRevision: 0n,
      proposal: openQuestion,
      config,
    });
    await recordContextActionAnswer({
      db: connection.db,
      taskId: task.id,
      clientActionId: "first-answer",
      request: {
        inputSchemaVersion: 2,
        expectedRevision: 0n,
        kind: "question_answer",
        questionId: answeredQuestion.action.id,
        answer: { mode: "open_text", text: "First" },
      },
    });
    await expect(
      recordContextActionAnswer({
        db: connection.db,
        taskId: task.id,
        clientActionId: "second-answer",
        request: {
          inputSchemaVersion: 2,
          expectedRevision: 0n,
          kind: "question_answer",
          questionId: answeredQuestion.action.id,
          answer: { mode: "open_text", text: "Second" },
        },
      }),
    ).rejects.toBeInstanceOf(ContextQuestionAlreadyAnsweredError);

    const secondTask = await createShoppingTask(connection.db);
    const staleReceipt = await noChangeReceipt(
      connection,
      secondTask.id,
      "stale-question-source",
    );
    const staleQuestion = await persistContextAction({
      db: connection.db,
      taskId: secondTask.id,
      stateChangeApplicationId: staleReceipt.application.id,
      selectedAtRevision: 0n,
      proposal: openQuestion,
      config,
    });
    await connection.db
      .update(shoppingTasks)
      .set({ currentRevision: 1n })
      .where(eq(shoppingTasks.id, secondTask.id));
    await expect(
      recordContextActionAnswer({
        db: connection.db,
        taskId: secondTask.id,
        clientActionId: "stale-answer",
        request: {
          inputSchemaVersion: 2,
          expectedRevision: 0n,
          kind: "question_answer",
          questionId: staleQuestion.action.id,
          answer: { mode: "open_text", text: "Too late" },
        },
      }),
    ).rejects.toBeInstanceOf(StaleContextQuestionError);

    const retained = await connection.db
      .select({ clientActionId: taskInputs.clientActionId })
      .from(taskInputs)
      .where(eq(taskInputs.clientActionId, "second-answer"));
    expect(retained).toEqual([]);
    const staleRetained = await connection.db
      .select({ clientActionId: taskInputs.clientActionId })
      .from(taskInputs)
      .where(eq(taskInputs.clientActionId, "stale-answer"));
    expect(staleRetained).toEqual([]);
    const bindings = await connection.db
      .select()
      .from(contextActionAnswers)
      .where(eq(contextActionAnswers.taskId, task.id));
    expect(bindings).toHaveLength(1);
  });
});
