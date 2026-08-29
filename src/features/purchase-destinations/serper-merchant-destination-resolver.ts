import { z } from "zod";
import {
  merchantDestinationResolutionRequestSchema,
  merchantDestinationResolutionResultSchema,
  type MerchantDestinationRejectionCode,
  type MerchantDestinationResolver,
  MerchantDestinationResolverError,
} from "./contracts";
import {
  buildExactOfferMerchantQuery,
  evaluateExactOfferMerchantDestination,
} from "./exact-offer-policy";

const SERPER_SEARCH_ENDPOINT = "https://google.serper.dev/search";

const serperOrganicItemSchema = z.looseObject({
  position: z.number().int().positive().optional(),
  title: z.string().min(1).max(1_000),
  link: z.string().min(1).max(4_000),
});

const serperOrganicEnvelopeSchema = z.looseObject({
  organic: z.array(z.unknown()).optional().default([]),
});

export class SerperMerchantDestinationError extends MerchantDestinationResolverError {
  constructor(
    message: string,
    code: "provider_failed" | "invalid_provider_result",
    readonly status: number | null,
  ) {
    super(message, code);
    this.name = "SerperMerchantDestinationError";
  }
}

export type SerperMerchantDestinationResolverOptions = Readonly<{
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  onRequest?: (requestId: string) => void;
}>;

export class SerperMerchantDestinationResolver implements MerchantDestinationResolver {
  readonly provider = "serper" as const;
  readonly maxRequestDurationMs: number;

  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #onRequest: NonNullable<
    SerperMerchantDestinationResolverOptions["onRequest"]
  >;

  constructor(options: SerperMerchantDestinationResolverOptions) {
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
    this.#onRequest = options.onRequest ?? (() => undefined);
  }

  async resolve(requestInput: unknown) {
    const request =
      merchantDestinationResolutionRequestSchema.parse(requestInput);
    if (
      request.queryText !==
      buildExactOfferMerchantQuery({
        title: request.title,
        merchant: request.merchant,
      })
    ) {
      throw new TypeError(
        "Merchant destination query must match the exact listing and merchant",
      );
    }
    let response: Response;
    try {
      this.#onRequest(request.requestId);
      response = await this.#fetch(SERPER_SEARCH_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": this.#apiKey,
        },
        body: JSON.stringify({
          q: request.queryText,
          gl: "gb",
          hl: "en",
          location: "United Kingdom",
          num: 5,
        }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      throw new SerperMerchantDestinationError(
        error instanceof Error
          ? error.message
          : "Serper merchant destination request failed",
        "provider_failed",
        null,
      );
    }
    if (!response.ok) {
      throw new SerperMerchantDestinationError(
        `Serper returned HTTP ${response.status}`,
        "provider_failed",
        response.status,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new SerperMerchantDestinationError(
        "Serper returned invalid JSON",
        "invalid_provider_result",
        200,
      );
    }
    const envelope = serperOrganicEnvelopeSchema.safeParse(body);
    if (!envelope.success) {
      throw new SerperMerchantDestinationError(
        "Serper returned an invalid organic envelope",
        "invalid_provider_result",
        200,
      );
    }

    const considered = envelope.data.organic.slice(0, 5);
    let leadingRejection: MerchantDestinationRejectionCode | null = null;
    for (const [index, rawItem] of considered.entries()) {
      const parsed = serperOrganicItemSchema.safeParse(rawItem);
      if (!parsed.success) {
        leadingRejection ??= "invalid_result";
        continue;
      }
      const decision = evaluateExactOfferMerchantDestination({
        candidateTitle: request.title,
        merchant: request.merchant,
        resultTitle: parsed.data.title,
        resultUrl: parsed.data.link,
      });
      if (decision.accepted) {
        return merchantDestinationResolutionResultSchema.parse({
          outcome: "resolved",
          destinationUrl: decision.destinationUrl,
          acceptedResultTitle: parsed.data.title,
          observedResultUrl:
            parsed.data.link === decision.destinationUrl
              ? null
              : parsed.data.link,
          consideredResultCount: index + 1,
        });
      }
      leadingRejection ??= decision.rejectionCode;
    }

    return merchantDestinationResolutionResultSchema.parse({
      outcome: "rejected",
      rejectionCode: leadingRejection ?? "no_results",
      consideredResultCount: considered.length,
    });
  }
}
