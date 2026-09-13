/** Fictional source corpus, never production evidence or an expected-winner map. */
import { createHash } from "node:crypto";
import {
  candidateListingSchema,
  providerSearchResultSchema,
  type ShoppingSearchProvider,
} from "@/features/retrieval-spike/contracts";
import {
  evidenceSearchResponseSchema,
  type EvidenceSearchProvider,
} from "@/features/product-understanding/evidence-search";
import type { EvidencePageFetcher } from "@/features/product-understanding/research-orchestrator";
import type { ProductUnderstandingModel } from "@/features/product-understanding/model-port";
import {
  productUnderstandingProviderWireV1Schema,
  type ProductUnderstandingInputV1,
} from "@/features/product-understanding/provider-wire";

export type CorpusProduct = {
  title: string;
  price: number;
  facts: Readonly<Record<string, string>>;
};
const mouseFacts = {
  "Wireless connectivity": "wireless",
  "Battery life": "Up to 18 months of useful wireless battery life",
  "Mouse shape": "Sculpted chunky body with a noticeable thumb rest, not flat",
  "Brand reputation":
    "Independent review documents reputable product support and established quality control",
  "Excluded brand": "Fictional Studio",
  Reviews: "4.4/5; 128 reviews",
};
export const mouseCorpus: readonly CorpusProduct[] = [
  {
    title: "Mouse A Workform 100",
    price: 3999,
    facts: {
      ...mouseFacts,
      "Comfort for long workdays":
        "The reviewer used Mouse A throughout several full working days and remained comfortable without wrist fatigue.",
    },
  },
  {
    title: "Mouse B Workform 200",
    price: 3999,
    facts: {
      ...mouseFacts,
      "Comfort for long workdays":
        "The review notes the sculpted shape and thumb rest but does not evaluate comfort over extended working sessions.",
    },
  },
];
const chairFacts = {
  "Chair size": "compact",
  "Chair style": "office",
  Material: "Breathable mesh rather than leather",
  "Shopper height":
    "A reviewer 178 cm tall found the adjustment range suitable",
};
export const chairCorpus: readonly CorpusProduct[] = [
  {
    title: "Chair A Workseat 100",
    price: 24500,
    facts: {
      ...chairFacts,
      "Lower-back support":
        "Adequate lumbar support; comfort during long sessions was not evaluated.",
    },
  },
  {
    title: "Chair B Workseat 200",
    price: 33000,
    facts: {
      ...chairFacts,
      Price:
        "Compared with Chair A, the review found genuinely better support for long sessions after repeated working days.",
      "Lower-back support":
        "The reviewer remained comfortable with sustained lumbar support through full working days.",
    },
  },
];
const vacuumFacts = {
  "Cordless operation": "true",
  "Floor-type suitability": "hard floors, rugs",
  Weight: "2.8 kg",
  "Useful runtime": "45 minutes of useful runtime",
};
export const vacuumCorpus: readonly CorpusProduct[] = [
  {
    title: "Vacuum A Floorcare 100",
    price: 22000,
    facts: { ...vacuumFacts, "Noise level": "Noise was not tested." },
  },
  {
    title: "Vacuum B Floorcare 200",
    price: 21000,
    facts: {
      ...vacuumFacts,
      "Noise level": "Very loud during independent use tests.",
    },
  },
];
const coffeeFacts = {
  "Espresso quality":
    "Independent tasting found genuinely good espresso with balanced extraction",
  "Ease of cleaning": "Removable parts were easy to clean after use",
  "Noise level": "Noise was not tested.",
  "Milk frothing": "true",
};
export const coffeeCorpus: readonly CorpusProduct[] = [
  {
    title: "Machine A Countertop 100",
    price: 29900,
    facts: { ...coffeeFacts, "Machine width": "24 cm" },
  },
  {
    title: "Machine B Countertop 200",
    price: 29900,
    facts: { ...coffeeFacts, "Machine width": "29 cm" },
  },
];
function escape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
}

export function founderCorpus(products: readonly CorpusProduct[]) {
  const calls = { search: 0, evidence: 0, page: 0, model: 0 };
  const productUrl = (index: number) =>
    `https://example.test/founder/product-${index}`;
  const provider: ShoppingSearchProvider = {
    provider: "fixture",
    maxRequestDurationMs: 0,
    async search(query) {
      calls.search++;
      return providerSearchResultSchema.parse({
        listings: products.map((product, index) =>
          candidateListingSchema.parse({
            taskId: query.taskId,
            runId: query.runId,
            queryId: query.id,
            provider: "fixture",
            providerResultId: productUrl(index),
            sourceRank: products.length - index,
            surface: "shopping",
            title: product.title,
            url: productUrl(index),
            canonicalUrl: productUrl(index),
            merchantDestinationUrl: productUrl(index),
            merchantDestinationSource: "shopping_result",
            merchant: "Fictional Shop",
            price: { amountMinor: product.price, currency: "GBP" },
            priceText: `£${(product.price / 100).toFixed(2)}`,
            imageUrl: null,
            deliveryText: "Fixture delivery available",
            availabilityText: "Fixture in stock",
            reviewEvidence: null,
            retrievedAt: new Date(),
          }),
        ),
        diagnostics: {
          receivedResultCount: products.length,
          rejectedResultCount: 0,
        },
      });
    },
  };
  const evidenceProvider: EvidenceSearchProvider = {
    provider: "fixture",
    async search(input) {
      calls.evidence++;
      const index = products.findIndex(
        ({ title }) => title === input.candidateTitle,
      );
      if (index < 0)
        throw new Error("Candidate absent from exact source corpus");
      return evidenceSearchResponseSchema.parse({
        providerRequestId: `corpus-${calls.evidence}`,
        receivedResultCount: 1,
        results: [
          {
            providerResultId: `review-${index}`,
            rank: 1,
            title: `${input.candidateTitle} independent review`,
            url: `https://trustedreviews.com/fixture/founder-${index}`,
            snippet: Object.values(products[index]!.facts)
              .join(" ")
              .slice(0, 900),
            sourceRole: "independent_review",
          },
        ],
      });
    },
  };
  const pageFetcher: EvidencePageFetcher = {
    provider: "fixture",
    async fetch(input) {
      calls.page++;
      const index = products.findIndex(
        ({ title }) => title === input.candidateTitle,
      );
      const product = products[index];
      if (
        !product ||
        input.url !== `https://trustedreviews.com/fixture/founder-${index}`
      )
        throw new Error("Page is outside exact corpus");
      const text = `<html><head><title>${escape(product.title)} independent review</title></head><body><h1>${escape(product.title)}</h1><p>Fictional deterministic product-review source; not a claim about a real product.</p><dl>${Object.entries(
        product.facts,
      )
        .map(
          ([label, value]) =>
            `<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`,
        )
        .join("")}</dl></body></html>`;
      return {
        requestedUrl: input.url,
        finalUrl: input.url,
        contentType: "text/html",
        text,
        encodedBytes: Buffer.byteLength(text),
        decodedBytes: Buffer.byteLength(text),
        redirectCount: 0,
        fetchedAt: new Date(),
        responseHash: createHash("sha256").update(text).digest("hex"),
      };
    },
  };
  // Only reads the projected source text + current criterion. Never sees corpus,
  // candidate index, expected state, or a precomputed assessment.
  const model: ProductUnderstandingModel = {
    async understand(input) {
      calls.model++;
      return {
        status: "completed",
        value: extractCorpusEvidence(input),
        metadata: {
          provider: "fixture",
          model: "source-row-extractor",
          promptVersion: "founder-corpus-v1",
          providerSchemaVersion: 1,
          providerRequestId: `corpus-model-${calls.model}`,
          durationMs: 0,
          inputTokens: null,
          outputTokens: null,
        },
      };
    },
  };
  return { provider, evidenceProvider, pageFetcher, model, calls };
}

export function extractCorpusEvidence(input: ProductUnderstandingInputV1) {
  const observations: unknown[] = [],
    assessments: unknown[] = [];
  for (const criterion of input.criteria) {
    const prefix = `Specification: ${criterion.label}: `;
    const source = input.sources.find(
      (s) =>
        s.kind === "fetched_page" &&
        s.excerpt?.split("\n").some((line) => line.startsWith(prefix)),
    );
    const claim = source?.excerpt
      ?.split("\n")
      .find((line) => line.startsWith(prefix))
      ?.slice(prefix.length);
    let status = "uncertain";
    let value: Record<string, unknown> = {
      schemaVersion: 1,
      kind: "text",
      text: claim ?? "Not established",
    };
    if (
      claim &&
      !/not evaluat|does not evaluate|not tested|unknown|not established/i.test(
        claim,
      )
    ) {
      status = "meets";
      const quantity = /^(\d+(?:\.\d+)?) (cm|kg|hours)\b/.exec(claim);
      if (quantity) {
        value = {
          schemaVersion: 1,
          kind: "quantity",
          amount: quantity[1],
          unit: quantity[2],
          qualifier: "exact",
        };
        if (criterion.value.kind === "measurement_range") {
          const upper = criterion.value.upper as
            { amount: string; inclusive: boolean } | undefined;
          const lower = criterion.value.lower as
            { amount: string; inclusive: boolean } | undefined;
          if (criterion.value.unit !== quantity[2]) status = "uncertain";
          else if (
            (upper &&
              (Number(quantity[1]) > Number(upper.amount) ||
                (!upper.inclusive &&
                  Number(quantity[1]) === Number(upper.amount)))) ||
            (lower &&
              (Number(quantity[1]) < Number(lower.amount) ||
                (!lower.inclusive &&
                  Number(quantity[1]) === Number(lower.amount))))
          )
            status = "conflicts";
        }
      }
      if (/noise/i.test(criterion.label) && /^very loud\b/i.test(claim)) {
        value = {
          schemaVersion: 1,
          kind: "categorical",
          values: ["very loud"],
        };
        if (/not very loud/i.test(JSON.stringify(criterion.value)))
          status = "conflicts";
      }
      if (claim === "true" || claim === "false") {
        value = { schemaVersion: 1, kind: "boolean", value: claim === "true" };
        if (
          criterion.value.kind === "boolean" &&
          criterion.value.value !== value.value
        )
          status = "conflicts";
      }
      const rating = /^(\d(?:\.\d)?)\/5; (\d+) reviews$/.exec(claim);
      if (rating)
        value = {
          schemaVersion: 1,
          kind: "rating_aggregate",
          ratingHundredths: Math.round(Number(rating[1]) * 100),
          scaleHundredths: 500,
          reviewCount: Number(rating[2]),
        };
      if (criterion.value.kind === "categorical") {
        const values = claim.split(", ");
        value = { schemaVersion: 1, kind: "categorical", values };
        const requested = criterion.value.values as string[];
        if (
          criterion.value.operator === "exclude"
            ? requested.some((v) => values.includes(v))
            : !requested.every((v) => values.includes(v))
        )
          status = "conflicts";
      }
    }
    const refs = claim && source ? [`row_${criterion.ordinal}`] : [];
    if (claim && source)
      observations.push({
        localRef: refs[0],
        sourceOrdinal: source.ordinal,
        criterionOrdinal: criterion.ordinal,
        support: "supported",
        observationKind: "source_assertion",
        propertyLabel: criterion.label,
        claim,
        value,
        derivation: "model_text",
      });
    assessments.push({
      criterionOrdinal: criterion.ordinal,
      status,
      relation:
        status === "uncertain" ? "insufficient_evidence" : "source_support",
      explanation: claim ?? "Exact source evidence is missing.",
      observationRefs: refs,
    });
  }
  return productUnderstandingProviderWireV1Schema.parse({
    providerSchemaVersion: 1,
    observations,
    assessments,
  });
}
