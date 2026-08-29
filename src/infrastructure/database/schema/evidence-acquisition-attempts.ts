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
import { candidateListings } from "./candidate-listings";
import { evidenceResearchRuns } from "./evidence-research-runs";
import { shoppingPrivate } from "./shopping-private";

export const evidenceAcquisitionAttempts = shoppingPrivate.table(
  "evidence_acquisition_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull(),
    researchRunId: uuid("research_run_id").notNull(),
    candidateRunId: uuid("candidate_run_id").notNull(),
    candidateListingId: uuid("candidate_listing_id").notNull(),
    stage: text("stage").notNull(),
    purpose: text("purpose").notNull(),
    planKey: text("plan_key").notNull(),
    query: text("query"),
    status: text("status").notNull(),
    provider: text("provider").notNull(),
    model: text("model"),
    promptVersion: text("prompt_version"),
    providerRequestId: text("provider_request_id"),
    receivedResultCount: integer("received_result_count"),
    failureCode: text("failure_code"),
    startedAt: timestamp("started_at", {
      mode: "date",
      withTimezone: true,
    }),
    finishedAt: timestamp("finished_at", {
      mode: "date",
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("evidence_acquisition_attempts_task_id_id_unique").on(
      table.taskId,
      table.id,
    ),
    unique("evidence_acquisition_attempts_candidate_id_unique").on(
      table.taskId,
      table.researchRunId,
      table.candidateRunId,
      table.candidateListingId,
      table.id,
    ),
    unique("evidence_acquisition_attempts_candidate_stage_id_unique").on(
      table.taskId,
      table.researchRunId,
      table.candidateRunId,
      table.candidateListingId,
      table.id,
      table.stage,
    ),
    unique("evidence_acquisition_attempts_plan_unique").on(
      table.taskId,
      table.researchRunId,
      table.candidateListingId,
      table.planKey,
    ),
    foreignKey({
      name: "evidence_acquisition_attempts_research_run_fk",
      columns: [table.taskId, table.researchRunId, table.candidateRunId],
      foreignColumns: [
        evidenceResearchRuns.taskId,
        evidenceResearchRuns.id,
        evidenceResearchRuns.searchRunId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "evidence_acquisition_attempts_candidate_fk",
      columns: [table.taskId, table.candidateRunId, table.candidateListingId],
      foreignColumns: [
        candidateListings.taskId,
        candidateListings.runId,
        candidateListings.id,
      ],
    }).onDelete("restrict"),
    check(
      "evidence_acquisition_attempts_stage_allowed",
      sql`${table.stage} in ('organic_search', 'page_fetch', 'observation_extraction', 'criterion_assessment')`,
    ),
    check(
      "evidence_acquisition_attempts_purpose_allowed",
      sql`${table.purpose} in ('specifications', 'experience', 'source_depth', 'first_pass', 'decision_gap', 'combined', 'current_brief')`,
    ),
    check(
      "evidence_acquisition_attempts_text_bounds",
      sql`char_length(btrim(${table.planKey})) between 1 and 180 and char_length(btrim(${table.provider})) between 1 and 120 and (${table.query} is null or char_length(btrim(${table.query})) between 1 and 500) and (${table.model} is null or char_length(btrim(${table.model})) between 1 and 160) and (${table.promptVersion} is null or char_length(btrim(${table.promptVersion})) between 1 and 120) and (${table.providerRequestId} is null or char_length(btrim(${table.providerRequestId})) between 1 and 240)`,
    ),
    check(
      "evidence_acquisition_attempts_stage_shape",
      sql`(${table.stage} = 'organic_search' and ${table.query} is not null and ${table.provider} in ('serper', 'fixture') and ${table.model} is null and ${table.promptVersion} is null) or (${table.stage} = 'page_fetch' and ${table.query} is null and ${table.provider} in ('server_http', 'fixture') and ${table.model} is null and ${table.promptVersion} is null) or (${table.stage} in ('observation_extraction', 'criterion_assessment') and ${table.query} is null and ${table.provider} in ('openai', 'fixture') and ${table.model} is not null and ${table.promptVersion} is not null)`,
    ),
    check(
      "evidence_acquisition_attempts_status_allowed",
      sql`${table.status} in ('planned', 'succeeded', 'failed')`,
    ),
    check(
      "evidence_acquisition_attempts_terminal_shape",
      sql`(${table.status} = 'planned' and ${table.startedAt} is null and ${table.finishedAt} is null and ${table.receivedResultCount} is null and ${table.failureCode} is null) or (${table.status} = 'succeeded' and ${table.startedAt} is not null and ${table.finishedAt} is not null and ${table.finishedAt} >= ${table.startedAt} and ${table.receivedResultCount} is not null and ${table.receivedResultCount} >= 0 and ${table.failureCode} is null) or (${table.status} = 'failed' and ${table.startedAt} is not null and ${table.finishedAt} is not null and ${table.finishedAt} >= ${table.startedAt} and ${table.receivedResultCount} is null and ${table.failureCode} is not null and ${table.failureCode} in ('provider_failed', 'invalid_provider_result', 'unsafe_url', 'dns_failed', 'network_failed', 'timeout', 'redirect_invalid', 'redirect_limit', 'http_status', 'unsupported_content_type', 'unsupported_content_encoding', 'response_too_large', 'invalid_text', 'invalid_extraction', 'identity_mismatch', 'model_failed', 'invalid_model_output'))`,
    ),
  ],
);
