import { z } from "zod";
import {
  formatBriefItem,
  projectShoppingBrief,
} from "@/domain/shopping-state/brief";
import type { HistoricalShoppingState } from "@/domain/shopping-state/shopping-state";
import { buildDecisionSupport, type CurrentDecision } from "./decision-support";
import type { CurrentDecisionSupport } from "./persistence";

const decisionState = z.enum([
  "researching",
  "leader_needs_verification",
  "leader_with_tradeoff",
  "ready_to_choose",
  "no_clear_winner",
  "insufficient_evidence",
  "no_eligible_option",
]);
const summarySchema = z.object({
  state: decisionState,
  leaderId: z.uuid().nullable(),
  leaderTitle: z.string().nullable(),
});
export const decisionTransitionSchema = z.strictObject({
  previousRevision: z.string().regex(/^\d+$/),
  currentRevision: z.string().regex(/^\d+$/),
  changes: z
    .array(
      z.strictObject({
        conceptId: z.uuid(),
        criterionId: z.uuid().nullable(),
        label: z.string(),
        kind: z.enum([
          "added",
          "removed",
          "strength_changed",
          "target_changed",
          "marked_indifferent",
          "indifference_ended",
        ]),
        before: z.string().nullable(),
        after: z.string().nullable(),
      }),
    )
    .max(50),
  unchangedCriteria: z.boolean(),
  previous: summarySchema.nullable(),
  current: summarySchema,
  movement: z.enum([
    "reassessing",
    "tie_broken",
    "leader_changed",
    "needs_verification",
    "ready",
    "tie",
    "no_recommendation",
    "rationale_changed",
    "unchanged",
    "no_history",
  ]),
  cause: z.enum([
    "brief_refinement",
    "candidate_rejection",
    "updated_evidence",
    "undetermined",
  ]),
  headline: z.string(),
  explanation: z.string(),
  causalCriterionIds: z.array(z.uuid()).max(3),
  evidence: z.enum(["reused", "new", "mixed", "unknown", "pending"]),
  evidenceExplanation: z.string(),
  candidateContinuity: z.enum(["same_listings", "changed_listings", "unknown"]),
  unresolved: z.string().nullable(),
});
export type DecisionTransition = z.infer<typeof decisionTransitionSchema>;

const strengths = {
  hard: "Must-have",
  strong_preference: "Strong preference",
  preference: "Preference",
} as const;
function semanticKey(
  value: ReturnType<
    typeof projectShoppingBrief
  >["items"][number]["semanticValue"],
) {
  return JSON.stringify(
    value.kind === "categorical"
      ? { ...value, values: [...value.values].sort() }
      : value,
  );
}
export function briefChanges(
  before: HistoricalShoppingState,
  after: HistoricalShoppingState,
): DecisionTransition["changes"] {
  if (before.task.id !== after.task.id || before.revision >= after.revision)
    throw new Error("Decision transition authority mismatch");
  const oldBrief = projectShoppingBrief(before);
  const newBrief = projectShoppingBrief(after);
  const result: DecisionTransition["changes"] = [];
  const oldIndifferent = new Set(
    before.effectiveCriteria
      .filter(({ criterion }) => criterion.semanticValue.kind === "indifferent")
      .map(({ criterion }) => criterion.conceptId),
  );
  const newIndifferent = new Set(
    after.effectiveCriteria
      .filter(({ criterion }) => criterion.semanticValue.kind === "indifferent")
      .map(({ criterion }) => criterion.conceptId),
  );
  const consumed = new Set<string>();
  for (const old of oldBrief.items) {
    const next = newBrief.items.find(
      (item) => item.lineageId === old.lineageId,
    );
    if (next) consumed.add(next.criterionId);
    if (!next) {
      result.push({
        conceptId: old.conceptId,
        criterionId: null,
        label: old.conceptLabel,
        kind: newIndifferent.has(old.conceptId)
          ? "marked_indifferent"
          : "removed",
        before: formatBriefItem(old, oldBrief.market),
        after: newIndifferent.has(old.conceptId) ? "No preference now" : null,
      });
      continue;
    }
    if (old.strength !== next.strength)
      result.push({
        conceptId: next.conceptId,
        criterionId: next.criterionId,
        label: next.conceptLabel,
        kind: "strength_changed",
        before: strengths[old.strength],
        after: strengths[next.strength],
      });
    if (
      old.targetSemantics !== next.targetSemantics ||
      semanticKey(old.semanticValue) !== semanticKey(next.semanticValue)
    ) {
      // A changed qualitative phrase accompanying a strength change is one shopper change.
      if (
        old.strength !== next.strength &&
        old.semanticValue.kind === "qualitative" &&
        next.semanticValue.kind === "qualitative"
      )
        continue;
      result.push({
        conceptId: next.conceptId,
        criterionId: next.criterionId,
        label: next.conceptLabel,
        kind: "target_changed",
        before: formatBriefItem(old, oldBrief.market),
        after: formatBriefItem(next, newBrief.market),
      });
    }
  }
  for (const next of newBrief.items) {
    if (consumed.has(next.criterionId)) continue;
    result.push({
      conceptId: next.conceptId,
      criterionId: next.criterionId,
      label: next.conceptLabel,
      kind: oldIndifferent.has(next.conceptId) ? "indifference_ended" : "added",
      before: oldIndifferent.has(next.conceptId) ? "No preference" : null,
      after: `${strengths[next.strength]} · ${formatBriefItem(next, newBrief.market).replace(/^Strong preference: |^Prefer /, "")}`,
    });
  }
  return result.slice(0, 50);
}

function summarize(decision: CurrentDecision, support: CurrentDecisionSupport) {
  return {
    state: decision.state,
    leaderId: decision.leadingCandidateListingId,
    leaderTitle:
      support.candidates.find(
        ({ id }) => id === decision.leadingCandidateListingId,
      )?.title ?? null,
  };
}

export function projectDecisionTransition(options: {
  before: HistoricalShoppingState;
  after: HistoricalShoppingState;
  previousSupport: CurrentDecisionSupport | null;
  currentSupport: CurrentDecisionSupport;
  previousRejected: ReadonlySet<string>;
  currentRejected: ReadonlySet<string>;
}): DecisionTransition | null {
  if (options.after.revision <= 1n) return null;
  if (
    options.currentSupport.brief.taskId !== options.after.task.id ||
    options.currentSupport.brief.revision !== options.after.revision ||
    (options.previousSupport &&
      (options.previousSupport.brief.taskId !== options.before.task.id ||
        options.previousSupport.brief.revision !== options.before.revision))
  )
    throw new Error("Decision transition support does not match authority");
  const changes = briefChanges(options.before, options.after);
  if (!changes.length) return null;
  const current = buildDecisionSupport({
    support: options.currentSupport,
    savedListingIds: new Set(),
    rejectedListingIds: options.currentRejected,
  }).currentDecision;
  const prior =
    options.previousSupport === null
      ? null
      : buildDecisionSupport({
          support: options.previousSupport,
          savedListingIds: new Set(),
          rejectedListingIds: options.previousRejected,
        }).currentDecision;
  const pending =
    options.currentSupport.assessments.length === 0 ||
    options.currentSupport.researchRuns.some(
      ({ status, phase }) => status === "running" && phase !== "deepening",
    );
  const oldIds = new Set(
    options.previousSupport?.candidates.map(({ id }) => id) ?? [],
  );
  const samePool =
    oldIds.size > 0 &&
    options.currentSupport.candidates.length === oldIds.size &&
    options.currentSupport.candidates.every(({ id }) => oldIds.has(id));
  const oldObservations = new Set(
    options.previousSupport?.observations.map(({ id }) => id) ?? [],
  );
  const oldSources = new Set(
    options.previousSupport?.sources.map(({ id }) => id) ?? [],
  );
  const usedObservations = new Set(
    options.currentSupport.assessments
      .filter(
        ({ taskRevision, taskId }) =>
          taskRevision === options.after.revision &&
          taskId === options.after.task.id,
      )
      .flatMap(({ observationIds }) => observationIds),
  );
  const reused = [...usedObservations].filter(
    (id) =>
      oldObservations.has(id) ||
      options.currentSupport.observations.some(
        (observation) =>
          observation.id === id && oldSources.has(observation.evidenceSourceId),
      ),
  );
  const evidence = pending
    ? "pending"
    : !usedObservations.size || !options.previousSupport
      ? "unknown"
      : reused.length === usedObservations.size
        ? "reused"
        : reused.length
          ? "mixed"
          : "new";
  const rejectionChanged =
    options.previousSupport !== null &&
    (options.currentRejected.size !== options.previousRejected.size ||
      [...options.currentRejected].some(
        (id) => !options.previousRejected.has(id),
      ));
  const cause = rejectionChanged
    ? "candidate_rejection"
    : evidence === "new" || evidence === "mixed"
      ? "updated_evidence"
      : evidence === "reused" && samePool
        ? "brief_refinement"
        : "undetermined";
  const changedIds = new Set(
    changes.flatMap(({ criterionId }) => (criterionId ? [criterionId] : [])),
  );
  const causal = current.keyReasons.filter(
    ({ criterionId, label }) =>
      changedIds.has(criterionId) &&
      (prior?.leadingCandidateListingId !== current.leadingCandidateListingId ||
        !prior.keyReasons.some((reason) => reason.label === label)) &&
      options.currentSupport.assessments.some(
        (assessment) =>
          assessment.taskRevision === options.after.revision &&
          assessment.criterionId === criterionId &&
          assessment.candidateListingId !== current.leadingCandidateListingId &&
          assessment.status !== "meets",
      ),
  );
  const blocking =
    current.blockingGap && changedIds.has(current.blockingGap.criterionId)
      ? current.blockingGap
      : null;
  const movement = pending
    ? "reassessing"
    : !prior
      ? "no_history"
      : current.state === "leader_needs_verification" &&
          prior.recommendationLevel === "ready"
        ? "needs_verification"
        : current.recommendationLevel === "ready" &&
            prior.state === "no_clear_winner"
          ? "tie_broken"
          : current.leadingCandidateListingId !== null &&
              prior.leadingCandidateListingId !== null &&
              current.leadingCandidateListingId !==
                prior.leadingCandidateListingId
            ? "leader_changed"
            : current.recommendationLevel === "ready" &&
                prior.recommendationLevel !== "ready"
              ? "ready"
              : current.state === "no_clear_winner" &&
                  prior.state !== "no_clear_winner"
                ? "tie"
                : current.leadingCandidateListingId === null &&
                    prior.leadingCandidateListingId !== null
                  ? "no_recommendation"
                  : current.leadingCandidateListingId !== null &&
                      (current.keyReasons
                        .map(({ label }) => label)
                        .join("|") !==
                        prior.keyReasons.map(({ label }) => label).join("|") ||
                        causal.length > 0)
                    ? "rationale_changed"
                    : "unchanged";
  const explanation = pending
    ? "Re-evaluating the products against your updated priorities. The earlier conclusion is no longer current."
    : rejectionChanged
      ? "Your priorities changed, and a listing was also rejected or restored. The current choice reflects both; the movement cannot be attributed to refinement alone."
      : !prior
        ? "Your current decision has been recalculated. There is no recorded basis for claiming an earlier recommendation."
        : cause === "brief_refinement" && blocking
          ? `${blocking.label} is now a must-have to verify before choosing.`
          : cause === "brief_refinement" && causal[0]
            ? `${causal[0].label} now separates the current choice from an alternative: ${causal[0].explanation}`
            : movement === "unchanged"
              ? "This change does not alter the current decision."
              : !samePool
                ? "The updated search produced a different set of listings. These are exact offers; no cross-listing product identity is assumed."
                : cause === "updated_evidence"
                  ? "Updated priorities and additional product evidence both inform this decision."
                  : "The current conclusion reflects your updated priorities. The available history does not establish a single cause for the movement.";
  return decisionTransitionSchema.parse({
    previousRevision: options.before.revision.toString(),
    currentRevision: options.after.revision.toString(),
    changes,
    unchangedCriteria: projectShoppingBrief(options.after).items.some(
      (item) => !changes.some(({ conceptId }) => conceptId === item.conceptId),
    ),
    previous:
      prior && options.previousSupport
        ? summarize(prior, options.previousSupport)
        : null,
    current: summarize(current, options.currentSupport),
    movement,
    cause,
    headline: pending
      ? "Re-evaluating your updated priorities"
      : movement === "rationale_changed"
        ? "Same choice, updated reasons"
        : movement === "tie_broken" && cause === "brief_refinement"
          ? "Your priorities broke the tie"
          : "Updated after your refinement",
    explanation,
    causalCriterionIds:
      cause === "brief_refinement"
        ? blocking
          ? [blocking.criterionId]
          : causal.map(({ criterionId }) => criterionId).slice(0, 3)
        : [],
    evidence,
    evidenceExplanation:
      evidence === "reused"
        ? "Existing product evidence was reused and re-evaluated against your updated priorities."
        : evidence === "mixed"
          ? "Previously collected evidence and newly collected evidence both support the updated assessment."
          : evidence === "new"
            ? "New product evidence supports the updated assessment."
            : evidence === "pending"
              ? "Existing product evidence can remain visible while the updated assessment is prepared."
              : "Evidence continuity has not been established for this change.",
    candidateContinuity:
      !options.previousSupport || pending
        ? "unknown"
        : samePool
          ? "same_listings"
          : "changed_listings",
    unresolved:
      current.blockingGap?.explanation ??
      current.whatCouldChangeDecision?.explanation ??
      null,
  });
}
