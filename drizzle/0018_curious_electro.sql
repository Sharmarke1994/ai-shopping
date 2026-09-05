CREATE TABLE "shopping_private"."decision_refinement_bases" (
	"source_task_input_id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"task_revision" bigint NOT NULL,
	"assessment_ids" uuid[] NOT NULL,
	"source_ids" uuid[] NOT NULL,
	"rejected_listing_ids" uuid[] NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_refinement_bases_sources" CHECK (cardinality("shopping_private"."decision_refinement_bases"."source_ids") <= 10000 and array_position("shopping_private"."decision_refinement_bases"."source_ids", null) is null),
	CONSTRAINT "decision_refinement_bases_revision" CHECK ("shopping_private"."decision_refinement_bases"."task_revision" >= 1),
	CONSTRAINT "decision_refinement_bases_arrays" CHECK (cardinality("shopping_private"."decision_refinement_bases"."assessment_ids") between 1 and 10000 and array_position("shopping_private"."decision_refinement_bases"."assessment_ids", null) is null and cardinality("shopping_private"."decision_refinement_bases"."rejected_listing_ids") <= 10000 and array_position("shopping_private"."decision_refinement_bases"."rejected_listing_ids", null) is null)
);
--> statement-breakpoint
ALTER TABLE "shopping_private"."decision_refinement_bases" ADD CONSTRAINT "decision_refinement_bases_input_fk" FOREIGN KEY ("task_id","source_task_input_id") REFERENCES "shopping_private"."task_inputs"("task_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION shopping_private.validate_decision_refinement_basis() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Decision refinement bases are immutable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM shopping_private.task_inputs WHERE id = NEW.source_task_input_id AND task_id = NEW.task_id AND expected_revision = NEW.task_revision)
    OR (SELECT count(*) FROM shopping_private.criterion_assessments WHERE id = ANY(NEW.assessment_ids) AND task_id = NEW.task_id AND task_revision = NEW.task_revision AND created_at <= NEW.captured_at) <> cardinality(NEW.assessment_ids)
    OR (SELECT count(*) FROM shopping_private.evidence_sources WHERE id = ANY(NEW.source_ids) AND task_id = NEW.task_id) <> cardinality(NEW.source_ids)
    OR (SELECT count(*) FROM shopping_private.candidate_listings WHERE id = ANY(NEW.rejected_listing_ids) AND task_id = NEW.task_id) <> cardinality(NEW.rejected_listing_ids)
  THEN RAISE EXCEPTION 'Decision refinement basis references invalid authority'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER decision_refinement_basis_guard BEFORE INSERT OR UPDATE ON shopping_private.decision_refinement_bases FOR EACH ROW EXECUTE FUNCTION shopping_private.validate_decision_refinement_basis();
