import type {
  BriefItemV1,
  ShoppingBriefV1,
} from "@/domain/shopping-state/brief";
import type { PersistedCandidateListing } from "@/features/retrieval-spike/persistence/contracts";
import type {
  CriterionAssessmentV1,
  EvidenceSourceV1,
  ProductObservationV1,
} from "./contracts";

export type ObservationWithSource = Readonly<{
  observation: ProductObservationV1;
  source: EvidenceSourceV1;
}>;

export type ProposedCriterionAssessment = Readonly<{
  status: CriterionAssessmentV1["status"];
  relation: string;
  explanation: string;
  observations: readonly ObservationWithSource[];
}>;

export type GuardedAssessment = Readonly<{
  status: CriterionAssessmentV1["status"];
  relation: string;
  explanation: string;
  method: CriterionAssessmentV1["method"];
  observationIds: readonly ProductObservationV1["id"][];
}>;

function normalized(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
}

function conceptMatches(item: BriefItemV1, pattern: RegExp) {
  return pattern.test(
    normalized(`${item.conceptLabel} ${item.conceptDefinition}`),
  );
}

function formatMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

function observedMoney(
  listing: PersistedCandidateListing,
  observations: readonly ObservationWithSource[],
): {
  amountMinor: number;
  currency: string;
  observationIds: ProductObservationV1["id"][];
} | null {
  const direct = observations.find(
    ({ observation }) => observation.value.kind === "money",
  );
  if (direct?.observation.value.kind === "money") {
    return {
      amountMinor: direct.observation.value.amountMinor,
      currency: direct.observation.value.currency,
      observationIds: [direct.observation.id],
    };
  }
  return listing.price === null
    ? null
    : { ...listing.price, observationIds: [] };
}

function moneyAssessment(options: {
  item: BriefItemV1;
  listing: PersistedCandidateListing;
  observations: readonly ObservationWithSource[];
  proposal: ProposedCriterionAssessment | null;
}): GuardedAssessment | null {
  const observed = observedMoney(options.listing, options.observations);
  const value = options.item.semanticValue;
  if (value.kind !== "money" && value.kind !== "money_stretch") return null;
  if (observed === null || observed.currency !== value.currency) {
    return {
      status: "uncertain",
      relation: "price_not_observed",
      explanation: "A comparable current price was not observed.",
      method: "deterministic",
      observationIds: [],
    };
  }
  if (value.kind === "money") {
    const difference = observed.amountMinor - value.amountMinor;
    if (value.mode === "ceiling") {
      return {
        status: difference <= 0 ? "meets" : "conflicts",
        relation: difference <= 0 ? "within_ceiling" : "above_ceiling",
        explanation:
          difference <= 0
            ? `${formatMoney(observed.amountMinor, observed.currency)} is within the ${formatMoney(value.amountMinor, value.currency)} maximum.`
            : `${formatMoney(observed.amountMinor, observed.currency)} is ${formatMoney(difference, observed.currency)} above the ${formatMoney(value.amountMinor, value.currency)} maximum.`,
        method: "deterministic",
        observationIds: observed.observationIds,
      };
    }
    return {
      status: difference === 0 ? "meets" : "uncertain",
      relation: `target_distance_minor:${difference}`,
      explanation:
        difference === 0
          ? `The observed price matches the ${formatMoney(value.amountMinor, value.currency)} target.`
          : `${formatMoney(observed.amountMinor, observed.currency)} is ${formatMoney(Math.abs(difference), observed.currency)} ${difference > 0 ? "above" : "below"} the ${formatMoney(value.amountMinor, value.currency)} target; no arbitrary tolerance has been assumed.`,
      method: "deterministic",
      observationIds: observed.observationIds,
    };
  }
  const targetDifference = observed.amountMinor - value.targetMinor;
  if (targetDifference === 0) {
    return {
      status: "meets",
      relation: "target_exact",
      explanation: `${formatMoney(observed.amountMinor, observed.currency)} matches the ${formatMoney(value.targetMinor, value.currency)} target.`,
      method: "deterministic",
      observationIds: observed.observationIds,
    };
  }
  if (targetDifference < 0) {
    return {
      status: "uncertain",
      relation: `target_distance_minor:${targetDifference}`,
      explanation: `${formatMoney(observed.amountMinor, observed.currency)} is ${formatMoney(Math.abs(targetDifference), observed.currency)} below the ${formatMoney(value.targetMinor, value.currency)} target; being cheaper is not being treated as an automatic target match.`,
      method: "deterministic",
      observationIds: observed.observationIds,
    };
  }
  if (observed.amountMinor <= value.stretchCeilingMinor) {
    const conditionTerms = normalized(value.condition)
      .split(/[^a-z0-9]+/)
      .filter(
        (term) =>
          term.length >= 4 &&
          !["genuinely", "better", "because", "only", "with"].includes(term),
      );
    const conditionEvidence =
      options.proposal?.status === "meets"
        ? options.proposal.observations.filter(({ observation, source }) => {
            if (
              observation.support !== "supported" ||
              source.sourceRole === "visual" ||
              source.sourceRole === "listing" ||
              source.sourceRole === "other"
            ) {
              return false;
            }
            const evidenceText = normalized(
              `${observation.propertyLabel} ${observation.claim}`,
            );
            return conditionTerms.some((term) => evidenceText.includes(term));
          })
        : [];
    if (conditionEvidence.length > 0) {
      return {
        status: "meets",
        relation: "conditional_stretch_supported",
        explanation: `${formatMoney(observed.amountMinor, observed.currency)} is inside the stretch ceiling, and the cited evidence directly addresses the condition: ${value.condition}.`,
        method: "guarded_model",
        observationIds: [
          ...observed.observationIds,
          ...conditionEvidence.map(({ observation }) => observation.id),
        ],
      };
    }
    return {
      status: "uncertain",
      relation: "inside_conditional_stretch",
      explanation: `${formatMoney(observed.amountMinor, observed.currency)} is inside the conditional stretch range, but still needs evidence for the stated condition: “${value.condition}”.`,
      method: "deterministic",
      observationIds: observed.observationIds,
    };
  }
  return {
    status: "conflicts",
    relation: "above_stretch_ceiling",
    explanation: `${formatMoney(observed.amountMinor, observed.currency)} is above the ${formatMoney(value.stretchCeilingMinor, value.currency)} stretch ceiling.`,
    method: "deterministic",
    observationIds: observed.observationIds,
  };
}

function booleanObservationAddressesCriterion(
  item: BriefItemV1,
  observation: ProductObservationV1,
) {
  if (observation.value.kind !== "boolean") return false;
  const criterionText = normalized(
    `${item.conceptLabel} ${item.conceptDefinition}`,
  );
  const property = normalized(observation.propertyLabel);
  if (/battery|runtime|charge life/.test(criterionText)) {
    return /battery|runtime|charge life/.test(property);
  }
  if (
    /comfort|ergonom|long session|long work|personal fit/.test(criterionText)
  ) {
    return /comfort|palm|wrist|support|ergonom|shape|profile/.test(property);
  }
  if (/wireless|connect/.test(criterionText)) {
    return /wireless|wired|connect/.test(property);
  }
  const criterionTokens = new Set(
    criterionText.split(/[^a-z0-9]+/).filter((token) => token.length >= 4),
  );
  return [...criterionTokens].some((token) => property.includes(token));
}

function explicitBooleanAssessment(options: {
  item: BriefItemV1;
  observations: readonly ObservationWithSource[];
}) {
  if (options.item.semanticValue.kind !== "boolean") return null;
  const isComfort = conceptMatches(
    options.item,
    /comfort|ergonom|long session|long work/,
  );
  const eligible = options.observations.filter(({ observation }) => {
    if (observation.value.kind !== "boolean") return false;
    return booleanObservationAddressesCriterion(options.item, observation);
  });
  const supported = eligible.filter(
    ({ observation }) => observation.support === "supported",
  );
  if (supported.length === 0) return null;
  const values = new Set(
    supported.map(({ observation }) =>
      observation.value.kind === "boolean" ? observation.value.value : null,
    ),
  );
  if (values.size > 1) {
    return {
      status: "uncertain" as const,
      relation: "conflicting_supported_evidence",
      explanation:
        "Admissible supplied sources disagree on this boolean; the conflict is left unresolved.",
      method: "deterministic" as const,
      observationIds: supported.map(({ observation }) => observation.id),
    };
  }
  const matches = [...values][0] === options.item.semanticValue.value;
  const hasVisual = supported.some(
    ({ source, observation }) =>
      source.sourceRole === "visual" ||
      source.sourceKind === "listing_image" ||
      observation.derivation === "model_visual",
  );
  const hasWeakSource = supported.some(
    ({ source }) => source.sourceRole === "other",
  );
  const hasStrongNonVisualSource = supported.some(
    ({ source, observation }) =>
      source.sourceRole !== "other" &&
      source.sourceRole !== "visual" &&
      source.sourceKind !== "listing_image" &&
      observation.derivation !== "model_visual",
  );
  if (
    hasVisual &&
    options.item.strength === "hard" &&
    !hasStrongNonVisualSource
  ) {
    return {
      status: "uncertain" as const,
      relation: matches
        ? "visual_support_not_admissible_for_hard_requirement"
        : "visual_conflict_not_admissible",
      explanation: matches
        ? "The image is consistent with this requirement, but visual evidence alone cannot establish a hard hidden specification."
        : "The image suggests a possible mismatch, but visual evidence alone cannot exclude this candidate.",
      method: "deterministic" as const,
      observationIds: supported.map(({ observation }) => observation.id),
    };
  }
  if (hasWeakSource && !hasStrongNonVisualSource) {
    return {
      status: "uncertain" as const,
      relation: "weak_boolean_evidence",
      explanation:
        "The supplied source is not specific enough to establish this boolean criterion.",
      method: "deterministic" as const,
      observationIds: supported.map(({ observation }) => observation.id),
    };
  }
  if (isComfort) {
    return {
      status: "uncertain" as const,
      relation: "personal_fit_unresolved",
      explanation:
        "The source reports an ergonomic or support feature, but personal comfort over a full workday remains uncertain.",
      method: "deterministic" as const,
      observationIds: supported.map(({ observation }) => observation.id),
    };
  }
  return {
    status: matches
      ? ("meets" as const)
      : options.item.strength === "hard"
        ? ("conflicts" as const)
        : ("conflicts" as const),
    relation: matches
      ? "direct_match"
      : hasVisual
        ? "visual_preference_mismatch"
        : "direct_contradiction",
    explanation: supported[0]!.observation.claim,
    method: "deterministic" as const,
    observationIds: supported.map(({ observation }) => observation.id),
  };
}

function hasAdmissibleHardConflict(options: {
  item: BriefItemV1;
  proposal: ProposedCriterionAssessment;
}) {
  if (options.proposal.status !== "conflicts") return true;
  if (options.item.strength !== "hard") return true;
  return options.proposal.observations.some(({ observation, source }) => {
    if (observation.support !== "supported") return false;
    if (source.sourceRole === "visual") return false;
    if (source.sourceRole === "other") return false;
    if (
      observation.value.kind === "boolean" &&
      !booleanObservationAddressesCriterion(options.item, observation)
    ) {
      return false;
    }
    return (
      observation.value.kind === "boolean" ||
      observation.value.kind === "money" ||
      observation.value.kind === "quantity" ||
      observation.value.kind === "categorical"
    );
  });
}

function proposalHasRelevantEvidence(options: {
  item: BriefItemV1;
  proposal: ProposedCriterionAssessment;
}) {
  if (options.proposal.status === "uncertain") return true;
  if (options.proposal.observations.length === 0) return false;
  if (options.item.semanticValue.kind === "boolean") {
    return options.proposal.observations.some(({ observation }) =>
      booleanObservationAddressesCriterion(options.item, observation),
    );
  }
  const battery = conceptMatches(options.item, /battery|runtime|charge life/);
  const comfort = conceptMatches(
    options.item,
    /comfort|ergonom|long session|long work/,
  );
  const reputation = conceptMatches(
    options.item,
    /brand|reputation|established/,
  );
  const reviews = conceptMatches(
    options.item,
    /review|customer evidence|customer sentiment/,
  );
  return options.proposal.observations.some(({ observation, source }) => {
    const property = normalized(observation.propertyLabel);
    if (battery) return /battery|runtime|charge life/.test(property);
    if (comfort) {
      return (
        /comfort|palm|wrist|support|shape|profile/.test(property) &&
        !(
          source.sourceRole === "listing" &&
          /ergonomic/.test(normalized(observation.claim))
        )
      );
    }
    if (reputation) {
      return [
        "manufacturer",
        "independent_review",
        "retailer_review_aggregate",
      ].includes(source.sourceRole);
    }
    if (reviews) {
      return (
        observation.value.kind === "rating_aggregate" &&
        [
          "retailer",
          "retailer_review_aggregate",
          "independent_review",
        ].includes(source.sourceRole)
      );
    }
    return true;
  });
}

export function guardCriterionAssessment(options: {
  item: BriefItemV1;
  listing: PersistedCandidateListing;
  observations: readonly ObservationWithSource[];
  proposal: ProposedCriterionAssessment | null;
}): GuardedAssessment {
  const money = moneyAssessment(options);
  if (money !== null) return money;
  const directBoolean = explicitBooleanAssessment(options);
  if (directBoolean !== null) return directBoolean;
  if (options.proposal === null) {
    return {
      status: "uncertain",
      relation: "insufficient_evidence",
      explanation: "Current evidence does not establish this criterion.",
      method: "deterministic",
      observationIds: [],
    };
  }
  const proposal = options.proposal;
  if (!proposalHasRelevantEvidence({ item: options.item, proposal })) {
    return {
      status: "uncertain",
      relation: "insufficient_relevant_evidence",
      explanation:
        "The available evidence does not directly establish this criterion.",
      method: "guarded_model",
      observationIds: options.proposal.observations.map(
        ({ observation }) => observation.id,
      ),
    };
  }
  if (
    conceptMatches(options.item, /comfort|long session|long workday/) &&
    proposal.status === "meets"
  ) {
    return {
      status: "uncertain",
      relation: "personal_fit_unresolved",
      explanation: `${proposal.explanation} Personal comfort over a full workday remains uncertain.`,
      method: "guarded_model",
      observationIds: proposal.observations.map(
        ({ observation }) => observation.id,
      ),
    };
  }
  if (!hasAdmissibleHardConflict({ item: options.item, proposal })) {
    return {
      status: "uncertain",
      relation: "conflict_not_directly_admissible",
      explanation:
        "The evidence is not a direct enough contradiction to exclude this product.",
      method: "guarded_model",
      observationIds: options.proposal.observations.map(
        ({ observation }) => observation.id,
      ),
    };
  }
  if (
    options.item.strength === "hard" &&
    options.proposal.status === "conflicts" &&
    options.proposal.observations.some(
      ({ source }) => source.sourceRole === "visual",
    )
  ) {
    return {
      status: "uncertain",
      relation: "visual_conflict_not_admissible",
      explanation:
        "The image suggests a possible mismatch, but visual evidence alone cannot exclude it.",
      method: "guarded_model",
      observationIds: options.proposal.observations.map(
        ({ observation }) => observation.id,
      ),
    };
  }
  return {
    status: options.proposal.status,
    relation: options.proposal.relation,
    explanation: options.proposal.explanation,
    method: "guarded_model",
    observationIds: options.proposal.observations.map(
      ({ observation }) => observation.id,
    ),
  };
}

function targetDistance(assessment: CriterionAssessmentV1) {
  if (!assessment.relation.startsWith("target_distance_minor:")) return 0;
  return Math.abs(
    Number(assessment.relation.slice("target_distance_minor:".length)),
  );
}

export function orderCandidatesByAssessments(options: {
  brief: ShoppingBriefV1;
  candidates: readonly PersistedCandidateListing[];
  assessments: readonly CriterionAssessmentV1[];
}) {
  const itemById = new Map(
    options.brief.items.map((item) => [item.criterionId, item]),
  );
  const assessmentsByCandidate = new Map<string, CriterionAssessmentV1[]>();
  for (const assessment of options.assessments) {
    const list =
      assessmentsByCandidate.get(assessment.candidateListingId) ?? [];
    list.push(assessment);
    assessmentsByCandidate.set(assessment.candidateListingId, list);
  }
  const dimensions = (candidateId: string) => {
    const assessments = assessmentsByCandidate.get(candidateId) ?? [];
    const counts = {
      hardConflicts: 0,
      hardMeets: 0,
      strongConflicts: 0,
      strongMeets: 0,
      preferenceConflicts: 0,
      preferenceMeets: 0,
      unknowns: 0,
      targetDistance: 0,
    };
    for (const assessment of assessments) {
      const item = itemById.get(assessment.criterionId);
      if (item === undefined) continue;
      if (assessment.status === "conflicts" && item.strength === "hard") {
        counts.hardConflicts += 1;
      }
      if (assessment.status === "meets") {
        if (item.strength === "hard") counts.hardMeets += 1;
        else if (item.strength === "strong_preference") counts.strongMeets += 1;
        else counts.preferenceMeets += 1;
      }
      if (assessment.status === "conflicts") {
        if (item.strength === "strong_preference") {
          counts.strongConflicts += 1;
        } else if (item.strength === "preference") {
          counts.preferenceConflicts += 1;
        }
      }
      if (assessment.status === "uncertain") counts.unknowns += 1;
      counts.targetDistance += targetDistance(assessment);
    }
    return counts;
  };
  return [...options.candidates].sort((left, right) => {
    const l = dimensions(left.id);
    const r = dimensions(right.id);
    return (
      l.hardConflicts - r.hardConflicts ||
      r.hardMeets - l.hardMeets ||
      l.strongConflicts - r.strongConflicts ||
      r.strongMeets - l.strongMeets ||
      l.preferenceConflicts - r.preferenceConflicts ||
      r.preferenceMeets - l.preferenceMeets ||
      l.unknowns - r.unknowns ||
      l.targetDistance - r.targetDistance ||
      left.id.localeCompare(right.id)
    );
  });
}
