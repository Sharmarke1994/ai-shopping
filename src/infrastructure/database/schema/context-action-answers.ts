import { foreignKey, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { contextActions } from "./context-actions";
import { shoppingPrivate } from "./shopping-private";
import { taskInputs } from "./task-inputs";

export const contextActionAnswers = shoppingPrivate.table(
  "context_action_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull(),
    contextActionId: uuid("context_action_id").notNull(),
    answerTaskInputId: uuid("answer_task_input_id").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("context_action_answers_task_action_unique").on(
      table.taskId,
      table.contextActionId,
    ),
    unique("context_action_answers_task_input_unique").on(
      table.taskId,
      table.answerTaskInputId,
    ),
    foreignKey({
      name: "context_action_answers_action_fk",
      columns: [table.taskId, table.contextActionId],
      foreignColumns: [contextActions.taskId, contextActions.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "context_action_answers_input_fk",
      columns: [table.taskId, table.answerTaskInputId],
      foreignColumns: [taskInputs.taskId, taskInputs.id],
    }).onDelete("restrict"),
  ],
);
