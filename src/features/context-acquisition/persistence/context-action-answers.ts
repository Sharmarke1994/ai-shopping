import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { PersistedDataCorruptionError } from "../../../domain/shopping-state/errors";
import {
  contextActionIdSchema,
  shoppingTaskIdSchema,
} from "../../../domain/shopping-state/ids";
import {
  QUESTION_ANSWER_INPUT_SCHEMA_VERSION,
  stableClientIdentifierSchema,
  taskInputRequestSchema,
} from "../../../domain/shopping-state/task-input";
import type { ShoppingDatabase } from "../../../infrastructure/database/clients";
import {
  contextActionAnswers,
  shoppingTasks,
} from "../../../infrastructure/database/schema";
import { recordTaskInputInTransaction } from "../../shopping-state/persistence/inputs-and-messages";
import {
  loadContextActionByIdInTransaction,
  type PersistedContextAction,
} from "./context-actions";

export class ContextQuestionNotAvailableError extends Error {
  constructor(readonly contextActionId: string) {
    super(`Context question ${contextActionId} is not available in this task`);
    this.name = "ContextQuestionNotAvailableError";
  }
}

export class ContextQuestionAlreadyAnsweredError extends Error {
  constructor(readonly contextActionId: string) {
    super(`Context question ${contextActionId} already has an answer`);
    this.name = "ContextQuestionAlreadyAnsweredError";
  }
}

export class ContextQuestionAnswerMismatchError extends Error {
  constructor(
    readonly contextActionId: string,
    message: string,
  ) {
    super(message);
    this.name = "ContextQuestionAnswerMismatchError";
  }
}

export class StaleContextQuestionError extends Error {
  constructor(
    readonly contextActionId: string,
    readonly questionRevision: bigint,
    readonly currentRevision: bigint,
  ) {
    super(
      `Context question ${contextActionId} was selected at revision ${questionRevision} but the task is at revision ${currentRevision}`,
    );
    this.name = "StaleContextQuestionError";
  }
}

type ResolvedContextAnswer =
  | Readonly<{ mode: "open_text"; text: string }>
  | Readonly<{
      mode: "single_select";
      optionId: string;
      label: string;
    }>;

export type RecordedContextActionAnswer = Readonly<{
  created: boolean;
  input: Awaited<ReturnType<typeof recordTaskInputInTransaction>>["input"];
  action: Extract<PersistedContextAction, { action: "ask" }>;
  resolvedAnswer: ResolvedContextAnswer;
}>;

function exactResolvedAnswer(
  action: Extract<PersistedContextAction, { action: "ask" }>,
  request: Extract<
    ReturnType<typeof taskInputRequestSchema.parse>,
    { inputSchemaVersion: 2; kind: "question_answer" }
  >,
): ResolvedContextAnswer {
  if (request.answer.mode !== action.question.responseMode) {
    throw new ContextQuestionAnswerMismatchError(
      action.id,
      "Answer mode does not match the stored question",
    );
  }
  if (request.answer.mode === "open_text") {
    return { mode: "open_text", text: request.answer.text };
  }
  const optionId = request.answer.optionId;
  const option = action.question.options.find(
    (candidate) => candidate.id === optionId,
  );
  if (option === undefined) {
    throw new ContextQuestionAnswerMismatchError(
      action.id,
      "Selected option does not belong to the stored question",
    );
  }
  return {
    mode: "single_select",
    optionId: option.id,
    label: option.label,
  };
}

export async function recordContextActionAnswer(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  clientActionId: string;
  request: unknown;
  inputId?: unknown;
}): Promise<RecordedContextActionAnswer> {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const clientActionId = stableClientIdentifierSchema.parse(
    options.clientActionId,
  );
  const request = taskInputRequestSchema.parse(options.request);
  if (
    request.inputSchemaVersion !== QUESTION_ANSWER_INPUT_SCHEMA_VERSION ||
    request.kind !== "question_answer"
  ) {
    throw new TypeError("Context action answers require question_answer V2");
  }
  const contextActionId = contextActionIdSchema.parse(request.questionId);

  return options.db.transaction(async (tx) => {
    const recorded = await recordTaskInputInTransaction({
      tx,
      taskId,
      clientActionId,
      request,
      ...(options.inputId === undefined ? {} : { inputId: options.inputId }),
    });

    if (!recorded.created) {
      const [binding] = await tx
        .select()
        .from(contextActionAnswers)
        .where(
          and(
            eq(contextActionAnswers.taskId, taskId),
            eq(contextActionAnswers.answerTaskInputId, recorded.input.id),
          ),
        )
        .limit(1);
      if (
        binding === undefined ||
        binding.contextActionId !== contextActionId
      ) {
        throw new PersistedDataCorruptionError({
          recordType: "ContextActionAnswer",
          recordId: recorded.input.id,
          cause: new Error(
            "A persisted V2 question answer has no exact action binding",
          ),
        });
      }
      const action = await loadContextActionByIdInTransaction({
        tx,
        taskId,
        contextActionId,
      });
      if (action === null || action.action !== "ask") {
        throw new PersistedDataCorruptionError({
          recordType: "ContextActionAnswer",
          recordId: binding.id,
          cause: new Error("The bound ASK action is missing or invalid"),
        });
      }
      return {
        created: false,
        input: recorded.input,
        action,
        resolvedAnswer: exactResolvedAnswer(action, request),
      };
    }

    const [task] = await tx
      .select({ currentRevision: shoppingTasks.currentRevision })
      .from(shoppingTasks)
      .where(eq(shoppingTasks.id, taskId))
      .for("update")
      .limit(1);
    if (task === undefined) throw new Error(`Shopping task ${taskId} missing`);

    const action = await loadContextActionByIdInTransaction({
      tx,
      taskId,
      contextActionId,
      forUpdate: true,
    });
    if (action === null || action.action !== "ask") {
      throw new ContextQuestionNotAvailableError(contextActionId);
    }
    if (
      request.expectedRevision !== action.selectedAtRevision ||
      task.currentRevision !== action.selectedAtRevision
    ) {
      throw new StaleContextQuestionError(
        contextActionId,
        action.selectedAtRevision,
        task.currentRevision,
      );
    }
    const resolvedAnswer = exactResolvedAnswer(action, request);

    const [existingAnswer] = await tx
      .select({ id: contextActionAnswers.id })
      .from(contextActionAnswers)
      .where(
        and(
          eq(contextActionAnswers.taskId, taskId),
          eq(contextActionAnswers.contextActionId, contextActionId),
        ),
      )
      .limit(1);
    if (existingAnswer !== undefined) {
      throw new ContextQuestionAlreadyAnsweredError(contextActionId);
    }

    const [binding] = await tx
      .insert(contextActionAnswers)
      .values({
        id: randomUUID(),
        taskId,
        contextActionId,
        answerTaskInputId: recorded.input.id,
      })
      .returning({ id: contextActionAnswers.id });
    if (binding === undefined) {
      throw new Error("Context action answer insert returned no row");
    }
    return {
      created: true,
      input: recorded.input,
      action,
      resolvedAnswer,
    };
  });
}
