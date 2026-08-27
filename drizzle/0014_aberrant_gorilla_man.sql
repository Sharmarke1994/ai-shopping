CREATE TABLE "shopping_private"."criterion_assessment_observations" (
	"task_id" uuid NOT NULL,
	"candidate_run_id" uuid NOT NULL,
	"candidate_listing_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "criterion_assessment_observations_pk" PRIMARY KEY("task_id","assessment_id","observation_id")
);
--> statement-breakpoint
CREATE TABLE "shopping_private"."criterion_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"research_run_id" uuid NOT NULL,
	"task_revision" bigint NOT NULL,
	"candidate_run_id" uuid NOT NULL,
	"candidate_listing_id" uuid NOT NULL,
	"criterion_id" uuid NOT NULL,
	"status" text NOT NULL,
	"relation" text NOT NULL,
	"explanation" text NOT NULL,
	"method" text NOT NULL,
	"model" text,
	"prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "criterion_assessments_task_id_id_unique" UNIQUE("task_id","id"),
	CONSTRAINT "criterion_assessments_identity_unique" UNIQUE("task_id","task_revision","candidate_run_id","candidate_listing_id","criterion_id"),
	CONSTRAINT "criterion_assessments_candidate_id_unique" UNIQUE("task_id","research_run_id","candidate_run_id","candidate_listing_id","id"),
	CONSTRAINT "criterion_assessments_reusable_candidate_id_unique" UNIQUE("task_id","candidate_run_id","candidate_listing_id","id"),
	CONSTRAINT "criterion_assessments_revision_nonnegative" CHECK ("shopping_private"."criterion_assessments"."task_revision" >= 0),
	CONSTRAINT "criterion_assessments_status_allowed" CHECK ("shopping_private"."criterion_assessments"."status" in ('meets', 'conflicts', 'uncertain', 'not_applicable')),
	CONSTRAINT "criterion_assessments_method_allowed" CHECK ("shopping_private"."criterion_assessments"."method" in ('deterministic', 'model', 'guarded_model')),
	CONSTRAINT "criterion_assessments_method_shape" CHECK (("shopping_private"."criterion_assessments"."method" = 'deterministic' and "shopping_private"."criterion_assessments"."model" is null and "shopping_private"."criterion_assessments"."prompt_version" is null) or ("shopping_private"."criterion_assessments"."method" in ('model', 'guarded_model') and "shopping_private"."criterion_assessments"."model" is not null and "shopping_private"."criterion_assessments"."prompt_version" is not null)),
	CONSTRAINT "criterion_assessments_text_bounds" CHECK (char_length(btrim("shopping_private"."criterion_assessments"."relation")) between 1 and 120 and char_length(btrim("shopping_private"."criterion_assessments"."explanation")) between 1 and 500 and ("shopping_private"."criterion_assessments"."model" is null or char_length(btrim("shopping_private"."criterion_assessments"."model")) between 1 and 160) and ("shopping_private"."criterion_assessments"."prompt_version" is null or char_length(btrim("shopping_private"."criterion_assessments"."prompt_version")) between 1 and 120))
);
--> statement-breakpoint
CREATE TABLE "shopping_private"."evidence_acquisition_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"research_run_id" uuid NOT NULL,
	"candidate_run_id" uuid NOT NULL,
	"candidate_listing_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"purpose" text NOT NULL,
	"plan_key" text NOT NULL,
	"query" text,
	"status" text NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"prompt_version" text,
	"provider_request_id" text,
	"received_result_count" integer,
	"failure_code" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_acquisition_attempts_task_id_id_unique" UNIQUE("task_id","id"),
	CONSTRAINT "evidence_acquisition_attempts_candidate_id_unique" UNIQUE("task_id","research_run_id","candidate_run_id","candidate_listing_id","id"),
	CONSTRAINT "evidence_acquisition_attempts_plan_unique" UNIQUE("task_id","research_run_id","candidate_listing_id","plan_key"),
	CONSTRAINT "evidence_acquisition_attempts_stage_allowed" CHECK ("shopping_private"."evidence_acquisition_attempts"."stage" in ('organic_search', 'observation_extraction', 'criterion_assessment')),
	CONSTRAINT "evidence_acquisition_attempts_purpose_allowed" CHECK ("shopping_private"."evidence_acquisition_attempts"."purpose" in ('specifications', 'experience', 'combined', 'current_brief')),
	CONSTRAINT "evidence_acquisition_attempts_text_bounds" CHECK (char_length(btrim("shopping_private"."evidence_acquisition_attempts"."plan_key")) between 1 and 180 and char_length(btrim("shopping_private"."evidence_acquisition_attempts"."provider")) between 1 and 120 and ("shopping_private"."evidence_acquisition_attempts"."query" is null or char_length(btrim("shopping_private"."evidence_acquisition_attempts"."query")) between 1 and 500) and ("shopping_private"."evidence_acquisition_attempts"."model" is null or char_length(btrim("shopping_private"."evidence_acquisition_attempts"."model")) between 1 and 160) and ("shopping_private"."evidence_acquisition_attempts"."prompt_version" is null or char_length(btrim("shopping_private"."evidence_acquisition_attempts"."prompt_version")) between 1 and 120) and ("shopping_private"."evidence_acquisition_attempts"."provider_request_id" is null or char_length(btrim("shopping_private"."evidence_acquisition_attempts"."provider_request_id")) between 1 and 240)),
	CONSTRAINT "evidence_acquisition_attempts_stage_shape" CHECK (("shopping_private"."evidence_acquisition_attempts"."stage" = 'organic_search' and "shopping_private"."evidence_acquisition_attempts"."query" is not null and "shopping_private"."evidence_acquisition_attempts"."provider" in ('serper', 'fixture') and "shopping_private"."evidence_acquisition_attempts"."model" is null and "shopping_private"."evidence_acquisition_attempts"."prompt_version" is null) or ("shopping_private"."evidence_acquisition_attempts"."stage" in ('observation_extraction', 'criterion_assessment') and "shopping_private"."evidence_acquisition_attempts"."query" is null and "shopping_private"."evidence_acquisition_attempts"."provider" in ('openai', 'fixture') and "shopping_private"."evidence_acquisition_attempts"."model" is not null and "shopping_private"."evidence_acquisition_attempts"."prompt_version" is not null)),
	CONSTRAINT "evidence_acquisition_attempts_status_allowed" CHECK ("shopping_private"."evidence_acquisition_attempts"."status" in ('planned', 'succeeded', 'failed')),
	CONSTRAINT "evidence_acquisition_attempts_terminal_shape" CHECK (("shopping_private"."evidence_acquisition_attempts"."status" = 'planned' and "shopping_private"."evidence_acquisition_attempts"."started_at" is null and "shopping_private"."evidence_acquisition_attempts"."finished_at" is null and "shopping_private"."evidence_acquisition_attempts"."received_result_count" is null and "shopping_private"."evidence_acquisition_attempts"."failure_code" is null) or ("shopping_private"."evidence_acquisition_attempts"."status" = 'succeeded' and "shopping_private"."evidence_acquisition_attempts"."started_at" is not null and "shopping_private"."evidence_acquisition_attempts"."finished_at" is not null and "shopping_private"."evidence_acquisition_attempts"."finished_at" >= "shopping_private"."evidence_acquisition_attempts"."started_at" and "shopping_private"."evidence_acquisition_attempts"."received_result_count" is not null and "shopping_private"."evidence_acquisition_attempts"."received_result_count" >= 0 and "shopping_private"."evidence_acquisition_attempts"."failure_code" is null) or ("shopping_private"."evidence_acquisition_attempts"."status" = 'failed' and "shopping_private"."evidence_acquisition_attempts"."started_at" is not null and "shopping_private"."evidence_acquisition_attempts"."finished_at" is not null and "shopping_private"."evidence_acquisition_attempts"."finished_at" >= "shopping_private"."evidence_acquisition_attempts"."started_at" and "shopping_private"."evidence_acquisition_attempts"."received_result_count" is null and "shopping_private"."evidence_acquisition_attempts"."failure_code" in ('provider_failed', 'invalid_provider_result', 'model_failed', 'invalid_model_output')))
);
--> statement-breakpoint
CREATE TABLE "shopping_private"."evidence_research_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"search_run_id" uuid NOT NULL,
	"task_revision" bigint NOT NULL,
	"policy_version" text NOT NULL,
	"status" text NOT NULL,
	"selected_candidate_count" integer NOT NULL,
	"planned_search_count" integer NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_research_runs_task_id_id_unique" UNIQUE("task_id","id"),
	CONSTRAINT "evidence_research_runs_candidate_scope_unique" UNIQUE("task_id","id","search_run_id"),
	CONSTRAINT "evidence_research_runs_assessment_scope_unique" UNIQUE("task_id","id","search_run_id","task_revision"),
	CONSTRAINT "evidence_research_runs_scope_unique" UNIQUE("task_id","search_run_id","task_revision","policy_version"),
	CONSTRAINT "evidence_research_runs_revision_nonnegative" CHECK ("shopping_private"."evidence_research_runs"."task_revision" >= 0),
	CONSTRAINT "evidence_research_runs_policy_bounds" CHECK (char_length(btrim("shopping_private"."evidence_research_runs"."policy_version")) between 1 and 120),
	CONSTRAINT "evidence_research_runs_status_allowed" CHECK ("shopping_private"."evidence_research_runs"."status" in ('running', 'succeeded', 'partial', 'failed')),
	CONSTRAINT "evidence_research_runs_budget_shape" CHECK ("shopping_private"."evidence_research_runs"."selected_candidate_count" between 1 and 8 and "shopping_private"."evidence_research_runs"."planned_search_count" between 0 and ("shopping_private"."evidence_research_runs"."selected_candidate_count" * 2)),
	CONSTRAINT "evidence_research_runs_status_time_shape" CHECK (("shopping_private"."evidence_research_runs"."status" = 'running' and "shopping_private"."evidence_research_runs"."finished_at" is null) or ("shopping_private"."evidence_research_runs"."status" in ('succeeded', 'partial', 'failed') and "shopping_private"."evidence_research_runs"."finished_at" is not null and "shopping_private"."evidence_research_runs"."finished_at" >= "shopping_private"."evidence_research_runs"."started_at")),
	CONSTRAINT "evidence_research_runs_lease_shape" CHECK (("shopping_private"."evidence_research_runs"."lease_token" is null and "shopping_private"."evidence_research_runs"."lease_expires_at" is null) or ("shopping_private"."evidence_research_runs"."status" = 'running' and "shopping_private"."evidence_research_runs"."lease_token" is not null and "shopping_private"."evidence_research_runs"."lease_expires_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "shopping_private"."evidence_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"research_run_id" uuid NOT NULL,
	"candidate_run_id" uuid NOT NULL,
	"candidate_listing_id" uuid NOT NULL,
	"acquisition_attempt_id" uuid,
	"source_role" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_url" text NOT NULL,
	"source_title" text NOT NULL,
	"excerpt" text,
	"provider" text NOT NULL,
	"provider_result_id" text,
	"observed_at" timestamp with time zone NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_sources_task_id_id_unique" UNIQUE("task_id","id"),
	CONSTRAINT "evidence_sources_candidate_id_unique" UNIQUE("task_id","research_run_id","candidate_run_id","candidate_listing_id","id"),
	CONSTRAINT "evidence_sources_fingerprint_unique" UNIQUE("task_id","candidate_run_id","candidate_listing_id","fingerprint"),
	CONSTRAINT "evidence_sources_role_allowed" CHECK ("shopping_private"."evidence_sources"."source_role" in ('listing', 'retailer', 'manufacturer', 'independent_review', 'retailer_review_aggregate', 'visual', 'other')),
	CONSTRAINT "evidence_sources_kind_allowed" CHECK ("shopping_private"."evidence_sources"."source_kind" in ('listing_field', 'organic_result', 'listing_image')),
	CONSTRAINT "evidence_sources_kind_role_shape" CHECK (("shopping_private"."evidence_sources"."source_kind" = 'listing_field' and "shopping_private"."evidence_sources"."source_role" in ('listing', 'retailer_review_aggregate')) or ("shopping_private"."evidence_sources"."source_kind" = 'organic_result' and "shopping_private"."evidence_sources"."source_role" in ('retailer', 'manufacturer', 'independent_review', 'retailer_review_aggregate', 'other')) or ("shopping_private"."evidence_sources"."source_kind" = 'listing_image' and "shopping_private"."evidence_sources"."source_role" = 'visual')),
	CONSTRAINT "evidence_sources_url_shape" CHECK (char_length("shopping_private"."evidence_sources"."source_url") between 1 and 4000 and "shopping_private"."evidence_sources"."source_url" ~ '^https?://'),
	CONSTRAINT "evidence_sources_text_bounds" CHECK (char_length(btrim("shopping_private"."evidence_sources"."source_title")) between 1 and 500 and ("shopping_private"."evidence_sources"."excerpt" is null or char_length(btrim("shopping_private"."evidence_sources"."excerpt")) between 1 and 1000) and ("shopping_private"."evidence_sources"."provider_result_id" is null or char_length(btrim("shopping_private"."evidence_sources"."provider_result_id")) between 1 and 500)),
	CONSTRAINT "evidence_sources_provider_allowed" CHECK ("shopping_private"."evidence_sources"."provider" in ('listing', 'serper', 'fixture')),
	CONSTRAINT "evidence_sources_fingerprint_shape" CHECK ("shopping_private"."evidence_sources"."fingerprint" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "shopping_private"."product_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"research_run_id" uuid NOT NULL,
	"candidate_run_id" uuid NOT NULL,
	"candidate_listing_id" uuid NOT NULL,
	"evidence_source_id" uuid NOT NULL,
	"concept_id" uuid,
	"support" text NOT NULL,
	"observation_kind" text NOT NULL,
	"property_label" text NOT NULL,
	"claim" text NOT NULL,
	"value" jsonb NOT NULL,
	"derivation" text NOT NULL,
	"model" text,
	"prompt_version" text,
	"observed_at" timestamp with time zone NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_observations_task_id_id_unique" UNIQUE("task_id","id"),
	CONSTRAINT "product_observations_candidate_id_unique" UNIQUE("task_id","research_run_id","candidate_run_id","candidate_listing_id","id"),
	CONSTRAINT "product_observations_reusable_candidate_id_unique" UNIQUE("task_id","candidate_run_id","candidate_listing_id","id"),
	CONSTRAINT "product_observations_fingerprint_unique" UNIQUE("task_id","candidate_run_id","candidate_listing_id","evidence_source_id","fingerprint"),
	CONSTRAINT "product_observations_support_allowed" CHECK ("shopping_private"."product_observations"."support" in ('supported', 'ambiguous')),
	CONSTRAINT "product_observations_kind_allowed" CHECK ("shopping_private"."product_observations"."observation_kind" in ('structured_field', 'source_assertion', 'visual_inference')),
	CONSTRAINT "product_observations_derivation_allowed" CHECK ("shopping_private"."product_observations"."derivation" in ('deterministic', 'model_text', 'model_visual')),
	CONSTRAINT "product_observations_derivation_shape" CHECK (("shopping_private"."product_observations"."derivation" = 'deterministic' and "shopping_private"."product_observations"."model" is null and "shopping_private"."product_observations"."prompt_version" is null) or ("shopping_private"."product_observations"."derivation" in ('model_text', 'model_visual') and "shopping_private"."product_observations"."model" is not null and "shopping_private"."product_observations"."prompt_version" is not null)),
	CONSTRAINT "product_observations_text_bounds" CHECK (char_length(btrim("shopping_private"."product_observations"."property_label")) between 1 and 120 and char_length(btrim("shopping_private"."product_observations"."claim")) between 1 and 500 and ("shopping_private"."product_observations"."model" is null or char_length(btrim("shopping_private"."product_observations"."model")) between 1 and 160) and ("shopping_private"."product_observations"."prompt_version" is null or char_length(btrim("shopping_private"."product_observations"."prompt_version")) between 1 and 120)),
	CONSTRAINT "product_observations_value_object" CHECK (jsonb_typeof("shopping_private"."product_observations"."value") is not distinct from 'object' and ("shopping_private"."product_observations"."value" ->> 'schemaVersion') = '1' and ("shopping_private"."product_observations"."value" ->> 'kind') in ('boolean', 'money', 'quantity', 'rating_aggregate', 'categorical', 'text')),
	CONSTRAINT "product_observations_fingerprint_shape" CHECK ("shopping_private"."product_observations"."fingerprint" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "shopping_private"."criterion_assessment_observations" ADD CONSTRAINT "criterion_assessment_observations_assessment_fk" FOREIGN KEY ("task_id","candidate_run_id","candidate_listing_id","assessment_id") REFERENCES "shopping_private"."criterion_assessments"("task_id","candidate_run_id","candidate_listing_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."criterion_assessment_observations" ADD CONSTRAINT "criterion_assessment_observations_observation_fk" FOREIGN KEY ("task_id","candidate_run_id","candidate_listing_id","observation_id") REFERENCES "shopping_private"."product_observations"("task_id","candidate_run_id","candidate_listing_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."criterion_assessments" ADD CONSTRAINT "criterion_assessments_task_fk" FOREIGN KEY ("task_id") REFERENCES "shopping_private"."shopping_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."criterion_assessments" ADD CONSTRAINT "criterion_assessments_research_run_fk" FOREIGN KEY ("task_id","research_run_id","candidate_run_id","task_revision") REFERENCES "shopping_private"."evidence_research_runs"("task_id","id","search_run_id","task_revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."criterion_assessments" ADD CONSTRAINT "criterion_assessments_candidate_fk" FOREIGN KEY ("task_id","candidate_run_id","candidate_listing_id") REFERENCES "shopping_private"."candidate_listings"("task_id","run_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."criterion_assessments" ADD CONSTRAINT "criterion_assessments_criterion_fk" FOREIGN KEY ("task_id","criterion_id") REFERENCES "shopping_private"."decision_criteria"("task_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_acquisition_attempts" ADD CONSTRAINT "evidence_acquisition_attempts_research_run_fk" FOREIGN KEY ("task_id","research_run_id","candidate_run_id") REFERENCES "shopping_private"."evidence_research_runs"("task_id","id","search_run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_acquisition_attempts" ADD CONSTRAINT "evidence_acquisition_attempts_candidate_fk" FOREIGN KEY ("task_id","candidate_run_id","candidate_listing_id") REFERENCES "shopping_private"."candidate_listings"("task_id","run_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_research_runs" ADD CONSTRAINT "evidence_research_runs_task_fk" FOREIGN KEY ("task_id") REFERENCES "shopping_private"."shopping_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_research_runs" ADD CONSTRAINT "evidence_research_runs_search_run_fk" FOREIGN KEY ("task_id","search_run_id") REFERENCES "shopping_private"."search_runs"("task_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_sources" ADD CONSTRAINT "evidence_sources_research_run_fk" FOREIGN KEY ("task_id","research_run_id","candidate_run_id") REFERENCES "shopping_private"."evidence_research_runs"("task_id","id","search_run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_sources" ADD CONSTRAINT "evidence_sources_candidate_fk" FOREIGN KEY ("task_id","candidate_run_id","candidate_listing_id") REFERENCES "shopping_private"."candidate_listings"("task_id","run_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_sources" ADD CONSTRAINT "evidence_sources_attempt_fk" FOREIGN KEY ("task_id","research_run_id","candidate_run_id","candidate_listing_id","acquisition_attempt_id") REFERENCES "shopping_private"."evidence_acquisition_attempts"("task_id","research_run_id","candidate_run_id","candidate_listing_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."product_observations" ADD CONSTRAINT "product_observations_source_fk" FOREIGN KEY ("task_id","research_run_id","candidate_run_id","candidate_listing_id","evidence_source_id") REFERENCES "shopping_private"."evidence_sources"("task_id","research_run_id","candidate_run_id","candidate_listing_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."product_observations" ADD CONSTRAINT "product_observations_concept_fk" FOREIGN KEY ("task_id","concept_id") REFERENCES "shopping_private"."concept_definitions"("task_id","id") ON DELETE restrict ON UPDATE no action;