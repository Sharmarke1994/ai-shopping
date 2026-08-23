import {
  candidateListingSchema,
  providerSearchResultSchema,
  searchQuerySchema,
  type CandidateListing,
  type ProviderSearchResult,
  type SearchQuery,
  type ShoppingSearchProvider,
} from "./contracts";
import { z } from "zod";

const SERPER_SHOPPING_ENDPOINT = "https://google.serper.dev/shopping";

const serperShoppingItemSchema = z.looseObject({
  position: z.number().int().positive().optional(),
  title: z.string().min(1),
  link: z.url(),
  source: z.string().min(1).optional(),
  price: z.union([z.string().min(1), z.number().finite()]).optional(),
  imageUrl: z.url().optional(),
  productId: z.union([z.string(), z.number()]).optional(),
  delivery: z.string().min(1).optional(),
});

const serperEnvelopeSchema = z.looseObject({
  shopping: z.array(z.unknown()).optional().default([]),
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
  const removable = new Set(["gclid", "gbraid", "wbraid"]);
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

  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #now: () => Date;

  constructor(options: SerperShoppingAdapterOptions) {
    if (options.apiKey.trim().length === 0) {
      throw new Error("SERPER_API_KEY must not be empty");
    }
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 12_000;
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
          merchant: item.source ?? null,
          price: parseObservedGbpPrice(item.price),
          priceText: priceText(item.price),
          imageUrl: item.imageUrl ?? null,
          deliveryText: item.delivery ?? null,
          availabilityText: null,
          retrievedAt,
        }),
      );
    }

    return providerSearchResultSchema.parse({
      listings: listings.slice(0, query.limit),
      diagnostics: {
        receivedResultCount: envelope.data.shopping.length,
        rejectedResultCount,
      },
    });
  }
}
