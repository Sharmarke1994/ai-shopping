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

export type CurrentDecisionReason = Readonly<{
  criterionId: string;
  label: string;
  strength: BriefItemV1["strength"];
  explanation: string;
}>;

export type CurrentDecision = Readonly<{
  state:
    | "researching"
    | "leader_needs_verification"
    | "leader_with_tradeoff"
    | "ready_to_choose"
    | "no_clear_winner"
    | "insufficient_evidence"
    | "no_eligible_option";
  recommendationLevel: "none" | "provisional" | "ready";
  leadingCandidateListingId: string | null;
  alternativeCandidateListingId: string | null;
  headline: string;
  explanation: string;
  keyReasons: readonly CurrentDecisionReason[];
  keyTradeoff: CurrentDecisionReason | null;
  blockingGap: DecisionGap | null;
  whatCouldChangeDecision: DecisionGap | null;
  alternativeReason: string | null;
  recommendationBasis:
    | "evidence_still_developing"
    | "meaningful_criterion_separation"
    | "sole_eligible_option"
    | "unresolved_hard_requirement"
    | "equivalent_evidence"
    | "insufficient_grounded_evidence"
    | "no_eligible_candidate";
}>;

type CriterionDifference = Readonly<{
  item: BriefItemV1;
  leaderAssessment: CriterionAssessmentV1 | undefined;
  challengerAssessment: CriterionAssessmentV1 | undefined;
  favours: "leader" | "challenger";
}>;

const decisionStrengthOrder: Record<BriefItemV1["strength"], number> = {
  hard: 0,
  strong_preference: 1,
  preference: 2,
};

function decisionStatusRank(assessment: CriterionAssessmentV1 | undefined) {
  if (assessment?.status === "meets") return 0;
  if (assessment?.status === "conflicts") return 2;
  return 1;
}

function isPopularitySignal(item: BriefItemV1) {
  return /\b(?:review|reviews|rating|ratings|popular|popularity)\b/i.test(
    `${item.conceptLabel} ${item.conceptDefinition}`,
  );
}

function decisionReason(
  item: BriefItemV1,
  assessment: CriterionAssessmentV1,
): CurrentDecisionReason {
  return {
    criterionId: item.criterionId,
    label: item.conceptLabel,
    strength: item.strength,
    explanation: assessment.explanation,
  };
}

function criterionDifferences(options: {
  items: readonly BriefItemV1[];
  assessments: readonly CriterionAssessmentV1[];
  leaderId: string;
  challengerId: string;
}) {
  return [...options.items]
    .sort(
      (left, right) =>
        decisionStrengthOrder[left.strength] -
        decisionStrengthOrder[right.strength],
    )
    .flatMap((item): CriterionDifference[] => {
      const leaderAssessment = options.assessments.find(
        (assessment) =>
          assessment.candidateListingId === options.leaderId &&
          assessment.criterionId === item.criterionId,
      );
      const challengerAssessment = options.assessments.find(
        (assessment) =>
          assessment.candidateListingId === options.challengerId &&
          assessment.criterionId === item.criterionId,
      );
      const leaderRank = decisionStatusRank(leaderAssessment);
      const challengerRank = decisionStatusRank(challengerAssessment);
      if (leaderRank === challengerRank) return [];
      return [
        {
          item,
          leaderAssessment,
          challengerAssessment,
          favours: leaderRank < challengerRank ? "leader" : "challenger",
        },
      ];
    });
}

function primaryDecisionGap(options: {
  gaps: readonly DecisionGap[];
  leaderId: string | null;
  challengerId: string | null;
}) {
  if (options.leaderId === null) return options.gaps[0] ?? null;
  return (
    options.gaps.find(
      ({ candidateListingIds }) =>
        options.challengerId !== null &&
        candidateListingIds.includes(options.leaderId!) &&
        candidateListingIds.includes(options.challengerId),
    ) ??
    options.gaps.find(({ candidateListingIds }) =>
      candidateListingIds.includes(options.leaderId!),
    ) ??
    options.gaps[0] ??
    null
  );
}

export function synthesizeCurrentDecision(options: {
  items: readonly BriefItemV1[];
  candidates: readonly DecisionSupportCandidate[];
  assessments: readonly CriterionAssessmentV1[];
  decisionGaps: readonly DecisionGap[];
  researchStatus:
    "not_started" | "researching" | "partial" | "failed" | "ready";
  assessedCandidateCount: number;
  eligibleCandidateCount: number;
}): CurrentDecision {
  const [leader, challenger] = options.candidates;
  if (options.eligibleCandidateCount === 0) {
    const noAssessments = options.assessedCandidateCount === 0;
    return {
      state: noAssessments ? "insufficient_evidence" : "no_eligible_option",
      recommendationLevel: "none",
      leadingCandidateListingId: null,
      alternativeCandidateListingId: null,
      headline: noAssessments
        ? "I don’t have enough evidence to recommend yet"
        : "None of these options clears your purchase boundaries",
      explanation: noAssessments
        ? "Product research has not produced grounded current assessments yet."
        : "Every researched option conflicts with a must-have or an absolute purchase ceiling, so no product is recommended.",
      keyReasons: [],
      keyTradeoff: null,
      blockingGap: null,
      whatCouldChangeDecision: options.decisionGaps[0] ?? null,
      alternativeReason: null,
      recommendationBasis: noAssessments
        ? "insufficient_grounded_evidence"
        : "no_eligible_candidate",
    };
  }
  if (leader === undefined) {
    return {
      state: "insufficient_evidence",
      recommendationLevel: "none",
      leadingCandidateListingId: null,
      alternativeCandidateListingId: null,
      headline: "I don’t have enough evidence to recommend yet",
      explanation:
        "The available product rows have not produced enough grounded evidence for a decision.",
      keyReasons: [],
      keyTradeoff: null,
      blockingGap: null,
      whatCouldChangeDecision: options.decisionGaps[0] ?? null,
      alternativeReason: null,
      recommendationBasis: "insufficient_grounded_evidence",
    };
  }

  const leaderAssessments = options.assessments.filter(
    ({ candidateListingId }) => candidateListingId === leader.listing.id,
  );
  const tradeoffItem = options.items.find((item) => {
    const assessment = assessmentForCriterion(
      leaderAssessments,
      item.criterionId,
    );
    return (
      (item.strength !== "hard" && assessment?.status === "conflicts") ||
      assessment?.relation === "inside_conditional_stretch"
    );
  });
  const tradeoffAssessment =
    tradeoffItem === undefined
      ? undefined
      : assessmentForCriterion(leaderAssessments, tradeoffItem.criterionId);
  const keyTradeoff =
    tradeoffItem === undefined || tradeoffAssessment === undefined
      ? null
      : decisionReason(tradeoffItem, tradeoffAssessment);
  const differences =
    challenger === undefined
      ? []
      : criterionDifferences({
          items: options.items,
          assessments: options.assessments,
          leaderId: leader.listing.id,
          challengerId: challenger.listing.id,
        });
  const leaderAdvantages = differences.filter(
    ({ favours }) => favours === "leader",
  );
  const materialLeaderAdvantages = leaderAdvantages.filter(
    ({ item }) => !isPopularitySignal(item),
  );
  const separatingCriterionIds = new Set(
    materialLeaderAdvantages.map(({ item }) => item.criterionId),
  );
  const supportedReasons = [...options.items]
    .sort(
      (left, right) =>
        Number(!separatingCriterionIds.has(left.criterionId)) -
          Number(!separatingCriterionIds.has(right.criterionId)) ||
        decisionStrengthOrder[left.strength] -
          decisionStrengthOrder[right.strength],
    )
    .flatMap((item) => {
      const assessment = assessmentForCriterion(
        leaderAssessments,
        item.criterionId,
      );
      return assessment?.status === "meets"
        ? [decisionReason(item, assessment)]
        : [];
    })
    .slice(0, 3);
  const challengerAdvantage = differences.find(
    ({ favours, challengerAssessment }) =>
      favours === "challenger" && challengerAssessment?.status === "meets",
  );
  const soleEligible = options.eligibleCandidateCount === 1;
  const hasNonPopularitySupport = options.items.some((item) => {
    const assessment = assessmentForCriterion(
      leaderAssessments,
      item.criterionId,
    );
    return assessment?.status === "meets" && !isPopularitySignal(item);
  });
  const meaningfulSeparation =
    (soleEligible && hasNonPopularitySupport) ||
    materialLeaderAdvantages.length > 0;
  const hasGroundedSupport = supportedReasons.length > 0;
  const blockingGap =
    leader.unresolvedMustHaves.length === 0
      ? null
      : (options.decisionGaps.find(
          ({ strength, candidateListingIds }) =>
            strength === "hard" &&
            candidateListingIds.includes(leader.listing.id),
        ) ?? null);
  const whatCouldChangeDecision = primaryDecisionGap({
    gaps: options.decisionGaps,
    leaderId: meaningfulSeparation ? leader.listing.id : null,
    challengerId: challenger?.listing.id ?? null,
  });
  const alternativeCandidateListingId =
    challengerAdvantage === undefined || challenger === undefined
      ? null
      : challenger.listing.id;
  const alternativeReason =
    challengerAdvantage?.challengerAssessment === undefined ||
    challenger === undefined
      ? null
      : `Choose ${challenger.listing.title} instead if ${challengerAdvantage.item.conceptLabel.toLocaleLowerCase("en-GB")} matters more: ${challengerAdvantage.challengerAssessment.explanation}`;

  if (options.researchStatus === "researching") {
    return {
      state: "researching",
      recommendationLevel: meaningfulSeparation ? "provisional" : "none",
      leadingCandidateListingId:
        meaningfulSeparation && hasGroundedSupport ? leader.listing.id : null,
      alternativeCandidateListingId,
      headline:
        meaningfulSeparation && hasGroundedSupport
          ? `${leader.listing.title} leads while research continues`
          : "Research is still building the decision",
      explanation:
        meaningfulSeparation && hasGroundedSupport
          ? "Current evidence separates this option, but the remaining saved research could still change the conclusion."
          : "Early evidence does not yet separate the leading options enough to recommend one.",
      keyReasons: supportedReasons,
      keyTradeoff,
      blockingGap,
      whatCouldChangeDecision,
      alternativeReason,
      recommendationBasis: "evidence_still_developing",
    };
  }

  if (!hasGroundedSupport) {
    return {
      state: "insufficient_evidence",
      recommendationLevel: "none",
      leadingCandidateListingId: null,
      alternativeCandidateListingId: null,
      headline: "I don’t have enough evidence to recommend yet",
      explanation:
        "The checked products still lack grounded support against the current brief.",
      keyReasons: [],
      keyTradeoff: null,
      blockingGap,
      whatCouldChangeDecision,
      alternativeReason: null,
      recommendationBasis: "insufficient_grounded_evidence",
    };
  }

  if (!meaningfulSeparation) {
    const popularityOnly =
      leaderAdvantages.length > 0 && materialLeaderAdvantages.length === 0;
    return {
      state: "no_clear_winner",
      recommendationLevel: "none",
      leadingCandidateListingId: null,
      alternativeCandidateListingId: null,
      headline: "I wouldn’t choose between these yet",
      explanation: popularityOnly
        ? "The apparent lead comes only from review or popularity evidence, not a meaningful product difference for this brief."
        : "The leading options have effectively equivalent evidence on what matters, so their listing order is not treated as a decision.",
      keyReasons: [],
      keyTradeoff: null,
      blockingGap: null,
      whatCouldChangeDecision,
      alternativeReason: null,
      recommendationBasis: "equivalent_evidence",
    };
  }

  if (leader.readiness === "needs_verification") {
    return {
      state: "leader_needs_verification",
      recommendationLevel: "provisional",
      leadingCandidateListingId: leader.listing.id,
      alternativeCandidateListingId,
      headline: `${leader.listing.title} leads, but verify one must-have`,
      explanation:
        blockingGap === null
          ? "This option has the strongest current evidence, but a hard requirement remains unresolved."
          : `${blockingGap.label} still prevents an honest buy recommendation.`,
      keyReasons: supportedReasons,
      keyTradeoff,
      blockingGap,
      whatCouldChangeDecision: blockingGap ?? whatCouldChangeDecision,
      alternativeReason,
      recommendationBasis: "unresolved_hard_requirement",
    };
  }

  if (leader.readiness === "trade_off" || keyTradeoff !== null) {
    return {
      state: "leader_with_tradeoff",
      recommendationLevel: "ready",
      leadingCandidateListingId: leader.listing.id,
      alternativeCandidateListingId,
      headline: `I’d choose ${leader.listing.title}—with one trade-off`,
      explanation:
        keyTradeoff === null
          ? "It has meaningful separation and clears the must-haves, with a softer compromise to consider."
          : keyTradeoff.explanation,
      keyReasons: supportedReasons,
      keyTradeoff,
      blockingGap: null,
      whatCouldChangeDecision,
      alternativeReason,
      recommendationBasis: soleEligible
        ? "sole_eligible_option"
        : "meaningful_criterion_separation",
    };
  }

  return {
    state: "ready_to_choose",
    recommendationLevel: "ready",
    leadingCandidateListingId: leader.listing.id,
    alternativeCandidateListingId,
    headline: `I’d choose ${leader.listing.title}`,
    explanation:
      "It clears the current must-haves and has meaningful evidence separation on what matters most in this brief.",
    keyReasons: supportedReasons,
    keyTradeoff: null,
    blockingGap: null,
    whatCouldChangeDecision,
    alternativeReason,
    recommendationBasis: soleEligible
      ? "sole_eligible_option"
      : "meaningful_criterion_separation",
  };
}

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
      if (assessment.relation === "inside_conditional_stretch") return true;
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
  const currentAssessments = options.support.assessments.filter(
    ({ taskId, taskRevision }) =>
      taskId === options.support.brief.taskId &&
      taskRevision === options.support.brief.revision,
  );
  const support = { ...options.support, assessments: currentAssessments };
  const assessmentCandidateIds = new Set(
    currentAssessments.map(({ candidateListingId }) => candidateListingId),
  );
  const assessedCandidates = support.candidates.filter(
    ({ id }) => assessmentCandidateIds.has(id) && !rejectedListingIds.has(id),
  );
  const ordered = orderCandidatesByAssessments({
    brief: support.brief,
    candidates: assessedCandidates,
    assessments: currentAssessments,
  });
  const savedCandidates = (options.savedListings ?? support.candidates).filter(
    ({ id }) => options.savedListingIds.has(id) && !rejectedListingIds.has(id),
  );
  if (savedCandidates.length > 4) {
    throw new Error("Saved-listing comparison limit invariant was violated");
  }
  const assessedSavedCandidates = orderCandidatesByAssessments({
    brief: support.brief,
    candidates: savedCandidates.filter(({ id }) =>
      assessmentCandidateIds.has(id),
    ),
    assessments: currentAssessments,
  });
  const assessedSavedIds = new Set(assessedSavedCandidates.map(({ id }) => id));
  const orderedSavedCandidates = [
    ...assessedSavedCandidates,
    ...savedCandidates.filter(({ id }) => !assessedSavedIds.has(id)),
  ];
  const viable = groupExactOffers(ordered).filter(
    (listing) =>
      !purchaseExclusion(
        support.brief.items,
        assessmentsForCandidate(currentAssessments, listing.id),
      ),
  );
  const conflictFree = viable.filter(
    (listing) =>
      !hasConflict(assessmentsForCandidate(currentAssessments, listing.id)),
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
    support.observations.map((entry) => [entry.id, entry]),
  );
  const sourceMap = new Map(support.sources.map((entry) => [entry.id, entry]));
  const topOptions = recommendationPool
    .slice(0, recommendationLimit)
    .map((listing) => {
      const assessments = assessmentsForCandidate(
        currentAssessments,
        listing.id,
      );
      return candidateDecision({
        listing,
        items: support.brief.items,
        assessments,
        observationMap,
        sourceMap,
        strongestSupported: false,
        researchState: candidateResearchState({
          candidateListingId: listing.id,
          items: support.brief.items,
          assessments,
          coverage: support.deepResearchCoverage,
        }),
        coverage: support.deepResearchCoverage,
      });
    });
  const hasHardResolvedOption = topOptions.some(
    ({ readiness }) => readiness === "qualified" || readiness === "trade_off",
  );
  const firstTwoHaveDifferentAssessmentStates =
    topOptions.length < 2 ||
    support.brief.items.some((item) => {
      const first = assessmentForCriterion(
        topOptions[0] === undefined
          ? []
          : assessmentsForCandidate(
              currentAssessments,
              topOptions[0].listing.id,
            ),
        item.criterionId,
      );
      const second = assessmentForCriterion(
        topOptions[1] === undefined
          ? []
          : assessmentsForCandidate(
              currentAssessments,
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
  const decisionEligibleOptions = finalizedTopOptions.filter(
    ({ readiness }) => readiness !== "ineligible",
  );
  const currentGaps = decisionGaps({
    items: support.brief.items,
    candidates: finalizedTopOptions.map(({ listing }) => listing).slice(0, 3),
    assessments: currentAssessments,
  });
  const firstPassRuns = support.researchRuns.filter(
    ({ phase }) => phase === "first_pass" || phase === undefined,
  );
  const deepeningRuns = support.researchRuns.filter(
    ({ phase }) => phase === "deepening",
  );
  const assessmentRunIds = new Set(
    currentAssessments
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
      productUnderstandingCalls: support.researchRuns.reduce(
        (total, run) => total + run.selectedCandidateCount,
        0,
      ),
    },
    researchedCandidateCount: new Set(
      currentAssessments.map(({ candidateListingId }) => candidateListingId),
    ).size,
    sectionMode: hasHardResolvedOption
      ? ("qualified_options" as const)
      : ("verification_needed" as const),
    excludedCandidateCount: ordered.length - viable.length,
    decisionGaps: currentGaps,
    topOptions: finalizedTopOptions,
    currentDecision: synthesizeCurrentDecision({
      items: support.brief.items,
      candidates: decisionEligibleOptions,
      assessments: currentAssessments,
      decisionGaps: currentGaps,
      researchStatus,
      assessedCandidateCount: ordered.length,
      eligibleCandidateCount: decisionEligibleOptions.length,
    }),
    comparison: buildComparison({
      support,
      savedCandidates: orderedSavedCandidates,
      observationMap,
      sourceMap,
    }),
  };
}
