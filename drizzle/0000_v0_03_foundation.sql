CREATE SCHEMA "shopping_private";
--> statement-breakpoint
CREATE TABLE "shopping_private"."concept_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"label" text NOT NULL,
	"definition" text NOT NULL,
	"value_family" text NOT NULL,
	"canonical_unit" text,
	"created_revision" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concept_definitions_task_id_id_unique" UNIQUE("task_id","id"),
	CONSTRAINT "concept_definitions_label_shape" CHECK (char_length(btrim("shopping_private"."concept_definitions"."label")) between 1 and 120),
	CONSTRAINT "concept_definitions_definition_shape" CHECK (char_length(btrim("shopping_private"."concept_definitions"."definition")) between 1 and 500),
	CONSTRAINT "concept_definitions_family_allowed" CHECK ("shopping_private"."concept_definitions"."value_family" in ('boolean', 'qualitative', 'measurement', 'money', 'categorical')),
	CONSTRAINT "concept_definitions_unit_shape" CHECK (("shopping_private"."concept_definitions"."value_family" = 'measurement' and "shopping_private"."concept_definitions"."canonical_unit" is not null and "shopping_private"."concept_definitions"."canonical_unit" in ('mm', 'cm', 'm', 'g', 'kg')) or ("shopping_private"."concept_definitions"."value_family" <> 'measurement' and "shopping_private"."concept_definitions"."canonical_unit" is null)),
	CONSTRAINT "concept_definitions_revision_nonnegative" CHECK ("shopping_private"."concept_definitions"."created_revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shopping_private"."criterion_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"criterion_id" uuid NOT NULL,
	"source_role" text NOT NULL,
	"source_kind" text NOT NULL,
	"task_input_id" uuid NOT NULL,
	"message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "criterion_sources_task_id_id_unique" UNIQUE("task_id","id"),
	CONSTRAINT "criterion_sources_role_input_unique" UNIQUE("criterion_id","source_role","task_input_id"),
	CONSTRAINT "criterion_sources_role_allowed" CHECK ("shopping_private"."criterion_sources"."source_role" in ('origin', 'confirmation', 'change')),
	CONSTRAINT "criterion_sources_kind_allowed" CHECK ("shopping_private"."criterion_sources"."source_kind" in ('message', 'question_answer', 'direct_brief_action')),
	CONSTRAINT "criterion_sources_message_shape" CHECK (("shopping_private"."criterion_sources"."source_kind" = 'message' and "shopping_private"."criterion_sources"."message_id" is not null) or ("shopping_private"."criterion_sources"."source_kind" <> 'message' and "shopping_private"."criterion_sources"."message_id" is null))
);
--> statement-breakpoint
CREATE TABLE "shopping_private"."decision_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"lineage_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"authority" text NOT NULL,
	"strength" text,
	"target_semantics" text NOT NULL,
	"value_schema_version" integer NOT NULL,
	"value_kind" text NOT NULL,
	"semantic_value" jsonb NOT NULL,
	"lifecycle" text NOT NULL,
	"created_revision" bigint NOT NULL,
	"ended_revision" bigint,
	"superseded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_criteria_task_id_id_unique" UNIQUE("task_id","id"),
	CONSTRAINT "decision_criteria_successor_identity_unique" UNIQUE("task_id","lineage_id","concept_id","id"),
	CONSTRAINT "decision_criteria_authority_allowed" CHECK ("shopping_private"."decision_criteria"."authority" in ('user_explicit', 'user_confirmed')),
	CONSTRAINT "decision_criteria_strength_allowed" CHECK ("shopping_private"."decision_criteria"."strength" is null or "shopping_private"."decision_criteria"."strength" in ('hard', 'strong_preference', 'preference')),
	CONSTRAINT "decision_criteria_target_allowed" CHECK ("shopping_private"."decision_criteria"."target_semantics" in ('exact', 'range', 'around', 'stretch', 'categorical', 'qualitative', 'comparative', 'indifferent')),
	CONSTRAINT "decision_criteria_value_version_positive" CHECK ("shopping_private"."decision_criteria"."value_schema_version" > 0),
	CONSTRAINT "decision_criteria_value_kind_allowed" CHECK ("shopping_private"."decision_criteria"."value_kind" in ('boolean', 'qualitative', 'measurement', 'measurement_range', 'money', 'money_stretch', 'categorical', 'indifferent')),
	CONSTRAINT "decision_criteria_value_object" CHECK (jsonb_typeof("shopping_private"."decision_criteria"."semantic_value") is not distinct from 'object'),
	CONSTRAINT "decision_criteria_value_discriminators_match" CHECK (("shopping_private"."decision_criteria"."semantic_value" ->> 'kind') is not distinct from "shopping_private"."decision_criteria"."value_kind" and coalesce("shopping_private"."decision_criteria"."semantic_value" ->> 'schemaVersion', '') ~ '^[1-9][0-9]*$' and ("shopping_private"."decision_criteria"."semantic_value" ->> 'schemaVersion')::integer = "shopping_private"."decision_criteria"."value_schema_version"),
	CONSTRAINT "decision_criteria_indifference_shape" CHECK (("shopping_private"."decision_criteria"."value_kind" = 'indifferent' and "shopping_private"."decision_criteria"."target_semantics" = 'indifferent' and "shopping_private"."decision_criteria"."strength" is null) or ("shopping_private"."decision_criteria"."value_kind" <> 'indifferent' and "shopping_private"."decision_criteria"."target_semantics" <> 'indifferent' and "shopping_private"."decision_criteria"."strength" is not null)),
	CONSTRAINT "decision_criteria_lifecycle_allowed" CHECK ("shopping_private"."decision_criteria"."lifecycle" in ('active', 'superseded', 'removed')),
	CONSTRAINT "decision_criteria_lifecycle_shape" CHECK (("shopping_private"."decision_criteria"."lifecycle" = 'active' and "shopping_private"."decision_criteria"."ended_revision" is null and "shopping_private"."decision_criteria"."superseded_by_id" is null) or ("shopping_private"."decision_criteria"."lifecycle" = 'superseded' and "shopping_private"."decision_criteria"."ended_revision" is not null and "shopping_private"."decision_criteria"."superseded_by_id" is not null and "shopping_private"."decision_criteria"."superseded_by_id" <> "shopping_private"."decision_criteria"."id") or ("shopping_private"."decision_criteria"."lifecycle" = 'removed' and "shopping_private"."decision_criteria"."ended_revision" is not null and "shopping_private"."decision_criteria"."superseded_by_id" is null)),
	CONSTRAINT "decision_criteria_revision_shape" CHECK ("shopping_private"."decision_criteria"."created_revision" >= 0 and ("shopping_private"."decision_criteria"."ended_revision" is null or "shopping_private"."decision_criteria"."ended_revision" >= "shopping_private"."decision_criteria"."created_revision")),
	CONSTRAINT "decision_criteria_timestamp_order" CHECK ("shopping_private"."decision_criteria"."updated_at" >= "shopping_private"."decision_criteria"."created_at")
);
--> statement-breakpoint
CREATE TABLE "shopping_private"."shopping_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"current_revision" bigint DEFAULT 0 NOT NULL,
	"market_country" text NOT NULL,
	"language_tag" text NOT NULL,
	"currency_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopping_tasks_revision_nonnegative" CHECK ("shopping_private"."shopping_tasks"."current_revision" >= 0),
	CONSTRAINT "shopping_tasks_market_country_shape" CHECK ("shopping_private"."shopping_tasks"."market_country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "shopping_tasks_language_tag_shape" CHECK ("shopping_private"."shopping_tasks"."language_tag" ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
	CONSTRAINT "shopping_tasks_currency_code_shape" CHECK ("shopping_private"."shopping_tasks"."currency_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "shopping_tasks_timestamp_order" CHECK ("shopping_private"."shopping_tasks"."updated_at" >= "shopping_private"."shopping_tasks"."created_at")
);
--> statement-breakpoint
CREATE TABLE "shopping_private"."task_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"client_action_id" text NOT NULL,
	"input_kind" text NOT NULL,
	"input_schema_version" integer NOT NULL,
	"input_payload" jsonb NOT NULL,
	"fingerprint_version" integer NOT NULL,
	"request_fingerprint" text NOT NULL,
	"expected_revision" bigint NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_inputs_task_id_id_unique" UNIQUE("task_id","id"),
	CONSTRAINT "task_inputs_task_client_action_unique" UNIQUE("task_id","client_action_id"),
	CONSTRAINT "task_inputs_client_action_shape" CHECK (char_length("shopping_private"."task_inputs"."client_action_id") between 1 and 160 and "shopping_private"."task_inputs"."client_action_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'),
	CONSTRAINT "task_inputs_kind_allowed" CHECK ("shopping_private"."task_inputs"."input_kind" in ('message', 'question_answer', 'direct_brief_action')),
	CONSTRAINT "task_inputs_schema_version_positive" CHECK ("shopping_private"."task_inputs"."input_schema_version" > 0),
	CONSTRAINT "task_inputs_payload_object" CHECK (jsonb_typeof("shopping_private"."task_inputs"."input_payload") is not distinct from 'object'),
	CONSTRAINT "task_inputs_payload_discriminators_match" CHECK (("shopping_private"."task_inputs"."input_payload" ->> 'kind') is not distinct from "shopping_private"."task_inputs"."input_kind" and coalesce("shopping_private"."task_inputs"."input_payload" ->> 'schemaVersion', '') ~ '^[1-9][0-9]*$' and ("shopping_private"."task_inputs"."input_payload" ->> 'schemaVersion')::integer = "shopping_private"."task_inputs"."input_schema_version"),
	CONSTRAINT "task_inputs_fingerprint_version_positive" CHECK ("shopping_private"."task_inputs"."fingerprint_version" > 0),
	CONSTRAINT "task_inputs_fingerprint_shape" CHECK ("shopping_private"."task_inputs"."request_fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "task_inputs_expected_revision_nonnegative" CHECK ("shopping_private"."task_inputs"."expected_revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shopping_private"."user_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"task_input_id" uuid NOT NULL,
	"body" text NOT NULL,
	"received_at_revision" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_messages_task_id_id_unique" UNIQUE("task_id","id"),
	CONSTRAINT "user_messages_task_input_unique" UNIQUE("task_id","task_input_id"),
	CONSTRAINT "user_messages_exact_source_unique" UNIQUE("task_id","task_input_id","id"),
	CONSTRAINT "user_messages_body_shape" CHECK (char_length("shopping_private"."user_messages"."body") between 1 and 10000 and "shopping_private"."user_messages"."body" ~ '[^[:space:]]'),
	CONSTRAINT "user_messages_revision_nonnegative" CHECK ("shopping_private"."user_messages"."received_at_revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "shopping_private"."concept_definitions" ADD CONSTRAINT "concept_definitions_task_fk" FOREIGN KEY ("task_id") REFERENCES "shopping_private"."shopping_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."criterion_sources" ADD CONSTRAINT "criterion_sources_task_fk" FOREIGN KEY ("task_id") REFERENCES "shopping_private"."shopping_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."criterion_sources" ADD CONSTRAINT "criterion_sources_criterion_fk" FOREIGN KEY ("task_id","criterion_id") REFERENCES "shopping_private"."decision_criteria"("task_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."criterion_sources" ADD CONSTRAINT "criterion_sources_input_fk" FOREIGN KEY ("task_id","task_input_id") REFERENCES "shopping_private"."task_inputs"("task_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."criterion_sources" ADD CONSTRAINT "criterion_sources_exact_message_fk" FOREIGN KEY ("task_id","task_input_id","message_id") REFERENCES "shopping_private"."user_messages"("task_id","task_input_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."decision_criteria" ADD CONSTRAINT "decision_criteria_task_fk" FOREIGN KEY ("task_id") REFERENCES "shopping_private"."shopping_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."decision_criteria" ADD CONSTRAINT "decision_criteria_concept_fk" FOREIGN KEY ("task_id","concept_id") REFERENCES "shopping_private"."concept_definitions"("task_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."task_inputs" ADD CONSTRAINT "task_inputs_task_fk" FOREIGN KEY ("task_id") REFERENCES "shopping_private"."shopping_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."user_messages" ADD CONSTRAINT "user_messages_task_fk" FOREIGN KEY ("task_id") REFERENCES "shopping_private"."shopping_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."user_messages" ADD CONSTRAINT "user_messages_input_fk" FOREIGN KEY ("task_id","task_input_id") REFERENCES "shopping_private"."task_inputs"("task_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "decision_criteria_one_active_lineage" ON "shopping_private"."decision_criteria" USING btree ("task_id","lineage_id") WHERE "shopping_private"."decision_criteria"."lifecycle" = 'active';