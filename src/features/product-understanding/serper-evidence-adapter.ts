import { z } from "zod";
import { httpUrlSchema } from "@/features/retrieval-spike/contracts";
import {
  evidenceSearchResponseSchema,
  type EvidenceSearchProvider,
} from "./evidence-search";

const endpoint = "https://google.serper.dev/search";

const organicSchema = z.looseObject({
  position: z.number().int().positive().optional(),
  title: z.string().min(1),
  link: httpUrlSchema,
  snippet: z.string().min(1).optional(),
});

const envelopeSchema = z.looseObject({
  organic: z.array(z.unknown()).optional().default([]),
  searchParameters: z.looseObject({ q: z.string().optional() }).optional(),
});

const reviewHosts = [
  "rtings.com",
  "techradar.com",
  "tomsguide.com",
  "pcmag.com",
  "expertreviews.co.uk",
  "trustedreviews.com",
  "which.co.uk",
];

function tokens(value: string) {
  return value
    .toLocaleLowerCase("en-GB")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4);
}

function classifySource(url: string, merchant: string | null) {
  const host = new URL(url).hostname.toLocaleLowerCase("en-GB");
  if (
    reviewHosts.some((entry) => host === entry || host.endsWith(`.${entry}`))
  ) {
    return "independent_review" as const;
  }
  if (
    merchant !== null &&
    tokens(merchant).some((token) =>
      host.replace(/[^a-z0-9]/g, "").includes(token),
    )
  ) {
    return "retailer" as const;
  }
  return "other" as const;
}

export class SerperEvidenceSearchAdapter implements EvidenceSearchProvider {
  readonly provider = "serper" as const;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: {
    apiKey: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  }) {
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
  }

  async search(input: {
    query: string;
    candidateTitle: string;
    merchant: string | null;
  }) {
    const response = await this.#fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": this.#apiKey,
      },
      body: JSON.stringify({
        q: input.query,
        gl: "gb",
        hl: "en",
        location: "United Kingdom",
        num: 5,
      }),
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!response.ok) {
      throw new Error(
        `Serper evidence search returned HTTP ${response.status}`,
      );
    }
    const envelope = envelopeSchema.parse(await response.json());
    const results = envelope.organic.flatMap((raw, index) => {
      const parsed = organicSchema.safeParse(raw);
      if (!parsed.success) return [];
      return [
        {
          providerResultId:
            `${parsed.data.position ?? index + 1}:${parsed.data.link}`.slice(
              0,
              500,
            ),
          rank: parsed.data.position ?? index + 1,
          title: parsed.data.title.slice(0, 500),
          url: parsed.data.link,
          snippet: parsed.data.snippet?.slice(0, 1_000) ?? null,
          sourceRole: classifySource(parsed.data.link, input.merchant),
        },
      ];
    });
    return evidenceSearchResponseSchema.parse({
      providerRequestId: null,
      results: results.slice(0, 5),
      receivedResultCount: envelope.organic.length,
    });
  }
}
