import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  IdempotencyConflictError,
  PersistedDataCorruptionError,
} from "../../src/domain/shopping-state/errors";
import {
  REQUEST_FINGERPRINT_VERSION_V1,
  createRequestFingerprint,
} from "../../src/domain/shopping-state/task-input";
import { recordTaskInput } from "../../src/features/shopping-state/persistence/inputs-and-messages";
import { createShoppingTask } from "../../src/features/shopping-state/persistence/tasks";
import {
  taskInputs,
  userMessages,
} from "../../src/infrastructure/database/schema";
import {
  createTestDatabaseConnection,
  resetShoppingState,
  type TestDatabaseConnection,
} from "./helpers";

const messageRequest = {
  inputSchemaVersion: 1,
  expectedRevision: 0n,
  kind: "message",
  body: "I need a light breathable cap",
} as const;

describe("task input and message persistence", () => {
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

  it("creates an exact message atomically and returns the same stored retry", async () => {
    const task = await createShoppingTask(connection.db);
    const first = await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: "cap-message-1",
      request: messageRequest,
    });
    const retry = await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: "cap-message-1",
      request: messageRequest,
    });

    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(retry.input.id).toBe(first.input.id);
    expect(retry.message?.id).toBe(first.message?.id);
    expect(retry.message?.body).toBe(messageRequest.body);
    expect(retry.input.expectedRevision).toBe(0n);
    expect(first.input.receivedAt).toBeInstanceOf(Date);
    expect(first.message?.createdAt).toBeInstanceOf(Date);
  });

  it("fails closed when a stored retry message has a different revision", async () => {
    const task = await createShoppingTask(connection.db);
    const first = await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: "corrupt-message-revision",
      request: messageRequest,
    });
    if (first.message === null) throw new Error("Expected message row");

    await connection.db
      .update(userMessages)
      .set({ receivedAtRevision: 1n })
      .where(eq(userMessages.id, first.message.id));

    await expect(
      recordTaskInput({
        db: connection.db,
        taskId: task.id,
        clientActionId: "corrupt-message-revision",
        request: messageRequest,
      }),
    ).rejects.toBeInstanceOf(PersistedDataCorruptionError);
  });

  it("rejects one task-scoped key reused for different source content", async () => {
    const task = await createShoppingTask(connection.db);
    await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: "same-key",
      request: messageRequest,
    });

    await expect(
      recordTaskInput({
        db: connection.db,
        taskId: task.id,
        clientActionId: "same-key",
        request: { ...messageRequest, body: `${messageRequest.body} ` },
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("allows the same client key independently in another task", async () => {
    const firstTask = await createShoppingTask(connection.db);
    const secondTask = await createShoppingTask(connection.db);
    const [first, second] = await Promise.all([
      recordTaskInput({
        db: connection.db,
        taskId: firstTask.id,
        clientActionId: "shared-client-key",
        request: messageRequest,
      }),
      recordTaskInput({
        db: connection.db,
        taskId: secondTask.id,
        clientActionId: "shared-client-key",
        request: messageRequest,
      }),
    ]);
    expect(first.input.id).not.toBe(second.input.id);
  });

  it("uses the stored V1 canonicalizer for an existing historical row", async () => {
    const task = await createShoppingTask(connection.db);
    const inputId = randomUUID();
    await connection.db.insert(taskInputs).values({
      id: inputId,
      taskId: task.id,
      clientActionId: "historical-v1",
      inputKind: "question_answer",
      inputSchemaVersion: 1,
      inputPayload: {
        schemaVersion: 1,
        kind: "question_answer",
        questionId: "cap-shape",
        optionId: "minimal",
        answerText: "Keep it minimal",
      },
      fingerprintVersion: 1,
      requestFingerprint: createRequestFingerprint({
        inputSchemaVersion: 1,
        expectedRevision: 0n,
        kind: "question_answer",
        questionId: "cap-shape",
        optionId: "minimal",
        answerText: "Keep it minimal",
      }),
      expectedRevision: 0n,
    });

    const retry = await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: "historical-v1",
      request: {
        answerText: "Keep it minimal",
        optionId: "minimal",
        questionId: "cap-shape",
        kind: "question_answer",
        expectedRevision: 0n,
        inputSchemaVersion: 1,
      },
    });
    expect(retry.created).toBe(false);
    expect(retry.input.id).toBe(inputId);
    expect(retry.input.fingerprintVersion).toBe(REQUEST_FINGERPRINT_VERSION_V1);
  });

  it("rejects unbound V2 answers outside the atomic context-action wrapper", async () => {
    const task = await createShoppingTask(connection.db);
    await expect(
      recordTaskInput({
        db: connection.db,
        taskId: task.id,
        clientActionId: "unbound-answer-v2",
        request: {
          inputSchemaVersion: 2,
          expectedRevision: 0n,
          kind: "question_answer",
          questionId: "11111111-1111-4111-8111-111111111111",
          answer: { mode: "open_text", text: "60 cm high at most" },
        },
      }),
    ).rejects.toThrow(
      "Question-answer V2 must be recorded through recordContextActionAnswer",
    );
    const rows = await connection.db
      .select()
      .from(taskInputs)
      .where(eq(taskInputs.taskId, task.id));
    expect(rows).toEqual([]);
  });

  it("rolls back the input when its exact message cannot be inserted", async () => {
    const task = await createShoppingTask(connection.db);
    const duplicateMessageId = randomUUID();
    await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: "first-message",
      request: messageRequest,
      messageId: duplicateMessageId,
    });

    await expect(
      recordTaskInput({
        db: connection.db,
        taskId: task.id,
        clientActionId: "must-roll-back",
        request: { ...messageRequest, body: "A different message" },
        messageId: duplicateMessageId,
      }),
    ).rejects.toThrow();

    const rolledBackInputs = await connection.db
      .select()
      .from(taskInputs)
      .where(
        and(
          eq(taskInputs.taskId, task.id),
          eq(taskInputs.clientActionId, "must-roll-back"),
        ),
      );
    const storedMessages = await connection.db
      .select()
      .from(userMessages)
      .where(eq(userMessages.id, duplicateMessageId));
    expect(rolledBackInputs).toEqual([]);
    expect(storedMessages).toHaveLength(1);
  });
});
