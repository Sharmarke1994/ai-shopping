import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { contextActions } from "./context-actions";
import { shoppingPrivate } from "./shopping-private";
import { shoppingTasks } from "./shopping-tasks";
import { taskInputs } from "./task-inputs";

/**
 * Local-founder continuity only. The client chooses the opaque session and turn
 * keys used for retry detection; every shopping-state identity remains owned by
 * the server and linked here by task-scoped foreign keys.
 */
export const founderLiveSessions = shoppingPrivate.table(
  "founder_live_sessions",
  {
    id: uuid("id").primaryKey(),
    taskId: uuid("task_id").notNull(),
    initialTurnId: uuid("initial_turn_id").notNull(),
    initialRequestFingerprint: text("initial_request_fingerprint").notNull(),
    currentContextActionId: uuid("current_context_action_id"),
    pendingTaskInputId: uuid("pending_task_input_id"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("founder_live_sessions_task_unique").on(table.taskId),
    foreignKey({
      name: "founder_live_sessions_task_fk",
      columns: [table.taskId],
      foreignColumns: [shoppingTasks.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "founder_live_sessions_current_action_fk",
      columns: [table.taskId, table.currentContextActionId],
      foreignColumns: [contextActions.taskId, contextActions.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "founder_live_sessions_pending_input_fk",
      columns: [table.taskId, table.pendingTaskInputId],
      foreignColumns: [taskInputs.taskId, taskInputs.id],
    }).onDelete("restrict"),
    check(
      "founder_live_sessions_fingerprint_shape",
      sql`${table.initialRequestFingerprint} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "founder_live_sessions_timestamp_order",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);
