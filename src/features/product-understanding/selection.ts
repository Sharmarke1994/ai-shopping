import { createHash } from "node:crypto";
import type { ShoppingBriefV1 } from "@/domain/shopping-state/brief";
import type { PersistedSearchRun } from "@/features/retrieval-spike/persistence/contracts";
import { triageListingAgainstHardCriteria } from "@/features/live-shopping/hard-constraint-triage";
import type { CriterionAssessmentV1 } from "./contracts";

export const EVIDENCE_POLICY_VERSION = "evidence-progressive-v2";
export const MAX_RESEARCH_CANDIDATES = 4;
export const MAX_FIRST_PASS_SEARCHES_PER_CANDIDATE = 1;
export const MAX_DEEP_RESEARCH_CANDIDATES = 3;
export const MAX_DEEP_CRITERIA_PER_CANDIDATE = 2;

export type SelectedResearchCandidate = Readonly<{
  listing: PersistedSearchRun["listings"][number];
  foundAcrossQueryCount: number;
}>;

export type PlannedEvidenceSearch = Readonly<{
  planKey: string;
  purpose: "first_pass" | "decision_gap";
  query: string;
  criterionIds: readonly string[];
}>;

export type SelectedDeepResearchCandidate = Readonly<{
  listing: PersistedSearchRun["listings"][number];
  criterionIds: readonly string[];
  criterionLabels: readonly string[];
}>;

function normalized(value: string | null) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
}

function groupKey(listing: PersistedSearchRun["listings"][number]) {
  return JSON.stringify([
    normalized(listing.title),
    normalized(listing.merchant),
    listing.price?.amountMinor ?? null,
    listing.price?.currency ?? null,
  ]);
}

function hasStructuredSupport(listing: PersistedSearchRun["listings"][number]) {
  return Number(
    listing.price !== null ||
      listing.reviewEvidence !== null ||
      listing.merchantDestinationUrl !== null,
  );
}

/**
 * Selects exact task-local listings only. This is conservative presentation
 * grouping, not ProductIdentity and never writes shopper truth.
 */
export function selectResearchCandidates(options: {
  brief: ShoppingBriefV1;
  run: PersistedSearchRun;
  limit?: number;
}): readonly SelectedResearchCandidate[] {
  const limit = Math.min(
    MAX_RESEARCH_CANDIDATES,
    Math.max(1, options.limit ?? MAX_RESEARCH_CANDIDATES),
  );
  const grouped = new Map<
    string,
    {
      listing: PersistedSearchRun["listings"][number];
      queryIds: Set<string>;
    }
  >();

  for (const listing of options.run.listings) {
    if (
      triageListingAgainstHardCriteria({
        brief: options.brief,
        listing,
      }).hasDirectConflict
    ) {
      continue;
    }
    const key = groupKey(listing);
    const existing = grouped.get(key);
    if (existing === undefined) {
      grouped.set(key, { listing, queryIds: new Set([listing.queryId]) });
      continue;
    }
    existing.queryIds.add(listing.queryId);
    const existingSupport = hasStructuredSupport(existing.listing);
    const newSupport = hasStructuredSupport(listing);
    if (
      newSupport > existingSupport ||
      (newSupport === existingSupport &&
        listing.sourceRank < existing.listing.sourceRank)
    ) {
      existing.listing = listing;
    }
  }

  return [...grouped.values()]
    .sort(
      (left, right) =>
        hasStructuredSupport(right.listing) -
          hasStructuredSupport(left.listing) ||
        right.queryIds.size - left.queryIds.size ||
        left.listing.sourceRank - right.listing.sourceRank ||
        left.listing.id.localeCompare(right.listing.id),
    )
    .slice(0, limit)
    .map(({ listing, queryIds }) => ({
      listing,
      foundAcrossQueryCount: queryIds.size,
    }));
}

function criterionPriority(
  strength: ShoppingBriefV1["items"][number]["strength"],
) {
  return strength === "hard" ? 0 : strength === "strong_preference" ? 1 : 2;
}

function prioritizedCriteria(brief: ShoppingBriefV1) {
  return [...brief.items].sort(
    (left, right) =>
      criterionPriority(left.strength) - criterionPriority(right.strength) ||
      left.conceptLabel.localeCompare(right.conceptLabel),
  );
}

function boundedQuery(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

function planKey(purpose: string, query: string) {
  return `${purpose}:${createHash("sha256").update(query).digest("hex").slice(0, 20)}`;
}

export function planEvidenceSearches(options: {
  brief: ShoppingBriefV1;
  candidate: SelectedResearchCandidate;
}): readonly PlannedEvidenceSearch[] {
  const title = options.candidate.listing.title
    .replaceAll('"', "")
    .slice(0, 260);
  const criteria = prioritizedCriteria(options.brief).slice(0, 5);
  const criterionTerms = criteria
    .map(({ conceptLabel }) => conceptLabel)
    .join(" ");
  const query = boundedQuery(
    `"${title}" ${criterionTerms || "official specifications"} review`,
  );
  return [
    {
      planKey: planKey("first-pass", query),
      purpose: "first_pass" as const,
      query,
      criterionIds: criteria.map(({ criterionId }) => criterionId),
    },
  ].slice(0, MAX_FIRST_PASS_SEARCHES_PER_CANDIDATE);
}

export function selectDeepResearchCandidates(options: {
  brief: ShoppingBriefV1;
  run: PersistedSearchRun;
  orderedCandidateIds: readonly string[];
  assessments: readonly CriterionAssessmentV1[];
  savedCandidateListingIds: ReadonlySet<string>;
  rejectedCandidateListingIds?: ReadonlySet<string>;
  completedCriterionIdsByCandidate?: ReadonlyMap<string, ReadonlySet<string>>;
  targetCandidateListingId?: string;
  limit?: number;
}): readonly SelectedDeepResearchCandidate[] {
  const byId = new Map<string, PersistedSearchRun["listings"][number]>(
    options.run.listings.map((listing) => [listing.id, listing]),
  );
  const rejected = options.rejectedCandidateListingIds ?? new Set<string>();
  const candidateIds =
    options.targetCandidateListingId === undefined
      ? [
          ...options.run.listings
            .filter(({ id }) => options.savedCandidateListingIds.has(id))
            .map(({ id }) => id),
          ...options.orderedCandidateIds,
        ]
      : [options.targetCandidateListingId];
  const uniqueIds = [...new Set(candidateIds)];
  const assessmentByIdentity = new Map(
    options.assessments.map((assessment) => [
      `${assessment.candidateListingId}:${assessment.criterionId}`,
      assessment,
    ]),
  );
  const selected: SelectedDeepResearchCandidate[] = [];
  const limit = Math.min(
    MAX_DEEP_RESEARCH_CANDIDATES,
    Math.max(1, options.limit ?? 2),
  );
  for (const candidateId of uniqueIds) {
    if (selected.length >= limit || rejected.has(candidateId)) continue;
    const listing = byId.get(candidateId);
    if (listing === undefined) continue;
    const completedCriteria =
      options.completedCriterionIdsByCandidate?.get(candidateId) ??
      new Set<string>();
    const unresolved = prioritizedCriteria(options.brief)
      .filter((item) => {
        if (completedCriteria.has(item.criterionId)) return false;
        const assessment = assessmentByIdentity.get(
          `${candidateId}:${item.criterionId}`,
        );
        if (assessment?.relation.startsWith("target_distance_minor:")) {
          return false;
        }
        return (
          assessment === undefined ||
          assessment.status === "uncertain" ||
          assessment.status === "not_applicable"
        );
      })
      .slice(0, MAX_DEEP_CRITERIA_PER_CANDIDATE);
    if (unresolved.length === 0) continue;
    selected.push({
      listing,
      criterionIds: unresolved.map(({ criterionId }) => criterionId),
      criterionLabels: unresolved.map(({ conceptLabel }) => conceptLabel),
    });
  }
  return selected;
}

export function planDecisionGapSearch(options: {
  candidate: SelectedDeepResearchCandidate;
}): PlannedEvidenceSearch {
  const title = options.candidate.listing.title
    .replaceAll('"', "")
    .slice(0, 260);
  const query = boundedQuery(
    `"${title}" ${options.candidate.criterionLabels.join(" ")} official independent review`,
  );
  return {
    planKey: planKey("decision-gap", query),
    purpose: "decision_gap",
    query,
    criterionIds: options.candidate.criterionIds,
  };
}
