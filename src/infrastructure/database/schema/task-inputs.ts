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
  uuid,
} from "drizzle-orm/pg-core";
import { shoppingPrivate } from "./shopping-private";
import { shoppingTasks } from "./shopping-tasks";

export const taskInputs = shoppingPrivate.table(
  "task_inputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull(),
    clientActionId: text("client_action_id").notNull(),
    inputKind: text("input_kind").notNull(),
    inputSchemaVersion: integer("input_schema_version").notNull(),
    inputPayload: jsonb("input_payload").$type<unknown>().notNull(),
    fingerprintVersion: integer("fingerprint_version").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    expectedRevision: bigint("expected_revision", { mode: "bigint" }).notNull(),
    receivedAt: timestamp("received_at", {
      mode: "date",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("task_inputs_task_id_id_unique").on(table.taskId, table.id),
    unique("task_inputs_task_client_action_unique").on(
      table.taskId,
      table.clientActionId,
    ),
    foreignKey({
      name: "task_inputs_task_fk",
      columns: [table.taskId],
      foreignColumns: [shoppingTasks.id],
    }).onDelete("restrict"),
    check(
      "task_inputs_client_action_shape",
      sql`char_length(${table.clientActionId}) between 1 and 160 and ${table.clientActionId} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'`,
    ),
    check(
      "task_inputs_kind_allowed",
      sql`${table.inputKind} in ('message', 'question_answer', 'direct_brief_action')`,
    ),
    check(
      "task_inputs_schema_version_positive",
      sql`${table.inputSchemaVersion} > 0`,
    ),
    check(
      "task_inputs_payload_object",
      sql`jsonb_typeof(${table.inputPayload}) is not distinct from 'object'`,
    ),
    check(
      "task_inputs_payload_discriminators_match",
      sql`(${table.inputPayload} ->> 'kind') is not distinct from ${table.inputKind} and coalesce(${table.inputPayload} ->> 'schemaVersion', '') ~ '^[1-9][0-9]*$' and (${table.inputPayload} ->> 'schemaVersion')::integer = ${table.inputSchemaVersion}`,
    ),
    check(
      "task_inputs_fingerprint_version_positive",
      sql`${table.fingerprintVersion} > 0`,
    ),
    check(
      "task_inputs_fingerprint_shape",
      sql`${table.requestFingerprint} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "task_inputs_expected_revision_nonnegative",
      sql`${table.expectedRevision} >= 0`,
    ),
  ],
);
