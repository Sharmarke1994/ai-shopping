CREATE TABLE "shopping_private"."state_change_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"source_task_input_id" uuid NOT NULL,
	"application_kind" text NOT NULL,
	"request_schema_version" integer NOT NULL,
	"fingerprint_version" integer NOT NULL,
	"request_fingerprint" text NOT NULL,
	"base_revision" bigint NOT NULL,
	"resulting_revision" bigint NOT NULL,
	"outcome" text NOT NULL,
	"delta_schema_version" integer NOT NULL,
	"applied_delta" jsonb NOT NULL,
	"undoes_application_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "state_change_applications_task_id_id_unique" UNIQUE("task_id","id"),
	CONSTRAINT "state_change_applications_task_source_unique" UNIQUE("task_id","source_task_input_id"),
	CONSTRAINT "state_change_applications_kind_allowed" CHECK ("shopping_private"."state_change_applications"."application_kind" in ('patch', 'undo')),
	CONSTRAINT "state_change_applications_outcome_allowed" CHECK ("shopping_private"."state_change_applications"."outcome" in ('applied', 'no_change')),
	CONSTRAINT "state_change_applications_versions_positive" CHECK ("shopping_private"."state_change_applications"."request_schema_version" > 0 and "shopping_private"."state_change_applications"."fingerprint_version" > 0 and "shopping_private"."state_change_applications"."delta_schema_version" > 0),
	CONSTRAINT "state_change_applications_fingerprint_shape" CHECK ("shopping_private"."state_change_applications"."request_fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "state_change_applications_revision_shape" CHECK ("shopping_private"."state_change_applications"."base_revision" >= 0 and (("shopping_private"."state_change_applications"."outcome" = 'no_change' and "shopping_private"."state_change_applications"."resulting_revision" = "shopping_private"."state_change_applications"."base_revision") or ("shopping_private"."state_change_applications"."outcome" = 'applied' and "shopping_private"."state_change_applications"."resulting_revision" = "shopping_private"."state_change_applications"."base_revision" + 1))),
	CONSTRAINT "state_change_applications_undo_shape" CHECK (("shopping_private"."state_change_applications"."application_kind" = 'patch' and "shopping_private"."state_change_applications"."undoes_application_id" is null) or ("shopping_private"."state_change_applications"."application_kind" = 'undo' and "shopping_private"."state_change_applications"."undoes_application_id" is not null and "shopping_private"."state_change_applications"."outcome" = 'applied')),
	CONSTRAINT "state_change_applications_delta_object" CHECK (jsonb_typeof("shopping_private"."state_change_applications"."applied_delta") is not distinct from 'object'),
	CONSTRAINT "state_change_applications_delta_shape" CHECK (coalesce("shopping_private"."state_change_applications"."applied_delta" ->> 'schemaVersion', '') ~ '^[1-9][0-9]*$' and ("shopping_private"."state_change_applications"."applied_delta" ->> 'schemaVersion')::integer = "shopping_private"."state_change_applications"."delta_schema_version" and jsonb_typeof("shopping_private"."state_change_applications"."applied_delta" -> 'entries') is not distinct from 'array'),
	CONSTRAINT "state_change_applications_delta_outcome" CHECK (("shopping_private"."state_change_applications"."outcome" = 'no_change' and jsonb_array_length("shopping_private"."state_change_applications"."applied_delta" -> 'entries') = 0) or ("shopping_private"."state_change_applications"."outcome" = 'applied' and jsonb_array_length("shopping_private"."state_change_applications"."applied_delta" -> 'entries') > 0))
);
--> statement-breakpoint
ALTER TABLE "shopping_private"."state_change_applications" ADD CONSTRAINT "state_change_applications_task_fk" FOREIGN KEY ("task_id") REFERENCES "shopping_private"."shopping_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."state_change_applications" ADD CONSTRAINT "state_change_applications_source_input_fk" FOREIGN KEY ("task_id","source_task_input_id") REFERENCES "shopping_private"."task_inputs"("task_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "state_change_applications_one_undo_per_target" ON "shopping_private"."state_change_applications" USING btree ("task_id","undoes_application_id") WHERE "shopping_private"."state_change_applications"."undoes_application_id" is not null;