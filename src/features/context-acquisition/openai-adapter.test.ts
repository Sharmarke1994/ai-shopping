import { zodTextFormat } from "openai/helpers/zod";
import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import type { ModelCallMetadata } from "./model-port";
import {
  createOpenAIContextAcquisitionModel,
  parseOpenAIResponse,
} from "./openai-adapter";
import { interpretationProviderWireV1Schema } from "./provider-wire";

const metadata: ModelCallMetadata = {
  provider: "openai",
  model: "test-model",
  promptVersion: "test-prompt",
  providerSchemaVersion: 1,
  providerRequestId: null,
  durationMs: 1,
  inputTokens: null,
  outputTokens: null,
};

function response(output: unknown[], status = "completed") {
  return {
    id: "resp_test",
    model: "test-model",
    output,
    status,
    usage: undefined,
  } as unknown as Parameters<typeof parseOpenAIResponse>[0]["response"];
}

function completedNoChangeResponse() {
  return response([
    {
      type: "message",
      id: "m",
      role: "assistant",
      status: "completed",
      content: [
        {
          type: "output_text",
          annotations: [],
          logprobs: [],
          text: JSON.stringify({
            providerSchemaVersion: 1,
            outcome: "no_change",
            operations: [],
            ambiguities: [],
          }),
        },
      ],
    },
  ]);
}

function createTestModel(
  create: (...arguments_: unknown[]) => Promise<unknown>,
) {
  const client = {
    responses: { create },
  } as unknown as OpenAI;
  return createOpenAIContextAcquisitionModel({
    client,
    environment: {},
    config: { model: "test-model", timeoutMs: 1_000 },
  });
}

describe("OpenAI context-acquisition adapter", () => {
  it("generates an object-root strict Structured Outputs schema", () => {
    const schema = zodTextFormat(
      interpretationProviderWireV1Schema,
      "shopping_interpretation_v1",
    ).schema as Record<string, unknown>;

    expect(schema.type).toBe("object");
    expect(schema).not.toHaveProperty("anyOf");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual([
      "providerSchemaVersion",
      "outcome",
      "operations",
      "ambiguities",
    ]);
  });

  it("ignores reasoning items and accepts exactly one assistant payload", () => {
    const result = parseOpenAIResponse({
      response: response([
        { type: "reasoning", id: "r", summary: [] },
        {
          type: "message",
          id: "m",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              annotations: [],
              logprobs: [],
              text: JSON.stringify({
                providerSchemaVersion: 1,
                outcome: "no_change",
                operations: [],
                ambiguities: [],
              }),
            },
          ],
        },
      ]),
      schema: interpretationProviderWireV1Schema,
      fallbackMetadata: metadata,
    });

    expect(result.status).toBe("completed");
  });

  it("fails closed for refusal, incomplete, multiple messages, and invalid JSON", () => {
    const cases = [
      response([
        {
          type: "message",
          id: "m",
          role: "assistant",
          status: "completed",
          content: [{ type: "refusal", refusal: "no" }],
        },
      ]),
      response([], "incomplete"),
      response([
        { type: "message", role: "assistant", content: [] },
        { type: "message", role: "assistant", content: [] },
      ]),
      response([
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "{" }],
        },
      ]),
    ];

    expect(
      cases.map(
        (value) =>
          parseOpenAIResponse({
            response: value,
            schema: interpretationProviderWireV1Schema,
            fallbackMetadata: metadata,
          }).status,
      ),
    ).toEqual(["refused", "incomplete", "malformed", "malformed"]);
  });

  it("retries one rate-limit transport failure against the same snapshot", async () => {
    let calls = 0;
    const model = createTestModel(async () => {
      calls += 1;
      if (calls === 1)
        throw Object.assign(new Error("rate limited"), { status: 429 });
      return completedNoChangeResponse();
    });
    const result = await model.interpret({
      providerInputSchemaVersion: 1,
      payload: {},
    });
    expect(result.status).toBe("completed");
    expect(calls).toBe(2);
  });

  it("retries one known OpenAI transport failure", async () => {
    let calls = 0;
    const model = createTestModel(async () => {
      calls += 1;
      if (calls === 1) {
        throw new OpenAI.APIConnectionError({
          cause: new Error("connection reset"),
        });
      }
      return completedNoChangeResponse();
    });

    const result = await model.interpret({
      providerInputSchemaVersion: 1,
      payload: {},
    });

    expect(result.status).toBe("completed");
    expect(calls).toBe(2);
  });

  it.each([
    new Error("deterministic failure"),
    new TypeError("invalid deterministic input"),
    Object.assign(new Error("invalid non-HTTP status"), { status: 600 }),
  ])("does not retry a non-transient failure %s", async (error) => {
    let calls = 0;
    const model = createTestModel(async () => {
      calls += 1;
      throw error;
    });

    const result = await model.interpret({
      providerInputSchemaVersion: 1,
      payload: {},
    });

    expect(result.status).toBe("provider_failed");
    expect(calls).toBe(1);
  });

  it("disables SDK retries for an injected client at the request boundary", async () => {
    let requestOptions: unknown;
    const model = createTestModel(async (_body, options) => {
      requestOptions = options;
      return completedNoChangeResponse();
    });

    const result = await model.interpret({
      providerInputSchemaVersion: 1,
      payload: {},
    });

    expect(result.status).toBe("completed");
    expect(requestOptions).toMatchObject({ maxRetries: 0 });
  });

  it.each([
    {
      name: "refusal",
      value: response([
        {
          type: "message",
          id: "m",
          role: "assistant",
          status: "completed",
          content: [{ type: "refusal", refusal: "no" }],
        },
      ]),
      expectedStatus: "refused",
    },
    {
      name: "incomplete response",
      value: response([], "incomplete"),
      expectedStatus: "incomplete",
    },
    {
      name: "invalid structured output",
      value: response([
        {
          type: "message",
          id: "m",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "{" }],
        },
      ]),
      expectedStatus: "malformed",
    },
  ])("does not transport-retry $name", async ({ value, expectedStatus }) => {
    let calls = 0;
    const model = createTestModel(async () => {
      calls += 1;
      return value;
    });

    const result = await model.interpret({
      providerInputSchemaVersion: 1,
      payload: {},
    });

    expect(result.status).toBe(expectedStatus);
    expect(calls).toBe(1);
  });
});
