import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  decisionRefinementBases,
  stateChangeApplications,
  taskInputs,
} from "@/infrastructure/database/schema";
import type {
  ShoppingDatabase,
  ShoppingTransaction,
} from "@/infrastructure/database/clients";
import { loadShoppingStateAtRevision } from "@/features/shopping-state/persistence/state-loaders";
import {
  loadCurrentDecisionSupportInTransaction,
  type CurrentDecisionSupport,
} from "@/features/product-understanding/persistence";
import { projectDecisionTransition } from "@/features/product-understanding/decision-transition";
import { loadRejectedCandidateListingsInTransaction } from "./rejected-listings";

const basisSchema = z.object({
  taskRevision: z.bigint().positive(),
  assessmentIds: z.array(z.uuid()).min(1).max(10000),
  sourceIds: z.array(z.uuid()).max(10000),
  rejectedListingIds: z.array(z.uuid()).max(10000),
  capturedAt: z.date(),
});

export async function captureDecisionRefinementBasis(options: {
  db: ShoppingDatabase;
  taskId: string;
  sourceTaskInputId: string;
}) {
  await options.db.transaction(
    async (tx) => {
      const [input] = await tx
        .select()
        .from(taskInputs)
        .where(
          and(
            eq(taskInputs.taskId, options.taskId),
            eq(taskInputs.id, options.sourceTaskInputId),
          ),
        );
      if (!input) throw new Error("Refinement input is missing");
      const support = await loadCurrentDecisionSupportInTransaction({
        tx,
        taskId: options.taskId,
      });
      // An input replay after authority advances must never backfill invented history.
      if (
        support.brief.revision !== input.expectedRevision ||
        !support.assessments.length ||
        support.researchRuns.some(({ status }) => status === "running")
      )
        return;
      const rejected = await loadRejectedCandidateListingsInTransaction({
        tx,
        taskId: options.taskId,
      });
      await tx
        .insert(decisionRefinementBases)
        .values({
          taskId: options.taskId,
          sourceTaskInputId: options.sourceTaskInputId,
          taskRevision: support.brief.revision,
          assessmentIds: support.assessments.map(({ id }) => id),
          sourceIds: support.sources.map(({ id }) => id),
          rejectedListingIds: rejected.map(({ listing }) => listing.id),
        })
        .onConflictDoNothing();
    },
    { isolationLevel: "repeatable read" },
  );
}

export async function loadDecisionTransitionInTransaction(options: {
  tx: ShoppingTransaction;
  support: CurrentDecisionSupport;
  rejectedIds: ReadonlySet<string>;
}) {
  const revision = options.support.brief.revision;
  if (revision <= 1n) return null;
  const taskId = options.support.brief.taskId;
  const [application] = await options.tx
    .select()
    .from(stateChangeApplications)
    .where(
      and(
        eq(stateChangeApplications.taskId, taskId),
        eq(stateChangeApplications.resultingRevision, revision),
        eq(stateChangeApplications.outcome, "applied"),
      ),
    );
  if (!application) return null;
  const [before, after, rows] = await Promise.all([
    loadShoppingStateAtRevision(options.tx, taskId, application.baseRevision),
    loadShoppingStateAtRevision(options.tx, taskId, revision),
    options.tx
      .select()
      .from(decisionRefinementBases)
      .where(
        and(
          eq(decisionRefinementBases.taskId, taskId),
          eq(
            decisionRefinementBases.sourceTaskInputId,
            application.sourceTaskInputId,
          ),
        ),
      ),
  ]);
  const basis = rows[0] ? basisSchema.parse(rows[0]) : null;
  if (
    basis &&
    (basis.taskRevision !== application.baseRevision ||
      basis.capturedAt > application.createdAt)
  )
    throw new Error("Refinement basis does not precede its authority change");
  let previousSupport: CurrentDecisionSupport | null = null;
  if (basis) {
    const loaded = await loadCurrentDecisionSupportInTransaction({
      tx: options.tx,
      taskId,
      revision: basis.taskRevision,
      assessmentIds: basis.assessmentIds,
    });
    if (
      loaded.assessments.some(({ createdAt }) => createdAt > basis.capturedAt)
    )
      throw new Error("Refinement basis references future assessments");
    const ids = new Set(
      loaded.assessments.map(({ candidateListingId }) => candidateListingId),
    );
    previousSupport = {
      ...loaded,
      candidates: loaded.candidates.filter(({ id }) => ids.has(id)),
      sources: loaded.sources.filter(({ id }) => basis.sourceIds.includes(id)),
      observations: loaded.observations.filter(({ evidenceSourceId }) =>
        basis.sourceIds.includes(evidenceSourceId),
      ),
      // Capture requires terminal research. Later work must not rewrite that
      // historical conclusion; decision synthesis only distinguishes running
      // research from terminal evidence, and consumes the frozen assessments.
      researchRuns: [],
    };
  }
  return projectDecisionTransition({
    before,
    after,
    previousSupport,
    currentSupport: options.support,
    previousRejected: new Set(basis?.rejectedListingIds ?? []),
    currentRejected: options.rejectedIds,
  });
}
