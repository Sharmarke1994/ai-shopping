import { describe, expect, it } from "vitest";
import {
  admitFetchedPageEvidence,
  type DiscoveredPageSource,
  type ExtractedPageIdentity,
  type ExtractedPageIdentityProduct,
} from "./page-evidence-admission";

function product(
  productName: string,
  overrides: Partial<ExtractedPageIdentityProduct> = {},
): ExtractedPageIdentityProduct {
  return {
    productName,
    brand: null,
    model: null,
    sku: null,
    mpn: null,
    ...overrides,
  };
}

function discovered(
  title: string,
  url: string,
  sourceRole: DiscoveredPageSource["sourceRole"] = "other",
): DiscoveredPageSource {
  return { title, url, sourceRole };
}

function page(
  title: string | null,
  finalUrl: string,
  products: readonly ExtractedPageIdentityProduct[] = [],
  overrides: Partial<ExtractedPageIdentity> = {},
): ExtractedPageIdentity {
  return {
    finalUrl,
    canonicalUrl: finalUrl,
    title,
    openGraphTitle: title,
    products,
    ...overrides,
  };
}

describe("fetched-page evidence admission", () => {
  it("promotes an exact mouse brand page only with coherent host and explicit Product.brand", () => {
    const accepted = admitFetchedPageEvidence({
      candidateTitle: "Logitech MX Master 3S Wireless Mouse",
      merchant: "Currys",
      discovered: discovered(
        "Logitech MX Master 3S Wireless Mouse",
        "https://www.logitech.com/en-gb/products/mice/mx-master-3s.html",
      ),
      page: page(
        "Logitech MX Master 3S Wireless Mouse",
        "https://www.logitech.com/en-gb/products/mice/mx-master-3s.html",
        [
          product("MX Master 3S Wireless Mouse", {
            brand: "Logitech",
            model: "MX Master 3S",
            sku: "910-006559",
          }),
        ],
      ),
    });
    expect(accepted).toMatchObject({
      decision: "admit",
      admittedRole: "manufacturer",
      reason: "exact_page_identity_with_manufacturer_promotion",
      identityEvidence: {
        brand: "Logitech",
        model: "MX Master 3S",
      },
    });

    const selfDescribedWrongBrand = admitFetchedPageEvidence({
      candidateTitle: "Logitech MX Master 3S Wireless Mouse",
      merchant: "Currys",
      discovered: discovered(
        "Logitech MX Master 3S Wireless Mouse",
        "https://www.logitech.com/en-gb/products/mice/mx-master-3s.html",
      ),
      page: page(
        "Logitech MX Master 3S Wireless Mouse",
        "https://www.logitech.com/en-gb/products/mice/mx-master-3s.html",
        [product("Logitech MX Master 3S Wireless Mouse", { brand: "Acme" })],
      ),
    });
    expect(selfDescribedWrongBrand).toMatchObject({
      decision: "reject",
      reason: "unsupported_source_role",
    });

    const lookalikeDomain = admitFetchedPageEvidence({
      candidateTitle: "Logitech MX Master 3S Wireless Mouse",
      merchant: "Currys",
      discovered: discovered(
        "Logitech MX Master 3S Wireless Mouse",
        "https://logitech-reviews.example/mx-master-3s",
      ),
      page: page(
        "Logitech MX Master 3S Wireless Mouse",
        "https://logitech-reviews.example/mx-master-3s",
        [
          product("Logitech MX Master 3S Wireless Mouse", {
            brand: "Logitech",
          }),
        ],
      ),
    });
    expect(lookalikeDomain).toMatchObject({
      decision: "reject",
      reason: "unsupported_source_role",
    });
  });

  it("admits a chair review only under its conservatively discovered independent role", () => {
    const exactPage = page(
      "Herman Miller Aeron Office Chair review",
      "https://www.techradar.com/reviews/herman-miller-aeron",
    );
    expect(
      admitFetchedPageEvidence({
        candidateTitle: "Herman Miller Aeron Office Chair",
        merchant: "John Lewis",
        discovered: discovered(
          "Herman Miller Aeron Office Chair review",
          exactPage.finalUrl,
          "independent_review",
        ),
        page: exactPage,
      }),
    ).toMatchObject({ decision: "admit", admittedRole: "independent_review" });

    expect(
      admitFetchedPageEvidence({
        candidateTitle: "Herman Miller Aeron Office Chair",
        merchant: "John Lewis",
        discovered: discovered(
          "Herman Miller Aeron Office Chair review",
          exactPage.finalUrl,
          "other",
        ),
        page: exactPage,
      }),
    ).toMatchObject({ decision: "reject", reason: "unsupported_source_role" });
  });

  it("rejects wrong vacuum models and coffee-machine variants", () => {
    expect(
      admitFetchedPageEvidence({
        candidateTitle: "Shark Stratos IZ400UKT Cordless Vacuum",
        merchant: "Currys",
        discovered: discovered(
          "Shark Stratos IZ400UKT Cordless Vacuum",
          "https://sharkclean.co.uk/product/stratos-iz400ukt",
          "manufacturer",
        ),
        page: page(
          "Shark Stratos IZ420UKT Cordless Vacuum",
          "https://sharkclean.co.uk/product/stratos-iz400ukt",
          [
            product("Shark Stratos IZ420UKT Cordless Vacuum", {
              brand: "Shark",
              model: "IZ420UKT",
            }),
          ],
        ),
      }),
    ).toMatchObject({ decision: "reject", reason: "wrong_model_or_variant" });

    expect(
      admitFetchedPageEvidence({
        candidateTitle: "Sage Bambino Plus Espresso Machine",
        merchant: "John Lewis",
        discovered: discovered(
          "Sage Bambino Plus Espresso Machine",
          "https://www.sageappliances.com/en-gb/product/bes500",
          "manufacturer",
        ),
        page: page(
          "Sage Bambino Espresso Machine",
          "https://www.sageappliances.com/en-gb/product/bes500",
          [
            product("Sage Bambino Espresso Machine", {
              brand: "Sage",
              model: "Bambino",
            }),
          ],
        ),
      }),
    ).toMatchObject({ decision: "reject", reason: "wrong_model_or_variant" });

    expect(
      admitFetchedPageEvidence({
        candidateTitle: "Sage Bambino Espresso Machine",
        merchant: "John Lewis",
        discovered: discovered(
          "Sage Bambino Plus Espresso Machine",
          "https://www.sageappliances.com/en-gb/product/bes500",
          "manufacturer",
        ),
        page: page(
          "Sage Bambino Plus Espresso Machine",
          "https://www.sageappliances.com/en-gb/product/bes500",
          [
            product("Sage Bambino Plus Espresso Machine", {
              brand: "Sage",
              model: "Bambino Plus",
              sku: "BES500",
            }),
          ],
        ),
      }),
    ).toMatchObject({ decision: "reject", reason: "wrong_model_or_variant" });

    expect(
      admitFetchedPageEvidence({
        candidateTitle: "Logitech Lift Vertical Ergonomic Mouse",
        merchant: "Currys",
        discovered: discovered(
          "Logitech Lift 2 Vertical Ergonomic Mouse",
          "https://www.logitech.com/en-gb/products/mice/lift-2.html",
          "manufacturer",
        ),
        page: page(
          "Logitech Lift 2 Vertical Ergonomic Mouse",
          "https://www.logitech.com/en-gb/products/mice/lift-2.html",
          [
            product("Logitech Lift 2 Vertical Ergonomic Mouse", {
              brand: "Logitech",
              model: "Lift 2",
            }),
          ],
        ),
      }),
    ).toMatchObject({ decision: "reject", reason: "wrong_model_or_variant" });

    expect(
      admitFetchedPageEvidence({
        candidateTitle: "Sage Bambino Espresso Machine",
        merchant: "John Lewis",
        discovered: discovered(
          "Sage Bambino Espresso Machine",
          "https://www.sageappliances.com/en-gb/product/bambino",
          "manufacturer",
        ),
        page: page(
          "Sage Bambino Espresso Machine",
          "https://www.sageappliances.com/en-gb/product/bambino",
          [
            product("Sage Bambino Espresso Machine", {
              brand: "Sage",
              model: "Bambino Plus",
            }),
          ],
        ),
      }),
    ).toMatchObject({ decision: "reject", reason: "wrong_model_or_variant" });

    expect(
      admitFetchedPageEvidence({
        candidateTitle: "Sage Bambino Espresso Machine",
        merchant: "John Lewis",
        discovered: discovered(
          "Sage Bambino Espresso Machine",
          "https://www.sageappliances.com/en-gb/product/bambino-title-conflict",
          "manufacturer",
        ),
        page: page(
          "Sage Bambino Plus Espresso Machine",
          "https://www.sageappliances.com/en-gb/product/bambino-title-conflict",
          [
            product("Sage Bambino Espresso Machine", {
              brand: "Sage",
              model: "Bambino",
            }),
          ],
        ),
      }),
    ).toMatchObject({ decision: "reject", reason: "wrong_model_or_variant" });

    expect(
      admitFetchedPageEvidence({
        candidateTitle: "Sage Bambino Espresso Machine",
        merchant: "John Lewis",
        discovered: discovered(
          "Sage Bambino Espresso Machine",
          "https://www.sageappliances.com/en-gb/product/bambino-title-without-brand",
          "manufacturer",
        ),
        page: page(
          "Bambino Plus Espresso Machine",
          "https://www.sageappliances.com/en-gb/product/bambino-title-without-brand",
          [
            product("Sage Bambino Espresso Machine", {
              brand: "Sage",
              model: "Bambino",
            }),
          ],
        ),
      }),
    ).toMatchObject({ decision: "reject", reason: "wrong_model_or_variant" });
  });

  it("rejects category, comparison, wrong-category, generic and ambiguous pages", () => {
    const candidateTitle = "Logitech Lift Vertical Ergonomic Mouse";
    const cases: Array<{
      discovered: DiscoveredPageSource;
      page: ExtractedPageIdentity;
      reason: string;
    }> = [
      {
        discovered: discovered(
          "Logitech Lift Vertical Ergonomic Mouse",
          "https://www.logitech.com/en-gb/shop/mice",
          "manufacturer",
        ),
        page: page(
          "Logitech Lift Vertical Ergonomic Mouse",
          "https://www.logitech.com/en-gb/shop/mice",
        ),
        reason: "search_or_category_page",
      },
      {
        discovered: discovered(
          "Logitech Lift vs MX Vertical",
          "https://example.test/compare/logitech-lift-vs-mx-vertical",
          "independent_review",
        ),
        page: page(
          "Logitech Lift vs MX Vertical",
          "https://example.test/compare/logitech-lift-vs-mx-vertical",
        ),
        reason: "comparison_page",
      },
      {
        discovered: discovered(
          "Logitech Lift Vertical Ergonomic Mouse",
          "https://example.test/logitech-lift",
          "independent_review",
        ),
        page: page(
          "Logitech Lift Wireless Keyboard",
          "https://example.test/logitech-lift",
        ),
        reason: "wrong_category",
      },
      {
        discovered: discovered(
          "Logitech Lift Vertical Ergonomic Mouse",
          "https://example.test/logitech-lift",
          "independent_review",
        ),
        page: page("Product details", "https://example.test/logitech-lift"),
        reason: "generic_page_identity",
      },
      {
        discovered: discovered(
          "Logitech Lift Vertical Ergonomic Mouse",
          "https://example.test/logitech-lift-generic-product",
          "independent_review",
        ),
        page: page(
          "Logitech Lift Vertical Ergonomic Mouse",
          "https://example.test/logitech-lift-generic-product",
          [product("Ergonomic Wireless Mouse")],
        ),
        reason: "generic_page_identity",
      },
      {
        discovered: discovered(
          "Logitech Lift Vertical Ergonomic Mouse",
          "https://example.test/logitech-lift",
          "independent_review",
        ),
        page: page(
          "Logitech Lift Vertical Ergonomic Mouse",
          "https://example.test/logitech-lift",
          [
            product("Logitech Lift Vertical Ergonomic Mouse"),
            product("Logitech MX Vertical Ergonomic Mouse"),
          ],
        ),
        reason: "ambiguous_product_data",
      },
      {
        discovered: discovered(
          "Logitech Lift Vertical Ergonomic Mouse",
          "https://example.test/logitech-lift-conflicting-variants",
          "independent_review",
        ),
        page: page(
          "Logitech Lift Vertical Ergonomic Mouse",
          "https://example.test/logitech-lift-conflicting-variants",
          [
            product("Logitech Lift Vertical Ergonomic Mouse", {
              brand: "Logitech",
              model: "Lift Left",
              sku: "LIFT-LEFT",
            }),
            product("Logitech Lift Vertical Ergonomic Mouse", {
              brand: "Logitech",
              model: "Lift Right",
              sku: "LIFT-RIGHT",
            }),
          ],
        ),
        reason: "ambiguous_product_data",
      },
    ];
    for (const example of cases) {
      expect(
        admitFetchedPageEvidence({
          candidateTitle,
          merchant: "Currys",
          discovered: example.discovered,
          page: example.page,
        }),
      ).toMatchObject({ decision: "reject", reason: example.reason });
    }

    expect(
      admitFetchedPageEvidence({
        candidateTitle: "Ergonomic Wireless Mouse",
        merchant: "Amazon",
        discovered: discovered(
          "Ergonomic Wireless Mouse",
          "https://example.test/ergonomic-wireless-mouse",
          "retailer",
        ),
        page: page(
          "Ergonomic Wireless Mouse",
          "https://example.test/ergonomic-wireless-mouse",
        ),
      }),
    ).toMatchObject({
      decision: "reject",
      reason: "generic_candidate_identity",
    });

    expect(
      admitFetchedPageEvidence({
        candidateTitle: "Logitech Lift Vertical Ergonomic Mouse",
        merchant: "Currys",
        discovered: discovered(
          "Logitech Lift Vertical Ergonomic Mouse",
          "https://example.test/logitech-lift-duplicate-data",
          "independent_review",
        ),
        page: page(
          "Logitech Lift Vertical Ergonomic Mouse",
          "https://example.test/logitech-lift-duplicate-data",
          [
            product("Logitech Lift Vertical Ergonomic Mouse", {
              brand: "Logitech",
              model: "Lift",
              sku: "LIFT-001",
            }),
            product("Logitech Lift Vertical Ergonomic Mouse", {
              brand: "Logitech",
              model: "Lift",
              sku: "LIFT-001",
            }),
          ],
        ),
      }),
    ).toMatchObject({ decision: "admit", admittedRole: "independent_review" });
  });

  it("requires retailer pages to remain in the candidate merchant context", () => {
    const candidateTitle = "Sage Bambino Plus Espresso Machine";
    expect(
      admitFetchedPageEvidence({
        candidateTitle,
        merchant: "John Lewis",
        discovered: discovered(
          candidateTitle,
          "https://www.amazon.co.uk/sage-bambino-plus/dp/B01M123456",
          "retailer",
        ),
        page: page(
          candidateTitle,
          "https://www.amazon.co.uk/sage-bambino-plus/dp/B01M123456",
          [product(candidateTitle, { brand: "Sage", model: "Bambino Plus" })],
        ),
      }),
    ).toMatchObject({
      decision: "reject",
      reason: "merchant_context_mismatch",
    });

    expect(
      admitFetchedPageEvidence({
        candidateTitle,
        merchant: "John Lewis",
        discovered: discovered(
          candidateTitle,
          "https://www.johnlewis.com/sage-bambino-plus/p123",
          "retailer",
        ),
        page: page(
          candidateTitle,
          "https://www.johnlewis.com/sage-bambino-plus/p123",
          [product(candidateTitle, { brand: "Sage", model: "Bambino Plus" })],
        ),
      }),
    ).toMatchObject({ decision: "admit", admittedRole: "retailer" });
  });

  it("rejects a redirect or canonical identity outside the discovered source host", () => {
    expect(
      admitFetchedPageEvidence({
        candidateTitle: "Logitech MX Master 3S Wireless Mouse",
        merchant: "Currys",
        discovered: discovered(
          "Logitech MX Master 3S Wireless Mouse",
          "https://www.logitech.com/products/mx-master-3s",
          "manufacturer",
        ),
        page: page(
          "Logitech MX Master 3S Wireless Mouse",
          "https://malicious.example/product",
          [product("Logitech MX Master 3S Wireless Mouse")],
        ),
      }),
    ).toMatchObject({ decision: "reject", reason: "redirect_origin_mismatch" });
  });
});
