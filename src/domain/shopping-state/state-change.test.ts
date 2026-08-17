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

  it("keeps patch and undo delta kinds separate and binds every undo entry to its target", () => {
    const receiptId = "00000000-0000-4000-8000-000000000001";
    const targetId = "00000000-0000-4000-8000-000000000004";
    const otherTargetId = "00000000-0000-4000-8000-000000000005";
    const before = {
      id: "00000000-0000-4000-8000-000000000010",
      lineageId: "00000000-0000-4000-8000-000000000011",
      conceptId: "00000000-0000-4000-8000-000000000012",
      authority: "user_explicit",
      strength: "hard",
      targetSemantics: "exact",
      valueSchemaVersion: 1,
      valueKind: "boolean",
      semanticValue: { schemaVersion: 1, kind: "boolean", value: true },
      lifecycle: "active",
      createdRevision: "1",
      endedRevision: null,
      supersededById: null,
    };
    const after = {
      ...before,
      lifecycle: "removed",
      endedRevision: "3",
    };
    const undoEntry = {
      kind: "criterion_ended_by_undo",
      targetApplicationId: targetId,
      before,
      after,
    };
    const base = {
      id: receiptId,
      taskId: "00000000-0000-4000-8000-000000000002",
      sourceTaskInputId: "00000000-0000-4000-8000-000000000003",
      applicationKind: "undo",
      requestSchemaVersion: 1,
      fingerprintVersion: 1,
      requestFingerprint: "a".repeat(64),
      baseRevision: 2n,
      resultingRevision: 3n,
      outcome: "applied",
      deltaSchemaVersion: 1,
      appliedDelta: { schemaVersion: 1, entries: [undoEntry] },
      undoesApplicationId: targetId,
      createdAt: new Date(0),
    };
    expect(stateChangeApplicationSchema.parse(base).applicationKind).toBe(
      "undo",
    );
    expect(() =>
      stateChangeApplicationSchema.parse({
        ...base,
        applicationKind: "patch",
        undoesApplicationId: null,
      }),
    ).toThrow();
    expect(() =>
      stateChangeApplicationSchema.parse({
        ...base,
        appliedDelta: {
          schemaVersion: 1,
          entries: [{ ...undoEntry, targetApplicationId: otherTargetId }],
        },
      }),
    ).toThrow();
    expect(() =>
      stateChangeApplicationSchema.parse({
        ...base,
        undoesApplicationId: receiptId,
        appliedDelta: {
          schemaVersion: 1,
          entries: [{ ...undoEntry, targetApplicationId: receiptId }],
        },
      }),
    ).toThrow();
  });
});
