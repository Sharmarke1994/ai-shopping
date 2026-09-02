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
import { contextActions } from "./context-actions";
import { shoppingPrivate } from "./shopping-private";
import { stateChangeApplications } from "./state-change-applications";
import { taskInputs } from "./task-inputs";

export const contextAcquisitionAttempts = shoppingPrivate.table(
  "context_acquisition_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orchestrationRunId: uuid("orchestration_run_id").notNull(),
    taskId: uuid("task_id").notNull(),
    sourceTaskInputId: uuid("source_task_input_id").notNull(),
    snapshotRevision: bigint("snapshot_revision", { mode: "bigint" }).notNull(),
    stage: text("stage").notNull(),
    attemptOrdinal: integer("attempt_ordinal").notNull(),
    status: text("status").notNull(),
    provider: text("provider"),
    model: text("model"),
    promptVersion: text("prompt_version").notNull(),
    providerSchemaVersion: integer("provider_schema_version").notNull(),
    providerRequestId: text("provider_request_id"),
    durationMs: integer("duration_ms").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    interpretationProposal: jsonb("interpretation_proposal").$type<unknown>(),
    contextActionProposal: jsonb("context_action_proposal").$type<unknown>(),
    coverageDiagnostic: jsonb("coverage_diagnostic").$type<unknown>(),
    errorCode: text("error_code"),
    stateChangeApplicationId: uuid("state_change_application_id"),
    contextActionId: uuid("context_action_id"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("context_acquisition_attempts_run_stage_ordinal_unique").on(
      table.orchestrationRunId,
      table.stage,
      table.attemptOrdinal,
    ),
    foreignKey({
      name: "context_acquisition_attempts_input_fk",
      columns: [table.taskId, table.sourceTaskInputId],
      foreignColumns: [taskInputs.taskId, taskInputs.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "context_acquisition_attempts_application_fk",
      columns: [table.taskId, table.stateChangeApplicationId],
      foreignColumns: [
        stateChangeApplications.taskId,
        stateChangeApplications.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "context_acquisition_attempts_action_fk",
      columns: [table.taskId, table.contextActionId],
      foreignColumns: [contextActions.taskId, contextActions.id],
    }).onDelete("restrict"),
    check(
      "context_acquisition_attempts_stage_allowed",
      sql`${table.stage} in ('interpretation', 'interpretation_coverage', 'interpretation_repair', 'interpretation_repair_coverage', 'context_action')`,
    ),
    check(
      "context_acquisition_attempts_status_allowed",
      sql`${table.status} in ('completed', 'refused', 'incomplete', 'malformed', 'timed_out', 'provider_failed', 'input_too_large', 'invalid_patch', 'stale', 'superseded_by_winner', 'coverage_completed', 'coverage_needs_repair', 'coverage_failed')`,
    ),
    check(
      "context_acquisition_attempts_numbers_nonnegative",
      sql`${table.snapshotRevision} >= 0 and ${table.attemptOrdinal} > 0 and ${table.durationMs} >= 0 and (${table.inputTokens} is null or ${table.inputTokens} >= 0) and (${table.outputTokens} is null or ${table.outputTokens} >= 0)`,
    ),
    check(
      "context_acquisition_attempts_schema_positive",
      sql`${table.providerSchemaVersion} > 0`,
    ),
    check(
      "context_acquisition_attempts_proposal_objects",
      sql`(${table.interpretationProposal} is null or jsonb_typeof(${table.interpretationProposal}) = 'object') and (${table.contextActionProposal} is null or jsonb_typeof(${table.contextActionProposal}) = 'object')`,
    ),
    check(
      "context_acquisition_attempts_stage_proposal",
      sql`not (${table.interpretationProposal} is not null and ${table.contextActionProposal} is not null) and (${table.stage} in ('interpretation', 'interpretation_coverage', 'interpretation_repair', 'interpretation_repair_coverage') or ${table.interpretationProposal} is null) and (${table.stage} = 'context_action' or ${table.contextActionProposal} is null)`,
    ),
    check(
      "context_acquisition_attempts_text_bounds",
      sql`char_length(${table.promptVersion}) between 1 and 120 and (${table.provider} is null or char_length(${table.provider}) between 1 and 120) and (${table.model} is null or char_length(${table.model}) between 1 and 160) and (${table.providerRequestId} is null or char_length(${table.providerRequestId}) between 1 and 240) and (${table.errorCode} is null or ${table.errorCode} ~ '^[a-z0-9_:-]{1,120}$')`,
    ),
  ],
);
