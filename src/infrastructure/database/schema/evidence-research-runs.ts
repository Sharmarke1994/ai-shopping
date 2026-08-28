import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  integer,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { searchRuns } from "./search-runs";
import { shoppingPrivate } from "./shopping-private";
import { shoppingTasks } from "./shopping-tasks";

export const evidenceResearchRuns = shoppingPrivate.table(
  "evidence_research_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull(),
    searchRunId: uuid("search_run_id").notNull(),
    taskRevision: bigint("task_revision", { mode: "bigint" }).notNull(),
    policyVersion: text("policy_version").notNull(),
    status: text("status").notNull(),
    selectedCandidateCount: integer("selected_candidate_count").notNull(),
    plannedSearchCount: integer("planned_search_count").notNull(),
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
    unique("evidence_research_runs_task_id_id_unique").on(
      table.taskId,
      table.id,
    ),
    unique("evidence_research_runs_candidate_scope_unique").on(
      table.taskId,
      table.id,
      table.searchRunId,
    ),
    unique("evidence_research_runs_assessment_scope_unique").on(
      table.taskId,
      table.id,
      table.searchRunId,
      table.taskRevision,
    ),
    unique("evidence_research_runs_scope_unique").on(
      table.taskId,
      table.searchRunId,
      table.taskRevision,
      table.policyVersion,
    ),
    foreignKey({
      name: "evidence_research_runs_task_fk",
      columns: [table.taskId],
      foreignColumns: [shoppingTasks.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "evidence_research_runs_search_run_fk",
      columns: [table.taskId, table.searchRunId],
      foreignColumns: [searchRuns.taskId, searchRuns.id],
    }).onDelete("restrict"),
    check(
      "evidence_research_runs_revision_nonnegative",
      sql`${table.taskRevision} >= 0`,
    ),
    check(
      "evidence_research_runs_policy_bounds",
      sql`char_length(btrim(${table.policyVersion})) between 1 and 120`,
    ),
    check(
      "evidence_research_runs_status_allowed",
      sql`${table.status} in ('running', 'succeeded', 'partial', 'failed')`,
    ),
    check(
      "evidence_research_runs_budget_shape",
      sql`${table.selectedCandidateCount} between 1 and 8 and ${table.plannedSearchCount} between 0 and (${table.selectedCandidateCount} * 2)`,
    ),
    check(
      "evidence_research_runs_status_time_shape",
      sql`(${table.status} = 'running' and ${table.finishedAt} is null) or (${table.status} in ('succeeded', 'partial', 'failed') and ${table.finishedAt} is not null and ${table.finishedAt} >= ${table.startedAt})`,
    ),
    check(
      "evidence_research_runs_lease_shape",
      sql`(${table.leaseToken} is null and ${table.leaseExpiresAt} is null) or (${table.status} = 'running' and ${table.leaseToken} is not null and ${table.leaseExpiresAt} is not null)`,
    ),
  ],
);
