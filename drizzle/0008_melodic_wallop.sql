CREATE TABLE "shopping_private"."shopping_task_subjects" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"task_input_id" uuid NOT NULL,
	"user_message_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shopping_private"."search_runs" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "shopping_private"."search_runs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shopping_private"."shopping_task_subjects" ADD CONSTRAINT "shopping_task_subjects_exact_message_fk" FOREIGN KEY ("task_id","task_input_id","user_message_id") REFERENCES "shopping_private"."user_messages"("task_id","task_input_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."search_runs" ADD CONSTRAINT "search_runs_task_context_action_unique" UNIQUE("task_id","context_action_id");--> statement-breakpoint
ALTER TABLE "shopping_private"."search_runs" ADD CONSTRAINT "search_runs_lease_shape" CHECK (("shopping_private"."search_runs"."lease_token" is null and "shopping_private"."search_runs"."lease_expires_at" is null) or ("shopping_private"."search_runs"."status" = 'running' and "shopping_private"."search_runs"."lease_token" is not null and "shopping_private"."search_runs"."lease_expires_at" is not null));--> statement-breakpoint
REVOKE ALL ON TABLE "shopping_private"."shopping_task_subjects" FROM PUBLIC;--> statement-breakpoint
DO $guard$
DECLARE
  client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE shopping_private.shopping_task_subjects FROM %I',
        client_role
      );
    END IF;
  END LOOP;
END
$guard$;
