import { foreignKey, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { decisionCriteria } from "./decision-criteria";
import { evidenceAcquisitionAttempts } from "./evidence-acquisition-attempts";
import { shoppingPrivate } from "./shopping-private";

export const evidenceAttemptTargetCriteria = shoppingPrivate.table(
  "evidence_attempt_target_criteria",
  {
    taskId: uuid("task_id").notNull(),
    researchRunId: uuid("research_run_id").notNull(),
    candidateRunId: uuid("candidate_run_id").notNull(),
    candidateListingId: uuid("candidate_listing_id").notNull(),
    attemptId: uuid("attempt_id").notNull(),
    criterionId: uuid("criterion_id").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "evidence_attempt_target_criteria_pk",
      columns: [table.taskId, table.attemptId, table.criterionId],
    }),
    foreignKey({
      name: "evidence_attempt_target_criteria_attempt_fk",
      columns: [
        table.taskId,
        table.researchRunId,
        table.candidateRunId,
        table.candidateListingId,
        table.attemptId,
      ],
      foreignColumns: [
        evidenceAcquisitionAttempts.taskId,
        evidenceAcquisitionAttempts.researchRunId,
        evidenceAcquisitionAttempts.candidateRunId,
        evidenceAcquisitionAttempts.candidateListingId,
        evidenceAcquisitionAttempts.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "evidence_attempt_target_criteria_criterion_fk",
      columns: [table.taskId, table.criterionId],
      foreignColumns: [decisionCriteria.taskId, decisionCriteria.id],
    }).onDelete("restrict"),
  ],
);
