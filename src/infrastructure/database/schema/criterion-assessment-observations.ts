import { foreignKey, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { criterionAssessments } from "./criterion-assessments";
import { productObservations } from "./product-observations";
import { shoppingPrivate } from "./shopping-private";

export const criterionAssessmentObservations = shoppingPrivate.table(
  "criterion_assessment_observations",
  {
    taskId: uuid("task_id").notNull(),
    candidateRunId: uuid("candidate_run_id").notNull(),
    candidateListingId: uuid("candidate_listing_id").notNull(),
    assessmentId: uuid("assessment_id").notNull(),
    observationId: uuid("observation_id").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "criterion_assessment_observations_pk",
      columns: [table.taskId, table.assessmentId, table.observationId],
    }),
    foreignKey({
      name: "criterion_assessment_observations_assessment_fk",
      columns: [
        table.taskId,
        table.candidateRunId,
        table.candidateListingId,
        table.assessmentId,
      ],
      foreignColumns: [
        criterionAssessments.taskId,
        criterionAssessments.candidateRunId,
        criterionAssessments.candidateListingId,
        criterionAssessments.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "criterion_assessment_observations_observation_fk",
      columns: [
        table.taskId,
        table.candidateRunId,
        table.candidateListingId,
        table.observationId,
      ],
      foreignColumns: [
        productObservations.taskId,
        productObservations.candidateRunId,
        productObservations.candidateListingId,
        productObservations.id,
      ],
    }).onDelete("restrict"),
  ],
);
