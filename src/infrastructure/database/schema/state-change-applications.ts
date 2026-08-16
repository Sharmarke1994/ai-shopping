import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { shoppingPrivate } from "./shopping-private";
import { shoppingTasks } from "./shopping-tasks";
import { taskInputs } from "./task-inputs";

export const stateChangeApplications = shoppingPrivate.table(
  "state_change_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull(),
    sourceTaskInputId: uuid("source_task_input_id").notNull(),
    applicationKind: text("application_kind").notNull(),
    requestSchemaVersion: integer("request_schema_version").notNull(),
    fingerprintVersion: integer("fingerprint_version").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    baseRevision: bigint("base_revision", { mode: "bigint" }).notNull(),
    resultingRevision: bigint("resulting_revision", {
      mode: "bigint",
    }).notNull(),
    outcome: text("outcome").notNull(),
    deltaSchemaVersion: integer("delta_schema_version").notNull(),
    appliedDelta: jsonb("applied_delta").$type<unknown>().notNull(),
    undoesApplicationId: uuid("undoes_application_id"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("state_change_applications_task_id_id_unique").on(
      table.taskId,
      table.id,
    ),
    unique("state_change_applications_task_source_unique").on(
      table.taskId,
      table.sourceTaskInputId,
    ),
    uniqueIndex("state_change_applications_one_undo_per_target")
      .on(table.taskId, table.undoesApplicationId)
      .where(sql`${table.undoesApplicationId} is not null`),
    foreignKey({
      name: "state_change_applications_task_fk",
      columns: [table.taskId],
      foreignColumns: [shoppingTasks.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "state_change_applications_source_input_fk",
      columns: [table.taskId, table.sourceTaskInputId],
      foreignColumns: [taskInputs.taskId, taskInputs.id],
    }).onDelete("restrict"),
    check(
      "state_change_applications_kind_allowed",
      sql`${table.applicationKind} in ('patch', 'undo')`,
    ),
    check(
      "state_change_applications_outcome_allowed",
      sql`${table.outcome} in ('applied', 'no_change')`,
    ),
    check(
      "state_change_applications_versions_positive",
      sql`${table.requestSchemaVersion} > 0 and ${table.fingerprintVersion} > 0 and ${table.deltaSchemaVersion} > 0`,
    ),
    check(
      "state_change_applications_fingerprint_shape",
      sql`${table.requestFingerprint} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "state_change_applications_revision_shape",
      sql`${table.baseRevision} >= 0 and ((${table.outcome} = 'no_change' and ${table.resultingRevision} = ${table.baseRevision}) or (${table.outcome} = 'applied' and ${table.resultingRevision} = ${table.baseRevision} + 1))`,
    ),
    check(
      "state_change_applications_undo_shape",
      sql`(${table.applicationKind} = 'patch' and ${table.undoesApplicationId} is null) or (${table.applicationKind} = 'undo' and ${table.undoesApplicationId} is not null and ${table.outcome} = 'applied')`,
    ),
    check(
      "state_change_applications_delta_object",
      sql`jsonb_typeof(${table.appliedDelta}) is not distinct from 'object'`,
    ),
    check(
      "state_change_applications_delta_shape",
      sql`coalesce(${table.appliedDelta} ->> 'schemaVersion', '') ~ '^[1-9][0-9]*$' and (${table.appliedDelta} ->> 'schemaVersion')::integer = ${table.deltaSchemaVersion} and jsonb_typeof(${table.appliedDelta} -> 'entries') is not distinct from 'array'`,
    ),
    check(
      "state_change_applications_delta_outcome",
      sql`(${table.outcome} = 'no_change' and jsonb_array_length(${table.appliedDelta} -> 'entries') = 0) or (${table.outcome} = 'applied' and jsonb_array_length(${table.appliedDelta} -> 'entries') > 0)`,
    ),
  ],
);
