import { describe, expect, it } from "vitest";
import { candidateListingIdSchema } from "@/domain/shopping-state/ids";
import { projectCurrentDecisionPurchase } from "./application";
import type { LiveShoppingView } from "./contracts";

const candidateListingId = candidateListingIdSchema.parse(
  "a83fb91c-29d6-4d6c-b5e6-53fa06c4d1b9",
);

function leader(
  purchaseState: "direct" | "checking" | "fallback",
): LiveShoppingView["savedListings"][number] {
  return {
    candidateListingId,
    displayId: "decision-leader",
    title: "Evidence-backed leader",
    merchant: "Example Retailer",
    priceText: "£49.99",
    imageUrl: null,
    destinationUrl:
      purchaseState === "direct"
        ? "https://retailer.example/product"
        : "https://google.example/shopping/product",
    destinationLabel:
      purchaseState === "direct"
        ? "View at Example Retailer"
        : "View on Google Shopping",
    purchaseState,
    sourceUrl: null,
    sourceLabel: null,
    deliveryText: null,
    availabilityText: null,
    foundAcrossQueries: 2,
    evidence: {
      sourceFacts: [],
      directlyEvidenced: [],
      contradictions: [],
      unverifiedLabels: [],
      additionalUnverifiedCount: 0,
    },
    saved: false,
    rejected: false,
  };
}

describe("Current Decision purchase projection", () => {
  it("promotes a verified direct destination for a ready decision", () => {
    expect(
      projectCurrentDecisionPurchase({
        recommendationLevel: "ready",
        leader: leader("direct"),
      }),
    ).toEqual({
      candidateListingId,
      state: "direct",
      destinationUrl: "https://retailer.example/product",
      label: "Buy from Example Retailer",
      priceText: "£49.99",
      merchant: "Example Retailer",
    });
  });

  it("labels fallback purchase paths honestly", () => {
    expect(
      projectCurrentDecisionPurchase({
        recommendationLevel: "ready",
        leader: leader("fallback"),
      }),
    ).toMatchObject({
      state: "fallback",
      destinationUrl: "https://google.example/shopping/product",
      label: "Check current offers",
    });
  });

  it("does not delay a ready decision while exact destination resolution is checking", () => {
    expect(
      projectCurrentDecisionPurchase({
        recommendationLevel: "ready",
        leader: leader("checking"),
      }),
    ).toMatchObject({
      state: "checking",
      label: "Check current offers",
    });
  });

  it("withholds every purchase CTA from provisional or no-recommendation states", () => {
    expect(
      projectCurrentDecisionPurchase({
        recommendationLevel: "provisional",
        leader: leader("direct"),
      }),
    ).toBeNull();
    expect(
      projectCurrentDecisionPurchase({
        recommendationLevel: "none",
        leader: leader("direct"),
      }),
    ).toBeNull();
  });
});
