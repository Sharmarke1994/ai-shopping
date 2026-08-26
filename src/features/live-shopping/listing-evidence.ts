import type {
  BriefItemV1,
  ShoppingBriefV1,
} from "@/domain/shopping-state/brief";
import type { CandidateListing } from "@/features/retrieval-spike/contracts";
import { triageListingAgainstHardCriteria } from "./hard-constraint-triage";

export type ListingEvidenceSummary = Readonly<{
  directlyEvidenced: readonly string[];
  contradictions: readonly string[];
  unverifiedLabels: readonly string[];
  additionalUnverifiedCount: number;
  hasDirectNonPriceSupport: boolean;
}>;

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("en-GB").replace(/\s+/g, " ");
}

function hasWord(value: string, word: string) {
  return new RegExp(`(^|[^a-z0-9])${word}($|[^a-z0-9])`, "i").test(value);
}

function observedMoney(item: BriefItemV1, listing: CandidateListing) {
  if (
    item.semanticValue.kind !== "money" ||
    item.semanticValue.mode !== "ceiling" ||
    listing.price === null ||
    listing.price.currency !== item.semanticValue.currency ||
    listing.price.amountMinor > item.semanticValue.amountMinor
  ) {
    return null;
  }
  const observed = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: listing.price.currency,
    maximumFractionDigits: listing.price.amountMinor % 100 === 0 ? 0 : 2,
  }).format(listing.price.amountMinor / 100);
  const ceiling = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: item.semanticValue.currency,
    maximumFractionDigits: item.semanticValue.amountMinor % 100 === 0 ? 0 : 2,
  }).format(item.semanticValue.amountMinor / 100);
  return `${observed} is within your ${ceiling} maximum`;
}

function observedWireless(item: BriefItemV1, listing: CandidateListing) {
  if (
    item.semanticValue.kind !== "boolean" ||
    !item.semanticValue.value ||
    !normalized(item.conceptLabel).includes("wireless") ||
    !hasWord(normalized(listing.title), "wireless")
  ) {
    return null;
  }
  return "Listing title says wireless";
}

function uniqueLabels(items: readonly BriefItemV1[]) {
  return [...new Set(items.map(({ conceptLabel }) => conceptLabel))];
}

/**
 * Produces a small, view-only assessment from persisted listing fields. It does
 * not create product truth: unsupported criteria stay explicitly unverified.
 */
export function summarizeListingEvidence(options: {
  brief: ShoppingBriefV1;
  listing: CandidateListing;
}): ListingEvidenceSummary {
  const triage = triageListingAgainstHardCriteria(options);
  const criteriaById = new Map<string, BriefItemV1>(
    options.brief.items.map((item) => [item.criterionId, item]),
  );
  const contradictions = triage.criteria
    .filter(({ state }) => state === "conflicts")
    .map((assessment) => {
      const item = criteriaById.get(assessment.criterionId);
      if (assessment.reason === "observed_price") {
        return `Observed price is above your ${item?.conceptLabel.toLocaleLowerCase("en-GB") ?? "limit"}`;
      }
      if (assessment.reason === "explicit_exclusion") {
        return `Listing names an excluded ${item?.conceptLabel.toLocaleLowerCase("en-GB") ?? "option"}`;
      }
      return "Listing title contradicts a must-have";
    });

  const directlyEvidenced: string[] = [];
  const supportedCriterionIds = new Set<string>();
  let hasDirectNonPriceSupport = false;
  for (const item of options.brief.items) {
    const money = observedMoney(item, options.listing);
    const wireless = observedWireless(item, options.listing);
    const detail = money ?? wireless;
    if (detail === null) continue;
    directlyEvidenced.push(detail);
    supportedCriterionIds.add(item.criterionId);
    if (wireless !== null) hasDirectNonPriceSupport = true;
  }

  const strengthOrder = {
    hard: 0,
    strong_preference: 1,
    preference: 2,
  } as const;
  const unverified = uniqueLabels(
    options.brief.items
      .filter(
        (item) =>
          !supportedCriterionIds.has(item.criterionId) &&
          !(
            item.semanticValue.kind === "categorical" &&
            item.semanticValue.operator === "exclude"
          ),
      )
      .sort(
        (left, right) =>
          strengthOrder[left.strength] - strengthOrder[right.strength],
      ),
  );
  const unverifiedLabels = unverified.slice(0, 3);
  return {
    directlyEvidenced,
    contradictions,
    unverifiedLabels,
    additionalUnverifiedCount: unverified.length - unverifiedLabels.length,
    hasDirectNonPriceSupport,
  };
}
