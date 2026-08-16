import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { shoppingPrivate } from "./shopping-private";
import { shoppingTasks } from "./shopping-tasks";
import { taskInputs } from "./task-inputs";

export const userMessages = shoppingPrivate.table(
  "user_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull(),
    taskInputId: uuid("task_input_id").notNull(),
    body: text("body").notNull(),
    receivedAtRevision: bigint("received_at_revision", {
      mode: "bigint",
    }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("user_messages_task_id_id_unique").on(table.taskId, table.id),
    unique("user_messages_task_input_unique").on(
      table.taskId,
      table.taskInputId,
    ),
    unique("user_messages_exact_source_unique").on(
      table.taskId,
      table.taskInputId,
      table.id,
    ),
    foreignKey({
      name: "user_messages_task_fk",
      columns: [table.taskId],
      foreignColumns: [shoppingTasks.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "user_messages_input_fk",
      columns: [table.taskId, table.taskInputId],
      foreignColumns: [taskInputs.taskId, taskInputs.id],
    }).onDelete("restrict"),
    check(
      "user_messages_body_shape",
      sql`char_length(${table.body}) between 1 and 10000 and ${table.body} ~ '[^[:space:]]'`,
    ),
    check(
      "user_messages_revision_nonnegative",
      sql`${table.receivedAtRevision} >= 0`,
    ),
  ],
);
