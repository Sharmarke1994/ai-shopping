import { describe, expect, it } from "vitest";
import { interpretationCoverageProviderWireV1Schema } from "./interpretation-coverage";

const issueKinds = [
  "missing_explicit_meaning",
  "strength_mismatch",
  "direction_mismatch",
  "conditional_loss",
  "invented_meaning",
  "wrong_change_of_mind",
] as const;

describe("interpretation coverage provider contract", () => {
  it("accepts a clean complete verdict", () => {
    expect(
      interpretationCoverageProviderWireV1Schema.parse({
        providerSchemaVersion: 1,
        verdict: "complete",
        issues: [],
      }),
    ).toMatchObject({ verdict: "complete", issues: [] });
  });

  it.each(issueKinds)("accepts bounded %s repair issue", (kind) => {
    expect(
      interpretationCoverageProviderWireV1Schema.parse({
        providerSchemaVersion: 1,
        verdict: "needs_repair",
        issues: [{ kind, summary: "A bounded semantic issue" }],
      }),
    ).toMatchObject({ verdict: "needs_repair" });
  });

  it("rejects a complete verdict that hides issues", () => {
    expect(() =>
      interpretationCoverageProviderWireV1Schema.parse({
        providerSchemaVersion: 1,
        verdict: "complete",
        issues: [{ kind: "invented_meaning", summary: "not complete" }],
      }),
    ).toThrow();
  });

  it("rejects an empty repair verdict and more than four issues", () => {
    expect(() =>
      interpretationCoverageProviderWireV1Schema.parse({
        providerSchemaVersion: 1,
        verdict: "needs_repair",
        issues: [],
      }),
    ).toThrow();
    expect(() =>
      interpretationCoverageProviderWireV1Schema.parse({
        providerSchemaVersion: 1,
        verdict: "needs_repair",
        issues: Array.from({ length: 5 }, () => ({
          kind: "missing_explicit_meaning",
          summary: "too many",
        })),
      }),
    ).toThrow();
  });
});
