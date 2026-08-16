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

export const conceptDefinitions = shoppingPrivate.table(
  "concept_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull(),
    label: text("label").notNull(),
    definition: text("definition").notNull(),
    valueFamily: text("value_family").notNull(),
    canonicalUnit: text("canonical_unit"),
    createdRevision: bigint("created_revision", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("concept_definitions_task_id_id_unique").on(table.taskId, table.id),
    foreignKey({
      name: "concept_definitions_task_fk",
      columns: [table.taskId],
      foreignColumns: [shoppingTasks.id],
    }).onDelete("restrict"),
    check(
      "concept_definitions_label_shape",
      sql`char_length(btrim(${table.label})) between 1 and 120`,
    ),
    check(
      "concept_definitions_definition_shape",
      sql`char_length(btrim(${table.definition})) between 1 and 500`,
    ),
    check(
      "concept_definitions_family_allowed",
      sql`${table.valueFamily} in ('boolean', 'qualitative', 'measurement', 'money', 'categorical')`,
    ),
    check(
      "concept_definitions_unit_shape",
      sql`(${table.valueFamily} = 'measurement' and ${table.canonicalUnit} is not null and ${table.canonicalUnit} in ('mm', 'cm', 'm', 'g', 'kg')) or (${table.valueFamily} <> 'measurement' and ${table.canonicalUnit} is null)`,
    ),
    check(
      "concept_definitions_revision_nonnegative",
      sql`${table.createdRevision} >= 0`,
    ),
  ],
);
