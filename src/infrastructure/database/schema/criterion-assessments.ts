import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { candidateListings } from "./candidate-listings";
import { decisionCriteria } from "./decision-criteria";
import { evidenceResearchRuns } from "./evidence-research-runs";
import { shoppingPrivate } from "./shopping-private";
import { shoppingTasks } from "./shopping-tasks";

export const criterionAssessments = shoppingPrivate.table(
  "criterion_assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull(),
    researchRunId: uuid("research_run_id").notNull(),
    taskRevision: bigint("task_revision", { mode: "bigint" }).notNull(),
    candidateRunId: uuid("candidate_run_id").notNull(),
    candidateListingId: uuid("candidate_listing_id").notNull(),
    criterionId: uuid("criterion_id").notNull(),
    status: text("status").notNull(),
    relation: text("relation").notNull(),
    explanation: text("explanation").notNull(),
    method: text("method").notNull(),
    model: text("model"),
    promptVersion: text("prompt_version"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("criterion_assessments_task_id_id_unique").on(
      table.taskId,
      table.id,
    ),
    unique("criterion_assessments_identity_unique").on(
      table.taskId,
      table.taskRevision,
      table.candidateRunId,
      table.candidateListingId,
      table.criterionId,
    ),
    unique("criterion_assessments_candidate_id_unique").on(
      table.taskId,
      table.researchRunId,
      table.candidateRunId,
      table.candidateListingId,
      table.id,
    ),
    unique("criterion_assessments_reusable_candidate_id_unique").on(
      table.taskId,
      table.candidateRunId,
      table.candidateListingId,
      table.id,
    ),
    foreignKey({
      name: "criterion_assessments_task_fk",
      columns: [table.taskId],
      foreignColumns: [shoppingTasks.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "criterion_assessments_research_run_fk",
      columns: [
        table.taskId,
        table.researchRunId,
        table.candidateRunId,
        table.taskRevision,
      ],
      foreignColumns: [
        evidenceResearchRuns.taskId,
        evidenceResearchRuns.id,
        evidenceResearchRuns.searchRunId,
        evidenceResearchRuns.taskRevision,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "criterion_assessments_candidate_fk",
      columns: [table.taskId, table.candidateRunId, table.candidateListingId],
      foreignColumns: [
        candidateListings.taskId,
        candidateListings.runId,
        candidateListings.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "criterion_assessments_criterion_fk",
      columns: [table.taskId, table.criterionId],
      foreignColumns: [decisionCriteria.taskId, decisionCriteria.id],
    }).onDelete("restrict"),
    check(
      "criterion_assessments_revision_nonnegative",
      sql`${table.taskRevision} >= 0`,
    ),
    check(
      "criterion_assessments_status_allowed",
      sql`${table.status} in ('meets', 'conflicts', 'uncertain', 'not_applicable')`,
    ),
    check(
      "criterion_assessments_method_allowed",
      sql`${table.method} in ('deterministic', 'model', 'guarded_model')`,
    ),
    check(
      "criterion_assessments_method_shape",
      sql`(${table.method} = 'deterministic' and ${table.model} is null and ${table.promptVersion} is null) or (${table.method} in ('model', 'guarded_model') and ${table.model} is not null and ${table.promptVersion} is not null)`,
    ),
    check(
      "criterion_assessments_text_bounds",
      sql`char_length(btrim(${table.relation})) between 1 and 120 and char_length(btrim(${table.explanation})) between 1 and 500 and (${table.model} is null or char_length(btrim(${table.model})) between 1 and 160) and (${table.promptVersion} is null or char_length(btrim(${table.promptVersion})) between 1 and 120)`,
    ),
  ],
);
