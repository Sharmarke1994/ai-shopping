CREATE TABLE "shopping_private"."founder_live_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"initial_turn_id" uuid NOT NULL,
	"initial_request_fingerprint" text NOT NULL,
	"current_context_action_id" uuid,
	"pending_task_input_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "founder_live_sessions_task_unique" UNIQUE("task_id"),
	CONSTRAINT "founder_live_sessions_fingerprint_shape" CHECK ("shopping_private"."founder_live_sessions"."initial_request_fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "founder_live_sessions_timestamp_order" CHECK ("shopping_private"."founder_live_sessions"."updated_at" >= "shopping_private"."founder_live_sessions"."created_at")
);
--> statement-breakpoint
ALTER TABLE "shopping_private"."founder_live_sessions" ADD CONSTRAINT "founder_live_sessions_task_fk" FOREIGN KEY ("task_id") REFERENCES "shopping_private"."shopping_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."founder_live_sessions" ADD CONSTRAINT "founder_live_sessions_current_action_fk" FOREIGN KEY ("task_id","current_context_action_id") REFERENCES "shopping_private"."context_actions"("task_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."founder_live_sessions" ADD CONSTRAINT "founder_live_sessions_pending_input_fk" FOREIGN KEY ("task_id","pending_task_input_id") REFERENCES "shopping_private"."task_inputs"("task_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
REVOKE ALL ON TABLE "shopping_private"."founder_live_sessions" FROM PUBLIC;--> statement-breakpoint
DO $guard$
DECLARE
  client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE shopping_private.founder_live_sessions FROM %I',
        client_role
      );
    END IF;
  END LOOP;
END
$guard$;
