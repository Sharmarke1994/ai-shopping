import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { decisionCriteria } from "./decision-criteria";
import { shoppingPrivate } from "./shopping-private";
import { shoppingTasks } from "./shopping-tasks";
import { taskInputs } from "./task-inputs";
import { userMessages } from "./user-messages";

export const criterionSources = shoppingPrivate.table(
  "criterion_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull(),
    criterionId: uuid("criterion_id").notNull(),
    sourceRole: text("source_role").notNull(),
    sourceKind: text("source_kind").notNull(),
    taskInputId: uuid("task_input_id").notNull(),
    messageId: uuid("message_id"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("criterion_sources_task_id_id_unique").on(table.taskId, table.id),
    unique("criterion_sources_role_input_unique").on(
      table.criterionId,
      table.sourceRole,
      table.taskInputId,
    ),
    foreignKey({
      name: "criterion_sources_task_fk",
      columns: [table.taskId],
      foreignColumns: [shoppingTasks.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "criterion_sources_criterion_fk",
      columns: [table.taskId, table.criterionId],
      foreignColumns: [decisionCriteria.taskId, decisionCriteria.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "criterion_sources_input_fk",
      columns: [table.taskId, table.taskInputId],
      foreignColumns: [taskInputs.taskId, taskInputs.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "criterion_sources_exact_message_fk",
      columns: [table.taskId, table.taskInputId, table.messageId],
      foreignColumns: [
        userMessages.taskId,
        userMessages.taskInputId,
        userMessages.id,
      ],
    }).onDelete("restrict"),
    check(
      "criterion_sources_role_allowed",
      sql`${table.sourceRole} in ('origin', 'confirmation', 'change')`,
    ),
    check(
      "criterion_sources_kind_allowed",
      sql`${table.sourceKind} in ('message', 'question_answer', 'direct_brief_action')`,
    ),
    check(
      "criterion_sources_message_shape",
      sql`(${table.sourceKind} = 'message' and ${table.messageId} is not null) or (${table.sourceKind} <> 'message' and ${table.messageId} is null)`,
    ),
  ],
);
