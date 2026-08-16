import { describe, expect, it } from "vitest";
import {
  createStateApplicationFingerprint,
  parseStateApplicationCommand,
  rawApplyStatePatchCommandV1Schema,
} from "./state-patch";
import { InvalidPatchReferenceError } from "./errors";

const taskId = "00000000-0000-4000-8000-000000000001";
const inputId = "00000000-0000-4000-8000-000000000002";

function command(label = "Brand", value = "Nike") {
  return {
    applicationSchemaVersion: 1 as const,
    applicationKind: "patch" as const,
    taskId,
    expectedRevision: 0n,
    source: { kind: "user_explicit" as const, inputId },
    patch: {
      schemaVersion: 1 as const,
      outcome: "change" as const,
      operations: [
        {
          op: "create_concept" as const,
          localRef: "concept_brand",
          label,
          definition: "Preferred manufacturer",
          valueFamily: "categorical" as const,
          canonicalUnit: null,
        },
        {
          op: "add_criterion" as const,
          concept: { kind: "created" as const, localRef: "concept_brand" },
          target: {
            strength: "preference" as const,
            targetSemantics: "categorical" as const,
            semanticValue: {
              schemaVersion: 1 as const,
              kind: "categorical" as const,
              operator: "prefer" as const,
              values: [value],
            },
          },
        },
      ],
    },
  };
}

describe("V0-04 patch boundary", () => {
  it("is strict and rejects server-owned or unknown patch fields", () => {
    expect(() =>
      rawApplyStatePatchCommandV1Schema.parse({
        ...command(),
        currentRevision: 1n,
      }),
    ).toThrow();
    expect(() =>
      rawApplyStatePatchCommandV1Schema.parse({
        ...command(),
        patch: { schemaVersion: 1, outcome: "change", operations: [] },
      }),
    ).toThrow();
  });

  it("fingerprints raw accepted values before semantic transforms", () => {
    const plain = parseStateApplicationCommand(command("Brand", "Nike"));
    const spaced = parseStateApplicationCommand(command("Brand", " Nike "));
    expect(plain.fingerprint).not.toBe(spaced.fingerprint);
    if (
      plain.command.applicationKind !== "patch" ||
      spaced.command.applicationKind !== "patch" ||
      plain.command.patch.outcome !== "change" ||
      spaced.command.patch.outcome !== "change"
    )
      throw new Error("Expected change patches");
    expect(plain.command.patch.operations[1]).toMatchObject({
      target: { semanticValue: { values: ["Nike"] } },
    });
    expect(spaced.command.patch.operations[1]).toMatchObject({
      target: { semanticValue: { values: ["Nike"] } },
    });
  });

  it("uses canonical object-key order but preserves ordered operations", () => {
    const original = command();
    const reordered = {
      patch: original.patch,
      source: original.source,
      expectedRevision: original.expectedRevision,
      taskId: original.taskId,
      applicationKind: original.applicationKind,
      applicationSchemaVersion: original.applicationSchemaVersion,
    };
    expect(createStateApplicationFingerprint(original)).toBe(
      createStateApplicationFingerprint(reordered),
    );
    const reversed = {
      ...original,
      patch: {
        ...original.patch,
        operations: [...original.patch.operations].reverse(),
      },
    };
    expect(() => parseStateApplicationCommand(reversed)).toThrow(
      InvalidPatchReferenceError,
    );
  });

  it("rejects forward, duplicate, unused, and unstable semantic-set refs", () => {
    const base = command();
    const operations = base.patch.operations;
    expect(() =>
      parseStateApplicationCommand({
        ...base,
        patch: {
          ...base.patch,
          operations: [operations[0], operations[0], operations[1]],
        },
      }),
    ).toThrow(InvalidPatchReferenceError);
    expect(() =>
      parseStateApplicationCommand({
        ...base,
        patch: { ...base.patch, operations: [operations[0]] },
      }),
    ).toThrow(InvalidPatchReferenceError);
    expect(() =>
      parseStateApplicationCommand({
        ...base,
        patch: { ...base.patch, operations: [operations[1], operations[0]] },
      }),
    ).toThrow(InvalidPatchReferenceError);
  });

  it("requires confirmed origin and causal inputs to differ", () => {
    expect(() =>
      parseStateApplicationCommand({
        ...command(),
        source: {
          kind: "user_confirmed",
          originInputId: inputId,
          confirmationInputId: inputId,
        },
      }),
    ).toThrow(InvalidPatchReferenceError);
  });
});
