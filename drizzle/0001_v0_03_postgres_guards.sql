ALTER TABLE "shopping_private"."decision_criteria"
ADD CONSTRAINT "decision_criteria_successor_fk"
FOREIGN KEY ("task_id", "lineage_id", "concept_id", "superseded_by_id")
REFERENCES "shopping_private"."decision_criteria"
  ("task_id", "lineage_id", "concept_id", "id")
ON DELETE RESTRICT
DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
REVOKE ALL ON SCHEMA "shopping_private" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA "shopping_private" FROM PUBLIC;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "shopping_private"
REVOKE ALL ON TABLES FROM PUBLIC;
--> statement-breakpoint
DO $guard$
DECLARE
  client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format(
        'REVOKE ALL ON SCHEMA shopping_private FROM %I',
        client_role
      );
      EXECUTE format(
        'REVOKE ALL ON ALL TABLES IN SCHEMA shopping_private FROM %I',
        client_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA shopping_private REVOKE ALL ON TABLES FROM %I',
        client_role
      );
    END IF;
  END LOOP;
END
$guard$;
