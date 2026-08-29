CREATE TABLE "shopping_private"."evidence_attempt_target_criteria" (
	"task_id" uuid NOT NULL,
	"research_run_id" uuid NOT NULL,
	"candidate_run_id" uuid NOT NULL,
	"candidate_listing_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"criterion_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_attempt_target_criteria_pk" PRIMARY KEY("task_id","attempt_id","criterion_id")
);
--> statement-breakpoint
CREATE TABLE "shopping_private"."rejected_candidate_listings" (
	"task_id" uuid NOT NULL,
	"candidate_listing_id" uuid NOT NULL,
	"rejected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rejected_candidate_listings_pk" PRIMARY KEY("task_id","candidate_listing_id")
);
--> statement-breakpoint
ALTER TABLE "shopping_private"."criterion_assessments" DROP CONSTRAINT "criterion_assessments_identity_unique";--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_acquisition_attempts" DROP CONSTRAINT "evidence_acquisition_attempts_purpose_allowed";--> statement-breakpoint
ALTER TABLE "shopping_private"."criterion_assessments" ADD COLUMN "generation" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "shopping_private"."criterion_assessments" ADD COLUMN "supersedes_assessment_id" uuid;--> statement-breakpoint
ALTER TABLE "shopping_private"."criterion_assessments" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_research_runs" ADD COLUMN "phase" text DEFAULT 'first_pass' NOT NULL;--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_attempt_target_criteria" ADD CONSTRAINT "evidence_attempt_target_criteria_attempt_fk" FOREIGN KEY ("task_id","research_run_id","candidate_run_id","candidate_listing_id","attempt_id") REFERENCES "shopping_private"."evidence_acquisition_attempts"("task_id","research_run_id","candidate_run_id","candidate_listing_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_attempt_target_criteria" ADD CONSTRAINT "evidence_attempt_target_criteria_criterion_fk" FOREIGN KEY ("task_id","criterion_id") REFERENCES "shopping_private"."decision_criteria"("task_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."rejected_candidate_listings" ADD CONSTRAINT "rejected_candidate_listings_candidate_fk" FOREIGN KEY ("task_id","candidate_listing_id") REFERENCES "shopping_private"."candidate_listings"("task_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "criterion_assessments_current_unique" ON "shopping_private"."criterion_assessments" USING btree ("task_id","task_revision","candidate_run_id","candidate_listing_id","criterion_id") WHERE "shopping_private"."criterion_assessments"."superseded_at" is null;--> statement-breakpoint
ALTER TABLE "shopping_private"."criterion_assessments" ADD CONSTRAINT "criterion_assessments_generation_unique" UNIQUE("task_id","task_revision","candidate_run_id","candidate_listing_id","criterion_id","generation");--> statement-breakpoint
ALTER TABLE "shopping_private"."criterion_assessments" ADD CONSTRAINT "criterion_assessments_lineage_id_unique" UNIQUE("task_id","task_revision","candidate_run_id","candidate_listing_id","criterion_id","id");--> statement-breakpoint
ALTER TABLE "shopping_private"."criterion_assessments" ADD CONSTRAINT "criterion_assessments_supersedes_fk" FOREIGN KEY ("task_id","task_revision","candidate_run_id","candidate_listing_id","criterion_id","supersedes_assessment_id") REFERENCES "shopping_private"."criterion_assessments"("task_id","task_revision","candidate_run_id","candidate_listing_id","criterion_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."criterion_assessments" ADD CONSTRAINT "criterion_assessments_generation_shape" CHECK (("shopping_private"."criterion_assessments"."generation" = 1 and "shopping_private"."criterion_assessments"."supersedes_assessment_id" is null) or ("shopping_private"."criterion_assessments"."generation" > 1 and "shopping_private"."criterion_assessments"."supersedes_assessment_id" is not null));--> statement-breakpoint
ALTER TABLE "shopping_private"."criterion_assessments" ADD CONSTRAINT "criterion_assessments_superseded_time_shape" CHECK ("shopping_private"."criterion_assessments"."superseded_at" is null or "shopping_private"."criterion_assessments"."superseded_at" >= "shopping_private"."criterion_assessments"."created_at");--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_acquisition_attempts" ADD CONSTRAINT "evidence_acquisition_attempts_purpose_allowed" CHECK ("shopping_private"."evidence_acquisition_attempts"."purpose" in ('specifications', 'experience', 'first_pass', 'decision_gap', 'combined', 'current_brief'));--> statement-breakpoint
ALTER TABLE "shopping_private"."evidence_research_runs" ADD CONSTRAINT "evidence_research_runs_phase_allowed" CHECK ("shopping_private"."evidence_research_runs"."phase" in ('first_pass', 'deepening', 'reassessment'));--> statement-breakpoint
REVOKE ALL ON TABLE "shopping_private"."evidence_attempt_target_criteria" FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON TABLE "shopping_private"."rejected_candidate_listings" FROM PUBLIC;--> statement-breakpoint
DO $guard$
DECLARE
  client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE shopping_private.evidence_attempt_target_criteria FROM %I',
        client_role
      );
      EXECUTE format(
        'REVOKE ALL ON TABLE shopping_private.rejected_candidate_listings FROM %I',
        client_role
      );
    END IF;
  END LOOP;
END
$guard$;
