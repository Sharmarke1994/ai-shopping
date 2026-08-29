import type { BriefItemV1 } from "@/domain/shopping-state/brief";
import type { EvidenceSearchResponse } from "./evidence-search";

export const MAX_PAGE_SOURCES_PER_CANDIDATE = 2;

export type PageSourcePurpose =
  | "official_specification"
  | "real_world_experience"
  | "brand_reputation"
  | "review_evidence"
  | "general_product_detail";

export type PageSourceCandidate = Readonly<
  Pick<
    EvidenceSearchResponse["results"][number],
    "providerResultId" | "rank" | "title" | "url" | "sourceRole"
  >
>;

export type SelectedPageSource = Readonly<{
  providerResultId: string;
  title: string;
  url: string;
  discoveredRole: PageSourceCandidate["sourceRole"];
  purpose: PageSourcePurpose;
  targetCriterionIds: readonly BriefItemV1["criterionId"][];
  selectionReason:
    | "declared_source_role"
    | "candidate_brand_domain"
    | "bounded_general_fallback";
}>;

type EvidenceNeed =
  "specification" | "experience" | "reputation" | "reviews" | "general";

const specificationTerms =
  /\b(?:dimension|dimensions|width|wide|depth|deep|height|tall|size|weight|weighs|material|materials|specification|specifications|capacity|wattage|watts|voltage|official runtime|rated runtime|manufacturer runtime|claimed runtime)\b/i;
const experienceTerms =
  /\b(?:comfort|comfortable|clamp|glasses|noise|noisy|quiet|loud|durability|durable|real[- ]world battery|battery life|battery endurance|performance|espresso quality|coffee quality|taste|tasting|cleaning|clean|suction|handling|ergonomic|ergonomics)\b/i;
const reputationTerms =
  /\b(?:brand reputation|reputable brand|brand reliability|trusted brand|trustworthy brand|manufacturer reputation)\b/i;
const reviewTerms =
  /\b(?:review aggregate|review count|customer reviews?|owner reviews?|user reviews?|star rating|ratings?)\b/i;

const genericCandidateTokens = new Set([
  "and",
  "automatic",
  "battery",
  "chair",
  "cleaner",
  "coffee",
  "cordless",
  "ergonomic",
  "espresso",
  "for",
  "machine",
  "mouse",
  "office",
  "product",
  "the",
  "vacuum",
  "wireless",
  "with",
]);

function normalizedTokens(value: string): readonly string[] {
  return value
    .toLocaleLowerCase("en-GB")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2);
}

function criterionText(item: BriefItemV1): string {
  const value = item.semanticValue;
  const semanticText =
    value.kind === "qualitative"
      ? value.mode === "text"
        ? value.text
        : `${value.relation} ${value.anchor}`
      : value.kind === "categorical"
        ? value.values.join(" ")
        : value.kind === "money_stretch"
          ? value.condition
          : "";
  return `${item.conceptLabel} ${item.conceptDefinition} ${semanticText}`;
}

function needsForCriterion(item: BriefItemV1): readonly EvidenceNeed[] {
  const text = criterionText(item);
  if (reputationTerms.test(text)) return ["reputation"];
  if (reviewTerms.test(text)) return ["reviews"];

  const needs: EvidenceNeed[] = [];
  if (specificationTerms.test(text)) needs.push("specification");
  if (experienceTerms.test(text)) needs.push("experience");
  return needs.length === 0 ? ["general"] : needs;
}

function criterionPriority(strength: BriefItemV1["strength"]): number {
  return strength === "hard" ? 0 : strength === "strong_preference" ? 1 : 2;
}

function normalizedUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    url.hash = "";
    url.hostname = url.hostname.toLocaleLowerCase("en-GB");
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

function candidateBrandTokens(title: string): readonly string[] {
  const tokens = normalizedTokens(title);
  const leading = tokens.findIndex((token) =>
    genericCandidateTokens.has(token),
  );
  const possibleBrand = (
    leading === -1 ? tokens.slice(0, 2) : tokens.slice(0, leading)
  ).filter((token) => !genericCandidateTokens.has(token));
  return possibleBrand.slice(0, 3);
}

function hostCompacted(raw: string): string {
  try {
    const labels = new URL(raw).hostname
      .replace(/^www\./, "")
      .toLocaleLowerCase("en-GB")
      .split(".")
      .filter(Boolean);
    const compoundCountrySuffix =
      labels.length >= 3 &&
      new Set(["ac", "co", "com", "net", "org"]).has(labels.at(-2) ?? "") &&
      (labels.at(-1)?.length ?? 0) === 2;
    return (labels.at(compoundCountrySuffix ? -3 : -2) ?? "").replace(
      /[^a-z0-9]/g,
      "",
    );
  } catch {
    return "";
  }
}

function isPotentialManufacturer(options: {
  candidateTitle: string;
  source: PageSourceCandidate;
}): boolean {
  if (options.source.sourceRole !== "other") return false;
  const registrableLabel = hostCompacted(options.source.url);
  const brand = candidateBrandTokens(options.candidateTitle);
  const brandPrefixes = brand.map((_, index) =>
    brand.slice(0, index + 1).join(""),
  );
  const allowedBrandDomainSuffixes = new Set([
    "",
    "appliances",
    "clean",
    "home",
    "official",
    "store",
  ]);
  return brandPrefixes.some(
    (prefix) =>
      registrableLabel.startsWith(prefix) &&
      allowedBrandDomainSuffixes.has(registrableLabel.slice(prefix.length)),
  );
}

function supportsNeed(options: {
  need: EvidenceNeed;
  candidateTitle: string;
  source: PageSourceCandidate;
}): SelectedPageSource["selectionReason"] | null {
  const { need, source } = options;
  const potentialManufacturer = isPotentialManufacturer(options);
  switch (need) {
    case "specification":
      if (
        source.sourceRole === "manufacturer" ||
        source.sourceRole === "retailer"
      ) {
        return "declared_source_role";
      }
      return potentialManufacturer ? "candidate_brand_domain" : null;
    case "experience":
      return source.sourceRole === "independent_review"
        ? "declared_source_role"
        : null;
    case "reputation":
      // A manufacturer cannot establish its own reputation. A brand-domain
      // `other` result is excluded for the same reason.
      if (source.sourceRole === "manufacturer" || potentialManufacturer)
        return null;
      return source.sourceRole === "independent_review" ||
        source.sourceRole === "retailer_review_aggregate"
        ? "declared_source_role"
        : null;
    case "reviews":
      return source.sourceRole === "retailer_review_aggregate" ||
        source.sourceRole === "independent_review"
        ? "declared_source_role"
        : null;
    case "general":
      if (
        source.sourceRole === "manufacturer" ||
        source.sourceRole === "retailer" ||
        source.sourceRole === "independent_review"
      ) {
        return potentialManufacturer
          ? "candidate_brand_domain"
          : "bounded_general_fallback";
      }
      return potentialManufacturer ? "candidate_brand_domain" : null;
  }
}

function sourceOrder(options: {
  need: EvidenceNeed;
  candidateTitle: string;
  sources: readonly PageSourceCandidate[];
}): readonly PageSourceCandidate[] {
  const roleOrder: readonly PageSourceCandidate["sourceRole"][] =
    options.need === "specification"
      ? ["manufacturer", "other", "retailer"]
      : options.need === "experience"
        ? ["independent_review"]
        : options.need === "reputation"
          ? ["independent_review", "retailer_review_aggregate"]
          : options.need === "reviews"
            ? ["retailer_review_aggregate", "independent_review"]
            : ["manufacturer", "other", "retailer", "independent_review"];

  return [...options.sources].sort((left, right) => {
    const leftRole = roleOrder.indexOf(left.sourceRole);
    const rightRole = roleOrder.indexOf(right.sourceRole);
    const role =
      (leftRole === -1 ? roleOrder.length : leftRole) -
      (rightRole === -1 ? roleOrder.length : rightRole);
    if (role !== 0) return role;
    return (
      left.rank - right.rank ||
      left.providerResultId.localeCompare(right.providerResultId)
    );
  });
}

function purposeForNeed(need: EvidenceNeed): PageSourcePurpose {
  return need === "specification"
    ? "official_specification"
    : need === "experience"
      ? "real_world_experience"
      : need === "reputation"
        ? "brand_reputation"
        : need === "reviews"
          ? "review_evidence"
          : "general_product_detail";
}

/**
 * Selects a tiny complementary page portfolio from already-admitted organic
 * results. This is an acquisition hypothesis only; it never changes shopper
 * criteria and deliberately abstains when the right source role is absent.
 */
export function selectPageSources(options: {
  candidateTitle: string;
  merchant: string | null;
  targetCriteria: readonly BriefItemV1[];
  organicSources: readonly PageSourceCandidate[];
}): readonly SelectedPageSource[] {
  void options.merchant;
  const uniqueSources: PageSourceCandidate[] = [];
  const seenUrls = new Set<string>();
  for (const source of options.organicSources) {
    const url = normalizedUrl(source.url);
    if (url === null || seenUrls.has(url)) continue;
    seenUrls.add(url);
    uniqueSources.push({ ...source, url });
  }

  const criteria = options.targetCriteria
    .map((criterion, ordinal) => ({ criterion, ordinal }))
    .sort(
      (left, right) =>
        criterionPriority(left.criterion.strength) -
          criterionPriority(right.criterion.strength) ||
        left.ordinal - right.ordinal,
    )
    .map(({ criterion }) => criterion);
  const needCriteria = new Map<EvidenceNeed, BriefItemV1["criterionId"][]>();
  for (const criterion of criteria) {
    for (const need of needsForCriterion(criterion)) {
      const current = needCriteria.get(need) ?? [];
      current.push(criterion.criterionId);
      needCriteria.set(need, current);
    }
  }

  const selected: SelectedPageSource[] = [];
  const selectedByUrl = new Map<string, number>();
  for (const [need, criterionIds] of needCriteria) {
    const ordered = sourceOrder({
      need,
      candidateTitle: options.candidateTitle,
      sources: uniqueSources,
    });
    const match = ordered.find(
      (source) =>
        supportsNeed({
          need,
          candidateTitle: options.candidateTitle,
          source,
        }) !== null,
    );
    if (match === undefined) continue;

    const existingIndex = selectedByUrl.get(match.url);
    if (existingIndex !== undefined) {
      const existing = selected[existingIndex]!;
      selected[existingIndex] = {
        ...existing,
        targetCriterionIds: [
          ...new Set([...existing.targetCriterionIds, ...criterionIds]),
        ],
      };
      continue;
    }
    if (selected.length >= MAX_PAGE_SOURCES_PER_CANDIDATE) continue;
    const selectionReason = supportsNeed({
      need,
      candidateTitle: options.candidateTitle,
      source: match,
    });
    if (selectionReason === null) continue;
    selectedByUrl.set(match.url, selected.length);
    selected.push({
      providerResultId: match.providerResultId,
      title: match.title,
      url: match.url,
      discoveredRole: match.sourceRole,
      purpose: purposeForNeed(need),
      targetCriterionIds: criterionIds,
      selectionReason,
    });
  }
  return selected;
}
