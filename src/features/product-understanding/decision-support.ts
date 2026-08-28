import type { BriefItemV1 } from "@/domain/shopping-state/brief";
import type { PersistedCandidateListing } from "@/features/retrieval-spike/persistence/contracts";
import { orderCandidatesByAssessments } from "./assessment-policy";
import type {
  CriterionAssessmentV1,
  EvidenceSourceV1,
  ProductObservationV1,
} from "./contracts";
import type { CurrentDecisionSupport } from "./persistence";

export type DecisionSupportCandidate = Readonly<{
  listing: PersistedCandidateListing;
  strongestSupported: boolean;
  whyItFits: readonly string[];
  watchouts: readonly string[];
  unknowns: readonly string[];
  evidenceSources: readonly Readonly<{
    title: string;
    url: string;
    role: EvidenceSourceV1["sourceRole"];
  }>[];
}>;

export type SavedComparison = Readonly<{
  candidates: readonly PersistedCandidateListing[];
  rows: readonly Readonly<{
    criterionId: string;
    label: string;
    cells: readonly Readonly<{
      candidateListingId: string;
      status: CriterionAssessmentV1["status"];
      explanation: string;
      sources: readonly Readonly<{ title: string; url: string }>[];
    }>[];
  }>[];
  judgement: string;
}>;

function assessmentsForCandidate(
  assessments: readonly CriterionAssessmentV1[],
  candidateListingId: string,
) {
  return assessments.filter(
    (assessment) => assessment.candidateListingId === candidateListingId,
  );
}

function sourcesForAssessment(options: {
  assessment: CriterionAssessmentV1;
  observations: ReadonlyMap<string, ProductObservationV1>;
  sources: ReadonlyMap<string, EvidenceSourceV1>;
}) {
  const output = new Map<string, EvidenceSourceV1>();
  for (const observationId of options.assessment.observationIds) {
    const observation = options.observations.get(observationId);
    const source =
      observation === undefined
        ? undefined
        : options.sources.get(observation.evidenceSourceId);
    if (source !== undefined) output.set(source.id, source);
  }
  return [...output.values()];
}

function purchaseExclusion(
  items: readonly BriefItemV1[],
  assessments: readonly CriterionAssessmentV1[],
) {
  const itemById = new Map(items.map((item) => [item.criterionId, item]));
  return assessments.some((assessment) => {
    if (assessment.status !== "conflicts") return false;
    const item = itemById.get(assessment.criterionId);
    if (item === undefined) return false;
    if (item.strength === "hard") return true;
    if (
      item.semanticValue.kind === "money" &&
      item.semanticValue.mode === "ceiling" &&
      assessment.relation === "above_ceiling"
    ) {
      return true;
    }
    return (
      item.semanticValue.kind === "money_stretch" &&
      assessment.relation === "above_stretch_ceiling"
    );
  });
}

function conciseUnique(values: readonly string[], limit: number) {
  return [...new Set(values)].slice(0, limit);
}

function normalizedOfferPart(value: string | null) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
}

function groupExactOffers(candidates: readonly PersistedCandidateListing[]) {
  const groups = new Map<string, { directDestinations: Set<string> }>();
  for (const listing of candidates) {
    const title = normalizedOfferPart(listing.title);
    const merchant = normalizedOfferPart(listing.merchant);
    const price = listing.price;
    if (!title || !merchant || price === null) continue;
    const identity = JSON.stringify([
      title,
      merchant,
      price.amountMinor,
      price.currency,
    ]);
    const group = groups.get(identity) ?? { directDestinations: new Set() };
    if (listing.merchantDestinationUrl !== null) {
      group.directDestinations.add(
        normalizedOfferPart(listing.merchantDestinationUrl),
      );
    }
    groups.set(identity, group);
  }
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const price = candidate.price;
    const title = normalizedOfferPart(candidate.title);
    const merchant = normalizedOfferPart(candidate.merchant);
    if (!title || !merchant || price === null) return true;
    const identity = JSON.stringify([
      title,
      merchant,
      price.amountMinor,
      price.currency,
    ]);
    const group = groups.get(identity);
    if (group === undefined) return true;
    const destinationBoundary =
      group.directDestinations.size > 1
        ? candidate.merchantDestinationUrl === null
          ? "indirect"
          : normalizedOfferPart(candidate.merchantDestinationUrl)
        : "same-offer";
    const key = `${identity}|${destinationBoundary}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasConflict(assessments: readonly CriterionAssessmentV1[]) {
  return assessments.some(({ status }) => status === "conflicts");
}

function candidateDecision(options: {
  listing: PersistedCandidateListing;
  assessments: readonly CriterionAssessmentV1[];
  observationMap: ReadonlyMap<string, ProductObservationV1>;
  sourceMap: ReadonlyMap<string, EvidenceSourceV1>;
  strongestSupported: boolean;
}): DecisionSupportCandidate {
  const whyItFits = conciseUnique(
    options.assessments
      .filter(({ status }) => status === "meets")
      .map(({ explanation }) => explanation),
    4,
  );
  const watchouts = conciseUnique(
    options.assessments
      .filter(
        ({ status, relation }) =>
          status === "conflicts" || relation === "inside_conditional_stretch",
      )
      .map(({ explanation }) => explanation),
    3,
  );
  const unknowns = conciseUnique(
    options.assessments
      .filter(({ status }) => status === "uncertain")
      .map(({ explanation }) => explanation),
    3,
  );
  const sourceMap = new Map<string, EvidenceSourceV1>();
  for (const assessment of options.assessments) {
    for (const source of sourcesForAssessment({
      assessment,
      observations: options.observationMap,
      sources: options.sourceMap,
    })) {
      sourceMap.set(source.id, source);
    }
  }
  return {
    listing: options.listing,
    strongestSupported: options.strongestSupported,
    whyItFits,
    watchouts,
    unknowns,
    evidenceSources: [...sourceMap.values()].slice(0, 5).map((source) => ({
      title: source.sourceTitle,
      url: source.sourceUrl,
      role: source.sourceRole,
    })),
  };
}

function buildComparison(options: {
  support: CurrentDecisionSupport;
  savedListingIds: ReadonlySet<string>;
  ordered: readonly PersistedCandidateListing[];
  observationMap: ReadonlyMap<string, ProductObservationV1>;
  sourceMap: ReadonlyMap<string, EvidenceSourceV1>;
}): SavedComparison | null {
  const candidates = options.ordered
    .filter(({ id }) => options.savedListingIds.has(id))
    .slice(0, 4);
  if (candidates.length < 2) return null;
  const rows = options.support.brief.items.map((item) => ({
    criterionId: item.criterionId,
    label: item.conceptLabel,
    cells: candidates.map((candidate) => {
      const assessment = options.support.assessments.find(
        (entry) =>
          entry.candidateListingId === candidate.id &&
          entry.criterionId === item.criterionId,
      );
      if (assessment === undefined) {
        return {
          candidateListingId: candidate.id,
          status: "uncertain" as const,
          explanation:
            "This saved product has not yet been assessed for the current brief.",
          sources: [],
        };
      }
      return {
        candidateListingId: candidate.id,
        status: assessment.status,
        explanation: assessment.explanation,
        sources: sourcesForAssessment({
          assessment,
          observations: options.observationMap,
          sources: options.sourceMap,
        }).map((source) => ({
          title: source.sourceTitle,
          url: source.sourceUrl,
        })),
      };
    }),
  }));
  const [strongest] = candidates;
  const judgement = `${strongest!.title} currently leads the saved comparison on the deterministic ordering, with its strongest differences shown row by row. The evidence does not establish a decisive winner beyond those differences; review the watchouts and unknown rows before choosing.`;
  return { candidates, rows, judgement };
}

export function buildDecisionSupport(options: {
  support: CurrentDecisionSupport;
  savedListingIds: ReadonlySet<string>;
}) {
  const assessmentCandidateIds = new Set(
    options.support.assessments.map(
      ({ candidateListingId }) => candidateListingId,
    ),
  );
  const assessedCandidates = options.support.candidates.filter(({ id }) =>
    assessmentCandidateIds.has(id),
  );
  const ordered = orderCandidatesByAssessments({
    brief: options.support.brief,
    candidates: assessedCandidates,
    assessments: options.support.assessments,
  });
  const viable = groupExactOffers(ordered).filter(
    (listing) =>
      !purchaseExclusion(
        options.support.brief.items,
        assessmentsForCandidate(options.support.assessments, listing.id),
      ),
  );
  const conflictFree = viable.filter(
    (listing) =>
      !hasConflict(
        assessmentsForCandidate(options.support.assessments, listing.id),
      ),
  );
  // A preference conflict can still be a useful trade-off when the market is
  // sparse. Put every conflict-free option first; only then add the least-bad
  // trade-off needed to show a useful three-option shortlist. This prevents a
  // contradictory result from outranking cleaner evidence without pretending
  // that an ordinary preference is a hard exclusion.
  const recommendationPool =
    conflictFree.length >= 2
      ? [
          ...conflictFree,
          ...viable.filter((listing) => !conflictFree.includes(listing)),
        ]
      : viable;
  const recommendationLimit =
    conflictFree.length >= 2
      ? Math.min(5, Math.max(3, conflictFree.length))
      : 5;
  const observationMap = new Map(
    options.support.observations.map((entry) => [entry.id, entry]),
  );
  const sourceMap = new Map(
    options.support.sources.map((entry) => [entry.id, entry]),
  );
  const topOptions = recommendationPool
    .slice(0, recommendationLimit)
    .map((listing, index) =>
      candidateDecision({
        listing,
        assessments: assessmentsForCandidate(
          options.support.assessments,
          listing.id,
        ),
        observationMap,
        sourceMap,
        strongestSupported:
          index === 0 &&
          assessmentsForCandidate(options.support.assessments, listing.id).some(
            ({ status }) => status === "meets",
          ),
      }),
    );
  return {
    researchStatus:
      options.support.researchRuns.length === 0
        ? ("not_started" as const)
        : options.support.researchRuns.some(
              ({ status }) => status === "running",
            )
          ? ("researching" as const)
          : options.support.researchRuns.every(
                ({ status }) => status === "failed",
              )
            ? ("failed" as const)
            : options.support.researchRuns.some(
                  ({ status }) => status === "partial" || status === "failed",
                )
              ? ("partial" as const)
              : ("ready" as const),
    researchedCandidateCount: new Set(
      options.support.assessments.map(
        ({ candidateListingId }) => candidateListingId,
      ),
    ).size,
    topOptions,
    comparison: buildComparison({
      support: options.support,
      savedListingIds: options.savedListingIds,
      ordered,
      observationMap,
      sourceMap,
    }),
  };
}
