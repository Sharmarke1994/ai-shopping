import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { searchHypotheses } from "./search-hypotheses";
import { searchRuns } from "./search-runs";
import { shoppingPrivate } from "./shopping-private";

export const searchQueries = shoppingPrivate.table(
  "search_queries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull(),
    runId: uuid("run_id").notNull(),
    hypothesisId: uuid("hypothesis_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    purpose: text("purpose").notNull(),
    queryText: text("query_text").notNull(),
    surface: text("surface").notNull(),
    candidateLimit: integer("candidate_limit").notNull(),
    provider: text("provider").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("search_queries_task_id_id_unique").on(table.taskId, table.id),
    unique("search_queries_task_run_id_unique").on(
      table.taskId,
      table.runId,
      table.id,
    ),
    unique("search_queries_exact_provider_surface_unique").on(
      table.taskId,
      table.runId,
      table.id,
      table.provider,
      table.surface,
    ),
    unique("search_queries_run_ordinal_unique").on(
      table.taskId,
      table.runId,
      table.ordinal,
    ),
    unique("search_queries_hypothesis_unique").on(
      table.taskId,
      table.runId,
      table.hypothesisId,
    ),
    foreignKey({
      name: "search_queries_run_provider_fk",
      columns: [table.taskId, table.runId, table.provider],
      foreignColumns: [searchRuns.taskId, searchRuns.id, searchRuns.provider],
    }).onDelete("restrict"),
    foreignKey({
      name: "search_queries_hypothesis_fk",
      columns: [table.taskId, table.runId, table.hypothesisId],
      foreignColumns: [
        searchHypotheses.taskId,
        searchHypotheses.runId,
        searchHypotheses.id,
      ],
    }).onDelete("restrict"),
    check(
      "search_queries_ordinal_bounds",
      sql`${table.ordinal} between 0 and 2`,
    ),
    check(
      "search_queries_purpose_allowed",
      sql`${table.purpose} in ('literal_precision', 'brief_recall', 'market_language')`,
    ),
    check(
      "search_queries_text_bounds",
      sql`char_length(btrim(${table.queryText})) between 1 and 240`,
    ),
    check("search_queries_surface_allowed", sql`${table.surface} = 'shopping'`),
    check(
      "search_queries_candidate_limit_bounds",
      sql`${table.candidateLimit} between 1 and 20`,
    ),
    check(
      "search_queries_provider_allowed",
      sql`${table.provider} in ('serper', 'fixture')`,
    ),
  ],
);
