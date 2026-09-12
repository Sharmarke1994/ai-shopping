import type { BriefItemV1 } from "@/domain/shopping-state/brief";
import type {
  GuardedAssessment,
  ObservationWithSource,
  ProposedCriterionAssessment,
} from "./assessment-policy";

// Deliberately limited to sustained comfort, not a general experiential classifier.
function experience(text: string): "positive" | "negative" | null {
  const sentences = text.toLowerCase().split(/[.!?\n]+/);
  const signs = new Set<string>();
  for (const sentence of sentences) {
    if (
      !/\b(?:hours?|workdays?|working days?|full days?|all.day|extended (?:use|sessions?)|longer sessions?|prolonged use|long sessions?)\b/.test(
        sentence,
      )
    )
      continue;
    if (
      /\b(?:designed|design|promises?|intended|aims?|may|might|could)\b/.test(
        sentence,
      )
    )
      continue;
    if (
      !/\b(?:reviewer|used|use|found|experienced|remained|throughout|during|after|over|through)\b/.test(
        sentence,
      )
    )
      continue;
    const withoutFatigue = sentence.replace(
      /\b(?:no|without) (?:\w+ ){0,2}(?:fatigue|discomfort|pain)\b/g,
      " comfortable ",
    );
    // Do not reinterpret hedged or complex negation as positive experience.
    if (
      /\b(?:no evidence|never|neither|did not|didn't|wasn't|isn't|not necessarily)\b/.test(
        withoutFatigue,
      )
    )
      continue;
    if (
      /\b(?:uncomfortable|fatigue|discomfort|pain|not comfortable|not supportive)\b/.test(
        withoutFatigue,
      )
    )
      signs.add("negative");
    else if (
      /\b(?:comfortable|comfort|supportive|sustained (?:palm|wrist|lumbar) support)\b/.test(
        withoutFatigue,
      )
    )
      signs.add("positive");
  }
  return signs.size === 1 ? ([...signs][0] as "positive" | "negative") : null;
}

export function experientialComfortAssessment(options: {
  item: BriefItemV1;
  observations: readonly ObservationWithSource[];
  proposal: ProposedCriterionAssessment | null;
}): GuardedAssessment | null {
  const criterionText = `${options.item.conceptLabel} ${options.item.conceptDefinition} ${options.item.semanticValue.kind === "qualitative" ? JSON.stringify(options.item.semanticValue) : ""}`;
  if (
    !/comfort|long session|long workday/i.test(criterionText) ||
    !/long[ -](?:work|session)|extended|all[ -]day|full[ -](?:work)?day|hours|sustained/i.test(
      criterionText,
    )
  )
    return null;
  const eligible = options.observations.flatMap(({ observation, source }) => {
    if (
      observation.conceptId !== options.item.conceptId ||
      observation.support !== "supported" ||
      observation.observationKind !== "source_assertion" ||
      source.sourceKind !== "fetched_page" ||
      !["independent_review", "retailer_review_aggregate"].includes(
        source.sourceRole,
      )
    )
      return [];
    const sign = experience(observation.claim);
    // A generated claim cannot supply experiential meaning missing from its source.
    return sign !== null && sign === experience(source.excerpt ?? "")
      ? [{ observation, source, sign }]
      : [];
  });
  const ids = eligible.map(({ observation }) => observation.id);
  const result = (
    status: GuardedAssessment["status"],
    relation: string,
    explanation: string,
  ): GuardedAssessment => ({
    status,
    relation,
    explanation,
    method: "guarded_model",
    observationIds: ids,
  });
  if (
    new Set(eligible.map(({ sign }) => sign)).size > 1 &&
    new Set(eligible.map(({ source }) => source.id)).size > 1
  )
    return result(
      "uncertain",
      "source_disagreement",
      "Exact experiential reviews disagree about sustained comfort, so this remains unresolved.",
    );
  if (options.item.strength === "hard")
    return result(
      "uncertain",
      "personal_fit_unresolved",
      "Another person's extended-use experience cannot establish your own all-day comfort. Individual fit needs verification.",
    );
  const proposed = new Set(
    options.proposal?.observations.map(({ observation }) => observation.id) ??
      [],
  );
  const sign =
    options.proposal?.status === "meets"
      ? "positive"
      : options.proposal?.status === "conflicts"
        ? "negative"
        : null;
  if (
    sign !== null &&
    eligible.some(
      ({ observation, sign: actual }) =>
        proposed.has(observation.id) && actual === sign,
    )
  )
    return result(
      sign === "positive" ? "meets" : "conflicts",
      "extended_use_evidence",
      sign === "positive"
        ? "An experiential review reports sustained comfort during extended use. Individual fit can still vary."
        : "An experiential review reports discomfort during extended use. Individual fit can still vary.",
    );
  return result(
    "uncertain",
    "insufficient_relevant_evidence",
    "Long-session comfort needs exact experiential review evidence; design claims alone do not establish it.",
  );
}
