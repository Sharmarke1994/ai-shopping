ALTER TABLE "shopping_private"."state_change_applications"
ADD CONSTRAINT "state_change_applications_undo_target_fk"
FOREIGN KEY ("task_id", "undoes_application_id")
REFERENCES "shopping_private"."state_change_applications" ("task_id", "id")
ON DELETE RESTRICT;
--> statement-breakpoint
REVOKE ALL ON TABLE "shopping_private"."state_change_applications" FROM PUBLIC;
--> statement-breakpoint
DO $guard$
DECLARE
  client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE shopping_private.state_change_applications FROM %I',
        client_role
      );
    END IF;
  END LOOP;
END
$guard$;
