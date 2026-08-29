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
import { shoppingPrivate } from "./shopping-private";

export const merchantDestinationResolutions = shoppingPrivate.table(
  "merchant_destination_resolutions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull(),
    searchRunId: uuid("search_run_id").notNull(),
    candidateListingId: uuid("candidate_listing_id").notNull(),
    policyVersion: text("policy_version").notNull(),
    provider: text("provider").notNull(),
    queryText: text("query_text").notNull(),
    status: text("status").notNull(),
    destinationUrl: text("destination_url"),
    acceptedResultTitle: text("accepted_result_title"),
    observedResultUrl: text("observed_result_url"),
    outcomeCode: text("outcome_code"),
    consideredResultCount: integer("considered_result_count"),
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
    unique("merchant_destination_resolutions_task_id_id_unique").on(
      table.taskId,
      table.id,
    ),
    unique("merchant_destination_resolutions_scope_unique").on(
      table.taskId,
      table.searchRunId,
      table.candidateListingId,
      table.policyVersion,
    ),
    foreignKey({
      name: "merchant_destination_resolutions_candidate_fk",
      columns: [table.taskId, table.searchRunId, table.candidateListingId],
      foreignColumns: [
        candidateListings.taskId,
        candidateListings.runId,
        candidateListings.id,
      ],
    }).onDelete("restrict"),
    check(
      "merchant_destination_resolutions_policy_bounds",
      sql`char_length(btrim(${table.policyVersion})) between 1 and 120`,
    ),
    check(
      "merchant_destination_resolutions_provider_allowed",
      sql`${table.provider} in ('serper', 'fixture')`,
    ),
    check(
      "merchant_destination_resolutions_query_bounds",
      sql`char_length(btrim(${table.queryText})) between 1 and 500`,
    ),
    check(
      "merchant_destination_resolutions_status_allowed",
      sql`${table.status} in ('running', 'resolved', 'rejected', 'failed')`,
    ),
    check(
      "merchant_destination_resolutions_destination_shape",
      sql`${table.destinationUrl} is null or (char_length(${table.destinationUrl}) between 1 and 4000 and ${table.destinationUrl} ~ '^https://')`,
    ),
    check(
      "merchant_destination_resolutions_accepted_title_shape",
      sql`${table.acceptedResultTitle} is null or char_length(btrim(${table.acceptedResultTitle})) between 1 and 1000`,
    ),
    check(
      "merchant_destination_resolutions_observed_url_shape",
      sql`${table.observedResultUrl} is null or (char_length(${table.observedResultUrl}) between 1 and 4000 and ${table.observedResultUrl} ~ '^https://' and ${table.observedResultUrl} <> ${table.destinationUrl})`,
    ),
    check(
      "merchant_destination_resolutions_outcome_allowed",
      sql`${table.outcomeCode} is null or ${table.outcomeCode} in ('no_results', 'invalid_result', 'unsafe_url', 'intermediary', 'comparison_or_content', 'merchant_mismatch', 'merchant_brand_ambiguity', 'non_product_page', 'ambiguous_identity', 'title_mismatch', 'variant_mismatch', 'provider_failed', 'invalid_provider_result')`,
    ),
    check(
      "merchant_destination_resolutions_count_nonnegative",
      sql`${table.consideredResultCount} is null or ${table.consideredResultCount} >= 0`,
    ),
    check(
      "merchant_destination_resolutions_lifecycle_shape",
      sql`(${table.status} = 'running' and ${table.destinationUrl} is null and ${table.acceptedResultTitle} is null and ${table.observedResultUrl} is null and ${table.outcomeCode} is null and ${table.consideredResultCount} is null and ${table.finishedAt} is null and ${table.leaseToken} is not null and ${table.leaseExpiresAt} is not null and ${table.leaseExpiresAt} > ${table.startedAt}) or (${table.status} = 'resolved' and ${table.destinationUrl} is not null and ${table.acceptedResultTitle} is not null and ${table.outcomeCode} is null and ${table.consideredResultCount} is not null and ${table.consideredResultCount} > 0 and ${table.finishedAt} is not null and ${table.finishedAt} >= ${table.startedAt} and ${table.leaseToken} is null and ${table.leaseExpiresAt} is null) or (${table.status} = 'rejected' and ${table.destinationUrl} is null and ${table.acceptedResultTitle} is null and ${table.observedResultUrl} is null and ${table.outcomeCode} is not null and ${table.outcomeCode} in ('no_results', 'invalid_result', 'unsafe_url', 'intermediary', 'comparison_or_content', 'merchant_mismatch', 'merchant_brand_ambiguity', 'non_product_page', 'ambiguous_identity', 'title_mismatch', 'variant_mismatch') and ${table.consideredResultCount} is not null and ${table.consideredResultCount} >= 0 and ${table.finishedAt} is not null and ${table.finishedAt} >= ${table.startedAt} and ${table.leaseToken} is null and ${table.leaseExpiresAt} is null) or (${table.status} = 'failed' and ${table.destinationUrl} is null and ${table.acceptedResultTitle} is null and ${table.observedResultUrl} is null and ${table.outcomeCode} is not null and ${table.outcomeCode} in ('provider_failed', 'invalid_provider_result') and ${table.consideredResultCount} is null and ${table.finishedAt} is not null and ${table.finishedAt} >= ${table.startedAt} and ${table.leaseToken} is null and ${table.leaseExpiresAt} is null)`,
    ),
  ],
);
