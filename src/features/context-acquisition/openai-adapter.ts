import OpenAI, { APIConnectionError } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { Response } from "openai/resources/responses/responses";
import type { ZodType } from "zod";
import { requireOpenAIEnvironment } from "@/infrastructure/config/environment";
import type {
  ContextAcquisitionModel,
  ModelCallMetadata,
  ModelCallResult,
} from "./model-port";
import {
  CONTEXT_ACTION_INSTRUCTIONS,
  CONTEXT_ACTION_PROMPT_VERSION,
  INTERPRETATION_INSTRUCTIONS,
  INTERPRETATION_PROMPT_VERSION,
} from "./prompts";
import {
  CONTEXT_ACTION_PROVIDER_SCHEMA_VERSION,
  INTERPRETATION_PROVIDER_SCHEMA_VERSION,
  contextActionProviderWireV1Schema,
  interpretationProviderWireV1Schema,
  type ContextActionProviderWireV1,
  type InterpretationProviderWireV1,
} from "./provider-wire";
import type { ProviderInputEnvelopeV1 } from "./provider-input";

export const V0_05_OPENAI_DEFAULT_CONFIG = {
  model: "gpt-5.6-terra",
  reasoningEffort: "low",
  timeoutMs: 45_000,
  maxOutputTokens: 4_000,
} as const satisfies OpenAIContextAcquisitionConfig;

export type OpenAIContextAcquisitionConfig = Readonly<{
  model: string;
  reasoningEffort: "none" | "minimal" | "low" | "medium" | "high";
  timeoutMs: number;
  maxOutputTokens: number;
}>;

type ResponseLike = Pick<
  Response,
  "id" | "model" | "output" | "status" | "usage"
>;

export function createOpenAIContextAcquisitionModel(options?: {
  client?: OpenAI;
  environment?: Readonly<Record<string, string | undefined>>;
  config?: Partial<OpenAIContextAcquisitionConfig>;
}): ContextAcquisitionModel {
  const environment = options?.environment ?? process.env;
  const openAIEnvironment =
    options?.client === undefined
      ? requireOpenAIEnvironment(environment)
      : { OPENAI_API_KEY: "injected-client" as const };
  const client =
    options?.client ??
    new OpenAI({
      apiKey: openAIEnvironment.OPENAI_API_KEY,
      maxRetries: 0,
    });
  const config: OpenAIContextAcquisitionConfig = {
    model:
      options?.config?.model ??
      ("OPENAI_CONTEXT_MODEL" in openAIEnvironment
        ? openAIEnvironment.OPENAI_CONTEXT_MODEL
        : undefined) ??
      V0_05_OPENAI_DEFAULT_CONFIG.model,
    reasoningEffort:
      options?.config?.reasoningEffort ??
      V0_05_OPENAI_DEFAULT_CONFIG.reasoningEffort,
    timeoutMs:
      options?.config?.timeoutMs ?? V0_05_OPENAI_DEFAULT_CONFIG.timeoutMs,
    maxOutputTokens:
      options?.config?.maxOutputTokens ??
      V0_05_OPENAI_DEFAULT_CONFIG.maxOutputTokens,
  };

  return {
    interpret: (input) =>
      callStructuredOutput({
        client,
        config,
        input,
        instructions: INTERPRETATION_INSTRUCTIONS,
        promptVersion: INTERPRETATION_PROMPT_VERSION,
        providerSchemaVersion: INTERPRETATION_PROVIDER_SCHEMA_VERSION,
        schemaName: "shopping_interpretation_v1",
        schema: interpretationProviderWireV1Schema,
      }),
    selectAction: (input) =>
      callStructuredOutput({
        client,
        config,
        input,
        instructions: CONTEXT_ACTION_INSTRUCTIONS,
        promptVersion: CONTEXT_ACTION_PROMPT_VERSION,
        providerSchemaVersion: CONTEXT_ACTION_PROVIDER_SCHEMA_VERSION,
        schemaName: "shopping_context_action_v1",
        schema: contextActionProviderWireV1Schema,
      }),
  };
}

async function callStructuredOutput<T>(options: {
  client: OpenAI;
  config: OpenAIContextAcquisitionConfig;
  input: ProviderInputEnvelopeV1;
  instructions: string;
  promptVersion: string;
  providerSchemaVersion: number;
  schemaName: string;
  schema: ZodType<T>;
}): Promise<ModelCallResult<T>> {
  const startedAt = performance.now();
  const deadline = startedAt + options.config.timeoutMs;
  const emptyMetadata = (): ModelCallMetadata => ({
    provider: "openai",
    model: options.config.model,
    promptVersion: options.promptVersion,
    providerSchemaVersion: options.providerSchemaVersion,
    providerRequestId: null,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    inputTokens: null,
    outputTokens: null,
  });

  for (let transportAttempt = 1; transportAttempt <= 2; transportAttempt += 1) {
    try {
      const remainingMs = Math.max(1, Math.round(deadline - performance.now()));
      const response = await options.client.responses.create(
        {
          model: options.config.model,
          instructions: options.instructions,
          input: JSON.stringify(options.input),
          max_output_tokens: options.config.maxOutputTokens,
          reasoning: { effort: options.config.reasoningEffort },
          store: false,
          truncation: "disabled",
          text: {
            format: zodTextFormat(options.schema, options.schemaName),
          },
        },
        {
          signal: AbortSignal.timeout(remainingMs),
          maxRetries: 0,
        },
      );
      return parseOpenAIResponse({
        response,
        schema: options.schema,
        fallbackMetadata: emptyMetadata(),
      });
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError");
      if (
        transportAttempt === 1 &&
        !timedOut &&
        isRetryableProviderError(error) &&
        performance.now() < deadline
      ) {
        continue;
      }
      return {
        status: timedOut ? "timed_out" : "provider_failed",
        errorCode: timedOut ? "provider_timeout" : "provider_request_failed",
        metadata: emptyMetadata(),
      };
    }
  }
  return {
    status: "provider_failed",
    errorCode: "provider_request_failed",
    metadata: emptyMetadata(),
  };
}

export function isRetryableProviderError(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  if (error instanceof APIConnectionError) return true;
  const status = "status" in error ? error.status : undefined;
  return (
    status === 408 ||
    status === 409 ||
    status === 429 ||
    (typeof status === "number" && status >= 500 && status <= 599)
  );
}

export function parseOpenAIResponse<T>(options: {
  response: ResponseLike;
  schema: ZodType<T>;
  fallbackMetadata: ModelCallMetadata;
}): ModelCallResult<T> {
  const metadata: ModelCallMetadata = {
    ...options.fallbackMetadata,
    model: options.response.model,
    providerRequestId: options.response.id,
    inputTokens: options.response.usage?.input_tokens ?? null,
    outputTokens: options.response.usage?.output_tokens ?? null,
  };

  if (options.response.status === "incomplete") {
    return {
      status: "incomplete",
      errorCode: "provider_response_incomplete",
      metadata,
    };
  }
  if (
    options.response.status !== undefined &&
    options.response.status !== "completed"
  ) {
    return {
      status: "provider_failed",
      errorCode: `provider_status_${options.response.status}`,
      metadata,
    };
  }

  const messages = options.response.output.filter(
    (item) => item.type === "message" && item.role === "assistant",
  );
  if (messages.length !== 1) {
    return {
      status: "malformed",
      errorCode: "expected_one_assistant_message",
      metadata,
    };
  }
  const content = messages[0]?.content ?? [];
  if (content.length !== 1) {
    return {
      status: "malformed",
      errorCode: "expected_one_assistant_content_item",
      metadata,
    };
  }
  const item = content[0];
  if (item?.type === "refusal") {
    return { status: "refused", errorCode: "provider_refusal", metadata };
  }
  if (item?.type !== "output_text") {
    return {
      status: "malformed",
      errorCode: "expected_structured_output_text",
      metadata,
    };
  }
  try {
    return {
      status: "completed",
      value: options.schema.parse(JSON.parse(item.text)),
      metadata,
    };
  } catch {
    return {
      status: "malformed",
      errorCode: "structured_output_validation_failed",
      metadata,
    };
  }
}

export type OpenAIInterpretationWire = InterpretationProviderWireV1;
export type OpenAIContextActionWire = ContextActionProviderWireV1;
