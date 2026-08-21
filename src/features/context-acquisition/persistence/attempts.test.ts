import { describe, expect, it } from "vitest";
import { contextAcquisitionAttemptInputSchema } from "./attempts";

const base = {
  orchestrationRunId: "11111111-1111-4111-8111-111111111111",
  taskId: "22222222-2222-4222-8222-222222222222",
  sourceTaskInputId: "33333333-3333-4333-8333-333333333333",
  snapshotRevision: 0n,
  stage: "interpretation" as const,
  attemptOrdinal: 1,
  status: "completed" as const,
  metadata: {
    provider: "openai",
    model: "model",
    promptVersion: "prompt",
    providerSchemaVersion: 1,
    providerRequestId: "resp",
    durationMs: 12,
    inputTokens: 10,
    outputTokens: 4,
  },
  interpretationProposal: {
    providerSchemaVersion: 1,
    outcome: "no_change" as const,
    operations: [],
    ambiguities: [],
  },
  contextActionProposal: null,
  errorCode: null,
  stateChangeApplicationId: "44444444-4444-4444-8444-444444444444",
  contextActionId: null,
};

describe("context acquisition attempt contract", () => {
  it("accepts a complete interpretation attempt", () => {
    expect(contextAcquisitionAttemptInputSchema.parse(base)).toMatchObject({
      status: "completed",
      stage: "interpretation",
    });
  });

  it("rejects completed attempts without a bound result", () => {
    expect(() =>
      contextAcquisitionAttemptInputSchema.parse({
        ...base,
        stateChangeApplicationId: null,
      }),
    ).toThrow();
  });
});
