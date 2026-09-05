import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
} from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { Response } from "openai/resources/responses/responses";
import { parseOpenAIResponse } from "@/features/context-acquisition/openai-adapter";
import type {
  ModelCallMetadata,
  ProductUnderstandingModel,
} from "./model-port";
import {
  PRODUCT_UNDERSTANDING_PROMPT_VERSION,
  productUnderstandingInstructionsForCall,
} from "./prompts";
import { productUnderstandingValidationErrorCode } from "./failure-taxonomy";
import {
  PRODUCT_UNDERSTANDING_PROVIDER_SCHEMA_VERSION,
  productUnderstandingInputV1Schema,
  productUnderstandingProviderStructuredOutputSchema,
} from "./provider-wire";

export type OpenAIProductUnderstandingConfig = Readonly<{
  model: string;
  reasoningEffort: "none" | "minimal" | "low" | "medium" | "high";
  timeoutMs: number;
  maxOutputTokens: number;
}>;

export const V0_07_OPENAI_DEFAULT_CONFIG = {
  model: "gpt-5.6-terra",
  reasoningEffort: "low",
  timeoutMs: 45_000,
  maxOutputTokens: 6_000,
} as const satisfies OpenAIProductUnderstandingConfig;

type ResponseLike = Pick<
  Response,
  "id" | "model" | "output" | "status" | "usage"
>;

function boundedProviderRequestId(value: unknown) {
  if (typeof value !== "string") return null;
  const requestId = value.trim();
  return requestId.length >= 1 && requestId.length <= 240 ? requestId : null;
}

function providerRequestIdFromError(error: unknown) {
  if (typeof error !== "object" || error === null) return null;
  const requestId =
    "requestID" in error
      ? error.requestID
      : "request_id" in error
        ? error.request_id
        : null;
  return boundedProviderRequestId(requestId);
}

function isProviderTimeout(error: unknown) {
  return (
    error instanceof APIUserAbortError ||
    error instanceof APIConnectionTimeoutError ||
    (error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}

function sanitizedProviderErrorCode(error: unknown) {
  if (error instanceof APIConnectionError) return "provider_connection_failed";
  if (typeof error !== "object" || error === null)
    return "provider_request_failed";
  const status = "status" in error ? error.status : undefined;
  const code = "code" in error ? error.code : undefined;
  if (status === 429 && code === "insufficient_quota")
    return "provider_quota_exhausted";
  if (status === 429) return "provider_rate_limited";
  if (status === 401) return "provider_authentication_failed";
  if (status === 403) return "provider_permission_denied";
  if (status === 400 || status === 404 || status === 422)
    return "provider_request_rejected";
  if (typeof status === "number" && status >= 500 && status <= 599)
    return "provider_unavailable";
  return "provider_request_failed";
}

export function createOpenAIProductUnderstandingModel(options: {
  apiKey: string;
  client?: OpenAI;
  config?: Partial<OpenAIProductUnderstandingConfig>;
}): ProductUnderstandingModel {
  const client =
    options.client ?? new OpenAI({ apiKey: options.apiKey, maxRetries: 0 });
  const config = { ...V0_07_OPENAI_DEFAULT_CONFIG, ...options.config };
  return {
    understand: async (rawInput, policy) => {
      const input = productUnderstandingInputV1Schema.parse(rawInput);
      const providerSchema = productUnderstandingProviderStructuredOutputSchema(
        {
          input,
          requireCriterionBinding: policy.requireCriterionBinding,
        },
      );
      const startedAt = performance.now();
      const metadata = (
        providerRequestId: string | null = null,
      ): ModelCallMetadata => ({
        provider: "openai",
        model: config.model,
        promptVersion: PRODUCT_UNDERSTANDING_PROMPT_VERSION,
        providerSchemaVersion: PRODUCT_UNDERSTANDING_PROVIDER_SCHEMA_VERSION,
        providerRequestId,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        inputTokens: null,
        outputTokens: null,
      });
      try {
        const image = input.sources.find(
          (source) => source.kind === "listing_image",
        );
        const content: Array<
          | { type: "input_text"; text: string }
          | {
              type: "input_image";
              image_url: string;
              detail: "low";
            }
        > = [
          {
            type: "input_text",
            text: JSON.stringify(input),
          },
        ];
        if (image !== undefined) {
          content.push({
            type: "input_image",
            image_url: image.url,
            detail: "low",
          });
        }
        const response: ResponseLike = await client.responses.create(
          {
            model: config.model,
            instructions: productUnderstandingInstructionsForCall(policy),
            input: [{ role: "user", content }],
            max_output_tokens: config.maxOutputTokens,
            reasoning: { effort: config.reasoningEffort },
            store: false,
            truncation: "disabled",
            tools: [],
            text: {
              format: zodTextFormat(
                providerSchema,
                policy.requireCriterionBinding
                  ? "product_understanding_focused_v1"
                  : "product_understanding_v1",
              ),
            },
          },
          {
            signal: AbortSignal.timeout(config.timeoutMs),
            maxRetries: 0,
          },
        );
        const result = parseOpenAIResponse({
          response,
          schema: providerSchema,
          fallbackMetadata: metadata(),
          validationErrorCode: productUnderstandingValidationErrorCode,
        });
        return {
          ...result,
          metadata: {
            ...result.metadata,
            providerRequestId: boundedProviderRequestId(
              result.metadata.providerRequestId,
            ),
          },
        };
      } catch (error) {
        const timedOut = isProviderTimeout(error);
        return {
          status: timedOut
            ? ("timed_out" as const)
            : ("provider_failed" as const),
          errorCode: timedOut
            ? "provider_timeout"
            : sanitizedProviderErrorCode(error),
          metadata: metadata(providerRequestIdFromError(error)),
        };
      }
    },
  };
}
