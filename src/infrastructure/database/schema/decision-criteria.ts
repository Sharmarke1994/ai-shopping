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
import { conceptDefinitions } from "./concept-definitions";
import { shoppingPrivate } from "./shopping-private";
import { shoppingTasks } from "./shopping-tasks";

export const decisionCriteria = shoppingPrivate.table(
  "decision_criteria",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull(),
    lineageId: uuid("lineage_id").notNull(),
    conceptId: uuid("concept_id").notNull(),
    authority: text("authority").notNull(),
    strength: text("strength"),
    targetSemantics: text("target_semantics").notNull(),
    valueSchemaVersion: integer("value_schema_version").notNull(),
    valueKind: text("value_kind").notNull(),
    semanticValue: jsonb("semantic_value").$type<unknown>().notNull(),
    lifecycle: text("lifecycle").notNull(),
    createdRevision: bigint("created_revision", { mode: "bigint" }).notNull(),
    endedRevision: bigint("ended_revision", { mode: "bigint" }),
    supersededById: uuid("superseded_by_id"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("decision_criteria_task_id_id_unique").on(table.taskId, table.id),
    unique("decision_criteria_successor_identity_unique").on(
      table.taskId,
      table.lineageId,
      table.conceptId,
      table.id,
    ),
    uniqueIndex("decision_criteria_one_active_lineage")
      .on(table.taskId, table.lineageId)
      .where(sql`${table.lifecycle} = 'active'`),
    foreignKey({
      name: "decision_criteria_task_fk",
      columns: [table.taskId],
      foreignColumns: [shoppingTasks.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "decision_criteria_concept_fk",
      columns: [table.taskId, table.conceptId],
      foreignColumns: [conceptDefinitions.taskId, conceptDefinitions.id],
    }).onDelete("restrict"),
    check(
      "decision_criteria_authority_allowed",
      sql`${table.authority} in ('user_explicit', 'user_confirmed')`,
    ),
    check(
      "decision_criteria_strength_allowed",
      sql`${table.strength} is null or ${table.strength} in ('hard', 'strong_preference', 'preference')`,
    ),
    check(
      "decision_criteria_target_allowed",
      sql`${table.targetSemantics} in ('exact', 'range', 'around', 'stretch', 'categorical', 'qualitative', 'comparative', 'indifferent')`,
    ),
    check(
      "decision_criteria_value_version_positive",
      sql`${table.valueSchemaVersion} > 0`,
    ),
    check(
      "decision_criteria_value_kind_allowed",
      sql`${table.valueKind} in ('boolean', 'qualitative', 'measurement', 'measurement_range', 'money', 'money_stretch', 'categorical', 'indifferent')`,
    ),
    check(
      "decision_criteria_value_object",
      sql`jsonb_typeof(${table.semanticValue}) is not distinct from 'object'`,
    ),
    check(
      "decision_criteria_value_discriminators_match",
      sql`(${table.semanticValue} ->> 'kind') is not distinct from ${table.valueKind} and coalesce(${table.semanticValue} ->> 'schemaVersion', '') ~ '^[1-9][0-9]*$' and (${table.semanticValue} ->> 'schemaVersion')::integer = ${table.valueSchemaVersion}`,
    ),
    check(
      "decision_criteria_indifference_shape",
      sql`(${table.valueKind} = 'indifferent' and ${table.targetSemantics} = 'indifferent' and ${table.strength} is null) or (${table.valueKind} <> 'indifferent' and ${table.targetSemantics} <> 'indifferent' and ${table.strength} is not null)`,
    ),
    check(
      "decision_criteria_lifecycle_allowed",
      sql`${table.lifecycle} in ('active', 'superseded', 'removed')`,
    ),
    check(
      "decision_criteria_lifecycle_shape",
      sql`(${table.lifecycle} = 'active' and ${table.endedRevision} is null and ${table.supersededById} is null) or (${table.lifecycle} = 'superseded' and ${table.endedRevision} is not null and ${table.supersededById} is not null and ${table.supersededById} <> ${table.id}) or (${table.lifecycle} = 'removed' and ${table.endedRevision} is not null and ${table.supersededById} is null)`,
    ),
    check(
      "decision_criteria_revision_shape",
      sql`${table.createdRevision} >= 0 and (${table.endedRevision} is null or ${table.endedRevision} >= ${table.createdRevision})`,
    ),
    check(
      "decision_criteria_timestamp_order",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);
