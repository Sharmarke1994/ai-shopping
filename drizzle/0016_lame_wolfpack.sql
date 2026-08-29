CREATE TABLE "shopping_private"."evidence_page_fetch_targets" (
	"task_id" uuid NOT NULL,
	"research_run_id" uuid NOT NULL,
	"candidate_run_id" uuid NOT NULL,
	"candidate_listing_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"attempt_stage" text DEFAULT 'page_fetch' NOT NULL,
	"discovered_source_id" uuid NOT NULL,
	"discovered_source_kind" text DEFAULT 'organic_result' NOT NULL,
	"requested_url" text NOT NULL,
	"policy_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_page_fetch_targets_task_attempt_unique" UNIQUE("task_id","attempt_id"),
	CONSTRAINT "evidence_page_fetch_targets_document_scope_unique" UNIQUE("task_id","research_run_id","candidate_run_id","candidate_listing_id","attempt_id","discovered_source_id"),
	CONSTRAINT "evidence_page_fetch_targets_shape" CHECK ("shopping_private"."evidence_page_fetch_targets"."attempt_stage" = 'page_fetch' and "shopping_private"."evidence_page_fetch_targets"."discovered_source_kind" = 'organic_result' and char_length("shopping_private"."evidence_page_fetch_targets"."requested_url") between 1 and 4000 and "shopping_private"."evidence_page_fetch_targets"."requested_url" ~ '^https?://' and char_length(btrim("shopping_private"."evidence_page_fetch_targets"."policy_version")) between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "shopping_private"."fetched_evidence_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"research_run_id" uuid NOT NULL,
	"candidate_run_id" uuid NOT NULL,
	"candidate_listing_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"attempt_stage" text DEFAULT 'page_fetch' NOT NULL,
	"discovered_source_id" uuid NOT NULL,
	"evidence_source_id" uuid NOT NULL,
	"evidence_source_kind" text DEFAULT 'fetched_page' NOT NULL,
	"requested_url" text NOT NULL,
	"final_url" text NOT NULL,
	"canonical_url" text,
	"content_type" text NOT NULL,
	"encoded_bytes" integer NOT NULL,
	"decoded_bytes" integer NOT NULL,
	"response_hash" text NOT NULL,
	"document_hash" text NOT NULL,
	"extraction_version" text NOT NULL,
	"document" jsonb NOT NULL,
	"admission" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fetched_evidence_documents_task_id_id_unique" UNIQUE("task_id","id"),
	CONSTRAINT "fetched_evidence_documents_attempt_unique" UNIQUE("task_id","research_run_id","attempt_id"),
	CONSTRAINT "fetched_evidence_documents_source_unique" UNIQUE("task_id","evidence_source_id"),
	CONSTRAINT "fetched_evidence_documents_scope_shape" CHECK ("shopping_private"."fetched_evidence_documents"."attempt_stage" = 'page_fetch' and "shopping_private"."fetched_evidence_documents"."evidence_source_kind" = 'fetched_page'),
	CONSTRAINT "fetched_evidence_documents_url_shape" CHECK (char_length("shopping_private"."fetched_evidence_documents"."requested_url") between 1 and 4000 and "shopping_private"."fetched_evidence_documents"."requested_url" ~ '^https?://' and char_length("shopping_private"."fetched_evidence_documents"."final_url") between 1 and 4000 and "shopping_private"."fetched_evidence_documents"."final_url" ~ '^https?://' and ("shopping_private"."fetched_evidence_documents"."canonical_url" is null or (char_length("shopping_private"."fetched_evidence_documents"."canonical_url") between 1 and 4000 and "shopping_private"."fetched_evidence_documents"."canonical_url" ~ '^https?://'))),
	CONSTRAINT "fetched_evidence_documents_content_shape" CHECK ("shopping_private"."fetched_evidence_documents"."content_type" in ('text/html', 'application/xhtml+xml', 'text/plain') and "shopping_private"."fetched_evidence_documents"."encoded_bytes" between 1 and 1500000 and "shopping_private"."fetched_evidence_documents"."decoded_bytes" between 1 and 1500000 and "shopping_private"."fetched_evidence_documents"."response_hash" ~ '^[a-f0-9]{64}$' and "shopping_private"."fetched_evidence_documents"."document_hash" ~ '^[a-f0-9]{64}$' and char_length(btrim("shopping_private"."fetched_evidence_documents"."extraction_version")) between 1 and 120 and jsonb_typeof("shopping_private"."fetched_evidence_documents"."document") = 'object' and octet_length("shopping_private"."fetched_evidence_documents"."document"::text) between 2 and 40000 and jsonb_typeof("shopping_private"."fetched_evidence_documents"."admission") = 'object' and octet_length("shopping_private"."fetched_evidence_documents"."admission"::text) between 2 and 8000)
);
--> statement-breakpoint
CREATE TABLE "shopping_private"."merchant_destination_resolutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"search_run_id" uuid NOT NULL,
	"candidate_listing_id" uuid NOT NULL,
	"policy_version" text NOT NULL,
	"provider" text NOT NULL,
	"query_text" text NOT NULL,
	"status" text NOT NULL,
	"destination_url" text,
	"accepted_result_title" text,
	"observed_result_url" text,
	"outcome_code" text,
	"considered_result_count" integer,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_destination_resolutions_task_id_id_unique" UNIQUE("task_id","id"),
	CONSTRAINT "merchant_destination_resolutions_scope_unique" UNIQUE("task_id","search_run_id","candidate_listing_id","policy_version"),
	CONSTRAINT "merchant_destination_resolutions_policy_bounds" CHECK (char_length(btrim("shopping_private"."merchant_destination_resolutions"."policy_version")) between 1 and 120),
	CONSTRAINT "merchant_destination_resolutions_provider_allowed" CHECK ("shopping_private"."merchant_destination_resolutions"."provider" in ('serper', 'fixture')),
	CONSTRAINT "merchant_destination_resolutions_query_bounds" CHECK (char_length(btrim("shopping_private"."merchant_destination_resolutions"."query_text")) between 1 and 500),
	CONSTRAINT "merchant_destination_resolutions_status_allowed" CHECK ("shopping_private"."merchant_destination_resolutions"."status" in ('running', 'resolved', 'rejected', 'failed')),
	CONSTRAINT "merchant_destination_resolutions_destination_shape" CHECK ("shopping_private"."merchant_destination_resolutions"."destination_url" is null or (char_length("shopping_private"."merchant_destination_resolutions"."destination_url") between 1 and 4000 and "shopping_private"."merchant_destination_resolutions"."destination_url" ~ '^https://')),
	CONSTRAINT "merchant_destination_resolutions_accepted_title_shape" CHECK ("shopping_private"."merchant_destination_resolutions"."accepted_result_title" is null or char_length(btrim("shopping_private"."merchant_destination_resolutions"."accepted_result_title")) between 1 and 1000),
	CONSTRAINT "merchant_destination_resolutions_observed_url_shape" CHECK ("shopping_private"."merchant_destination_resolutions"."observed_result_url" is null or (char_length("shopping_private"."merchant_destination_resolutions"."observed_result_url") between 1 and 4000 and "shopping_private"."merchant_destination_resolutions"."observed_result_url" ~ '^https://' and "shopping_private"."merchant_destination_resolutions"."observed_result_url" <> "shopping_private"."merchant_destination_resolutions"."destination_url")),
	CONSTRAINT "merchant_destination_resolutions_outcome_allowed" CHECK ("shopping_private"."merchant_destination_resolutions"."outcome_code" is null or "shopping_private"."merchant_destination_resolutions"."outcome_code" in ('no_results', 'invalid_result', 'unsafe_url', 'intermediary', 'comparison_or_content', 'merchant_mismatch', 'merchant_brand_ambiguity', 'non_product_page', 'ambiguous_identity', 'title_mismatch', 'variant_mismatch', 'provider_failed', 'invalid_provider_result')),
	CONSTRAINT "merchant_destination_resolutions_count_nonnegative" CHECK ("shopping_private"."merchant_destination_resolutions"."considered_result_count" is null or "shopping_private"."merchant_destination_resolutions"."considered_result_count" >= 0),
	CONSTRAINT "merchant_destination_resolutions_lifecycle_shape" CHECK (("shopping_private"."merchant_destination_resolutions"."status" = 'running' and "shopping_private"."merchant_destination_resolutions"."destination_url" is null and "shopping_private"."merchant_destination_resolutions"."accepted_result_title" is null and "shopping_private"."merchant_destination_resolutions"."observed_result_url" is null and "shopping_private"."merchant_destination_resolutions"."outcome_code" is null and "shopping_private"."merchant_destination_resolutions"."considered_result_count" is null and "shopping_private"."merchant_destination_resolutions"."finished_at" is null and "shopping_private"."merchant_destination_resolutions"."lease_token" is not null and "shopping_private"."merchant_destination_resolutions"."lease_expires_at" is not null and "shopping_private"."merchant_destination_resolutions"."lease_expires_at" > "shopping_private"."merchant_destination_resolutions"."started_at") or ("shopping_private"."merchant_destination_resolutions"."status" = 'resolved' and "shopping_private"."merchant_destination_resolutions"."destination_url" is not null and "shopping_private"."merchant_destination_resolutions"."accepted_result_title" is not null and "shopping_private"."merchant_destination_resolutions"."outcome_code" is null and "shopping_private"."merchant_destination_resolutions"."considered_result_count" is not null and "shopping_private"."merchant_destination_resolutions"."considered_result_count" > 0 and "shopping_private"."merchant_destination_resolutions"."finished_at" is not null and "shopping_private"."merchant_destination_resolutions"."finished_at" >= "shopping_private"."merchant_destination_resolutions"."started_at" and "shopping_private"."merchant_destination_resolutions"."lease_token" is null and "shopping_private"."merchant_destination_resolutions"."lease_expires_at" is null) or ("shopping_private"."merchant_destination_resolutions"."status" = 'rejected' and "shopping_private"."merchant_destination_resolutions"."destination_url" is null and "shopping_private"."merchant_destination_resolutions"."accepted_result_title" is null and "shopping_private"."merchant_destination_resolutions"."observed_result_url" is null and "shopping_private"."merchant_destination_resolutions"."outcome_code" is not null and "shopping_private"."merchant_destination_resolutions"."outcome_code" in ('no_results', 'invalid_result', 'unsafe_url', 'intermediary', 'comparison_or_content', 'merchant_mismatch', 'merchant_brand_ambiguity', 'non_product_page', 'ambiguous_identity', 'title_mismatch', 'variant_mismatch') and "shopping_private"."merchant_destination_resolutions"."considered_result_count" is not null and "shopping_private"."merchant_destination_resolutions"."considered_result_count" >= 0 and "shopping_private"."merchant_destination_resolutions"."finished_at" is not null and "shopping_private"."merchant_destination_resolutions"."finished_at" >= "shopping_private"."merchant_destination_resolutions"."started_at" and "shopping_private"."merchant_destination_resolutions"."lease_token" is null and "shopping_private"."merchant_destination_resolutions"."lease_expires_at" is null) or ("shopping_private"."merchant_destination_resolutions"."status" = 'failed' and "shopping_private"."merchant_destination_resolutions"."destination_url" is null and "shopping_private"."merchant_destination_resolutions"."accepted_result_title" is null and "shopping_private"."merchant_destination_resolutions"."observed_result_url" is null and "shopping_private"."merchant_destination_resolutions"."outcome_code" is not null and "shopping_private"."merchant_destination_resolutions"."outcome_code" in ('provider_failed', 'invalid_provider_result') and "shopping_private"."merchant_destination_resolutions"."considered_result_count" is null and "shopping_private"."merchant_destination_resolutions"."finished_at" is not null and "shopping_private"."merchant_destination_resolutions"."finished_at" >= "shopping_private"."merchant_destination_resolutions"."started_at" and "shopping_private"."merchant_destination_resolutions"."lease_token" is null and "shopping_private"."merchant_destination_resolutions"."lease_expires_at" is null))
);
--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_acquisition_attempts" DROP CONSTRAINT "evidence_acquisition_attempts_stage_allowed";--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_acquisition_attempts" DROP CONSTRAINT "evidence_acquisition_attempts_purpose_allowed";--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_acquisition_attempts" DROP CONSTRAINT "evidence_acquisition_attempts_stage_shape";--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_acquisition_attempts" DROP CONSTRAINT "evidence_acquisition_attempts_terminal_shape";--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_sources" DROP CONSTRAINT "evidence_sources_kind_allowed";--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_sources" DROP CONSTRAINT "evidence_sources_kind_role_shape";--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_sources" DROP CONSTRAINT "evidence_sources_provider_allowed";--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_acquisition_attempts" ADD CONSTRAINT "evidence_acquisition_attempts_candidate_stage_id_unique" UNIQUE("task_id","research_run_id","candidate_run_id","candidate_listing_id","id","stage");--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_sources" ADD CONSTRAINT "evidence_sources_candidate_kind_id_unique" UNIQUE("task_id","candidate_run_id","candidate_listing_id","id","source_kind");--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_sources" ADD CONSTRAINT "evidence_sources_attempt_kind_id_unique" UNIQUE("task_id","research_run_id","candidate_run_id","candidate_listing_id","acquisition_attempt_id","id","source_kind");--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_page_fetch_targets" ADD CONSTRAINT "evidence_page_fetch_targets_attempt_fk" FOREIGN KEY ("task_id","research_run_id","candidate_run_id","candidate_listing_id","attempt_id","attempt_stage") REFERENCES "shopping_private"."evidence_acquisition_attempts"("task_id","research_run_id","candidate_run_id","candidate_listing_id","id","stage") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_page_fetch_targets" ADD CONSTRAINT "evidence_page_fetch_targets_source_fk" FOREIGN KEY ("task_id","candidate_run_id","candidate_listing_id","discovered_source_id","discovered_source_kind") REFERENCES "shopping_private"."evidence_sources"("task_id","candidate_run_id","candidate_listing_id","id","source_kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."fetched_evidence_documents" ADD CONSTRAINT "fetched_evidence_documents_attempt_fk" FOREIGN KEY ("task_id","research_run_id","candidate_run_id","candidate_listing_id","attempt_id","attempt_stage") REFERENCES "shopping_private"."evidence_acquisition_attempts"("task_id","research_run_id","candidate_run_id","candidate_listing_id","id","stage") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."fetched_evidence_documents" ADD CONSTRAINT "fetched_evidence_documents_target_fk" FOREIGN KEY ("task_id","research_run_id","candidate_run_id","candidate_listing_id","attempt_id","discovered_source_id") REFERENCES "shopping_private"."evidence_page_fetch_targets"("task_id","research_run_id","candidate_run_id","candidate_listing_id","attempt_id","discovered_source_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."fetched_evidence_documents" ADD CONSTRAINT "fetched_evidence_documents_source_fk" FOREIGN KEY ("task_id","research_run_id","candidate_run_id","candidate_listing_id","attempt_id","evidence_source_id","evidence_source_kind") REFERENCES "shopping_private"."evidence_sources"("task_id","research_run_id","candidate_run_id","candidate_listing_id","acquisition_attempt_id","id","source_kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."merchant_destination_resolutions" ADD CONSTRAINT "merchant_destination_resolutions_candidate_fk" FOREIGN KEY ("task_id","search_run_id","candidate_listing_id") REFERENCES "shopping_private"."candidate_listings"("task_id","run_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_acquisition_attempts" ADD CONSTRAINT "evidence_acquisition_attempts_stage_allowed" CHECK ("shopping_private"."evidence_acquisition_attempts"."stage" in ('organic_search', 'page_fetch', 'observation_extraction', 'criterion_assessment'));--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_acquisition_attempts" ADD CONSTRAINT "evidence_acquisition_attempts_purpose_allowed" CHECK ("shopping_private"."evidence_acquisition_attempts"."purpose" in ('specifications', 'experience', 'source_depth', 'first_pass', 'decision_gap', 'combined', 'current_brief'));--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_acquisition_attempts" ADD CONSTRAINT "evidence_acquisition_attempts_stage_shape" CHECK (("shopping_private"."evidence_acquisition_attempts"."stage" = 'organic_search' and "shopping_private"."evidence_acquisition_attempts"."query" is not null and "shopping_private"."evidence_acquisition_attempts"."provider" in ('serper', 'fixture') and "shopping_private"."evidence_acquisition_attempts"."model" is null and "shopping_private"."evidence_acquisition_attempts"."prompt_version" is null) or ("shopping_private"."evidence_acquisition_attempts"."stage" = 'page_fetch' and "shopping_private"."evidence_acquisition_attempts"."query" is null and "shopping_private"."evidence_acquisition_attempts"."provider" in ('server_http', 'fixture') and "shopping_private"."evidence_acquisition_attempts"."model" is null and "shopping_private"."evidence_acquisition_attempts"."prompt_version" is null) or ("shopping_private"."evidence_acquisition_attempts"."stage" in ('observation_extraction', 'criterion_assessment') and "shopping_private"."evidence_acquisition_attempts"."query" is null and "shopping_private"."evidence_acquisition_attempts"."provider" in ('openai', 'fixture') and "shopping_private"."evidence_acquisition_attempts"."model" is not null and "shopping_private"."evidence_acquisition_attempts"."prompt_version" is not null));--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_acquisition_attempts" ADD CONSTRAINT "evidence_acquisition_attempts_terminal_shape" CHECK (("shopping_private"."evidence_acquisition_attempts"."status" = 'planned' and "shopping_private"."evidence_acquisition_attempts"."started_at" is null and "shopping_private"."evidence_acquisition_attempts"."finished_at" is null and "shopping_private"."evidence_acquisition_attempts"."received_result_count" is null and "shopping_private"."evidence_acquisition_attempts"."failure_code" is null) or ("shopping_private"."evidence_acquisition_attempts"."status" = 'succeeded' and "shopping_private"."evidence_acquisition_attempts"."started_at" is not null and "shopping_private"."evidence_acquisition_attempts"."finished_at" is not null and "shopping_private"."evidence_acquisition_attempts"."finished_at" >= "shopping_private"."evidence_acquisition_attempts"."started_at" and "shopping_private"."evidence_acquisition_attempts"."received_result_count" is not null and "shopping_private"."evidence_acquisition_attempts"."received_result_count" >= 0 and "shopping_private"."evidence_acquisition_attempts"."failure_code" is null) or ("shopping_private"."evidence_acquisition_attempts"."status" = 'failed' and "shopping_private"."evidence_acquisition_attempts"."started_at" is not null and "shopping_private"."evidence_acquisition_attempts"."finished_at" is not null and "shopping_private"."evidence_acquisition_attempts"."finished_at" >= "shopping_private"."evidence_acquisition_attempts"."started_at" and "shopping_private"."evidence_acquisition_attempts"."received_result_count" is null and "shopping_private"."evidence_acquisition_attempts"."failure_code" is not null and "shopping_private"."evidence_acquisition_attempts"."failure_code" in ('provider_failed', 'invalid_provider_result', 'unsafe_url', 'dns_failed', 'network_failed', 'timeout', 'redirect_invalid', 'redirect_limit', 'http_status', 'unsupported_content_type', 'unsupported_content_encoding', 'response_too_large', 'invalid_text', 'invalid_extraction', 'identity_mismatch', 'model_failed', 'invalid_model_output')));--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_sources" ADD CONSTRAINT "evidence_sources_kind_allowed" CHECK ("shopping_private"."evidence_sources"."source_kind" in ('listing_field', 'organic_result', 'fetched_page', 'listing_image'));--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_sources" ADD CONSTRAINT "evidence_sources_kind_role_shape" CHECK (("shopping_private"."evidence_sources"."source_kind" = 'listing_field' and "shopping_private"."evidence_sources"."source_role" in ('listing', 'retailer_review_aggregate')) or ("shopping_private"."evidence_sources"."source_kind" = 'organic_result' and "shopping_private"."evidence_sources"."source_role" in ('retailer', 'manufacturer', 'independent_review', 'retailer_review_aggregate', 'other')) or ("shopping_private"."evidence_sources"."source_kind" = 'fetched_page' and "shopping_private"."evidence_sources"."source_role" in ('retailer', 'manufacturer', 'independent_review', 'retailer_review_aggregate') and "shopping_private"."evidence_sources"."acquisition_attempt_id" is not null) or ("shopping_private"."evidence_sources"."source_kind" = 'listing_image' and "shopping_private"."evidence_sources"."source_role" = 'visual'));--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_sources" ADD CONSTRAINT "evidence_sources_provider_allowed" CHECK ("shopping_private"."evidence_sources"."provider" in ('listing', 'serper', 'page_fetch', 'fixture'));
--> statement-breakpoint
REVOKE ALL ON TABLE "shopping_private"."evidence_page_fetch_targets" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE "shopping_private"."fetched_evidence_documents" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE "shopping_private"."merchant_destination_resolutions" FROM PUBLIC;
--> statement-breakpoint
DO $guard$
DECLARE
  client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE shopping_private.evidence_page_fetch_targets FROM %I',
        client_role
      );
      EXECUTE format(
        'REVOKE ALL ON TABLE shopping_private.fetched_evidence_documents FROM %I',
        client_role
      );
      EXECUTE format(
        'REVOKE ALL ON TABLE shopping_private.merchant_destination_resolutions FROM %I',
        client_role
      );
    END IF;
  END LOOP;
END
$guard$;
