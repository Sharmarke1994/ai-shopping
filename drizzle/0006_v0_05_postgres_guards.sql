ALTER TABLE "shopping_private"."context_acquisition_attempts"
ADD CONSTRAINT "context_acquisition_attempts_terminal_shape"
CHECK (
  (
    "status" = 'completed'
    AND "error_code" IS NULL
    AND (
      (
        "stage" = 'interpretation'
        AND "interpretation_proposal" IS NOT NULL
        AND "state_change_application_id" IS NOT NULL
        AND "context_action_proposal" IS NULL
        AND "context_action_id" IS NULL
      )
      OR
      (
        "stage" = 'context_action'
        AND "context_action_proposal" IS NOT NULL
        AND "context_action_id" IS NOT NULL
        AND "interpretation_proposal" IS NULL
        AND "state_change_application_id" IS NULL
      )
    )
  )
  OR
  (
    "status" <> 'completed'
    AND "error_code" IS NOT NULL
  )
);
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA "shopping_private" FROM PUBLIC;
--> statement-breakpoint
DO $guard$
DECLARE
  client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format(
        'REVOKE ALL ON ALL TABLES IN SCHEMA shopping_private FROM %I',
        client_role
      );
    END IF;
  END LOOP;
END
$guard$;
