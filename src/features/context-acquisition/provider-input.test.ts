import { describe, expect, it } from "vitest";
import {
  ContextAcquisitionInputTooLargeError,
  projectInterpretationProviderInputV1,
} from "./provider-input";

const taskId = "11111111-1111-4111-8111-111111111111";
const sourceInputId = "22222222-2222-4222-8222-222222222222";

function request() {
  return {
    schemaVersion: 1 as const,
    taskId,
    sourceInputId,
    revision: 12n,
    market: { country: "GB", language: "en-GB", currency: "GBP" },
    source: {
      schemaVersion: 1 as const,
      kind: "message" as const,
      body: "A light breathable cap for hot weather",
    },
    concepts: [],
    activeCriteria: [],
  };
}

describe("provider input projection", () => {
  it("projects bigint revisions to canonical JSON-safe strings", () => {
    const projected = projectInterpretationProviderInputV1(request());

    expect(projected.payload.interpretedRevision).toBe("12");
    expect(() => JSON.stringify(projected)).not.toThrow();
    expect(projected.payload.source).toEqual(request().source);
  });

  it("fails without truncating when the complete snapshot exceeds the bound", () => {
    expect(() => projectInterpretationProviderInputV1(request(), 10)).toThrow(
      ContextAcquisitionInputTooLargeError,
    );
  });
});
