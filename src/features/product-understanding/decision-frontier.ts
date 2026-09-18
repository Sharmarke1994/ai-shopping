import type { BriefItemV1 } from "@/domain/shopping-state/brief";
import type { CriterionAssessmentV1 } from "./contracts";
import type {
  CurrentDecision,
  DecisionSupportCandidate,
} from "./decision-support";
import { isPurchasePriceCriterion } from "./assessment-policy";
import {
  decisionFrontierSchema,
  type DecisionFrontier,
  type FrontierBasis,
} from "./decision-frontier-contract";

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}

function basis(
  item: BriefItemV1,
  assessment: CriterionAssessmentV1,
): FrontierBasis {
  return {
    criterionId: item.criterionId,
    label: item.conceptLabel,
    strength: item.strength,
    candidateListingId: assessment.candidateListingId,
    assessmentId: assessment.id,
    observationIds: [...assessment.observationIds],
    explanation: assessment.explanation,
  };
}

/** Enrich a qualified decision; do not change ordering, eligibility or authority. */
export function deriveDecisionFrontier(options: {
  decision: Omit<CurrentDecision, "frontier">;
  items: readonly BriefItemV1[];
  candidates: readonly DecisionSupportCandidate[];
  assessments: readonly CriterionAssessmentV1[];
}): DecisionFrontier | null {
  if (
    !["ready_to_choose", "leader_with_tradeoff"].includes(
      options.decision.state,
    )
  )
    return null;
  const leader = options.candidates.find(
    (c) => c.listing.id === options.decision.leadingCandidateListingId,
  );
  if (!leader || !["qualified", "trade_off"].includes(leader.readiness))
    return null;
  const items = [...options.items].sort(
    (a, b) =>
      ({ hard: 0, strong_preference: 1, preference: 2 })[a.strength] -
      { hard: 0, strong_preference: 1, preference: 2 }[b.strength],
  );
  const assessment = (candidate: DecisionSupportCandidate, item: BriefItemV1) =>
    options.assessments.find(
      (a) =>
        a.taskId === candidate.listing.taskId &&
        a.candidateListingId === candidate.listing.id &&
        a.criterionId === item.criterionId,
    );

  // Candidates have already passed current-revision, rejection, exact-offer and
  // hard-ceiling guards. Search the bounded eligible pool, not merely rank two.
  for (const candidate of options.candidates) {
    if (
      candidate.listing.id === leader.listing.id ||
      !["qualified", "trade_off"].includes(candidate.readiness)
    )
      continue;
    if (
      items.some(
        (item) =>
          item.strength === "hard" &&
          assessment(candidate, item)?.status !== "meets",
      )
    )
      continue;
    const leaderAdvantages: FrontierBasis[] = [];
    const alternativeAdvantages: FrontierBasis[] = [];
    let price: DecisionFrontier["money"] = null;
    for (const item of items) {
      const left = assessment(leader, item);
      const right = assessment(candidate, item);
      if (!left || !right) continue;
      if (isPurchasePriceCriterion(item)) {
        const value = item.semanticValue;
        const a = leader.listing.price;
        const b = candidate.listing.price;
        // No tolerance band, no cheaper-is-better under a ceiling, and no
        // inventing savings from formatted price strings or another currency.
        if (
          price === null &&
          value.kind === "money_stretch" &&
          a &&
          b &&
          a.currency === value.currency &&
          b.currency === value.currency &&
          a.amountMinor > value.targetMinor &&
          a.amountMinor <= value.stretchCeilingMinor &&
          b.amountMinor <= value.targetMinor &&
          left.status === "meets" &&
          left.relation === "conditional_stretch_supported" &&
          left.observationIds.length > 0 &&
          right.observationIds.length > 0 &&
          ((b.amountMinor === value.targetMinor &&
            right.status === "meets" &&
            right.relation === "target_exact") ||
            (b.amountMinor < value.targetMinor &&
              right.status === "uncertain" &&
              right.relation ===
                `target_distance_minor:${b.amountMinor - value.targetMinor}`))
        ) {
          price = {
            currency: value.currency,
            targetMinor: value.targetMinor,
            leaderAmountMinor: a.amountMinor,
            alternativeAmountMinor: b.amountMinor,
            savingMinor: a.amountMinor - b.amountMinor,
            belowTargetMinor: value.targetMinor - b.amountMinor,
          };
          alternativeAdvantages.unshift(basis(item, right));
        }
        continue;
      }
      if (
        /\b(?:reviews?|ratings?|popular|popularity)\b/i.test(
          `${item.conceptLabel} ${item.conceptDefinition}`,
        )
      )
        continue;
      if (
        left.status === "meets" &&
        left.observationIds.length > 0 &&
        ["uncertain", "conflicts"].includes(right.status)
      )
        leaderAdvantages.push(basis(item, left));
      if (
        right.status === "meets" &&
        right.observationIds.length > 0 &&
        ["uncertain", "conflicts"].includes(left.status)
      )
        alternativeAdvantages.push(basis(item, right));
    }
    if (!leaderAdvantages.length || !alternativeAdvantages.length) continue;
    const benefit = leaderAdvantages[0]!.label.toLocaleLowerCase("en-GB");
    const direction =
      alternativeAdvantages[0]!.label.toLocaleLowerCase("en-GB");
    const giveUp = `The recommendation has stronger evidence for ${benefit}. This is a difference in support, not proof that the alternative performs worse.`;
    const summary = price
      ? `This option ${price.belowTargetMinor === 0 ? "matches" : `is ${money(price.belowTargetMinor, price.currency)} below`} your ${money(price.targetMinor, price.currency)} target and saves ${money(price.savingMinor, price.currency)} versus the recommendation, if stronger ${benefit} evidence is not worth stretching for.`
      : `Consider this option if ${direction} matters more to you than the recommendation’s stronger ${benefit} evidence.`;
    const frontier = decisionFrontierSchema.safeParse({
      kind: "eligible_alternative",
      candidateListingId: candidate.listing.id,
      title: candidate.listing.title,
      summary,
      giveUp,
      leaderAdvantages: leaderAdvantages.slice(0, 2),
      alternativeAdvantages: alternativeAdvantages.slice(0, 2),
      money: price,
    });
    // Optional enrichment must never make the qualified decision unavailable.
    if (frontier.success) return frontier.data;
  }
  return null;
}
