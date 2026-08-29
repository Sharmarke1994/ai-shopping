import { describe, expect, it } from "vitest";
import {
  buildExactOfferMerchantQuery,
  evaluateExactOfferMerchantDestination,
  isGoogleOwnedUrl,
  observedMerchantDestinationUrl,
  verifyOrganicMerchantDestination,
} from "./exact-offer-policy";

describe("exact-offer merchant destination policy", () => {
  it.each([
    {
      candidateTitle: "Trust Bayo II Ergonomic Wireless Mouse Black",
      merchant: "Argos",
      resultTitle: "Buy Trust Bayo II Ergonomic Wireless Mouse Black at Argos",
      resultUrl:
        "https://www.argos.co.uk/product/6827043?srsltid=tracking#reviews",
      expected: "https://www.argos.co.uk/product/6827043",
    },
    {
      candidateTitle: "Herman Miller Aeron Office Chair Size B Graphite",
      merchant: "John Lewis & Partners",
      resultTitle:
        "Herman Miller Aeron Office Chair Size B Graphite at John Lewis & Partners",
      resultUrl: "https://www.johnlewis.com/herman-miller-aeron/p12345",
      expected: "https://www.johnlewis.com/herman-miller-aeron/p12345",
    },
    {
      candidateTitle: "DeLonghi Dedica EC685M Coffee Machine Silver",
      merchant: "Currys",
      resultTitle: "Buy DeLonghi Dedica EC685M Coffee Machine Silver - Currys",
      resultUrl:
        "https://www.currys.co.uk/products/delonghi-dedica-ec685m.html",
      expected: "https://www.currys.co.uk/products/delonghi-dedica-ec685m.html",
    },
    {
      candidateTitle: "Dyson V8 Absolute Cordless Vacuum",
      merchant: "AO.com",
      resultTitle: "Dyson V8 Absolute Cordless Vacuum at AO.com",
      resultUrl: "https://ao.com/product/v8absolute-dyson-vacuum-cleaner",
      expected: "https://ao.com/product/v8absolute-dyson-vacuum-cleaner",
    },
  ])(
    "accepts the exact same $merchant offer without category-specific rules",
    ({ expected, ...candidate }) => {
      expect(verifyOrganicMerchantDestination(candidate)).toBe(expected);
    },
  );

  it.each([
    {
      name: "different merchant",
      resultTitle: "Sony WH1000XM5 Wireless Headphones Black",
      resultUrl: "https://www.amazon.co.uk/dp/example",
      rejectionCode: "merchant_mismatch",
    },
    {
      name: "manufacturer page",
      resultTitle: "Sony WH1000XM5 Wireless Headphones Black",
      resultUrl: "https://www.sony.co.uk/headphones/wh1000xm5",
      rejectionCode: "merchant_mismatch",
    },
    {
      name: "review page",
      resultTitle: "Sony WH1000XM5 Wireless Headphones Black",
      resultUrl: "https://www.argos.co.uk/reviews/wh1000xm5",
      rejectionCode: "non_product_page",
    },
    {
      name: "category page",
      resultTitle: "Sony WH1000XM5 Wireless Headphones Black",
      resultUrl: "https://www.argos.co.uk/category/headphones",
      rejectionCode: "non_product_page",
    },
    {
      name: "homepage",
      resultTitle: "Sony WH1000XM5 Wireless Headphones Black",
      resultUrl: "https://www.argos.co.uk/",
      rejectionCode: "non_product_page",
    },
    {
      name: "variant mismatch",
      resultTitle: "Sony WH1000XM4 Wireless Headphones Black",
      resultUrl: "https://www.argos.co.uk/product/123",
      rejectionCode: "variant_mismatch",
    },
    {
      name: "merchant-name subdomain on another site",
      resultTitle: "Sony WH1000XM5 Wireless Headphones Black",
      resultUrl: "https://argos.evil.example/product/123",
      rejectionCode: "merchant_mismatch",
    },
  ])("fails closed for a $name", ({ rejectionCode, ...result }) => {
    expect(
      evaluateExactOfferMerchantDestination({
        candidateTitle: "Sony WH1000XM5 Wireless Headphones Black",
        merchant: "Argos",
        ...result,
      }),
    ).toEqual({ accepted: false, rejectionCode });
  });

  it("does not turn an ambiguous manufacturer-brand page into a purchase CTA", () => {
    expect(
      evaluateExactOfferMerchantDestination({
        candidateTitle: "Dyson V8 Absolute Cordless Vacuum",
        merchant: "Dyson",
        resultTitle: "Dyson V8 Absolute Cordless Vacuum | Dyson",
        resultUrl: "https://www.dyson.co.uk/vacuum-cleaners/v8/absolute",
      }),
    ).toEqual({
      accepted: false,
      rejectionCode: "merchant_brand_ambiguity",
    });
  });

  it("rejects a generic listing when the result adds an unproved brand or variant", () => {
    expect(
      evaluateExactOfferMerchantDestination({
        candidateTitle: "Ergonomic 2.4G Wireless Mouse",
        merchant: "Amazon.co.uk - Amazon.co.uk-Seller",
        resultTitle:
          "Phefop Portable Ergonomic 2.4G Wireless Mouse Rechargeable",
        resultUrl: "https://www.amazon.co.uk/dp/example",
      }),
    ).toEqual({ accepted: false, rejectionCode: "title_mismatch" });
  });

  it("recognises real Google-owned fallback hosts without trusting lookalikes", () => {
    expect(
      isGoogleOwnedUrl(
        "https://www.google.co.uk/search?ibp=oshop&q=coffee-machine",
      ),
    ).toBe(true);
    expect(
      isGoogleOwnedUrl("https://shopping.googleusercontent.com/offer/123"),
    ).toBe(true);
    expect(isGoogleOwnedUrl("https://google.evil.example/offer/123")).toBe(
      false,
    );
    expect(
      observedMerchantDestinationUrl("https://google.evil.example/offer/123"),
    ).toBe("https://google.evil.example/offer/123");
  });

  it("builds one bounded exact-title plus same-merchant query", () => {
    expect(
      buildExactOfferMerchantQuery({
        title: 'Trust "Bayo" II Ergonomic Wireless Mouse',
        merchant: "Argos",
      }),
    ).toBe('"Trust Bayo II Ergonomic Wireless Mouse" Argos');
  });
});
