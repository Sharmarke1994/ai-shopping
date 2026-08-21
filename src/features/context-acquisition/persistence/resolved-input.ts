import { and, eq } from "drizzle-orm";
import { PersistedDataCorruptionError } from "@/domain/shopping-state/errors";
import {
  shoppingTaskIdSchema,
  taskInputIdSchema,
} from "@/domain/shopping-state/ids";
import type { ShoppingDatabase } from "@/infrastructure/database/clients";
import {
  contextActionAnswers,
  taskInputs,
  userMessages,
} from "@/infrastructure/database/schema";
import {
  mapTaskInput,
  mapUserMessage,
} from "@/features/shopping-state/persistence/mappers";
import {
  resolvedShoppingInputV1Schema,
  type ResolvedShoppingInputV1,
} from "../contracts";
import { loadContextActionByIdInTransaction } from "./context-actions";

export class StoredShoppingInputNotFoundError extends Error {
  constructor(readonly inputId: string) {
    super(`Stored shopping input ${inputId} was not found in this task`);
    this.name = "StoredShoppingInputNotFoundError";
  }
}

export async function resolveStoredShoppingInput(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  inputId: unknown;
}): Promise<ResolvedShoppingInputV1> {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const inputId = taskInputIdSchema.parse(options.inputId);

  return options.db.transaction(async (tx) => {
    const [inputRow] = await tx
      .select()
      .from(taskInputs)
      .where(and(eq(taskInputs.taskId, taskId), eq(taskInputs.id, inputId)))
      .limit(1);
    if (inputRow === undefined)
      throw new StoredShoppingInputNotFoundError(inputId);
    const input = mapTaskInput(inputRow);

    switch (input.inputPayload.kind) {
      case "message": {
        const [messageRow] = await tx
          .select()
          .from(userMessages)
          .where(
            and(
              eq(userMessages.taskId, taskId),
              eq(userMessages.taskInputId, inputId),
            ),
          )
          .limit(1);
        if (messageRow === undefined) {
          return corrupt(inputId, "Message input has no exact UserMessage");
        }
        const message = mapUserMessage(messageRow);
        if (message.receivedAtRevision !== input.expectedRevision) {
          return corrupt(
            inputId,
            "Message revision differs from its TaskInput",
          );
        }
        return resolvedShoppingInputV1Schema.parse({
          schemaVersion: 1,
          kind: "message",
          body: message.body,
        });
      }
      case "direct_brief_action":
        return resolvedShoppingInputV1Schema.parse({
          schemaVersion: 1,
          kind: "direct_brief_action",
          controlId: input.inputPayload.controlId,
          submittedText: input.inputPayload.submittedText,
        });
      case "question_answer": {
        if (input.inputPayload.schemaVersion === 1) {
          return resolvedShoppingInputV1Schema.parse({
            schemaVersion: 1,
            kind: "legacy_question_answer",
            questionId: input.inputPayload.questionId,
            optionId: input.inputPayload.optionId,
            answerText: input.inputPayload.answerText,
          });
        }

        const [binding] = await tx
          .select()
          .from(contextActionAnswers)
          .where(
            and(
              eq(contextActionAnswers.taskId, taskId),
              eq(contextActionAnswers.answerTaskInputId, inputId),
            ),
          )
          .limit(1);
        if (
          binding === undefined ||
          binding.contextActionId !== input.inputPayload.questionId
        ) {
          return corrupt(
            inputId,
            "Question-answer V2 has no exact context-action binding",
          );
        }
        const action = await loadContextActionByIdInTransaction({
          tx,
          taskId,
          contextActionId: binding.contextActionId,
        });
        if (action === null || action.action !== "ask") {
          return corrupt(inputId, "Question-answer V2 is not bound to an ASK");
        }
        if (input.inputPayload.answer.mode !== action.question.responseMode) {
          return corrupt(
            inputId,
            "Answer mode differs from the stored question",
          );
        }
        if (input.inputPayload.answer.mode === "open_text") {
          return resolvedShoppingInputV1Schema.parse({
            schemaVersion: 1,
            kind: "question_answer",
            questionId: action.id,
            prompt: action.question.prompt,
            answer: input.inputPayload.answer,
          });
        }
        const answer = input.inputPayload.answer;
        const option = action.question.options.find(
          ({ id }) => id === answer.optionId,
        );
        if (option === undefined) {
          return corrupt(
            inputId,
            "Selected option is not owned by the question",
          );
        }
        return resolvedShoppingInputV1Schema.parse({
          schemaVersion: 1,
          kind: "question_answer",
          questionId: action.id,
          prompt: action.question.prompt,
          answer: {
            mode: "single_select",
            optionId: option.id,
            label: option.label,
          },
        });
      }
    }
  });
}

function corrupt(inputId: string, message: string): never {
  throw new PersistedDataCorruptionError({
    recordType: "TaskInput",
    recordId: inputId,
    cause: new Error(message),
  });
}
