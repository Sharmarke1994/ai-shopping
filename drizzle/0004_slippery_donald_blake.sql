CREATE TABLE "shopping_private"."context_acquisition_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"orchestration_run_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"source_task_input_id" uuid NOT NULL,
	"snapshot_revision" bigint NOT NULL,
	"stage" text NOT NULL,
	"attempt_ordinal" integer NOT NULL,
	"status" text NOT NULL,
	"provider" text,
	"model" text,
	"prompt_version" text NOT NULL,
	"provider_schema_version" integer NOT NULL,
	"provider_request_id" text,
	"duration_ms" integer NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"interpretation_proposal" jsonb,
	"context_action_proposal" jsonb,
	"error_code" text,
	"state_change_application_id" uuid,
	"context_action_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "context_acquisition_attempts_stage_allowed" CHECK ("shopping_private"."context_acquisition_attempts"."stage" in ('interpretation', 'context_action')),
	CONSTRAINT "context_acquisition_attempts_status_allowed" CHECK ("shopping_private"."context_acquisition_attempts"."status" in ('completed', 'refused', 'incomplete', 'malformed', 'timed_out', 'provider_failed', 'input_too_large', 'invalid_patch', 'stale', 'superseded_by_winner')),
	CONSTRAINT "context_acquisition_attempts_numbers_nonnegative" CHECK ("shopping_private"."context_acquisition_attempts"."snapshot_revision" >= 0 and "shopping_private"."context_acquisition_attempts"."attempt_ordinal" > 0 and "shopping_private"."context_acquisition_attempts"."duration_ms" >= 0 and ("shopping_private"."context_acquisition_attempts"."input_tokens" is null or "shopping_private"."context_acquisition_attempts"."input_tokens" >= 0) and ("shopping_private"."context_acquisition_attempts"."output_tokens" is null or "shopping_private"."context_acquisition_attempts"."output_tokens" >= 0)),
	CONSTRAINT "context_acquisition_attempts_schema_positive" CHECK ("shopping_private"."context_acquisition_attempts"."provider_schema_version" > 0),
	CONSTRAINT "context_acquisition_attempts_proposal_objects" CHECK (("shopping_private"."context_acquisition_attempts"."interpretation_proposal" is null or jsonb_typeof("shopping_private"."context_acquisition_attempts"."interpretation_proposal") = 'object') and ("shopping_private"."context_acquisition_attempts"."context_action_proposal" is null or jsonb_typeof("shopping_private"."context_acquisition_attempts"."context_action_proposal") = 'object')),
	CONSTRAINT "context_acquisition_attempts_stage_proposal" CHECK (not ("shopping_private"."context_acquisition_attempts"."interpretation_proposal" is not null and "shopping_private"."context_acquisition_attempts"."context_action_proposal" is not null) and ("shopping_private"."context_acquisition_attempts"."stage" = 'interpretation' or "shopping_private"."context_acquisition_attempts"."interpretation_proposal" is null) and ("shopping_private"."context_acquisition_attempts"."stage" = 'context_action' or "shopping_private"."context_acquisition_attempts"."context_action_proposal" is null)),
	CONSTRAINT "context_acquisition_attempts_text_bounds" CHECK (char_length("shopping_private"."context_acquisition_attempts"."prompt_version") between 1 and 120 and ("shopping_private"."context_acquisition_attempts"."provider" is null or char_length("shopping_private"."context_acquisition_attempts"."provider") between 1 and 120) and ("shopping_private"."context_acquisition_attempts"."model" is null or char_length("shopping_private"."context_acquisition_attempts"."model") between 1 and 160) and ("shopping_private"."context_acquisition_attempts"."provider_request_id" is null or char_length("shopping_private"."context_acquisition_attempts"."provider_request_id") between 1 and 240) and ("shopping_private"."context_acquisition_attempts"."error_code" is null or "shopping_private"."context_acquisition_attempts"."error_code" ~ '^[a-z0-9_:-]{1,120}$'))
);
--> statement-breakpoint
CREATE TABLE "shopping_private"."context_action_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"context_action_id" uuid NOT NULL,
	"answer_task_input_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "context_action_answers_task_action_unique" UNIQUE("task_id","context_action_id"),
	CONSTRAINT "context_action_answers_task_input_unique" UNIQUE("task_id","answer_task_input_id")
);
--> statement-breakpoint
CREATE TABLE "shopping_private"."context_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"state_change_application_id" uuid NOT NULL,
	"selected_at_revision" bigint NOT NULL,
	"action_schema_version" integer NOT NULL,
	"action_kind" text NOT NULL,
	"prompt_schema_version" integer,
	"question_prompt" text,
	"response_mode" text,
	"expected_impact" text,
	"why_now" text,
	"can_search_without_answer" boolean,
	"rationale" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"provider_schema_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "context_actions_task_id_id_unique" UNIQUE("task_id","id"),
	CONSTRAINT "context_actions_task_application_unique" UNIQUE("task_id","state_change_application_id"),
	CONSTRAINT "context_actions_kind_allowed" CHECK ("shopping_private"."context_actions"."action_kind" in ('ask', 'search', 'show_refine')),
	CONSTRAINT "context_actions_versions_positive" CHECK ("shopping_private"."context_actions"."action_schema_version" > 0 and "shopping_private"."context_actions"."provider_schema_version" > 0 and ("shopping_private"."context_actions"."prompt_schema_version" is null or "shopping_private"."context_actions"."prompt_schema_version" > 0)),
	CONSTRAINT "context_actions_revision_nonnegative" CHECK ("shopping_private"."context_actions"."selected_at_revision" >= 0),
	CONSTRAINT "context_actions_config_text" CHECK (char_length("shopping_private"."context_actions"."provider") between 1 and 120 and char_length("shopping_private"."context_actions"."model") between 1 and 160 and char_length("shopping_private"."context_actions"."prompt_version") between 1 and 120),
	CONSTRAINT "context_actions_branch_shape" CHECK ((
        "shopping_private"."context_actions"."action_kind" = 'ask'
        and "shopping_private"."context_actions"."prompt_schema_version" is not null
        and "shopping_private"."context_actions"."question_prompt" is not null
        and "shopping_private"."context_actions"."response_mode" in ('open_text', 'single_select')
        and "shopping_private"."context_actions"."expected_impact" in ('retrieval', 'eligibility', 'judgement')
        and "shopping_private"."context_actions"."why_now" is not null
        and "shopping_private"."context_actions"."can_search_without_answer" is not null
        and "shopping_private"."context_actions"."rationale" is null
      ) or (
        "shopping_private"."context_actions"."action_kind" in ('search', 'show_refine')
        and "shopping_private"."context_actions"."prompt_schema_version" is null
        and "shopping_private"."context_actions"."question_prompt" is null
        and "shopping_private"."context_actions"."response_mode" is null
        and "shopping_private"."context_actions"."expected_impact" is null
        and "shopping_private"."context_actions"."why_now" is null
        and "shopping_private"."context_actions"."can_search_without_answer" is null
        and "shopping_private"."context_actions"."rationale" is not null
      )),
	CONSTRAINT "context_actions_text_bounds" CHECK ((
        ("shopping_private"."context_actions"."question_prompt" is null or char_length(btrim("shopping_private"."context_actions"."question_prompt")) between 1 and 500)
        and ("shopping_private"."context_actions"."why_now" is null or char_length(btrim("shopping_private"."context_actions"."why_now")) between 1 and 500)
        and ("shopping_private"."context_actions"."rationale" is null or char_length(btrim("shopping_private"."context_actions"."rationale")) between 1 and 500)
      ))
);
--> statement-breakpoint
CREATE TABLE "shopping_private"."context_question_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"context_action_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "context_question_options_task_id_id_unique" UNIQUE("task_id","id"),
	CONSTRAINT "context_question_options_action_ordinal_unique" UNIQUE("task_id","context_action_id","ordinal"),
	CONSTRAINT "context_question_options_ordinal_nonnegative" CHECK ("shopping_private"."context_question_options"."ordinal" >= 0),
	CONSTRAINT "context_question_options_label_bounds" CHECK (char_length(btrim("shopping_private"."context_question_options"."label")) between 1 and 160)
);
--> statement-breakpoint
ALTER TABLE "shopping_private"."context_acquisition_attempts" ADD CONSTRAINT "context_acquisition_attempts_input_fk" FOREIGN KEY ("task_id","source_task_input_id") REFERENCES "shopping_private"."task_inputs"("task_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."context_acquisition_attempts" ADD CONSTRAINT "context_acquisition_attempts_application_fk" FOREIGN KEY ("task_id","state_change_application_id") REFERENCES "shopping_private"."state_change_applications"("task_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."context_acquisition_attempts" ADD CONSTRAINT "context_acquisition_attempts_action_fk" FOREIGN KEY ("task_id","context_action_id") REFERENCES "shopping_private"."context_actions"("task_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."context_action_answers" ADD CONSTRAINT "context_action_answers_action_fk" FOREIGN KEY ("task_id","context_action_id") REFERENCES "shopping_private"."context_actions"("task_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."context_action_answers" ADD CONSTRAINT "context_action_answers_input_fk" FOREIGN KEY ("task_id","answer_task_input_id") REFERENCES "shopping_private"."task_inputs"("task_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."context_actions" ADD CONSTRAINT "context_actions_task_fk" FOREIGN KEY ("task_id") REFERENCES "shopping_private"."shopping_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."context_actions" ADD CONSTRAINT "context_actions_application_fk" FOREIGN KEY ("task_id","state_change_application_id") REFERENCES "shopping_private"."state_change_applications"("task_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."context_question_options" ADD CONSTRAINT "context_question_options_action_fk" FOREIGN KEY ("task_id","context_action_id") REFERENCES "shopping_private"."context_actions"("task_id","id") ON DELETE restrict ON UPDATE no action;