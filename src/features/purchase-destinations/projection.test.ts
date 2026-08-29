import { describe, expect, it } from "vitest";
import { persistedCandidateListingSchema } from "@/features/retrieval-spike/persistence/contracts";
import {
  persistedMerchantDestinationResolutionSchema,
  type MerchantDestinationResolutionMap,
} from "./persistence";
import { projectMerchantDestination } from "./projection";

const listingId = "40000000-0000-4000-8000-000000000004";
const listing = persistedCandidateListingSchema.parse({
  id: listingId,
  queryExecutionId: "50000000-0000-4000-8000-000000000005",
  taskId: "20000000-0000-4000-8000-000000000002",
  runId: "30000000-0000-4000-8000-000000000003",
  queryId: "60000000-0000-4000-8000-000000000006",
  provider: "serper",
  providerResultId: "offer-1",
  sourceRank: 1,
  surface: "shopping",
  title: "Trust Bayo II Ergonomic Wireless Mouse Black",
  url: "https://www.google.co.uk/search?ibp=oshop&q=trust+bayo",
  canonicalUrl: "https://www.google.co.uk/search?ibp=oshop&q=trust+bayo",
  merchantDestinationUrl: "https://www.argos.co.uk/product/original",
  merchantDestinationSource: "shopping_result",
  merchant: "Argos",
  price: { amountMinor: 2599, currency: "GBP" },
  priceText: "£25.99",
  imageUrl: null,
  deliveryText: null,
  availabilityText: null,
  reviewEvidence: null,
  retrievedAt: new Date("2026-08-29T10:00:00.000Z"),
});

function mapWith(
  status: "resolved" | "rejected" | "failed" | "running",
): MerchantDestinationResolutionMap {
  const base = {
    id: "10000000-0000-4000-8000-000000000001",
    taskId: listing.taskId,
    searchRunId: listing.runId,
    candidateListingId: listing.id,
    policyVersion: "exact-offer-merchant-v1",
    provider: "serper" as const,
    queryText: '"Trust Bayo II Ergonomic Wireless Mouse Black" Argos',
    startedAt: new Date("2026-08-29T10:00:01.000Z"),
    createdAt: new Date("2026-08-29T10:00:01.000Z"),
  };
  const resolution = persistedMerchantDestinationResolutionSchema.parse(
    status === "resolved"
      ? {
          ...base,
          status,
          destinationUrl: "https://www.argos.co.uk/product/resolved",
          acceptedResultTitle: "Trust Bayo II Ergonomic Wireless Mouse Black",
          observedResultUrl: null,
          outcomeCode: null,
          consideredResultCount: 1,
          leaseToken: null,
          leaseExpiresAt: null,
          finishedAt: new Date("2026-08-29T10:00:02.000Z"),
        }
      : status === "running"
        ? {
            ...base,
            status,
            destinationUrl: null,
            acceptedResultTitle: null,
            observedResultUrl: null,
            outcomeCode: null,
            consideredResultCount: null,
            leaseToken: "70000000-0000-4000-8000-000000000007",
            leaseExpiresAt: new Date("2026-08-29T10:01:01.000Z"),
            finishedAt: null,
          }
        : {
            ...base,
            status,
            destinationUrl: null,
            acceptedResultTitle: null,
            observedResultUrl: null,
            outcomeCode:
              status === "rejected" ? "variant_mismatch" : "provider_failed",
            consideredResultCount: status === "rejected" ? 1 : null,
            leaseToken: null,
            leaseExpiresAt: null,
            finishedAt: new Date("2026-08-29T10:00:02.000Z"),
          },
  );
  return new Map([[listing.id, resolution]]);
}

describe("merchant destination projection", () => {
  it("orders accepted resolution above the immutable original direct URL", () => {
    expect(
      projectMerchantDestination({ listing, resolutions: mapWith("resolved") }),
    ).toEqual({
      destinationUrl: "https://www.argos.co.uk/product/resolved",
      hasDirectDestination: true,
      purchaseState: "direct",
      googleShoppingSourceUrl: listing.url,
    });
  });

  it.each(["running", "rejected", "failed"] as const)(
    "keeps the original direct URL for a %s receipt",
    (status) => {
      expect(
        projectMerchantDestination({ listing, resolutions: mapWith(status) }),
      ).toEqual({
        destinationUrl: "https://www.argos.co.uk/product/original",
        hasDirectDestination: true,
        purchaseState: "direct",
        googleShoppingSourceUrl: listing.url,
      });
    },
  );

  it("keeps Google Shopping usable while checking or after a closed failure", () => {
    const fallbackListing = persistedCandidateListingSchema.parse({
      ...listing,
      merchantDestinationUrl: null,
      merchantDestinationSource: null,
    });
    for (const status of ["running", "rejected", "failed"] as const) {
      expect(
        projectMerchantDestination({
          listing: fallbackListing,
          resolutions: mapWith(status),
        }),
      ).toEqual({
        destinationUrl: fallbackListing.url,
        hasDirectDestination: false,
        purchaseState: status === "running" ? "checking" : "fallback",
        googleShoppingSourceUrl: null,
      });
    }
  });
});
