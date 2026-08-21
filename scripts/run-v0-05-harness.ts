import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  formatBriefItem,
  projectShoppingBrief,
} from "../src/domain/shopping-state/brief";
import { acquireShoppingContext } from "../src/features/context-acquisition/coordinator";
import { createOpenAIContextAcquisitionModel } from "../src/features/context-acquisition/openai-adapter";
import { recordContextActionAnswer } from "../src/features/context-acquisition/persistence/context-action-answers";
import type { PersistedContextAction } from "../src/features/context-acquisition/persistence/context-actions";
import { recordTaskInput } from "../src/features/shopping-state/persistence/inputs-and-messages";
import { loadCurrentShoppingState } from "../src/features/shopping-state/persistence/state-loaders";
import { createShoppingTask } from "../src/features/shopping-state/persistence/tasks";
import { createRuntimeDatabaseConnection } from "../src/infrastructure/database/clients";

const terminal = createInterface({ input: stdin, output: stdout });
const connection = createRuntimeDatabaseConnection();

try {
  const task = await createShoppingTask(connection.db);
  const model = createOpenAIContextAcquisitionModel();
  let pendingQuestion: Extract<
    PersistedContextAction,
    { action: "ask" }
  > | null = null;

  stdout.write(`AI Shopping conversation ${task.id}\n`);
  stdout.write("Type a shopping request, a follow-up, /brief, or /quit.\n\n");

  while (true) {
    if (pendingQuestion !== null) {
      stdout.write(`AI: ${pendingQuestion.question.prompt}\n`);
      pendingQuestion.question.options.forEach((option, index) => {
        stdout.write(`  ${index + 1}. ${option.label}\n`);
      });
    }
    const entered = await terminal.question("You: ");
    if (entered.trim() === "/quit") break;
    if (entered.trim() === "/brief") {
      await printBrief(task.id);
      continue;
    }
    if (entered.trim().length === 0) continue;

    const state = await loadCurrentShoppingState(connection.db, task.id);
    const clientActionId = `harness:${randomUUID()}`;
    const input =
      pendingQuestion === null
        ? await recordTaskInput({
            db: connection.db,
            taskId: task.id,
            clientActionId,
            request: {
              inputSchemaVersion: 1,
              expectedRevision: state.task.currentRevision,
              kind: "message",
              body: entered,
            },
          })
        : await recordAnswer({
            action: pendingQuestion,
            entered,
            revision: state.task.currentRevision,
            clientActionId,
          });
    pendingQuestion = null;

    const result = await acquireShoppingContext({
      db: connection.db,
      model,
      taskId: task.id,
      sourceInputId: input.input.id,
    });
    if (result.status === "failed") {
      stdout.write(
        `AI: I could not safely process that (${result.errorCode}).\n\n`,
      );
      continue;
    }

    await printBrief(task.id);
    if (result.action.action === "ask") {
      pendingQuestion = result.action;
    } else if (result.action.action === "search") {
      stdout.write(
        "AI: The brief is ready to search. Retrieval begins in V0-06.\n\n",
      );
    } else {
      stdout.write(`AI: ${result.action.rationale}\n\n`);
    }
  }

  async function recordAnswer(options: {
    action: Extract<PersistedContextAction, { action: "ask" }>;
    entered: string;
    revision: bigint;
    clientActionId: string;
  }) {
    const answer =
      options.action.question.responseMode === "open_text"
        ? { mode: "open_text" as const, text: options.entered }
        : selectedOption(options.action, options.entered);
    return recordContextActionAnswer({
      db: connection.db,
      taskId: task.id,
      clientActionId: options.clientActionId,
      request: {
        inputSchemaVersion: 2,
        expectedRevision: options.revision,
        kind: "question_answer",
        questionId: options.action.id,
        answer,
      },
    });
  }

  async function printBrief(taskId: string) {
    const state = await loadCurrentShoppingState(connection.db, taskId);
    const brief = projectShoppingBrief(state);
    stdout.write("\nAI understands:\n");
    if (brief.items.length === 0)
      stdout.write("  (no explicit criteria yet)\n");
    for (const item of brief.items) {
      stdout.write(
        `  • ${item.conceptLabel}: ${formatBriefItem(item, state.task.market)}\n`,
      );
    }
    stdout.write("\n");
  }
} finally {
  terminal.close();
  await connection.close();
}

function selectedOption(
  action: Extract<PersistedContextAction, { action: "ask" }>,
  entered: string,
) {
  const index = Number.parseInt(entered.trim(), 10) - 1;
  const option = action.question.options[index];
  if (option === undefined) {
    throw new Error("Enter the number of one visible option");
  }
  return { mode: "single_select" as const, optionId: option.id };
}
