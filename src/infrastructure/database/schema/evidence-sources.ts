import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { candidateListings } from "./candidate-listings";
import { evidenceAcquisitionAttempts } from "./evidence-acquisition-attempts";
import { evidenceResearchRuns } from "./evidence-research-runs";
import { shoppingPrivate } from "./shopping-private";

export const evidenceSources = shoppingPrivate.table(
  "evidence_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull(),
    researchRunId: uuid("research_run_id").notNull(),
    candidateRunId: uuid("candidate_run_id").notNull(),
    candidateListingId: uuid("candidate_listing_id").notNull(),
    acquisitionAttemptId: uuid("acquisition_attempt_id"),
    sourceRole: text("source_role").notNull(),
    sourceKind: text("source_kind").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceTitle: text("source_title").notNull(),
    excerpt: text("excerpt"),
    provider: text("provider").notNull(),
    providerResultId: text("provider_result_id"),
    observedAt: timestamp("observed_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    fingerprint: text("fingerprint").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("evidence_sources_task_id_id_unique").on(table.taskId, table.id),
    unique("evidence_sources_candidate_id_unique").on(
      table.taskId,
      table.researchRunId,
      table.candidateRunId,
      table.candidateListingId,
      table.id,
    ),
    unique("evidence_sources_candidate_kind_id_unique").on(
      table.taskId,
      table.candidateRunId,
      table.candidateListingId,
      table.id,
      table.sourceKind,
    ),
    unique("evidence_sources_attempt_kind_id_unique").on(
      table.taskId,
      table.researchRunId,
      table.candidateRunId,
      table.candidateListingId,
      table.acquisitionAttemptId,
      table.id,
      table.sourceKind,
    ),
    unique("evidence_sources_fingerprint_unique").on(
      table.taskId,
      table.candidateRunId,
      table.candidateListingId,
      table.fingerprint,
    ),
    foreignKey({
      name: "evidence_sources_research_run_fk",
      columns: [table.taskId, table.researchRunId, table.candidateRunId],
      foreignColumns: [
        evidenceResearchRuns.taskId,
        evidenceResearchRuns.id,
        evidenceResearchRuns.searchRunId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "evidence_sources_candidate_fk",
      columns: [table.taskId, table.candidateRunId, table.candidateListingId],
      foreignColumns: [
        candidateListings.taskId,
        candidateListings.runId,
        candidateListings.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "evidence_sources_attempt_fk",
      columns: [
        table.taskId,
        table.researchRunId,
        table.candidateRunId,
        table.candidateListingId,
        table.acquisitionAttemptId,
      ],
      foreignColumns: [
        evidenceAcquisitionAttempts.taskId,
        evidenceAcquisitionAttempts.researchRunId,
        evidenceAcquisitionAttempts.candidateRunId,
        evidenceAcquisitionAttempts.candidateListingId,
        evidenceAcquisitionAttempts.id,
      ],
    }).onDelete("restrict"),
    check(
      "evidence_sources_role_allowed",
      sql`${table.sourceRole} in ('listing', 'retailer', 'manufacturer', 'independent_review', 'retailer_review_aggregate', 'visual', 'other')`,
    ),
    check(
      "evidence_sources_kind_allowed",
      sql`${table.sourceKind} in ('listing_field', 'organic_result', 'fetched_page', 'listing_image')`,
    ),
    check(
      "evidence_sources_kind_role_shape",
      sql`(${table.sourceKind} = 'listing_field' and ${table.sourceRole} in ('listing', 'retailer_review_aggregate')) or (${table.sourceKind} = 'organic_result' and ${table.sourceRole} in ('retailer', 'manufacturer', 'independent_review', 'retailer_review_aggregate', 'other')) or (${table.sourceKind} = 'fetched_page' and ${table.sourceRole} in ('retailer', 'manufacturer', 'independent_review', 'retailer_review_aggregate') and ${table.acquisitionAttemptId} is not null) or (${table.sourceKind} = 'listing_image' and ${table.sourceRole} = 'visual')`,
    ),
    check(
      "evidence_sources_url_shape",
      sql`char_length(${table.sourceUrl}) between 1 and 4000 and ${table.sourceUrl} ~ '^https?://'`,
    ),
    check(
      "evidence_sources_text_bounds",
      sql`char_length(btrim(${table.sourceTitle})) between 1 and 500 and (${table.excerpt} is null or char_length(btrim(${table.excerpt})) between 1 and 1000) and (${table.providerResultId} is null or char_length(btrim(${table.providerResultId})) between 1 and 500)`,
    ),
    check(
      "evidence_sources_provider_allowed",
      sql`${table.provider} in ('listing', 'serper', 'page_fetch', 'fixture')`,
    ),
    check(
      "evidence_sources_fingerprint_shape",
      sql`${table.fingerprint} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);
