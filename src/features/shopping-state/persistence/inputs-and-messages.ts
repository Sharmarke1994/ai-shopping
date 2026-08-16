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
  REQUEST_FINGERPRINT_VERSION,
  createRequestFingerprint,
  requestMatchesStoredFingerprint,
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

async function loadExistingInput(options: {
  db: Parameters<Parameters<ShoppingDatabase["transaction"]>[0]>[0];
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

  return { created: false, input, message: mapUserMessage(messageRow) };
}

export async function recordTaskInput(options: {
  db: ShoppingDatabase;
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
  const requestFingerprint = createRequestFingerprint(request);
  const inputPayload = toTaskInputPayload(request);

  return options.db.transaction(async (tx) => {
    const id = taskInputIdSchema.parse(options.inputId ?? randomUUID());
    const [insertedRow] = await tx
      .insert(taskInputs)
      .values({
        id,
        taskId,
        clientActionId,
        inputKind: request.kind,
        inputSchemaVersion: request.inputSchemaVersion,
        inputPayload,
        fingerprintVersion: REQUEST_FINGERPRINT_VERSION,
        requestFingerprint,
        expectedRevision: request.expectedRevision,
      })
      .onConflictDoNothing({
        target: [taskInputs.taskId, taskInputs.clientActionId],
      })
      .returning();

    if (insertedRow === undefined) {
      return loadExistingInput({
        db: tx,
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
    const [messageRow] = await tx
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
  });
}
