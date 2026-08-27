import {
  candidateListingSchema,
  httpUrlSchema,
  providerSearchResultSchema,
  searchQuerySchema,
  type CandidateListing,
  type ProviderSearchResult,
  type SearchQuery,
  type ShoppingSearchProvider,
} from "./contracts";
import { z } from "zod";

const SERPER_SHOPPING_ENDPOINT = "https://google.serper.dev/shopping";
const SERPER_SEARCH_ENDPOINT = "https://google.serper.dev/search";

const serperShoppingItemSchema = z.looseObject({
  position: z.number().int().positive().optional(),
  title: z.string().min(1),
  link: httpUrlSchema,
  source: z.string().min(1).optional(),
  price: z.union([z.string().min(1), z.number().finite()]).optional(),
  imageUrl: httpUrlSchema.optional(),
  productId: z.union([z.string(), z.number()]).optional(),
  delivery: z.string().min(1).optional(),
});

const serperEnvelopeSchema = z.looseObject({
  shopping: z.array(z.unknown()).optional().default([]),
});

const serperOrganicItemSchema = z.looseObject({
  position: z.number().int().positive().optional(),
  title: z.string().min(1),
  link: httpUrlSchema,
  rating: z.unknown().optional(),
  ratingCount: z.unknown().optional(),
});

const serperStructuredReviewSchema = z.strictObject({
  rating: z.number().finite().min(0).max(5),
  ratingCount: z.number().int().positive(),
});

const serperOrganicEnvelopeSchema = z.looseObject({
  organic: z.array(z.unknown()).optional().default([]),
});

export class SerperShoppingError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "SerperShoppingError";
  }
}

function canonicaliseListingUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  url.hash = "";
  const removable = new Set(["gclid", "gbraid", "wbraid", "srsltid"]);
  for (const parameter of [...url.searchParams.keys()]) {
    const normalizedParameter = parameter.toLowerCase();
    if (
      normalizedParameter.startsWith("utm_") ||
      removable.has(normalizedParameter)
    ) {
      url.searchParams.delete(parameter);
    }
  }
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function merchantDestinationUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  const hostname = url.hostname.toLocaleLowerCase("en-GB");
  const googleOwnedHost =
    /(^|\.)google\.[a-z.]+$/i.test(hostname) ||
    hostname === "googleusercontent.com" ||
    hostname.endsWith(".googleusercontent.com") ||
    hostname === "g.co" ||
    hostname.endsWith(".g.co") ||
    hostname === "goo.gl";
  return googleOwnedHost ? null : url.toString();
}

const merchantNoise = new Set([
  "amazon",
  "seller",
  "shop",
  "shopping",
  "store",
  "official",
  "limited",
  "ltd",
]);

const titleNoise = new Set([
  "and",
  "for",
  "from",
  "the",
  "with",
  "black",
  "white",
  "new",
]);

const genericProductTokens = new Set([
  "2",
  "4g",
  "2ghz",
  "4ghz",
  "bluetooth",
  "ergonomic",
  "gaming",
  "mouse",
  "optical",
  "rechargeable",
  "usb",
  "vertical",
  "wired",
  "wireless",
]);

function tokens(value: string, noise: ReadonlySet<string>) {
  return value
    .toLocaleLowerCase("en-GB")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !noise.has(token));
}

function merchantMatchesHostname(merchant: string, hostname: string) {
  const compactHostname = hostname
    .toLocaleLowerCase("en-GB")
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]/g, "");
  const merchantTokens = tokens(merchant, merchantNoise).filter(
    (token) => token.length >= 4,
  );
  if (merchantTokens.length === 0) {
    const amazonMerchant = /(^|[^a-z0-9])amazon([^a-z0-9]|$)/i.test(merchant);
    return amazonMerchant && compactHostname.startsWith("amazon");
  }
  return merchantTokens.some((token) => compactHostname.includes(token));
}

function titleCoverage(candidateTitle: string, resultTitle: string) {
  const candidateTokens = [...new Set(tokens(candidateTitle, titleNoise))];
  if (candidateTokens.length < 3) return 0;
  const resultTokens = new Set(tokens(resultTitle, titleNoise));
  return (
    candidateTokens.filter((token) => resultTokens.has(token)).length /
    candidateTokens.length
  );
}

function hasDiscriminativeTitleIdentity(
  candidateTitle: string,
  resultTitle: string,
) {
  const candidateIdentity = tokens(candidateTitle, titleNoise).filter(
    (token) => !genericProductTokens.has(token),
  );
  if (candidateIdentity.length === 0) return false;
  const resultTokens = new Set(tokens(resultTitle, titleNoise));
  return candidateIdentity.every((token) => resultTokens.has(token));
}

const comparisonHosts = [
  "idealo.co.uk",
  "pinterest.com",
  "pricerunner.com",
  "pricespy.co.uk",
  "testmarket.io",
];

export function verifyOrganicMerchantDestination(options: {
  candidateTitle: string;
  merchant: string;
  resultTitle: string;
  resultUrl: string;
}) {
  const url = new URL(options.resultUrl);
  const hostname = url.hostname.toLocaleLowerCase("en-GB");
  if (
    url.protocol !== "https:" ||
    merchantDestinationUrl(url.toString()) === null ||
    comparisonHosts.some(
      (blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`),
    ) ||
    !merchantMatchesHostname(options.merchant, hostname) ||
    !hasDiscriminativeTitleIdentity(
      options.candidateTitle,
      options.resultTitle,
    ) ||
    titleCoverage(options.candidateTitle, options.resultTitle) < 0.7 ||
    url.pathname === "/" ||
    /^\/(?:s|search|browse|category|categories)(?:\/|$)/i.test(url.pathname)
  ) {
    return null;
  }
  return canonicaliseListingUrl(url.toString());
}

export function parseObservedGbpPrice(
  rawPrice: string | number | undefined,
): CandidateListing["price"] {
  if (typeof rawPrice === "number") {
    return null;
  }
  if (rawPrice === undefined) return null;
  const match = /^£\s*([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)(?:\.([0-9]{2}))?$/.exec(
    rawPrice.trim(),
  );
  if (match === null) return null;
  const pounds = Number.parseInt(match[1]!.replaceAll(",", ""), 10);
  const pence = Number.parseInt(match[2] ?? "00", 10);
  return { amountMinor: pounds * 100 + pence, currency: "GBP" };
}

function priceText(rawPrice: string | number | undefined) {
  return rawPrice === undefined ? null : String(rawPrice);
}

export type SerperShoppingAdapterOptions = Readonly<{
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
}>;

export class SerperShoppingAdapter implements ShoppingSearchProvider {
  readonly provider = "serper" as const;
  readonly maxRequestDurationMs: number;

  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #now: () => Date;
  readonly #destinationCache = new Map<
    string,
    Promise<{
      destinationUrl: string;
      reviewEvidence: CandidateListing["reviewEvidence"];
    } | null>
  >();

  constructor(options: SerperShoppingAdapterOptions) {
    if (options.apiKey.trim().length === 0) {
      throw new Error("SERPER_API_KEY must not be empty");
    }
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#timeoutMs = z
      .number()
      .int()
      .min(100)
      .max(30_000)
      .parse(options.timeoutMs ?? 12_000);
    this.maxRequestDurationMs = this.#timeoutMs;
    this.#now = options.now ?? (() => new Date());
  }

  async search(queryInput: SearchQuery): Promise<ProviderSearchResult> {
    const query = searchQuerySchema.parse(queryInput);
    if (
      query.market.country !== "GB" ||
      query.market.currency !== "GBP" ||
      query.market.language !== "en-GB"
    ) {
      throw new Error("The retrieval spike supports only GB / GBP / en-GB");
    }

    const deadline = Date.now() + this.#timeoutMs;
    let response: Response;
    try {
      response = await this.#fetch(SERPER_SHOPPING_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": this.#apiKey,
        },
        body: JSON.stringify({
          q: query.text,
          gl: "gb",
          hl: "en",
          location: "United Kingdom",
          num: query.limit,
        }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      throw new SerperShoppingError(
        error instanceof Error ? error.message : "Serper request failed",
        null,
      );
    }
    if (!response.ok) {
      throw new SerperShoppingError(
        `Serper returned HTTP ${response.status}`,
        response.status,
      );
    }

    const envelope = serperEnvelopeSchema.safeParse(await response.json());
    if (!envelope.success) {
      throw new SerperShoppingError("Serper returned an invalid envelope", 200);
    }

    const retrievedAt = this.#now();
    const listings: CandidateListing[] = [];
    let rejectedResultCount = 0;
    for (const [index, rawItem] of envelope.data.shopping.entries()) {
      const parsed = serperShoppingItemSchema.safeParse(rawItem);
      if (!parsed.success) {
        rejectedResultCount += 1;
        continue;
      }
      const item = parsed.data;
      const rank = item.position ?? index + 1;
      const observedMerchantDestination = merchantDestinationUrl(item.link);
      listings.push(
        candidateListingSchema.parse({
          taskId: query.taskId,
          runId: query.runId,
          queryId: query.id,
          provider: "serper",
          providerResultId: String(item.productId ?? `${query.id}:${rank}`),
          sourceRank: rank,
          surface: "shopping",
          title: item.title,
          url: item.link,
          canonicalUrl: canonicaliseListingUrl(item.link),
          merchantDestinationUrl: observedMerchantDestination,
          merchantDestinationSource:
            observedMerchantDestination === null ? null : "shopping_result",
          merchant: item.source ?? null,
          price: parseObservedGbpPrice(item.price),
          priceText: priceText(item.price),
          imageUrl: item.imageUrl ?? null,
          deliveryText: item.delivery ?? null,
          availabilityText: null,
          reviewEvidence: null,
          retrievedAt,
        }),
      );
    }

    const acceptedListings = listings.slice(0, query.limit);
    const seenMerchants = new Set<string>();
    const destinationCandidates = [...acceptedListings]
      .sort((left, right) => left.sourceRank - right.sourceRank)
      .filter((listing) => {
        if (
          listing.merchantDestinationUrl !== null ||
          listing.merchant === null
        ) {
          return false;
        }
        const merchant = listing.merchant.toLocaleLowerCase("en-GB");
        if (seenMerchants.has(merchant)) return false;
        seenMerchants.add(merchant);
        return true;
      })
      .slice(0, 3);
    for (const candidateForDestination of destinationCandidates) {
      const cacheKey = `${candidateForDestination.title}\n${candidateForDestination.merchant}`;
      let resolution = this.#destinationCache.get(cacheKey);
      if (resolution === undefined) {
        resolution = this.#resolveMerchantDestination(
          candidateForDestination,
          deadline,
        );
        this.#destinationCache.set(cacheKey, resolution);
      }
      const resolved = await resolution;
      if (resolved !== null) {
        const listingIndex = acceptedListings.indexOf(candidateForDestination);
        acceptedListings[listingIndex] = candidateListingSchema.parse({
          ...candidateForDestination,
          merchantDestinationUrl: resolved.destinationUrl,
          merchantDestinationSource: "verified_organic",
          reviewEvidence: resolved.reviewEvidence,
        });
      }
    }

    return providerSearchResultSchema.parse({
      listings: acceptedListings,
      diagnostics: {
        receivedResultCount: envelope.data.shopping.length,
        rejectedResultCount,
      },
    });
  }

  async #resolveMerchantDestination(
    listing: CandidateListing,
    deadline: number,
  ) {
    const remainingMs = deadline - Date.now();
    if (remainingMs < 100 || listing.merchant === null) return null;
    try {
      const response = await this.#fetch(SERPER_SEARCH_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": this.#apiKey,
        },
        body: JSON.stringify({
          q: `"${listing.title.replaceAll('"', "").slice(0, 240)}" ${listing.merchant.slice(0, 120)}`,
          gl: "gb",
          hl: "en",
          location: "United Kingdom",
          num: 5,
        }),
        signal: AbortSignal.timeout(remainingMs),
      });
      if (!response.ok) return null;
      const envelope = serperOrganicEnvelopeSchema.safeParse(
        await response.json(),
      );
      if (!envelope.success) return null;
      for (const rawItem of envelope.data.organic.slice(0, 5)) {
        const parsed = serperOrganicItemSchema.safeParse(rawItem);
        if (!parsed.success) continue;
        const destination = verifyOrganicMerchantDestination({
          candidateTitle: listing.title,
          merchant: listing.merchant,
          resultTitle: parsed.data.title,
          resultUrl: parsed.data.link,
        });
        if (destination !== null) {
          const review = serperStructuredReviewSchema.safeParse({
            rating: parsed.data.rating,
            ratingCount: parsed.data.ratingCount,
          });
          const reviewEvidence = review.success
            ? {
                kind: "provider_structured_rating" as const,
                ratingHundredths: Math.round(review.data.rating * 100),
                scaleHundredths: 500 as const,
                reviewCount: review.data.ratingCount,
                sourceUrl: destination,
              }
            : null;
          return { destinationUrl: destination, reviewEvidence };
        }
      }
      return null;
    } catch {
      return null;
    }
  }
}
