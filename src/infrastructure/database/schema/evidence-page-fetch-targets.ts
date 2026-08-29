import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { evidenceAcquisitionAttempts } from "./evidence-acquisition-attempts";
import { evidenceSources } from "./evidence-sources";
import { shoppingPrivate } from "./shopping-private";

export const evidencePageFetchTargets = shoppingPrivate.table(
  "evidence_page_fetch_targets",
  {
    taskId: uuid("task_id").notNull(),
    researchRunId: uuid("research_run_id").notNull(),
    candidateRunId: uuid("candidate_run_id").notNull(),
    candidateListingId: uuid("candidate_listing_id").notNull(),
    attemptId: uuid("attempt_id").notNull(),
    attemptStage: text("attempt_stage").notNull().default("page_fetch"),
    discoveredSourceId: uuid("discovered_source_id").notNull(),
    discoveredSourceKind: text("discovered_source_kind")
      .notNull()
      .default("organic_result"),
    requestedUrl: text("requested_url").notNull(),
    policyVersion: text("policy_version").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("evidence_page_fetch_targets_task_attempt_unique").on(
      table.taskId,
      table.attemptId,
    ),
    unique("evidence_page_fetch_targets_document_scope_unique").on(
      table.taskId,
      table.researchRunId,
      table.candidateRunId,
      table.candidateListingId,
      table.attemptId,
      table.discoveredSourceId,
    ),
    foreignKey({
      name: "evidence_page_fetch_targets_attempt_fk",
      columns: [
        table.taskId,
        table.researchRunId,
        table.candidateRunId,
        table.candidateListingId,
        table.attemptId,
        table.attemptStage,
      ],
      foreignColumns: [
        evidenceAcquisitionAttempts.taskId,
        evidenceAcquisitionAttempts.researchRunId,
        evidenceAcquisitionAttempts.candidateRunId,
        evidenceAcquisitionAttempts.candidateListingId,
        evidenceAcquisitionAttempts.id,
        evidenceAcquisitionAttempts.stage,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "evidence_page_fetch_targets_source_fk",
      columns: [
        table.taskId,
        table.candidateRunId,
        table.candidateListingId,
        table.discoveredSourceId,
        table.discoveredSourceKind,
      ],
      foreignColumns: [
        evidenceSources.taskId,
        evidenceSources.candidateRunId,
        evidenceSources.candidateListingId,
        evidenceSources.id,
        evidenceSources.sourceKind,
      ],
    }).onDelete("restrict"),
    check(
      "evidence_page_fetch_targets_shape",
      sql`${table.attemptStage} = 'page_fetch' and ${table.discoveredSourceKind} = 'organic_result' and char_length(${table.requestedUrl}) between 1 and 4000 and ${table.requestedUrl} ~ '^https?://' and char_length(btrim(${table.policyVersion})) between 1 and 120`,
    ),
  ],
);
