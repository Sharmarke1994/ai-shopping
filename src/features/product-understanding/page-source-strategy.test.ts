import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  briefItemV1Schema,
  type BriefItemV1,
} from "@/domain/shopping-state/brief";
import { evidenceSearchResultSchema } from "./evidence-search";
import {
  MAX_PAGE_SOURCES_PER_CANDIDATE,
  selectPageSources,
  type PageSourceCandidate,
} from "./page-source-strategy";

function criterion(options: {
  label: string;
  definition: string;
  strength?: BriefItemV1["strength"];
}): BriefItemV1 {
  return briefItemV1Schema.parse({
    criterionId: randomUUID(),
    lineageId: randomUUID(),
    conceptId: randomUUID(),
    conceptLabel: options.label,
    conceptDefinition: options.definition,
    strength: options.strength ?? "strong_preference",
    targetSemantics: "qualitative",
    semanticValue: {
      schemaVersion: 1,
      kind: "qualitative",
      mode: "text",
      text: options.label,
    },
  });
}

function source(options: {
  title: string;
  url: string;
  role: PageSourceCandidate["sourceRole"];
  rank?: number;
}): PageSourceCandidate {
  return evidenceSearchResultSchema.parse({
    providerResultId: `${options.rank ?? 1}:${options.url}`,
    rank: options.rank ?? 1,
    title: options.title,
    url: options.url,
    snippet: null,
    sourceRole: options.role,
  });
}

describe("page source strategy", () => {
  it("selects complementary official and independent sources for mouse criteria", () => {
    const dimensions = criterion({
      label: "Width",
      definition: "Exact product width and dimensions",
      strength: "hard",
    });
    const comfort = criterion({
      label: "Glasses and long-session comfort",
      definition: "Real-world ergonomic comfort during long workdays",
    });
    const selected = selectPageSources({
      candidateTitle: "Logitech MX Master 3S Wireless Mouse",
      merchant: "Currys",
      targetCriteria: [comfort, dimensions],
      organicSources: [
        source({
          title: "MX Master 3S review",
          url: "https://www.rtings.com/mouse/reviews/logitech/mx-master-3s",
          role: "independent_review",
          rank: 1,
        }),
        source({
          title: "MX Master 3S specifications",
          url: "https://www.logitech.com/en-gb/products/mice/mx-master-3s.html",
          role: "other",
          rank: 2,
        }),
      ],
    });

    expect(selected).toHaveLength(2);
    expect(selected.map(({ purpose }) => purpose)).toEqual([
      "official_specification",
      "real_world_experience",
    ]);
    expect(selected[0]).toMatchObject({
      discoveredRole: "other",
      selectionReason: "candidate_brand_domain",
      targetCriterionIds: [dimensions.criterionId],
    });
    expect(selected[1]?.targetCriterionIds).toEqual([comfort.criterionId]);
  });

  it("uses independent experience evidence for chairs and official dimensions for coffee machines", () => {
    const chair = selectPageSources({
      candidateTitle: "Herman Miller Aeron Office Chair",
      merchant: "John Lewis",
      targetCriteria: [
        criterion({
          label: "All-day comfort",
          definition: "Comfort and durability in real use",
        }),
      ],
      organicSources: [
        source({
          title: "Aeron product page",
          url: "https://www.hermanmiller.com/products/seating/office-chairs/aeron-chairs/",
          role: "other",
        }),
        source({
          title: "Herman Miller Aeron review",
          url: "https://www.techradar.com/reviews/herman-miller-aeron",
          role: "independent_review",
          rank: 2,
        }),
      ],
    });
    expect(chair.map(({ purpose }) => purpose)).toEqual([
      "real_world_experience",
    ]);

    const coffee = selectPageSources({
      candidateTitle: "Sage Bambino Plus Espresso Machine",
      merchant: "John Lewis",
      targetCriteria: [
        criterion({
          label: "Maximum width",
          definition: "Machine must be no more than 25cm wide",
          strength: "hard",
        }),
        criterion({
          label: "Noise",
          definition: "Prefer a machine that is not very loud in real use",
        }),
      ],
      organicSources: [
        source({
          title: "Sage Bambino Plus",
          url: "https://www.sageappliances.com/en-gb/product/bes500",
          role: "other",
        }),
        source({
          title: "Sage Bambino Plus review",
          url: "https://www.techradar.com/reviews/sage-bambino-plus",
          role: "independent_review",
          rank: 2,
        }),
      ],
    });
    expect(coffee.map(({ purpose }) => purpose)).toEqual([
      "official_specification",
      "real_world_experience",
    ]);
  });

  it("never treats a manufacturer page as brand-reputation evidence", () => {
    const reputation = criterion({
      label: "Brand reputation",
      definition: "Evidence that the vacuum brand has a trustworthy reputation",
    });
    const selected = selectPageSources({
      candidateTitle: "Shark Stratos IZ400UKT Cordless Vacuum",
      merchant: "Currys",
      targetCriteria: [reputation],
      organicSources: [
        source({
          title: "Shark Stratos IZ400UKT",
          url: "https://sharkclean.co.uk/product/stratos-iz400ukt",
          role: "manufacturer",
        }),
        source({
          title: "Shark Stratos IZ400UKT brand story",
          url: "https://sharkclean.co.uk/about-shark",
          role: "other",
          rank: 2,
        }),
        source({
          title: "Shark vacuum brand reliability",
          url: "https://www.which.co.uk/reviews/vacuum-cleaners/article/shark-reliability",
          role: "independent_review",
          rank: 3,
        }),
      ],
    });
    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({
      discoveredRole: "independent_review",
      purpose: "brand_reputation",
      targetCriterionIds: [reputation.criterionId],
    });
  });

  it("prefers a retailer review aggregate over a manufacturer for owner-review evidence", () => {
    const reviews = criterion({
      label: "Customer reviews",
      definition: "Owner review count and aggregate star rating",
    });
    const selected = selectPageSources({
      candidateTitle: "Shark Stratos IZ400UKT Cordless Vacuum",
      merchant: "Currys",
      targetCriteria: [reviews],
      organicSources: [
        source({
          title: "Shark Stratos IZ400UKT",
          url: "https://sharkclean.co.uk/product/stratos-iz400ukt",
          role: "manufacturer",
        }),
        source({
          title: "Shark Stratos IZ400UKT customer reviews",
          url: "https://www.currys.co.uk/reviews/shark-stratos-iz400ukt",
          role: "retailer_review_aggregate",
          rank: 2,
        }),
        source({
          title: "Shark Stratos IZ400UKT review",
          url: "https://www.techradar.com/reviews/shark-stratos-iz400ukt",
          role: "independent_review",
          rank: 1,
        }),
      ],
    });
    expect(selected).toMatchObject([
      {
        discoveredRole: "retailer_review_aggregate",
        purpose: "review_evidence",
        targetCriterionIds: [reviews.criterionId],
      },
    ]);
  });

  it("deduplicates URLs and never selects more than two pages", () => {
    const targets = [
      criterion({
        label: "Dimensions",
        definition: "Exact product dimensions",
        strength: "hard",
      }),
      criterion({ label: "Comfort", definition: "Real-world comfort" }),
      criterion({
        label: "Customer reviews",
        definition: "Owner review count and rating",
      }),
    ];
    const duplicate = source({
      title: "Logitech Lift review",
      url: "https://www.rtings.com/mouse/reviews/logitech/lift#section",
      role: "independent_review",
      rank: 2,
    });
    const selected = selectPageSources({
      candidateTitle: "Logitech Lift Vertical Ergonomic Mouse",
      merchant: "Amazon",
      targetCriteria: targets,
      organicSources: [
        source({
          title: "Logitech Lift specifications",
          url: "https://www.logitech.com/en-gb/products/mice/lift.html",
          role: "manufacturer",
        }),
        duplicate,
        {
          ...duplicate,
          providerResultId: "duplicate",
          url: duplicate.url.replace("#section", ""),
        },
        source({
          title: "Logitech Lift customer ratings",
          url: "https://www.amazon.co.uk/product-reviews/B07W6JN7NZ",
          role: "retailer_review_aggregate",
          rank: 3,
        }),
      ],
    });
    expect(selected).toHaveLength(MAX_PAGE_SOURCES_PER_CANDIDATE);
    expect(new Set(selected.map(({ url }) => url)).size).toBe(2);
    expect(selected.map(({ purpose }) => purpose)).toEqual([
      "official_specification",
      "real_world_experience",
    ]);
  });

  it("abstains when no source has the role needed for the target gap", () => {
    expect(
      selectPageSources({
        candidateTitle: "Sage Bambino Plus Espresso Machine",
        merchant: "John Lewis",
        targetCriteria: [
          criterion({
            label: "Noise",
            definition: "How loud it is in real use",
          }),
        ],
        organicSources: [
          source({
            title: "Sage Bambino Plus",
            url: "https://www.sageappliances.com/en-gb/product/bes500",
            role: "manufacturer",
          }),
        ],
      }),
    ).toEqual([]);
  });
});
