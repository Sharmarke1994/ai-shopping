import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { shoppingPrivate } from "./shopping-private";
import { taskInputs } from "./task-inputs";

// Immutable references, never generated explanations or a second shopper state.
export const decisionRefinementBases = shoppingPrivate.table(
  "decision_refinement_bases",
  {
    sourceTaskInputId: uuid("source_task_input_id").primaryKey(),
    taskId: uuid("task_id").notNull(),
    taskRevision: bigint("task_revision", { mode: "bigint" }).notNull(),
    assessmentIds: uuid("assessment_ids").array().notNull(),
    sourceIds: uuid("source_ids").array().notNull(),
    rejectedListingIds: uuid("rejected_listing_ids").array().notNull(),
    capturedAt: timestamp("captured_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "decision_refinement_bases_sources",
      sql`cardinality(${table.sourceIds}) <= 10000 and array_position(${table.sourceIds}, null) is null`,
    ),
    foreignKey({
      name: "decision_refinement_bases_input_fk",
      columns: [table.taskId, table.sourceTaskInputId],
      foreignColumns: [taskInputs.taskId, taskInputs.id],
    }).onDelete("restrict"),
    check(
      "decision_refinement_bases_revision",
      sql`${table.taskRevision} >= 1`,
    ),
    check(
      "decision_refinement_bases_arrays",
      sql`cardinality(${table.assessmentIds}) between 1 and 10000 and array_position(${table.assessmentIds}, null) is null and cardinality(${table.rejectedListingIds}) <= 10000 and array_position(${table.rejectedListingIds}, null) is null`,
    ),
  ],
);
