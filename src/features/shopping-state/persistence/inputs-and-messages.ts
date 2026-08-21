import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  IdempotencyConflictError,
  PersistedDataCorruptionError,
} from "../../../domain/shopping-state/errors";
import {
  taskInputIdSchema,
  userMessageIdSchema,
  shoppingTaskIdSchema,
} from "../../../domain/shopping-state/ids";
import {
  QUESTION_ANSWER_INPUT_SCHEMA_VERSION,
  createRequestFingerprint,
  requestMatchesStoredFingerprint,
  requestFingerprintVersionFor,
  stableClientIdentifierSchema,
  taskInputRequestSchema,
  toTaskInputPayload,
  type TaskInputRequest,
} from "../../../domain/shopping-state/task-input";
import type { ShoppingDatabase } from "../../../infrastructure/database/clients";
import {
  taskInputs,
  userMessages,
} from "../../../infrastructure/database/schema";
import { mapTaskInput, mapUserMessage } from "./mappers";

export type RecordedTaskInput = Readonly<{
  created: boolean;
  input: ReturnType<typeof mapTaskInput>;
  message: ReturnType<typeof mapUserMessage> | null;
}>;

type TaskInputTransaction = Parameters<
  Parameters<ShoppingDatabase["transaction"]>[0]
>[0];

async function loadExistingInput(options: {
  db: TaskInputTransaction;
  taskId: ReturnType<typeof shoppingTaskIdSchema.parse>;
  clientActionId: string;
  request: TaskInputRequest;
}): Promise<RecordedTaskInput> {
  const [row] = await options.db
    .select()
    .from(taskInputs)
    .where(
      and(
        eq(taskInputs.taskId, options.taskId),
        eq(taskInputs.clientActionId, options.clientActionId),
      ),
    )
    .limit(1);

  if (row === undefined) {
    throw new Error("Idempotency conflict row was not visible after insert");
  }

  const input = mapTaskInput(row);
  if (
    !requestMatchesStoredFingerprint({
      request: options.request,
      fingerprintVersion: input.fingerprintVersion,
      requestFingerprint: input.requestFingerprint,
    })
  ) {
    throw new IdempotencyConflictError(options.clientActionId);
  }

  if (options.request.kind !== "message") {
    return { created: false, input, message: null };
  }

  const [messageRow] = await options.db
    .select()
    .from(userMessages)
    .where(
      and(
        eq(userMessages.taskId, options.taskId),
        eq(userMessages.taskInputId, input.id),
      ),
    )
    .limit(1);

  if (messageRow === undefined) {
    throw new PersistedDataCorruptionError({
      recordType: "TaskInput",
      recordId: input.id,
      cause: new Error("Message input has no exact UserMessage"),
    });
  }

  const message = mapUserMessage(messageRow);
  if (
    message.taskInputId !== input.id ||
    message.taskId !== options.taskId ||
    message.receivedAtRevision !== input.expectedRevision
  ) {
    throw new PersistedDataCorruptionError({
      recordType: "TaskInput",
      recordId: input.id,
      cause: new Error(
        "Message input does not match its exact task, input, and revision",
      ),
    });
  }

  return { created: false, input, message };
}

export async function recordTaskInputInTransaction(options: {
  tx: TaskInputTransaction;
  taskId: unknown;
  clientActionId: string;
  request: unknown;
  inputId?: unknown;
  messageId?: unknown;
}): Promise<RecordedTaskInput> {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const clientActionId = stableClientIdentifierSchema.parse(
    options.clientActionId,
  );
  const request = taskInputRequestSchema.parse(options.request);
  const fingerprintVersion = requestFingerprintVersionFor(request);
  const requestFingerprint = createRequestFingerprint(request);
  const inputPayload = toTaskInputPayload(request);
  const id = taskInputIdSchema.parse(options.inputId ?? randomUUID());
  const [insertedRow] = await options.tx
    .insert(taskInputs)
    .values({
      id,
      taskId,
      clientActionId,
      inputKind: request.kind,
      inputSchemaVersion: request.inputSchemaVersion,
      inputPayload,
      fingerprintVersion,
      requestFingerprint,
      expectedRevision: request.expectedRevision,
    })
    .onConflictDoNothing({
      target: [taskInputs.taskId, taskInputs.clientActionId],
    })
    .returning();

  if (insertedRow === undefined) {
    return loadExistingInput({
      db: options.tx,
      taskId,
      clientActionId,
      request,
    });
  }

  const input = mapTaskInput(insertedRow);
  if (request.kind !== "message") {
    return { created: true, input, message: null };
  }

  const messageId = userMessageIdSchema.parse(
    options.messageId ?? randomUUID(),
  );
  const [messageRow] = await options.tx
    .insert(userMessages)
    .values({
      id: messageId,
      taskId,
      taskInputId: input.id,
      body: request.body,
      receivedAtRevision: request.expectedRevision,
    })
    .returning();

  if (messageRow === undefined) {
    throw new Error("User message insert returned no row");
  }

  return { created: true, input, message: mapUserMessage(messageRow) };
}

export async function recordTaskInput(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  clientActionId: string;
  request: unknown;
  inputId?: unknown;
  messageId?: unknown;
}): Promise<RecordedTaskInput> {
  const request = taskInputRequestSchema.parse(options.request);
  if (request.inputSchemaVersion === QUESTION_ANSWER_INPUT_SCHEMA_VERSION) {
    throw new TypeError(
      "Question-answer V2 must be recorded through recordContextActionAnswer",
    );
  }
  return options.db.transaction((tx) =>
    recordTaskInputInTransaction({
      tx,
      taskId: options.taskId,
      clientActionId: options.clientActionId,
      request,
      ...(options.inputId === undefined ? {} : { inputId: options.inputId }),
      ...(options.messageId === undefined
        ? {}
        : { messageId: options.messageId }),
    }),
  );
}
