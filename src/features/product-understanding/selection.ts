import { createHash } from "node:crypto";
import type { ShoppingBriefV1 } from "@/domain/shopping-state/brief";
import type { PersistedSearchRun } from "@/features/retrieval-spike/persistence/contracts";
import { triageListingAgainstHardCriteria } from "@/features/live-shopping/hard-constraint-triage";

export const EVIDENCE_POLICY_VERSION = "evidence-selective-v1";
export const MAX_RESEARCH_CANDIDATES = 6;
export const MAX_SEARCHES_PER_CANDIDATE = 2;

export type SelectedResearchCandidate = Readonly<{
  listing: PersistedSearchRun["listings"][number];
  foundAcrossQueryCount: number;
}>;

export type PlannedEvidenceSearch = Readonly<{
  planKey: string;
  purpose: "specifications" | "experience";
  query: string;
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

function criterionVocabulary(brief: ShoppingBriefV1) {
  const labels = brief.items
    .map((item) => item.conceptLabel.trim())
    .filter(Boolean);
  const specifications = labels.filter((label) =>
    /battery|wireless|connect|dimension|width|depth|height|material|mesh|fabric|weight|size|lumbar/i.test(
      label,
    ),
  );
  const experience = labels.filter((label) =>
    /review|comfort|ergonom|shape|profile|reputation|quality|support|long session|long work/i.test(
      label,
    ),
  );
  return {
    specifications: specifications.slice(0, 4),
    experience: experience.slice(0, 4),
  };
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
  const vocabulary = criterionVocabulary(options.brief);
  const specificationTerms =
    vocabulary.specifications.length === 0
      ? "official specifications"
      : vocabulary.specifications.join(" ");
  const experienceTerms =
    vocabulary.experience.length === 0
      ? "independent review"
      : vocabulary.experience.join(" ");
  const specificationQuery = boundedQuery(`"${title}" ${specificationTerms}`);
  const experienceQuery = boundedQuery(`"${title}" ${experienceTerms} review`);
  return [
    {
      planKey: planKey("specifications", specificationQuery),
      purpose: "specifications" as const,
      query: specificationQuery,
    },
    {
      planKey: planKey("experience", experienceQuery),
      purpose: "experience" as const,
      query: experienceQuery,
    },
  ].slice(0, MAX_SEARCHES_PER_CANDIDATE);
}
