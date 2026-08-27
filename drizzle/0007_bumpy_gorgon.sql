CREATE TABLE "shopping_private"."candidate_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"query_id" uuid NOT NULL,
	"query_execution_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_result_id" text NOT NULL,
	"source_rank" integer NOT NULL,
	"surface" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"merchant" text,
	"price_amount_minor" integer,
	"price_currency_code" text,
	"price_text" text,
	"image_url" text,
	"delivery_text" text,
	"availability_text" text,
	"retrieved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_listings_task_id_id_unique" UNIQUE("task_id","id"),
	CONSTRAINT "candidate_listings_task_run_id_unique" UNIQUE("task_id","run_id","id"),
	CONSTRAINT "candidate_listings_provider_identity_shape" CHECK ("shopping_private"."candidate_listings"."provider" in ('serper', 'fixture') and char_length(btrim("shopping_private"."candidate_listings"."provider_result_id")) between 1 and 500),
	CONSTRAINT "candidate_listings_rank_positive" CHECK ("shopping_private"."candidate_listings"."source_rank" > 0),
	CONSTRAINT "candidate_listings_surface_allowed" CHECK ("shopping_private"."candidate_listings"."surface" = 'shopping'),
	CONSTRAINT "candidate_listings_title_bounds" CHECK (char_length(btrim("shopping_private"."candidate_listings"."title")) between 1 and 1000),
	CONSTRAINT "candidate_listings_url_shape" CHECK (char_length("shopping_private"."candidate_listings"."url") between 1 and 4000 and "shopping_private"."candidate_listings"."url" ~ '^https?://' and char_length("shopping_private"."candidate_listings"."canonical_url") between 1 and 4000 and "shopping_private"."candidate_listings"."canonical_url" ~ '^https?://'),
	CONSTRAINT "candidate_listings_optional_text_bounds" CHECK (("shopping_private"."candidate_listings"."merchant" is null or char_length(btrim("shopping_private"."candidate_listings"."merchant")) between 1 and 500) and ("shopping_private"."candidate_listings"."price_text" is null or char_length(btrim("shopping_private"."candidate_listings"."price_text")) between 1 and 120) and ("shopping_private"."candidate_listings"."delivery_text" is null or char_length(btrim("shopping_private"."candidate_listings"."delivery_text")) between 1 and 500) and ("shopping_private"."candidate_listings"."availability_text" is null or char_length(btrim("shopping_private"."candidate_listings"."availability_text")) between 1 and 500)),
	CONSTRAINT "candidate_listings_price_shape" CHECK (("shopping_private"."candidate_listings"."price_amount_minor" is null and "shopping_private"."candidate_listings"."price_currency_code" is null) or ("shopping_private"."candidate_listings"."price_amount_minor" is not null and "shopping_private"."candidate_listings"."price_amount_minor" >= 0 and "shopping_private"."candidate_listings"."price_currency_code" is not null and "shopping_private"."candidate_listings"."price_currency_code" ~ '^[A-Z]{3}$')),
	CONSTRAINT "candidate_listings_image_url_shape" CHECK ("shopping_private"."candidate_listings"."image_url" is null or (char_length("shopping_private"."candidate_listings"."image_url") between 1 and 4000 and "shopping_private"."candidate_listings"."image_url" ~ '^https?://'))
);
--> statement-breakpoint
CREATE TABLE "shopping_private"."search_hypotheses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"kind" text NOT NULL,
	"rationale" text NOT NULL,
	"source_text_is_basis" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_hypotheses_task_id_id_unique" UNIQUE("task_id","id"),
	CONSTRAINT "search_hypotheses_task_run_id_unique" UNIQUE("task_id","run_id","id"),
	CONSTRAINT "search_hypotheses_run_ordinal_unique" UNIQUE("task_id","run_id","ordinal"),
	CONSTRAINT "search_hypotheses_ordinal_bounds" CHECK ("shopping_private"."search_hypotheses"."ordinal" between 0 and 2),
	CONSTRAINT "search_hypotheses_kind_allowed" CHECK ("shopping_private"."search_hypotheses"."kind" in ('literal', 'brief_expansion', 'market_vocabulary')),
	CONSTRAINT "search_hypotheses_rationale_bounds" CHECK (char_length(btrim("shopping_private"."search_hypotheses"."rationale")) between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "shopping_private"."search_hypothesis_basis_criteria" (
	"task_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"hypothesis_id" uuid NOT NULL,
	"criterion_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	CONSTRAINT "search_hypothesis_basis_criteria_pk" PRIMARY KEY("task_id","run_id","hypothesis_id","criterion_id"),
	CONSTRAINT "search_hypothesis_basis_criteria_ordinal_unique" UNIQUE("task_id","run_id","hypothesis_id","ordinal"),
	CONSTRAINT "search_hypothesis_basis_criteria_ordinal_bounds" CHECK ("shopping_private"."search_hypothesis_basis_criteria"."ordinal" between 0 and 19)
);
--> statement-breakpoint
CREATE TABLE "shopping_private"."search_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"hypothesis_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"purpose" text NOT NULL,
	"query_text" text NOT NULL,
	"surface" text NOT NULL,
	"candidate_limit" integer NOT NULL,
	"provider" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_queries_task_id_id_unique" UNIQUE("task_id","id"),
	CONSTRAINT "search_queries_task_run_id_unique" UNIQUE("task_id","run_id","id"),
	CONSTRAINT "search_queries_exact_provider_surface_unique" UNIQUE("task_id","run_id","id","provider","surface"),
	CONSTRAINT "search_queries_run_ordinal_unique" UNIQUE("task_id","run_id","ordinal"),
	CONSTRAINT "search_queries_hypothesis_unique" UNIQUE("task_id","run_id","hypothesis_id"),
	CONSTRAINT "search_queries_ordinal_bounds" CHECK ("shopping_private"."search_queries"."ordinal" between 0 and 2),
	CONSTRAINT "search_queries_purpose_allowed" CHECK ("shopping_private"."search_queries"."purpose" in ('literal_precision', 'brief_recall', 'market_language')),
	CONSTRAINT "search_queries_text_bounds" CHECK (char_length(btrim("shopping_private"."search_queries"."query_text")) between 1 and 240),
	CONSTRAINT "search_queries_surface_allowed" CHECK ("shopping_private"."search_queries"."surface" = 'shopping'),
	CONSTRAINT "search_queries_candidate_limit_bounds" CHECK ("shopping_private"."search_queries"."candidate_limit" between 1 and 20),
	CONSTRAINT "search_queries_provider_allowed" CHECK ("shopping_private"."search_queries"."provider" in ('serper', 'fixture'))
);
--> statement-breakpoint
CREATE TABLE "shopping_private"."search_query_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"query_id" uuid NOT NULL,
	"status" text NOT NULL,
	"received_result_count" integer,
	"rejected_result_count" integer,
	"provider_request_id" text,
	"failure_code" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_query_executions_task_id_id_unique" UNIQUE("task_id","id"),
	CONSTRAINT "search_query_executions_query_unique" UNIQUE("task_id","run_id","query_id"),
	CONSTRAINT "search_query_executions_exact_query_id_unique" UNIQUE("task_id","run_id","query_id","id"),
	CONSTRAINT "search_query_executions_status_allowed" CHECK ("shopping_private"."search_query_executions"."status" in ('succeeded', 'failed')),
	CONSTRAINT "search_query_executions_count_shape" CHECK (("shopping_private"."search_query_executions"."received_result_count" is null or "shopping_private"."search_query_executions"."received_result_count" >= 0) and ("shopping_private"."search_query_executions"."rejected_result_count" is null or "shopping_private"."search_query_executions"."rejected_result_count" >= 0) and ("shopping_private"."search_query_executions"."received_result_count" is null or "shopping_private"."search_query_executions"."rejected_result_count" is null or "shopping_private"."search_query_executions"."rejected_result_count" <= "shopping_private"."search_query_executions"."received_result_count")),
	CONSTRAINT "search_query_executions_terminal_shape" CHECK (("shopping_private"."search_query_executions"."status" = 'succeeded' and "shopping_private"."search_query_executions"."received_result_count" is not null and "shopping_private"."search_query_executions"."rejected_result_count" is not null and "shopping_private"."search_query_executions"."failure_code" is null) or ("shopping_private"."search_query_executions"."status" = 'failed' and "shopping_private"."search_query_executions"."received_result_count" is null and "shopping_private"."search_query_executions"."rejected_result_count" is null and "shopping_private"."search_query_executions"."failure_code" is not null and "shopping_private"."search_query_executions"."failure_code" in ('provider_failed', 'invalid_provider_result'))),
	CONSTRAINT "search_query_executions_diagnostic_text_bounds" CHECK (("shopping_private"."search_query_executions"."provider_request_id" is null or char_length(btrim("shopping_private"."search_query_executions"."provider_request_id")) between 1 and 240) and ("shopping_private"."search_query_executions"."failure_code" is null or "shopping_private"."search_query_executions"."failure_code" in ('provider_failed', 'invalid_provider_result'))),
	CONSTRAINT "search_query_executions_timestamp_order" CHECK ("shopping_private"."search_query_executions"."finished_at" >= "shopping_private"."search_query_executions"."started_at")
);
--> statement-breakpoint
CREATE TABLE "shopping_private"."search_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"context_action_id" uuid NOT NULL,
	"task_revision" bigint NOT NULL,
	"market_country" text NOT NULL,
	"language_tag" text NOT NULL,
	"currency_code" text NOT NULL,
	"provider" text NOT NULL,
	"query_strategy_version" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_runs_task_id_id_unique" UNIQUE("task_id","id"),
	CONSTRAINT "search_runs_task_id_id_provider_unique" UNIQUE("task_id","id","provider"),
	CONSTRAINT "search_runs_revision_nonnegative" CHECK ("shopping_private"."search_runs"."task_revision" >= 0),
	CONSTRAINT "search_runs_market_country_shape" CHECK ("shopping_private"."search_runs"."market_country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "search_runs_language_tag_shape" CHECK ("shopping_private"."search_runs"."language_tag" ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
	CONSTRAINT "search_runs_currency_code_shape" CHECK ("shopping_private"."search_runs"."currency_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "search_runs_config_text_bounds" CHECK (char_length(btrim("shopping_private"."search_runs"."provider")) between 1 and 120 and char_length(btrim("shopping_private"."search_runs"."query_strategy_version")) between 1 and 120),
	CONSTRAINT "search_runs_provider_allowed" CHECK ("shopping_private"."search_runs"."provider" in ('serper', 'fixture')),
	CONSTRAINT "search_runs_status_allowed" CHECK ("shopping_private"."search_runs"."status" in ('running', 'succeeded', 'partial', 'failed')),
	CONSTRAINT "search_runs_status_time_shape" CHECK (("shopping_private"."search_runs"."status" = 'running' and "shopping_private"."search_runs"."finished_at" is null) or ("shopping_private"."search_runs"."status" in ('succeeded', 'partial', 'failed') and "shopping_private"."search_runs"."finished_at" is not null and "shopping_private"."search_runs"."finished_at" >= "shopping_private"."search_runs"."started_at"))
);
--> statement-breakpoint
ALTER TABLE "shopping_private"."candidate_listings" ADD CONSTRAINT "candidate_listings_task_fk" FOREIGN KEY ("task_id") REFERENCES "shopping_private"."shopping_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."candidate_listings" ADD CONSTRAINT "candidate_listings_run_fk" FOREIGN KEY ("task_id","run_id") REFERENCES "shopping_private"."search_runs"("task_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."candidate_listings" ADD CONSTRAINT "candidate_listings_query_fk" FOREIGN KEY ("task_id","run_id","query_id","provider","surface") REFERENCES "shopping_private"."search_queries"("task_id","run_id","id","provider","surface") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."candidate_listings" ADD CONSTRAINT "candidate_listings_query_execution_fk" FOREIGN KEY ("task_id","run_id","query_id","query_execution_id") REFERENCES "shopping_private"."search_query_executions"("task_id","run_id","query_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."search_hypotheses" ADD CONSTRAINT "search_hypotheses_run_fk" FOREIGN KEY ("task_id","run_id") REFERENCES "shopping_private"."search_runs"("task_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."search_hypothesis_basis_criteria" ADD CONSTRAINT "search_hypothesis_basis_criteria_hypothesis_fk" FOREIGN KEY ("task_id","run_id","hypothesis_id") REFERENCES "shopping_private"."search_hypotheses"("task_id","run_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."search_hypothesis_basis_criteria" ADD CONSTRAINT "search_hypothesis_basis_criteria_criterion_fk" FOREIGN KEY ("task_id","criterion_id") REFERENCES "shopping_private"."decision_criteria"("task_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."search_queries" ADD CONSTRAINT "search_queries_run_provider_fk" FOREIGN KEY ("task_id","run_id","provider") REFERENCES "shopping_private"."search_runs"("task_id","id","provider") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."search_queries" ADD CONSTRAINT "search_queries_hypothesis_fk" FOREIGN KEY ("task_id","run_id","hypothesis_id") REFERENCES "shopping_private"."search_hypotheses"("task_id","run_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."search_query_executions" ADD CONSTRAINT "search_query_executions_run_fk" FOREIGN KEY ("task_id","run_id") REFERENCES "shopping_private"."search_runs"("task_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."search_query_executions" ADD CONSTRAINT "search_query_executions_query_fk" FOREIGN KEY ("task_id","run_id","query_id") REFERENCES "shopping_private"."search_queries"("task_id","run_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."search_runs" ADD CONSTRAINT "search_runs_task_fk" FOREIGN KEY ("task_id") REFERENCES "shopping_private"."shopping_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."search_runs" ADD CONSTRAINT "search_runs_context_action_fk" FOREIGN KEY ("task_id","context_action_id") REFERENCES "shopping_private"."context_actions"("task_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
REVOKE ALL ON TABLE
  "shopping_private"."candidate_listings",
  "shopping_private"."search_hypotheses",
  "shopping_private"."search_hypothesis_basis_criteria",
  "shopping_private"."search_queries",
  "shopping_private"."search_query_executions",
  "shopping_private"."search_runs"
FROM PUBLIC;
--> statement-breakpoint
DO $guard$
DECLARE
  client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE shopping_private.candidate_listings, shopping_private.search_hypotheses, shopping_private.search_hypothesis_basis_criteria, shopping_private.search_queries, shopping_private.search_query_executions, shopping_private.search_runs FROM %I',
        client_role
      );
    END IF;
  END LOOP;
END
$guard$;
