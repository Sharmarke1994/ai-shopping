import { describe, expect, it } from "vitest";
import { evidenceSearchResultSchema } from "./evidence-search";
import { isCandidateEvidenceRelevant } from "./evidence-relevance";

function result(title: string, url = "https://example.test/product") {
  return evidenceSearchResultSchema.parse({
    providerResultId: title,
    rank: 1,
    title,
    url,
    snippet: null,
    sourceRole: "other",
  });
}

const candidateTitle = "Logitech MX Master 3S Wireless Mouse";

describe("candidate evidence relevance", () => {
  it("accepts exact, manufacturer and independent-review identity matches", () => {
    for (const candidate of [
      result(
        "Logitech MX Master 3S Wireless Mouse | Logitech",
        "https://www.logitech.com/en-gb/products/mice/mx-master-3s.910-006559.html",
      ),
      result(
        "MX Master 3S Wireless Mouse review",
        "https://www.rtings.com/mouse/reviews/logitech/mx-master-3s",
      ),
      result(
        "Logitech MX Master 3S Wireless Mouse",
        "https://www.example.co.uk/logitech-mx-master-3s",
      ),
    ]) {
      expect(
        isCandidateEvidenceRelevant({
          candidateTitle,
          merchant: "Logitech",
          result: candidate,
        }),
      ).toBe(true);
    }
  });

  it("rejects the observed B&Q phone-case result", () => {
    expect(
      isCandidateEvidenceRelevant({
        candidateTitle: "Ergonomic Usb Wireless Mouse",
        merchant: "Amazon",
        result: result(
          "Phone cases | Mobile accessories - B&Q",
          "https://www.diy.com/departments/technology/mobile-accessories/phone-cases/DIY123456.cat",
        ),
      }),
    ).toBe(false);
  });

  it("rejects search/category pages even when the title matches", () => {
    expect(
      isCandidateEvidenceRelevant({
        candidateTitle,
        merchant: "Logitech",
        result: result(
          "Logitech MX Master 3S Wireless Mouse",
          "https://www.logitech.com/en-gb/search?q=mx%20master%203s",
        ),
      }),
    ).toBe(false);
  });

  it("rejects a related category with a different named model", () => {
    expect(
      isCandidateEvidenceRelevant({
        candidateTitle,
        merchant: "Logitech",
        result: result(
          "Logitech M720 Triathlon Wireless Mouse review",
          "https://www.example.co.uk/logitech-m720-triathlon",
        ),
      }),
    ).toBe(false);
  });

  it("rejects a same-brand different model and comparison page", () => {
    expect(
      isCandidateEvidenceRelevant({
        candidateTitle: "Trust Bayo II Ergonomic Wireless Mouse",
        merchant: "Argos",
        result: result(
          "Trust GXT926 Redex II Wireless RGB Gaming Mouse",
          "https://www.example.co.uk/trust-gxt926-redex-ii",
        ),
      }),
    ).toBe(false);
    expect(
      isCandidateEvidenceRelevant({
        candidateTitle: "Trust Bayo II Ergonomic Wireless Mouse",
        merchant: "Argos",
        result: result(
          "Trust Bayo+ Multidevice Ergonomic Wireless Mouse vs Bayo II",
          "https://e-catalog.co.uk/cmp/143184/bayoplus-vs-bayo-ii/",
        ),
      }),
    ).toBe(false);
  });

  it("abstains when the candidate title is too generic to identify", () => {
    expect(
      isCandidateEvidenceRelevant({
        candidateTitle: "Ergonomic Usb Wireless Mouse",
        merchant: "Amazon",
        result: result(
          "Logitech MX Master 3S Wireless Mouse review",
          "https://www.rtings.com/mouse/reviews/logitech/mx-master-3s",
        ),
      }),
    ).toBe(false);
  });
});
