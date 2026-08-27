import type {
  BriefItemV1,
  ShoppingBriefV1,
} from "@/domain/shopping-state/brief";
import type { CandidateListing } from "@/features/retrieval-spike/contracts";

export type HardCriterionTriage = Readonly<{
  criterionId: string;
  state: "meets" | "conflicts" | "unknown";
  reason:
    | "observed_price"
    | "explicit_exclusion"
    | "explicit_categorical_contradiction"
    | "not_directly_comparable";
}>;

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("en-GB").replace(/\s+/g, " ");
}

function hasExplicitPhrase(observedText: string, phrase: string) {
  const tokens = normalized(phrase)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (tokens.length === 0) return false;
  return new RegExp(
    `(^|[^a-z0-9])${tokens.join("[^a-z0-9]*")}($|[^a-z0-9])`,
    "i",
  ).test(observedText);
}

function triageHardCriterion(
  item: BriefItemV1,
  listing: CandidateListing,
): HardCriterionTriage {
  const value = item.semanticValue;
  if (value.kind === "money" && value.mode === "ceiling") {
    if (listing.price === null) {
      return {
        criterionId: item.criterionId,
        state: "unknown",
        reason: "not_directly_comparable",
      };
    }
    return {
      criterionId: item.criterionId,
      state:
        listing.price.amountMinor <= value.amountMinor ? "meets" : "conflicts",
      reason: "observed_price",
    };
  }
  if (value.kind === "categorical" && value.operator === "exclude") {
    const observedText = normalized(
      [listing.title, listing.merchant].filter(Boolean).join(" "),
    );
    const excluded = value.values.some((entry) =>
      hasExplicitPhrase(observedText, entry),
    );
    return {
      criterionId: item.criterionId,
      state: excluded ? "conflicts" : "unknown",
      reason: excluded ? "explicit_exclusion" : "not_directly_comparable",
    };
  }
  const wirelessBoolean =
    value.kind === "boolean"
      ? value.value
      : value.kind === "categorical" &&
          value.operator === "include" &&
          value.values.length === 1
        ? normalized(value.values[0]!) === "yes"
          ? true
          : normalized(value.values[0]!) === "no"
            ? false
            : null
        : null;
  if (
    wirelessBoolean !== null &&
    normalized(item.conceptLabel).includes("wireless")
  ) {
    const observedTitle = normalized(listing.title);
    const explicitlyWired = hasExplicitPhrase(observedTitle, "wired");
    const explicitlyWireless = hasExplicitPhrase(observedTitle, "wireless");
    const conflicts =
      (wirelessBoolean && explicitlyWired && !explicitlyWireless) ||
      (!wirelessBoolean && explicitlyWireless);
    return {
      criterionId: item.criterionId,
      state: conflicts ? "conflicts" : "unknown",
      reason: conflicts
        ? "explicit_categorical_contradiction"
        : "not_directly_comparable",
    };
  }
  return {
    criterionId: item.criterionId,
    state: "unknown",
    reason: "not_directly_comparable",
  };
}

export function triageListingAgainstHardCriteria(options: {
  brief: ShoppingBriefV1;
  listing: CandidateListing;
}) {
  const criteria = options.brief.items
    .filter(({ strength }) => strength === "hard")
    .map((item) => triageHardCriterion(item, options.listing));
  return {
    criteria,
    hasDirectConflict: criteria.some(({ state }) => state === "conflicts"),
  };
}
