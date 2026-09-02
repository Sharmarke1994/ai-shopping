import { describe, expect, it } from "vitest";
import { safeDiagnosticJsonStringify } from "./diagnostic-json";

describe("safeDiagnosticJsonStringify", () => {
  it("serializes bigint values as deterministic decimal strings", () => {
    expect(
      safeDiagnosticJsonStringify({ currentRevision: 12n, nested: [3n] }),
    ).toBe('{"currentRevision":"12","nested":["3"]}');
  });

  it("supports pretty diagnostic artifacts without changing values", () => {
    expect(safeDiagnosticJsonStringify({ value: 4n }, 2)).toContain(
      '"value": "4"',
    );
  });
});
