import type { PersistedCandidateListing } from "@/features/retrieval-spike/persistence/contracts";
import type { MerchantDestinationResolutionMap } from "./persistence";

export function projectMerchantDestination(options: {
  listing: PersistedCandidateListing;
  resolutions: MerchantDestinationResolutionMap;
}) {
  const resolution = options.resolutions.get(options.listing.id);
  const resolvedDestinationUrl =
    resolution?.status === "resolved" ? resolution.destinationUrl : null;
  const directDestinationUrl =
    resolvedDestinationUrl ?? options.listing.merchantDestinationUrl;
  const destinationUrl = directDestinationUrl ?? options.listing.url;
  const hasSeparateGoogleSource = destinationUrl !== options.listing.url;
  return {
    destinationUrl,
    hasDirectDestination: directDestinationUrl !== null,
    purchaseState:
      directDestinationUrl !== null
        ? ("direct" as const)
        : resolution?.status === "running"
          ? ("checking" as const)
          : ("fallback" as const),
    googleShoppingSourceUrl: hasSeparateGoogleSource
      ? options.listing.url
      : null,
  };
}
