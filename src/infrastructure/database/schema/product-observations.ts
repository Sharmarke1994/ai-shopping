import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { conceptDefinitions } from "./concept-definitions";
import { evidenceSources } from "./evidence-sources";
import { shoppingPrivate } from "./shopping-private";

export const productObservations = shoppingPrivate.table(
  "product_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull(),
    researchRunId: uuid("research_run_id").notNull(),
    candidateRunId: uuid("candidate_run_id").notNull(),
    candidateListingId: uuid("candidate_listing_id").notNull(),
    evidenceSourceId: uuid("evidence_source_id").notNull(),
    conceptId: uuid("concept_id"),
    support: text("support").notNull(),
    observationKind: text("observation_kind").notNull(),
    propertyLabel: text("property_label").notNull(),
    claim: text("claim").notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    derivation: text("derivation").notNull(),
    model: text("model"),
    promptVersion: text("prompt_version"),
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
    unique("product_observations_task_id_id_unique").on(table.taskId, table.id),
    unique("product_observations_candidate_id_unique").on(
      table.taskId,
      table.researchRunId,
      table.candidateRunId,
      table.candidateListingId,
      table.id,
    ),
    unique("product_observations_reusable_candidate_id_unique").on(
      table.taskId,
      table.candidateRunId,
      table.candidateListingId,
      table.id,
    ),
    unique("product_observations_fingerprint_unique").on(
      table.taskId,
      table.candidateRunId,
      table.candidateListingId,
      table.evidenceSourceId,
      table.fingerprint,
    ),
    foreignKey({
      name: "product_observations_source_fk",
      columns: [
        table.taskId,
        table.researchRunId,
        table.candidateRunId,
        table.candidateListingId,
        table.evidenceSourceId,
      ],
      foreignColumns: [
        evidenceSources.taskId,
        evidenceSources.researchRunId,
        evidenceSources.candidateRunId,
        evidenceSources.candidateListingId,
        evidenceSources.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "product_observations_concept_fk",
      columns: [table.taskId, table.conceptId],
      foreignColumns: [conceptDefinitions.taskId, conceptDefinitions.id],
    }).onDelete("restrict"),
    check(
      "product_observations_support_allowed",
      sql`${table.support} in ('supported', 'ambiguous')`,
    ),
    check(
      "product_observations_kind_allowed",
      sql`${table.observationKind} in ('structured_field', 'source_assertion', 'visual_inference')`,
    ),
    check(
      "product_observations_derivation_allowed",
      sql`${table.derivation} in ('deterministic', 'model_text', 'model_visual')`,
    ),
    check(
      "product_observations_derivation_shape",
      sql`(${table.derivation} = 'deterministic' and ${table.model} is null and ${table.promptVersion} is null) or (${table.derivation} in ('model_text', 'model_visual') and ${table.model} is not null and ${table.promptVersion} is not null)`,
    ),
    check(
      "product_observations_text_bounds",
      sql`char_length(btrim(${table.propertyLabel})) between 1 and 120 and char_length(btrim(${table.claim})) between 1 and 500 and (${table.model} is null or char_length(btrim(${table.model})) between 1 and 160) and (${table.promptVersion} is null or char_length(btrim(${table.promptVersion})) between 1 and 120)`,
    ),
    check(
      "product_observations_value_object",
      sql`jsonb_typeof(${table.value}) is not distinct from 'object' and (${table.value} ->> 'schemaVersion') = '1' and (${table.value} ->> 'kind') in ('boolean', 'money', 'quantity', 'rating_aggregate', 'categorical', 'text')`,
    ),
    check(
      "product_observations_fingerprint_shape",
      sql`${table.fingerprint} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);
