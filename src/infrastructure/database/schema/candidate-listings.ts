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
import { searchQueryExecutions } from "./search-query-executions";
import { searchRuns } from "./search-runs";
import { shoppingPrivate } from "./shopping-private";
import { shoppingTasks } from "./shopping-tasks";

export const candidateListings = shoppingPrivate.table(
  "candidate_listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull(),
    runId: uuid("run_id").notNull(),
    queryId: uuid("query_id").notNull(),
    queryExecutionId: uuid("query_execution_id").notNull(),
    provider: text("provider").notNull(),
    providerResultId: text("provider_result_id").notNull(),
    sourceRank: integer("source_rank").notNull(),
    surface: text("surface").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    merchantDestinationUrl: text("merchant_destination_url"),
    merchantDestinationSource: text("merchant_destination_source"),
    merchant: text("merchant"),
    priceAmountMinor: integer("price_amount_minor"),
    priceCurrencyCode: text("price_currency_code"),
    priceText: text("price_text"),
    imageUrl: text("image_url"),
    deliveryText: text("delivery_text"),
    availabilityText: text("availability_text"),
    reviewRatingHundredths: integer("review_rating_hundredths"),
    reviewCount: integer("review_count"),
    reviewEvidenceSourceUrl: text("review_evidence_source_url"),
    retrievedAt: timestamp("retrieved_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("candidate_listings_task_id_id_unique").on(table.taskId, table.id),
    unique("candidate_listings_task_run_id_unique").on(
      table.taskId,
      table.runId,
      table.id,
    ),
    foreignKey({
      name: "candidate_listings_task_fk",
      columns: [table.taskId],
      foreignColumns: [shoppingTasks.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "candidate_listings_run_fk",
      columns: [table.taskId, table.runId],
      foreignColumns: [searchRuns.taskId, searchRuns.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "candidate_listings_query_fk",
      columns: [
        table.taskId,
        table.runId,
        table.queryId,
        table.provider,
        table.surface,
      ],
      foreignColumns: [
        searchQueries.taskId,
        searchQueries.runId,
        searchQueries.id,
        searchQueries.provider,
        searchQueries.surface,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "candidate_listings_query_execution_fk",
      columns: [
        table.taskId,
        table.runId,
        table.queryId,
        table.queryExecutionId,
      ],
      foreignColumns: [
        searchQueryExecutions.taskId,
        searchQueryExecutions.runId,
        searchQueryExecutions.queryId,
        searchQueryExecutions.id,
      ],
    }).onDelete("restrict"),
    check(
      "candidate_listings_provider_identity_shape",
      sql`${table.provider} in ('serper', 'fixture') and char_length(btrim(${table.providerResultId})) between 1 and 500`,
    ),
    check("candidate_listings_rank_positive", sql`${table.sourceRank} > 0`),
    check(
      "candidate_listings_surface_allowed",
      sql`${table.surface} = 'shopping'`,
    ),
    check(
      "candidate_listings_title_bounds",
      sql`char_length(btrim(${table.title})) between 1 and 1000`,
    ),
    check(
      "candidate_listings_url_shape",
      sql`char_length(${table.url}) between 1 and 4000 and ${table.url} ~ '^https?://' and char_length(${table.canonicalUrl}) between 1 and 4000 and ${table.canonicalUrl} ~ '^https?://' and (${table.merchantDestinationUrl} is null or (char_length(${table.merchantDestinationUrl}) between 1 and 4000 and ${table.merchantDestinationUrl} ~ '^https?://'))`,
    ),
    check(
      "candidate_listings_destination_provenance_shape",
      sql`(${table.merchantDestinationUrl} is null and ${table.merchantDestinationSource} is null) or (${table.merchantDestinationUrl} is not null and ${table.merchantDestinationSource} is not null and ${table.merchantDestinationSource} in ('shopping_result', 'verified_organic'))`,
    ),
    check(
      "candidate_listings_optional_text_bounds",
      sql`(${table.merchant} is null or char_length(btrim(${table.merchant})) between 1 and 500) and (${table.priceText} is null or char_length(btrim(${table.priceText})) between 1 and 120) and (${table.deliveryText} is null or char_length(btrim(${table.deliveryText})) between 1 and 500) and (${table.availabilityText} is null or char_length(btrim(${table.availabilityText})) between 1 and 500)`,
    ),
    check(
      "candidate_listings_price_shape",
      sql`(${table.priceAmountMinor} is null and ${table.priceCurrencyCode} is null) or (${table.priceAmountMinor} is not null and ${table.priceAmountMinor} >= 0 and ${table.priceCurrencyCode} is not null and ${table.priceCurrencyCode} ~ '^[A-Z]{3}$')`,
    ),
    check(
      "candidate_listings_image_url_shape",
      sql`${table.imageUrl} is null or (char_length(${table.imageUrl}) between 1 and 4000 and ${table.imageUrl} ~ '^https?://')`,
    ),
    check(
      "candidate_listings_review_evidence_shape",
      sql`(${table.reviewRatingHundredths} is null and ${table.reviewCount} is null and ${table.reviewEvidenceSourceUrl} is null) or (${table.reviewRatingHundredths} is not null and ${table.reviewCount} is not null and ${table.reviewEvidenceSourceUrl} is not null and ${table.reviewRatingHundredths} between 0 and 500 and ${table.reviewCount} > 0 and ${table.merchantDestinationUrl} is not null and ${table.merchantDestinationSource} is not null and ${table.reviewEvidenceSourceUrl} = ${table.merchantDestinationUrl} and ${table.merchantDestinationSource} = 'verified_organic')`,
    ),
  ],
);
