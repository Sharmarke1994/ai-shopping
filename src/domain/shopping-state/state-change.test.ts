import { describe, expect, it } from "vitest";
import { stateChangeApplicationSchema } from "./state-change";

describe("state-change receipt contract", () => {
  it("accepts an exact no-change receipt and rejects revision drift", () => {
    const receipt = {
      id: "00000000-0000-4000-8000-000000000001",
      taskId: "00000000-0000-4000-8000-000000000002",
      sourceTaskInputId: "00000000-0000-4000-8000-000000000003",
      applicationKind: "patch",
      requestSchemaVersion: 1,
      fingerprintVersion: 1,
      requestFingerprint: "a".repeat(64),
      baseRevision: 2n,
      resultingRevision: 2n,
      outcome: "no_change",
      deltaSchemaVersion: 1,
      appliedDelta: { schemaVersion: 1, entries: [] },
      undoesApplicationId: null,
      createdAt: new Date(0),
    };
    expect(stateChangeApplicationSchema.parse(receipt).outcome).toBe(
      "no_change",
    );
    expect(() =>
      stateChangeApplicationSchema.parse({
        ...receipt,
        resultingRevision: 3n,
      }),
    ).toThrow();
  });
});
