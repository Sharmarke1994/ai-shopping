import OpenAI, { APIConnectionTimeoutError, APIUserAbortError } from "openai";
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
      const metadata = (): ModelCallMetadata => ({
        provider: "openai",
        model: config.model,
        promptVersion: PRODUCT_UNDERSTANDING_PROMPT_VERSION,
        providerSchemaVersion: PRODUCT_UNDERSTANDING_PROVIDER_SCHEMA_VERSION,
        providerRequestId: null,
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
        return parseOpenAIResponse({
          response,
          schema: providerSchema,
          fallbackMetadata: metadata(),
          validationErrorCode: productUnderstandingValidationErrorCode,
        });
      } catch (error) {
        const timedOut =
          error instanceof APIUserAbortError ||
          error instanceof APIConnectionTimeoutError ||
          (error instanceof Error &&
            ["AbortError", "TimeoutError"].includes(error.name));
        return {
          status: timedOut
            ? ("timed_out" as const)
            : ("provider_failed" as const),
          errorCode: timedOut ? "provider_timeout" : "provider_request_failed",
          metadata: metadata(),
        };
      }
    },
  };
}
