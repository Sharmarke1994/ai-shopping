import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  MAX_PAGE_TRANSPORT_BYTES,
  MAX_PERSISTED_PAGE_ADMISSION_JSON_BYTES,
  MAX_PERSISTED_PAGE_DOCUMENT_JSON_BYTES,
} from "../../../features/product-understanding/page-budgets";
import { evidenceAcquisitionAttempts } from "./evidence-acquisition-attempts";
import { evidencePageFetchTargets } from "./evidence-page-fetch-targets";
import { evidenceSources } from "./evidence-sources";
import { shoppingPrivate } from "./shopping-private";

export const fetchedEvidenceDocuments = shoppingPrivate.table(
  "fetched_evidence_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull(),
    researchRunId: uuid("research_run_id").notNull(),
    candidateRunId: uuid("candidate_run_id").notNull(),
    candidateListingId: uuid("candidate_listing_id").notNull(),
    attemptId: uuid("attempt_id").notNull(),
    attemptStage: text("attempt_stage").notNull().default("page_fetch"),
    discoveredSourceId: uuid("discovered_source_id").notNull(),
    evidenceSourceId: uuid("evidence_source_id").notNull(),
    evidenceSourceKind: text("evidence_source_kind")
      .notNull()
      .default("fetched_page"),
    requestedUrl: text("requested_url").notNull(),
    finalUrl: text("final_url").notNull(),
    canonicalUrl: text("canonical_url"),
    contentType: text("content_type").notNull(),
    encodedBytes: integer("encoded_bytes").notNull(),
    decodedBytes: integer("decoded_bytes").notNull(),
    responseHash: text("response_hash").notNull(),
    documentHash: text("document_hash").notNull(),
    extractionVersion: text("extraction_version").notNull(),
    document: jsonb("document").$type<unknown>().notNull(),
    admission: jsonb("admission").$type<unknown>().notNull(),
    fetchedAt: timestamp("fetched_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("fetched_evidence_documents_task_id_id_unique").on(
      table.taskId,
      table.id,
    ),
    unique("fetched_evidence_documents_attempt_unique").on(
      table.taskId,
      table.researchRunId,
      table.attemptId,
    ),
    unique("fetched_evidence_documents_source_unique").on(
      table.taskId,
      table.evidenceSourceId,
    ),
    foreignKey({
      name: "fetched_evidence_documents_attempt_fk",
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
      name: "fetched_evidence_documents_target_fk",
      columns: [
        table.taskId,
        table.researchRunId,
        table.candidateRunId,
        table.candidateListingId,
        table.attemptId,
        table.discoveredSourceId,
      ],
      foreignColumns: [
        evidencePageFetchTargets.taskId,
        evidencePageFetchTargets.researchRunId,
        evidencePageFetchTargets.candidateRunId,
        evidencePageFetchTargets.candidateListingId,
        evidencePageFetchTargets.attemptId,
        evidencePageFetchTargets.discoveredSourceId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fetched_evidence_documents_source_fk",
      columns: [
        table.taskId,
        table.researchRunId,
        table.candidateRunId,
        table.candidateListingId,
        table.attemptId,
        table.evidenceSourceId,
        table.evidenceSourceKind,
      ],
      foreignColumns: [
        evidenceSources.taskId,
        evidenceSources.researchRunId,
        evidenceSources.candidateRunId,
        evidenceSources.candidateListingId,
        evidenceSources.acquisitionAttemptId,
        evidenceSources.id,
        evidenceSources.sourceKind,
      ],
    }).onDelete("restrict"),
    check(
      "fetched_evidence_documents_scope_shape",
      sql`${table.attemptStage} = 'page_fetch' and ${table.evidenceSourceKind} = 'fetched_page'`,
    ),
    check(
      "fetched_evidence_documents_url_shape",
      sql`char_length(${table.requestedUrl}) between 1 and 4000 and ${table.requestedUrl} ~ '^https?://' and char_length(${table.finalUrl}) between 1 and 4000 and ${table.finalUrl} ~ '^https?://' and (${table.canonicalUrl} is null or (char_length(${table.canonicalUrl}) between 1 and 4000 and ${table.canonicalUrl} ~ '^https?://'))`,
    ),
    check(
      "fetched_evidence_documents_content_shape",
      sql`${table.contentType} in ('text/html', 'application/xhtml+xml', 'text/plain') and ${table.encodedBytes} between 1 and ${sql.raw(String(MAX_PAGE_TRANSPORT_BYTES))} and ${table.decodedBytes} between 1 and ${sql.raw(String(MAX_PAGE_TRANSPORT_BYTES))} and ${table.responseHash} ~ '^[a-f0-9]{64}$' and ${table.documentHash} ~ '^[a-f0-9]{64}$' and char_length(btrim(${table.extractionVersion})) between 1 and 120 and jsonb_typeof(${table.document}) = 'object' and octet_length(${table.document}::text) between 2 and ${sql.raw(String(MAX_PERSISTED_PAGE_DOCUMENT_JSON_BYTES))} and jsonb_typeof(${table.admission}) = 'object' and octet_length(${table.admission}::text) between 2 and ${sql.raw(String(MAX_PERSISTED_PAGE_ADMISSION_JSON_BYTES))}`,
    ),
  ],
);
