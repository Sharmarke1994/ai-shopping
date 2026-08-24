import { and, eq } from "drizzle-orm";
import {
  PersistedDataCorruptionError,
  TaskNotFoundError,
} from "@/domain/shopping-state/errors";
import {
  shoppingTaskIdSchema,
  taskInputIdSchema,
  userMessageIdSchema,
} from "@/domain/shopping-state/ids";
import {
  TASK_INPUT_SCHEMA_VERSION,
  taskInputRequestSchema,
} from "@/domain/shopping-state/task-input";
import type {
  ShoppingDatabase,
  ShoppingTransaction,
} from "@/infrastructure/database/clients";
import {
  shoppingTasks,
  shoppingTaskSubjects,
  taskInputs,
  userMessages,
} from "@/infrastructure/database/schema";
import {
  recordTaskInputInTransaction,
  type RecordedTaskInput,
} from "@/features/shopping-state/persistence/inputs-and-messages";
import {
  mapTaskInput,
  mapUserMessage,
} from "@/features/shopping-state/persistence/mappers";

export type PersistedShoppingSubject = Readonly<{
  taskId: ReturnType<typeof shoppingTaskIdSchema.parse>;
  sourceInputId: ReturnType<typeof taskInputIdSchema.parse>;
  userMessageId: ReturnType<typeof userMessageIdSchema.parse>;
  body: string;
  createdAt: Date;
}>;

export type RecordedShoppingSubject = Readonly<{
  created: boolean;
  input: RecordedTaskInput["input"];
  message: NonNullable<RecordedTaskInput["message"]>;
  subject: PersistedShoppingSubject;
}>;

export class ShoppingSubjectConflictError extends Error {
  constructor(readonly taskId: string) {
    super(`Shopping task ${taskId} already has a different shopping subject`);
    this.name = "ShoppingSubjectConflictError";
  }
}

export class ShoppingSubjectNotFoundError extends Error {
  constructor(readonly taskId: string) {
    super(`Shopping task ${taskId} has no bound shopping subject`);
    this.name = "ShoppingSubjectNotFoundError";
  }
}

export class ShoppingSubjectInitialRevisionError extends Error {
  constructor(
    readonly taskId: string,
    readonly currentRevision: bigint,
  ) {
    super(
      `Shopping subject must be bound at initial revision 0, but task ${taskId} is at revision ${currentRevision}`,
    );
    this.name = "ShoppingSubjectInitialRevisionError";
  }
}

export class ShoppingSubjectInitialInputError extends Error {
  constructor(readonly taskId: string) {
    super(
      `Shopping subject cannot be bound after task ${taskId} has already received input`,
    );
    this.name = "ShoppingSubjectInitialInputError";
  }
}

function corrupt(taskId: string, message: string): never {
  throw new PersistedDataCorruptionError({
    recordType: "ShoppingTaskSubject",
    recordId: taskId,
    cause: new Error(message),
  });
}

export async function loadShoppingSubjectInTransaction(options: {
  tx: ShoppingTransaction;
  taskId: unknown;
}): Promise<PersistedShoppingSubject | null> {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const [binding] = await options.tx
    .select()
    .from(shoppingTaskSubjects)
    .where(eq(shoppingTaskSubjects.taskId, taskId))
    .limit(1);
  if (binding === undefined) return null;

  try {
    const sourceInputId = taskInputIdSchema.parse(binding.taskInputId);
    const userMessageId = userMessageIdSchema.parse(binding.userMessageId);
    const [[inputRow], [messageRow]] = await Promise.all([
      options.tx
        .select()
        .from(taskInputs)
        .where(
          and(eq(taskInputs.taskId, taskId), eq(taskInputs.id, sourceInputId)),
        )
        .limit(1),
      options.tx
        .select()
        .from(userMessages)
        .where(
          and(
            eq(userMessages.taskId, taskId),
            eq(userMessages.taskInputId, sourceInputId),
            eq(userMessages.id, userMessageId),
          ),
        )
        .limit(1),
    ]);
    if (inputRow === undefined || messageRow === undefined) {
      return corrupt(taskId, "Bound subject has no exact persisted message");
    }
    const input = mapTaskInput(inputRow);
    const message = mapUserMessage(messageRow);
    if (
      input.inputSchemaVersion !== TASK_INPUT_SCHEMA_VERSION ||
      input.inputPayload.kind !== "message" ||
      input.expectedRevision !== 0n ||
      message.taskId !== taskId ||
      message.taskInputId !== sourceInputId ||
      message.receivedAtRevision !== input.expectedRevision
    ) {
      return corrupt(
        taskId,
        "Bound subject is not the task's exact initial V1 message",
      );
    }
    return {
      taskId,
      sourceInputId,
      userMessageId,
      body: message.body,
      createdAt: binding.createdAt,
    };
  } catch (cause) {
    if (cause instanceof PersistedDataCorruptionError) throw cause;
    throw new PersistedDataCorruptionError({
      recordType: "ShoppingTaskSubject",
      recordId: taskId,
      cause,
    });
  }
}

/**
 * Records the first shopper message and binds it as the task's immutable
 * shopping subject in the same transaction. Later turns must use the normal
 * input/answer recorders; they can change criteria but never this identity.
 */
export async function recordInitialShoppingSubject(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  clientActionId: string;
  request: unknown;
  inputId?: unknown;
  messageId?: unknown;
}): Promise<RecordedShoppingSubject> {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const request = taskInputRequestSchema.parse(options.request);
  if (
    request.inputSchemaVersion !== TASK_INPUT_SCHEMA_VERSION ||
    request.kind !== "message" ||
    request.expectedRevision !== 0n
  ) {
    throw new TypeError(
      "Shopping subjects require an initial revision-0 V1 message",
    );
  }

  return options.db.transaction(async (tx) => {
    const [task] = await tx
      .select({ currentRevision: shoppingTasks.currentRevision })
      .from(shoppingTasks)
      .where(eq(shoppingTasks.id, taskId))
      .for("update")
      .limit(1);
    if (task === undefined) throw new TaskNotFoundError(taskId);

    const existing = await loadShoppingSubjectInTransaction({ tx, taskId });
    if (existing !== null) {
      const recorded = await recordTaskInputInTransaction({
        tx,
        taskId,
        clientActionId: options.clientActionId,
        request,
        ...(options.inputId === undefined ? {} : { inputId: options.inputId }),
        ...(options.messageId === undefined
          ? {}
          : { messageId: options.messageId }),
      });
      if (recorded.message === null) {
        return corrupt(taskId, "Initial message recorder returned no message");
      }
      if (
        existing.sourceInputId !== recorded.input.id ||
        existing.userMessageId !== recorded.message.id
      ) {
        throw new ShoppingSubjectConflictError(taskId);
      }
      return {
        created: false,
        input: recorded.input,
        message: recorded.message,
        subject: existing,
      };
    }

    if (task.currentRevision !== 0n) {
      throw new ShoppingSubjectInitialRevisionError(
        taskId,
        task.currentRevision,
      );
    }
    const [priorInput] = await tx
      .select({ id: taskInputs.id })
      .from(taskInputs)
      .where(eq(taskInputs.taskId, taskId))
      .limit(1);
    if (priorInput !== undefined) {
      throw new ShoppingSubjectInitialInputError(taskId);
    }
    const recorded = await recordTaskInputInTransaction({
      tx,
      taskId,
      clientActionId: options.clientActionId,
      request,
      ...(options.inputId === undefined ? {} : { inputId: options.inputId }),
      ...(options.messageId === undefined
        ? {}
        : { messageId: options.messageId }),
    });
    if (recorded.message === null) {
      return corrupt(taskId, "Initial message recorder returned no message");
    }
    const [binding] = await tx
      .insert(shoppingTaskSubjects)
      .values({
        taskId,
        taskInputId: recorded.input.id,
        userMessageId: recorded.message.id,
      })
      .returning();
    if (binding === undefined) {
      throw new Error("Shopping subject insert returned no row");
    }
    return {
      created: true,
      input: recorded.input,
      message: recorded.message,
      subject: {
        taskId,
        sourceInputId: recorded.input.id,
        userMessageId: recorded.message.id,
        body: recorded.message.body,
        createdAt: binding.createdAt,
      },
    };
  });
}
