import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
} from "openai";
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
  CONTEXT_ACTION_PROVIDER_SCHEMA_VERSION_V2,
  INTERPRETATION_PROVIDER_SCHEMA_VERSION_V2,
  contextActionProviderWireV2Schema,
  interpretationProviderWireV2Schema,
  type ContextActionProviderWireV2,
  type InterpretationProviderWireV2,
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
        providerSchemaVersion: INTERPRETATION_PROVIDER_SCHEMA_VERSION_V2,
        schemaName: "shopping_interpretation_v2",
        schema: interpretationProviderWireV2Schema,
      }),
    selectAction: (input) =>
      callStructuredOutput({
        client,
        config,
        input,
        instructions: CONTEXT_ACTION_INSTRUCTIONS,
        promptVersion: CONTEXT_ACTION_PROMPT_VERSION,
        providerSchemaVersion: CONTEXT_ACTION_PROVIDER_SCHEMA_VERSION_V2,
        schemaName: "shopping_context_action_v2",
        schema: contextActionProviderWireV2Schema,
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
      const timedOut = isProviderTimeout(error);
      const retryDelayMs = providerRetryDelayMs(error);
      if (
        transportAttempt === 1 &&
        !timedOut &&
        isRetryableProviderError(error) &&
        retryDelayMs !== null &&
        retryDelayMs < deadline - performance.now()
      ) {
        if (retryDelayMs > 0) await wait(retryDelayMs);
        continue;
      }
      return {
        status: timedOut ? "timed_out" : "provider_failed",
        errorCode: timedOut
          ? "provider_timeout"
          : sanitizedProviderErrorCode(error),
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
  const code = "code" in error ? error.code : undefined;
  if (status === 429 && code === "insufficient_quota") return false;
  return (
    status === 408 ||
    status === 409 ||
    status === 429 ||
    (typeof status === "number" && status >= 500 && status <= 599)
  );
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

function providerRetryDelayMs(error: unknown) {
  if (!isRetryableProviderError(error)) return null;
  if (error instanceof APIConnectionError) return 0;
  if (typeof error !== "object" || error === null) return 0;
  const headers =
    "headers" in error &&
    typeof error.headers === "object" &&
    error.headers !== null &&
    "get" in error.headers &&
    typeof error.headers.get === "function"
      ? (error.headers as Readonly<{
          get(name: string): string | null | undefined;
        }>)
      : null;
  const retryAfterMs = headers?.get("retry-after-ms");
  if (retryAfterMs !== null && retryAfterMs !== undefined) {
    const milliseconds = Number(retryAfterMs);
    if (Number.isFinite(milliseconds) && milliseconds >= 0)
      return Math.ceil(milliseconds);
  }
  const retryAfter = headers?.get("retry-after");
  if (retryAfter !== null && retryAfter !== undefined) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0)
      return Math.ceil(seconds * 1_000);
    const timestamp = Date.parse(retryAfter);
    if (Number.isFinite(timestamp)) return Math.max(0, timestamp - Date.now());
  }
  const status = "status" in error ? error.status : undefined;
  return status === 429 ? 1_000 : 0;
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
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

export type OpenAIInterpretationWire = InterpretationProviderWireV2;
export type OpenAIContextActionWire = ContextActionProviderWireV2;
