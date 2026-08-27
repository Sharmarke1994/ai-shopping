import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  integer,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { decisionCriteria } from "./decision-criteria";
import { searchRuns } from "./search-runs";
import { shoppingPrivate } from "./shopping-private";

export const searchHypotheses = shoppingPrivate.table(
  "search_hypotheses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull(),
    runId: uuid("run_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    kind: text("kind").notNull(),
    rationale: text("rationale").notNull(),
    sourceTextIsBasis: boolean("source_text_is_basis").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("search_hypotheses_task_id_id_unique").on(table.taskId, table.id),
    unique("search_hypotheses_task_run_id_unique").on(
      table.taskId,
      table.runId,
      table.id,
    ),
    unique("search_hypotheses_run_ordinal_unique").on(
      table.taskId,
      table.runId,
      table.ordinal,
    ),
    foreignKey({
      name: "search_hypotheses_run_fk",
      columns: [table.taskId, table.runId],
      foreignColumns: [searchRuns.taskId, searchRuns.id],
    }).onDelete("restrict"),
    check(
      "search_hypotheses_ordinal_bounds",
      sql`${table.ordinal} between 0 and 2`,
    ),
    check(
      "search_hypotheses_kind_allowed",
      sql`${table.kind} in ('literal', 'brief_expansion', 'market_vocabulary')`,
    ),
    check(
      "search_hypotheses_rationale_bounds",
      sql`char_length(btrim(${table.rationale})) between 1 and 500`,
    ),
  ],
);

export const searchHypothesisBasisCriteria = shoppingPrivate.table(
  "search_hypothesis_basis_criteria",
  {
    taskId: uuid("task_id").notNull(),
    runId: uuid("run_id").notNull(),
    hypothesisId: uuid("hypothesis_id").notNull(),
    criterionId: uuid("criterion_id").notNull(),
    ordinal: integer("ordinal").notNull(),
  },
  (table) => [
    primaryKey({
      name: "search_hypothesis_basis_criteria_pk",
      columns: [
        table.taskId,
        table.runId,
        table.hypothesisId,
        table.criterionId,
      ],
    }),
    unique("search_hypothesis_basis_criteria_ordinal_unique").on(
      table.taskId,
      table.runId,
      table.hypothesisId,
      table.ordinal,
    ),
    foreignKey({
      name: "search_hypothesis_basis_criteria_hypothesis_fk",
      columns: [table.taskId, table.runId, table.hypothesisId],
      foreignColumns: [
        searchHypotheses.taskId,
        searchHypotheses.runId,
        searchHypotheses.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "search_hypothesis_basis_criteria_criterion_fk",
      columns: [table.taskId, table.criterionId],
      foreignColumns: [decisionCriteria.taskId, decisionCriteria.id],
    }).onDelete("restrict"),
    check(
      "search_hypothesis_basis_criteria_ordinal_bounds",
      sql`${table.ordinal} between 0 and 19`,
    ),
  ],
);
