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
import { searchQueries } from "./search-queries";
import { searchRuns } from "./search-runs";
import { shoppingPrivate } from "./shopping-private";

export const searchQueryExecutions = shoppingPrivate.table(
  "search_query_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull(),
    runId: uuid("run_id").notNull(),
    queryId: uuid("query_id").notNull(),
    status: text("status").notNull(),
    receivedResultCount: integer("received_result_count"),
    rejectedResultCount: integer("rejected_result_count"),
    providerRequestId: text("provider_request_id"),
    failureCode: text("failure_code"),
    startedAt: timestamp("started_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    finishedAt: timestamp("finished_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("search_query_executions_task_id_id_unique").on(
      table.taskId,
      table.id,
    ),
    unique("search_query_executions_query_unique").on(
      table.taskId,
      table.runId,
      table.queryId,
    ),
    unique("search_query_executions_exact_query_id_unique").on(
      table.taskId,
      table.runId,
      table.queryId,
      table.id,
    ),
    foreignKey({
      name: "search_query_executions_run_fk",
      columns: [table.taskId, table.runId],
      foreignColumns: [searchRuns.taskId, searchRuns.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "search_query_executions_query_fk",
      columns: [table.taskId, table.runId, table.queryId],
      foreignColumns: [
        searchQueries.taskId,
        searchQueries.runId,
        searchQueries.id,
      ],
    }).onDelete("restrict"),
    check(
      "search_query_executions_status_allowed",
      sql`${table.status} in ('succeeded', 'failed')`,
    ),
    check(
      "search_query_executions_count_shape",
      sql`(${table.receivedResultCount} is null or ${table.receivedResultCount} >= 0) and (${table.rejectedResultCount} is null or ${table.rejectedResultCount} >= 0) and (${table.receivedResultCount} is null or ${table.rejectedResultCount} is null or ${table.rejectedResultCount} <= ${table.receivedResultCount})`,
    ),
    check(
      "search_query_executions_terminal_shape",
      sql`(${table.status} = 'succeeded' and ${table.receivedResultCount} is not null and ${table.rejectedResultCount} is not null and ${table.failureCode} is null) or (${table.status} = 'failed' and ${table.receivedResultCount} is null and ${table.rejectedResultCount} is null and ${table.failureCode} is not null and ${table.failureCode} in ('provider_failed', 'invalid_provider_result'))`,
    ),
    check(
      "search_query_executions_diagnostic_text_bounds",
      sql`(${table.providerRequestId} is null or char_length(btrim(${table.providerRequestId})) between 1 and 240) and (${table.failureCode} is null or ${table.failureCode} in ('provider_failed', 'invalid_provider_result'))`,
    ),
    check(
      "search_query_executions_timestamp_order",
      sql`${table.finishedAt} >= ${table.startedAt}`,
    ),
  ],
);
