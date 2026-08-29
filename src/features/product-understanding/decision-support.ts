import type { BriefItemV1 } from "@/domain/shopping-state/brief";
import type { PersistedCandidateListing } from "@/features/retrieval-spike/persistence/contracts";
import {
  isPurchasePriceCriterion,
  orderCandidatesByAssessments,
} from "./assessment-policy";
import type {
  CriterionAssessmentV1,
  EvidenceSourceV1,
  ProductObservationV1,
} from "./contracts";
import type { CurrentDecisionSupport } from "./persistence";

export type DecisionSupportCandidate = Readonly<{
  listing: PersistedCandidateListing;
  readiness: "qualified" | "needs_verification" | "trade_off" | "ineligible";
  researchState: "available" | "researching" | "complete" | "failed";
  strongestSupported: boolean;
  supportedMustHaveCount: number;
  mustHaveCount: number;
  unresolvedMustHaves: readonly Readonly<{
    criterionId: string;
    label: string;
    explanation: string;
  }>[];
  whyItFits: readonly string[];
  watchouts: readonly string[];
  unknowns: readonly Readonly<{
    criterionId: string;
    label: string;
    reason:
      | "not_checked"
      | "checked_no_answer"
      | "source_disagreement"
      | "check_failed"
      | "personal_fit";
    explanation: string;
  }>[];
  evidenceSources: readonly Readonly<{
    title: string;
    url: string;
    role: EvidenceSourceV1["sourceRole"];
    depth: EvidenceSourceV1["sourceKind"];
  }>[];
}>;

export type SavedComparison = Readonly<{
  candidates: readonly PersistedCandidateListing[];
  researchStates: readonly Readonly<{
    candidateListingId: string;
    state: DecisionSupportCandidate["researchState"];
  }>[];
  purchaseSummaries: readonly Readonly<{
    candidateListingId: string;
    priceRelationship: string;
  }>[];
  rows: readonly Readonly<{
    criterionId: string;
    label: string;
    strength: BriefItemV1["strength"];
    cells: readonly Readonly<{
      candidateListingId: string;
      status: CriterionAssessmentV1["status"];
      explanation: string;
      sources: readonly Readonly<{
        title: string;
        url: string;
        role: EvidenceSourceV1["sourceRole"];
        depth: EvidenceSourceV1["sourceKind"];
      }>[];
    }>[];
  }>[];
  judgement: string;
  decisionGaps: readonly DecisionGap[];
}>;

export type DecisionGap = Readonly<{
  criterionId: string;
  label: string;
  strength: BriefItemV1["strength"];
  candidateListingIds: readonly string[];
  candidateTitles: readonly string[];
  explanation: string;
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

function assessmentForCriterion(
  assessments: readonly CriterionAssessmentV1[],
  criterionId: string,
) {
  return assessments.find(
    (assessment) => assessment.criterionId === criterionId,
  );
}

function unresolvedMustHaves(options: {
  items: readonly BriefItemV1[];
  assessments: readonly CriterionAssessmentV1[];
}) {
  return options.items
    .filter(({ strength }) => strength === "hard")
    .flatMap((item) => {
      const assessment = assessmentForCriterion(
        options.assessments,
        item.criterionId,
      );
      if (
        assessment?.status === "meets" ||
        assessment?.status === "conflicts"
      ) {
        return [];
      }
      return [
        {
          criterionId: item.criterionId,
          label: item.conceptLabel,
          explanation:
            assessment?.explanation ??
            "This must-have has not yet been assessed for this product.",
        },
      ];
    });
}

function readinessForCandidate(options: {
  items: readonly BriefItemV1[];
  assessments: readonly CriterionAssessmentV1[];
}) {
  if (purchaseExclusion(options.items, options.assessments)) {
    return "ineligible" as const;
  }
  if (unresolvedMustHaves(options).length > 0) {
    return "needs_verification" as const;
  }
  if (
    options.assessments.some((assessment) => {
      if (assessment.status !== "conflicts") return false;
      return (
        options.items.find(
          ({ criterionId }) => criterionId === assessment.criterionId,
        )?.strength !== "hard"
      );
    })
  ) {
    return "trade_off" as const;
  }
  return "qualified" as const;
}

function unresolvedCriterionIds(options: {
  items: readonly BriefItemV1[];
  assessments: readonly CriterionAssessmentV1[];
}) {
  return options.items
    .filter((item) => {
      const assessment = assessmentForCriterion(
        options.assessments,
        item.criterionId,
      );
      return (
        assessment === undefined ||
        assessment.status === "uncertain" ||
        assessment.status === "not_applicable"
      );
    })
    .map(({ criterionId }) => criterionId);
}

function candidateResearchState(options: {
  candidateListingId: string;
  items: readonly BriefItemV1[];
  assessments: readonly CriterionAssessmentV1[];
  coverage: CurrentDecisionSupport["deepResearchCoverage"];
}) {
  const unresolved = new Set(
    unresolvedCriterionIds({
      items: options.items,
      assessments: options.assessments,
    }),
  );
  if (unresolved.size === 0) return "complete" as const;
  const relevant = options.coverage.filter(
    ({ candidateListingId }) =>
      candidateListingId === options.candidateListingId,
  );
  if (
    relevant.some(
      ({ runStatus, criterionIds }) =>
        runStatus === "running" &&
        criterionIds.some((criterionId) => unresolved.has(criterionId)),
    )
  ) {
    return "researching" as const;
  }
  const terminalCriterionIds = new Set(
    relevant
      .filter(({ runStatus }) => runStatus !== "running")
      .flatMap(({ criterionIds }) => criterionIds),
  );
  if (
    [...unresolved].some(
      (criterionId) => !terminalCriterionIds.has(criterionId),
    )
  ) {
    return "available" as const;
  }
  return relevant.some(
    ({ runStatus, status, criterionIds }) =>
      runStatus !== "running" &&
      status === "failed" &&
      criterionIds.some((criterionId) => unresolved.has(criterionId)),
  )
    ? ("failed" as const)
    : ("complete" as const);
}

function unknownReason(options: {
  item: BriefItemV1;
  assessment: CriterionAssessmentV1 | undefined;
  candidateListingId: string;
  coverage: CurrentDecisionSupport["deepResearchCoverage"];
  sources: ReadonlyMap<string, EvidenceSourceV1>;
}): DecisionSupportCandidate["unknowns"][number]["reason"] {
  if (options.assessment?.relation === "personal_fit_unresolved") {
    return "personal_fit";
  }
  if (options.assessment?.relation === "source_disagreement") {
    return "source_disagreement";
  }
  const relevant = options.coverage.filter(
    ({ candidateListingId, criterionIds }) =>
      candidateListingId === options.candidateListingId &&
      criterionIds.includes(options.item.criterionId),
  );
  if (
    relevant.some(
      ({ runStatus, status }) => runStatus !== "running" && status === "failed",
    )
  ) {
    return "check_failed";
  }
  if (
    relevant.some(
      ({ runStatus, status, checkedSourcesByCriterion }) =>
        runStatus !== "running" &&
        status === "succeeded" &&
        (checkedSourcesByCriterion
          .find(({ criterionId }) => criterionId === options.item.criterionId)
          ?.sourceIds.some((sourceId) => {
            const source = options.sources.get(sourceId);
            return (
              source?.candidateListingId === options.candidateListingId &&
              source.sourceKind === "fetched_page"
            );
          }) ??
          false),
    )
  ) {
    return "checked_no_answer";
  }
  return "not_checked";
}

function candidateDecision(options: {
  listing: PersistedCandidateListing;
  items: readonly BriefItemV1[];
  assessments: readonly CriterionAssessmentV1[];
  observationMap: ReadonlyMap<string, ProductObservationV1>;
  sourceMap: ReadonlyMap<string, EvidenceSourceV1>;
  strongestSupported: boolean;
  researchState: DecisionSupportCandidate["researchState"];
  coverage: CurrentDecisionSupport["deepResearchCoverage"];
}): DecisionSupportCandidate {
  const unresolved = unresolvedMustHaves({
    items: options.items,
    assessments: options.assessments,
  });
  const mustHaveCount = options.items.filter(
    ({ strength }) => strength === "hard",
  ).length;
  const supportedMustHaveCount = options.items.filter(
    (item) =>
      item.strength === "hard" &&
      assessmentForCriterion(options.assessments, item.criterionId)?.status ===
        "meets",
  ).length;
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
  const unknowns = options.items
    .filter((item) => {
      if (item.strength === "hard") return false;
      const assessment = assessmentForCriterion(
        options.assessments,
        item.criterionId,
      );
      return (
        assessment === undefined ||
        assessment.status === "uncertain" ||
        assessment.status === "not_applicable"
      );
    })
    .slice(0, 3)
    .map((item) => {
      const assessment = assessmentForCriterion(
        options.assessments,
        item.criterionId,
      );
      const reason = unknownReason({
        item,
        assessment,
        candidateListingId: options.listing.id,
        coverage: options.coverage,
        sources: options.sourceMap,
      });
      const fallback =
        reason === "check_failed"
          ? "The focused source check did not complete; existing evidence is preserved."
          : reason === "not_checked"
            ? "This has not been checked against an exact product page yet."
            : "The checked exact sources did not establish this criterion.";
      return {
        criterionId: item.criterionId,
        label: item.conceptLabel,
        reason,
        explanation: assessment?.explanation ?? fallback,
      };
    });
  const sourceMap = new Map<string, EvidenceSourceV1>();
  const checkedRepresentativeSourceIds: string[] = [];
  for (const assessment of options.assessments) {
    for (const source of sourcesForAssessment({
      assessment,
      observations: options.observationMap,
      sources: options.sourceMap,
    })) {
      sourceMap.set(source.id, source);
    }
  }
  for (const unknown of unknowns) {
    const criterionSources: EvidenceSourceV1[] = [];
    for (const coverage of options.coverage) {
      if (
        coverage.candidateListingId !== options.listing.id ||
        coverage.runStatus === "running"
      ) {
        continue;
      }
      const checked = coverage.checkedSourcesByCriterion.find(
        ({ criterionId }) => criterionId === unknown.criterionId,
      );
      for (const sourceId of checked?.sourceIds ?? []) {
        const source = options.sourceMap.get(sourceId);
        if (
          source?.candidateListingId === options.listing.id &&
          source.sourceKind === "fetched_page"
        ) {
          sourceMap.set(source.id, source);
          criterionSources.push(source);
        }
      }
    }
    if (unknown.reason === "checked_no_answer") {
      const [representative] = criterionSources.sort(
        (left, right) =>
          left.observedAt.getTime() - right.observedAt.getTime() ||
          left.id.localeCompare(right.id),
      );
      if (
        representative !== undefined &&
        !checkedRepresentativeSourceIds.includes(representative.id)
      ) {
        checkedRepresentativeSourceIds.push(representative.id);
      }
    }
  }
  const sortedSources = [...sourceMap.values()].sort(
    (left, right) =>
      Number(right.sourceKind === "fetched_page") -
        Number(left.sourceKind === "fetched_page") ||
      left.observedAt.getTime() - right.observedAt.getTime() ||
      left.id.localeCompare(right.id),
  );
  const representativeIds = new Set(checkedRepresentativeSourceIds);
  const prioritizedSources = [
    ...checkedRepresentativeSourceIds.flatMap((sourceId) => {
      const source = sourceMap.get(sourceId);
      return source === undefined ? [] : [source];
    }),
    ...sortedSources.filter(({ id }) => !representativeIds.has(id)),
  ];
  return {
    listing: options.listing,
    readiness: readinessForCandidate({
      items: options.items,
      assessments: options.assessments,
    }),
    researchState: options.researchState,
    strongestSupported: options.strongestSupported,
    supportedMustHaveCount,
    mustHaveCount,
    unresolvedMustHaves: unresolved,
    whyItFits,
    watchouts,
    unknowns,
    evidenceSources: prioritizedSources.slice(0, 5).map((source) => ({
      title: source.sourceTitle,
      url: source.sourceUrl,
      role: source.sourceRole,
      depth: source.sourceKind,
    })),
  };
}

function decisionGaps(options: {
  items: readonly BriefItemV1[];
  candidates: readonly PersistedCandidateListing[];
  assessments: readonly CriterionAssessmentV1[];
  limit?: number;
}) {
  const strengthOrder: Record<BriefItemV1["strength"], number> = {
    hard: 0,
    strong_preference: 1,
    preference: 2,
  };
  return options.items
    .flatMap((item) => {
      const unresolvedCandidates = options.candidates.filter((candidate) => {
        const assessment = options.assessments.find(
          (entry) =>
            entry.candidateListingId === candidate.id &&
            entry.criterionId === item.criterionId,
        );
        return (
          assessment === undefined ||
          assessment.status === "uncertain" ||
          assessment.status === "not_applicable"
        );
      });
      if (unresolvedCandidates.length === 0) return [];
      const names = unresolvedCandidates.map(({ title }) => title);
      return [
        {
          criterionId: item.criterionId,
          label: item.conceptLabel,
          strength: item.strength,
          candidateListingIds: unresolvedCandidates.map(({ id }) => id),
          candidateTitles: names,
          explanation:
            item.strength === "hard"
              ? `${item.conceptLabel} still needs verification for ${names.length === 1 ? names[0] : `${names.length} contenders`}.`
              : `${item.conceptLabel} remains unresolved where it could separate the leading options.`,
        } satisfies DecisionGap,
      ];
    })
    .sort(
      (left, right) =>
        strengthOrder[left.strength] - strengthOrder[right.strength] ||
        right.candidateListingIds.length - left.candidateListingIds.length ||
        left.label.localeCompare(right.label),
    )
    .slice(0, options.limit ?? 3);
}

function readableList(values: readonly string[]) {
  const unique = [...new Set(values)];
  if (unique.length <= 1) return unique[0] ?? "";
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")}, and ${unique.at(-1)}`;
}

function buildComparison(options: {
  support: CurrentDecisionSupport;
  savedCandidates: readonly PersistedCandidateListing[];
  observationMap: ReadonlyMap<string, ProductObservationV1>;
  sourceMap: ReadonlyMap<string, EvidenceSourceV1>;
}): SavedComparison | null {
  const candidates = options.savedCandidates;
  if (candidates.length < 2) return null;
  const rows = options.support.brief.items.map((item) => ({
    criterionId: item.criterionId,
    label: item.conceptLabel,
    strength: item.strength,
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
          role: source.sourceRole,
          depth: source.sourceKind,
        })),
      };
    }),
  }));
  const purchasePriceItems = options.support.brief.items.filter(
    (item) =>
      (item.semanticValue.kind === "money" ||
        item.semanticValue.kind === "money_stretch") &&
      isPurchasePriceCriterion(item),
  );
  const purchasePriceItem =
    purchasePriceItems.length === 1 ? purchasePriceItems[0] : undefined;
  const purchaseSummaries = candidates.map((candidate) => {
    const assessment =
      purchasePriceItem === undefined
        ? undefined
        : options.support.assessments.find(
            (entry) =>
              entry.candidateListingId === candidate.id &&
              entry.criterionId === purchasePriceItem.criterionId,
          );
    return {
      candidateListingId: candidate.id,
      priceRelationship:
        assessment?.explanation ??
        (purchasePriceItems.length === 0
          ? "No purchase-price target is stated in the current brief."
          : purchasePriceItems.length > 1
            ? "Multiple purchase-price targets are stated, so no single purchase summary is assumed."
            : "Its observed purchase price has not been related to the stated purchase-price target."),
    };
  });
  const researchStates = candidates.map((candidate) => {
    const assessments = assessmentsForCandidate(
      options.support.assessments,
      candidate.id,
    );
    return {
      candidateListingId: candidate.id,
      state: candidateResearchState({
        candidateListingId: candidate.id,
        items: options.support.brief.items,
        assessments,
        coverage: options.support.deepResearchCoverage,
      }),
    };
  });
  const gaps = decisionGaps({
    items: options.support.brief.items,
    candidates,
    assessments: options.support.assessments,
  });
  const [strongest] = candidates;
  const strongestAssessments = assessmentsForCandidate(
    options.support.assessments,
    strongest!.id,
  );
  const strongestReadiness = readinessForCandidate({
    items: options.support.brief.items,
    assessments: strongestAssessments,
  });
  const leaderAdvantages = rows.filter((row) => {
    const leader = row.cells.find(
      ({ candidateListingId }) => candidateListingId === strongest!.id,
    );
    return (
      leader?.status === "meets" &&
      row.cells.some(
        ({ candidateListingId, status }) =>
          candidateListingId !== strongest!.id && status !== "meets",
      )
    );
  });
  const challengerAdvantages = rows.flatMap((row) => {
    const leader = row.cells.find(
      ({ candidateListingId }) => candidateListingId === strongest!.id,
    );
    if (leader?.status === "meets") return [];
    const challengers = row.cells
      .filter(
        ({ candidateListingId, status }) =>
          candidateListingId !== strongest!.id && status === "meets",
      )
      .map(({ candidateListingId }) =>
        candidates.find(({ id }) => id === candidateListingId),
      )
      .filter((candidate) => candidate !== undefined);
    return challengers.length === 0
      ? []
      : [{ label: row.label, titles: challengers.map(({ title }) => title) }];
  });
  const leaderHardGap = gaps.find(
    ({ strength, candidateListingIds }) =>
      strength === "hard" && candidateListingIds.includes(strongest!.id),
  );
  const leaderReason =
    leaderAdvantages.length === 0
      ? `The current evidence does not show a decisive criterion advantage for ${strongest!.title}.`
      : `${strongest!.title} has stronger support on ${readableList(
          leaderAdvantages.slice(0, 2).map(({ label }) => label),
        )}.`;
  const alternativeReason =
    challengerAdvantages.length === 0
      ? ""
      : ` ${readableList(challengerAdvantages[0]!.titles)} ${
          challengerAdvantages[0]!.titles.length === 1 ? "has" : "have"
        } stronger support on ${challengerAdvantages[0]!.label}.`;
  const judgement =
    leaderAdvantages.length === 0 && challengerAdvantages.length === 0
      ? gaps[0] === undefined
        ? "The current evidence does not meaningfully separate these saved options. Their supported criteria are presently equivalent, so no winner is claimed."
        : `The current evidence does not meaningfully separate these saved options. ${gaps[0].label} is the most important fact that could change the choice.`
      : leaderHardGap !== undefined
        ? `${strongest!.title} is promising, but it is not ready to choose on evidence alone: ${leaderHardGap.label} still needs verification. ${leaderReason}${alternativeReason}`
        : strongestReadiness === "trade_off"
          ? `${leaderReason}${alternativeReason} It currently leads overall, but carries an evidenced preference trade-off.`
          : `${leaderReason}${alternativeReason} It currently has the strongest support against today’s brief; personal fit and explicit unknowns still remain yours to judge.`;
  return {
    candidates,
    researchStates,
    purchaseSummaries,
    rows,
    judgement,
    decisionGaps: gaps,
  };
}

export function buildDecisionSupport(options: {
  support: CurrentDecisionSupport;
  savedListingIds: ReadonlySet<string>;
  savedListings?: readonly PersistedCandidateListing[];
  rejectedListingIds?: ReadonlySet<string>;
}) {
  const rejectedListingIds = options.rejectedListingIds ?? new Set<string>();
  const assessmentCandidateIds = new Set(
    options.support.assessments.map(
      ({ candidateListingId }) => candidateListingId,
    ),
  );
  const assessedCandidates = options.support.candidates.filter(
    ({ id }) => assessmentCandidateIds.has(id) && !rejectedListingIds.has(id),
  );
  const ordered = orderCandidatesByAssessments({
    brief: options.support.brief,
    candidates: assessedCandidates,
    assessments: options.support.assessments,
  });
  const savedCandidates = (
    options.savedListings ?? options.support.candidates
  ).filter(
    ({ id }) => options.savedListingIds.has(id) && !rejectedListingIds.has(id),
  );
  if (savedCandidates.length > 4) {
    throw new Error("Saved-listing comparison limit invariant was violated");
  }
  const assessedSavedCandidates = orderCandidatesByAssessments({
    brief: options.support.brief,
    candidates: savedCandidates.filter(({ id }) =>
      assessmentCandidateIds.has(id),
    ),
    assessments: options.support.assessments,
  });
  const assessedSavedIds = new Set(assessedSavedCandidates.map(({ id }) => id));
  const orderedSavedCandidates = [
    ...assessedSavedCandidates,
    ...savedCandidates.filter(({ id }) => !assessedSavedIds.has(id)),
  ];
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
    .map((listing) => {
      const assessments = assessmentsForCandidate(
        options.support.assessments,
        listing.id,
      );
      return candidateDecision({
        listing,
        items: options.support.brief.items,
        assessments,
        observationMap,
        sourceMap,
        strongestSupported: false,
        researchState: candidateResearchState({
          candidateListingId: listing.id,
          items: options.support.brief.items,
          assessments,
          coverage: options.support.deepResearchCoverage,
        }),
        coverage: options.support.deepResearchCoverage,
      });
    });
  const hasHardResolvedOption = topOptions.some(
    ({ readiness }) => readiness === "qualified" || readiness === "trade_off",
  );
  const firstTwoHaveDifferentAssessmentStates =
    topOptions.length < 2 ||
    options.support.brief.items.some((item) => {
      const first = assessmentForCriterion(
        topOptions[0] === undefined
          ? []
          : assessmentsForCandidate(
              options.support.assessments,
              topOptions[0].listing.id,
            ),
        item.criterionId,
      );
      const second = assessmentForCriterion(
        topOptions[1] === undefined
          ? []
          : assessmentsForCandidate(
              options.support.assessments,
              topOptions[1].listing.id,
            ),
        item.criterionId,
      );
      return (first?.status ?? "uncertain") !== (second?.status ?? "uncertain");
    });
  const finalizedTopOptions = topOptions.map((option, index) => ({
    ...option,
    strongestSupported:
      index === 0 &&
      hasHardResolvedOption &&
      firstTwoHaveDifferentAssessmentStates &&
      option.readiness !== "needs_verification" &&
      option.whyItFits.length > 0,
  }));
  const currentGaps = decisionGaps({
    items: options.support.brief.items,
    candidates: finalizedTopOptions.map(({ listing }) => listing).slice(0, 3),
    assessments: options.support.assessments,
  });
  const firstPassRuns = options.support.researchRuns.filter(
    ({ phase }) => phase === "first_pass" || phase === undefined,
  );
  const deepeningRuns = options.support.researchRuns.filter(
    ({ phase }) => phase === "deepening",
  );
  const assessmentRunIds = new Set(
    options.support.assessments
      .filter(({ observationIds }) => observationIds.length > 0)
      .map(({ researchRunId }) => researchRunId),
  );
  const firstPassHasUsefulAssessment = firstPassRuns.some(({ id }) =>
    assessmentRunIds.has(id),
  );
  const deepeningHasUsefulAssessment = deepeningRuns.some(({ id }) =>
    assessmentRunIds.has(id),
  );
  const researchStatus =
    firstPassRuns.length === 0
      ? ("not_started" as const)
      : firstPassRuns.some(({ status }) => status === "running")
        ? ("researching" as const)
        : firstPassRuns.every(({ status }) => status === "succeeded")
          ? ("ready" as const)
          : firstPassRuns.some(
                ({ status }) => status === "partial" || status === "succeeded",
              ) || firstPassHasUsefulAssessment
            ? ("partial" as const)
            : ("failed" as const);
  const deepResearchStatus =
    deepeningRuns.length === 0
      ? currentGaps.length === 0
        ? ("not_needed" as const)
        : ("available" as const)
      : deepeningRuns.some(({ status }) => status === "running")
        ? ("researching" as const)
        : deepeningRuns.every(({ status }) => status === "succeeded")
          ? ("complete" as const)
          : deepeningRuns.some(
                ({ status }) => status === "succeeded" || status === "partial",
              ) || deepeningHasUsefulAssessment
            ? ("partial" as const)
            : ("failed" as const);
  return {
    researchStatus,
    deepResearchStatus,
    researchActivity: {
      firstPassEvidenceCalls: firstPassRuns.reduce(
        (total, run) => total + run.plannedSearchCount,
        0,
      ),
      deepeningEvidenceCalls: deepeningRuns.reduce(
        (total, run) => total + run.plannedSearchCount,
        0,
      ),
      productUnderstandingCalls: options.support.researchRuns.reduce(
        (total, run) => total + run.selectedCandidateCount,
        0,
      ),
    },
    researchedCandidateCount: new Set(
      options.support.assessments.map(
        ({ candidateListingId }) => candidateListingId,
      ),
    ).size,
    sectionMode: hasHardResolvedOption
      ? ("qualified_options" as const)
      : ("verification_needed" as const),
    excludedCandidateCount: ordered.length - viable.length,
    decisionGaps: currentGaps,
    topOptions: finalizedTopOptions,
    comparison: buildComparison({
      support: options.support,
      savedCandidates: orderedSavedCandidates,
      observationMap,
      sourceMap,
    }),
  };
}
