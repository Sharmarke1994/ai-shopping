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
import { contextActions } from "./context-actions";
import { shoppingPrivate } from "./shopping-private";
import { shoppingTasks } from "./shopping-tasks";

export const searchRuns = shoppingPrivate.table(
  "search_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull(),
    contextActionId: uuid("context_action_id").notNull(),
    taskRevision: bigint("task_revision", { mode: "bigint" }).notNull(),
    marketCountry: text("market_country").notNull(),
    languageTag: text("language_tag").notNull(),
    currencyCode: text("currency_code").notNull(),
    provider: text("provider").notNull(),
    queryStrategyVersion: text("query_strategy_version").notNull(),
    status: text("status").notNull(),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", {
      mode: "date",
      withTimezone: true,
    }),
    startedAt: timestamp("started_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    finishedAt: timestamp("finished_at", {
      mode: "date",
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("search_runs_task_id_id_unique").on(table.taskId, table.id),
    unique("search_runs_task_id_id_provider_unique").on(
      table.taskId,
      table.id,
      table.provider,
    ),
    unique("search_runs_task_context_action_unique").on(
      table.taskId,
      table.contextActionId,
    ),
    foreignKey({
      name: "search_runs_task_fk",
      columns: [table.taskId],
      foreignColumns: [shoppingTasks.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "search_runs_context_action_fk",
      columns: [table.taskId, table.contextActionId],
      foreignColumns: [contextActions.taskId, contextActions.id],
    }).onDelete("restrict"),
    check("search_runs_revision_nonnegative", sql`${table.taskRevision} >= 0`),
    check(
      "search_runs_market_country_shape",
      sql`${table.marketCountry} ~ '^[A-Z]{2}$'`,
    ),
    check(
      "search_runs_language_tag_shape",
      sql`${table.languageTag} ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'`,
    ),
    check(
      "search_runs_currency_code_shape",
      sql`${table.currencyCode} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "search_runs_config_text_bounds",
      sql`char_length(btrim(${table.provider})) between 1 and 120 and char_length(btrim(${table.queryStrategyVersion})) between 1 and 120`,
    ),
    check(
      "search_runs_provider_allowed",
      sql`${table.provider} in ('serper', 'fixture')`,
    ),
    check(
      "search_runs_status_allowed",
      sql`${table.status} in ('running', 'succeeded', 'partial', 'failed')`,
    ),
    check(
      "search_runs_status_time_shape",
      sql`(${table.status} = 'running' and ${table.finishedAt} is null) or (${table.status} in ('succeeded', 'partial', 'failed') and ${table.finishedAt} is not null and ${table.finishedAt} >= ${table.startedAt})`,
    ),
    check(
      "search_runs_lease_shape",
      sql`(${table.leaseToken} is null and ${table.leaseExpiresAt} is null) or (${table.status} = 'running' and ${table.leaseToken} is not null and ${table.leaseExpiresAt} is not null)`,
    ),
  ],
);
