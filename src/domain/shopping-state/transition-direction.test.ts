import { describe, expect, it } from "vitest";
import {
  assertTransitionIntent,
  classifyTransitionDirection,
} from "./transition-direction";
import { ContradictoryTransitionIntentError } from "./errors";

const categorical = (
  operator: "include" | "exclude" | "prefer",
  values: string[],
  strength: "hard" | "preference" = "hard",
) => ({
  strength,
  targetSemantics: "categorical" as const,
  semanticValue: {
    schemaVersion: 1 as const,
    kind: "categorical" as const,
    operator,
    values,
  },
});

describe("narrow transition direction guard", () => {
  it("classifies include and exclude set relations in opposite directions", () => {
    expect(
      classifyTransitionDirection(
        categorical("include", ["black"]),
        categorical("include", ["black", "navy"]),
      ),
    ).toBe("relax");
    expect(
      classifyTransitionDirection(
        categorical("include", ["black", "navy"]),
        categorical("include", ["black"]),
      ),
    ).toBe("tighten");
    expect(
      classifyTransitionDirection(
        categorical("exclude", ["black", "navy"]),
        categorical("exclude", ["black"]),
      ),
    ).toBe("relax");
    expect(
      classifyTransitionDirection(
        categorical("exclude", ["black"]),
        categorical("exclude", ["black", "navy"]),
      ),
    ).toBe("tighten");
  });

  it("does not invent direction for prefer, operator changes, or mixed strength", () => {
    expect(
      classifyTransitionDirection(
        categorical("prefer", ["black"]),
        categorical("prefer", ["black", "navy"]),
      ),
    ).toBeNull();
    expect(
      classifyTransitionDirection(
        categorical("include", ["black"]),
        categorical("exclude", ["black"]),
      ),
    ).toBeNull();
    expect(
      classifyTransitionDirection(
        categorical("include", ["black"], "hard"),
        categorical("include", ["black", "navy"], "preference"),
      ),
    ).toBeNull();
  });

  it("rejects only a provably contradictory declaration", () => {
    const before = {
      strength: "hard" as const,
      targetSemantics: "range" as const,
      semanticValue: {
        schemaVersion: 1 as const,
        kind: "money" as const,
        mode: "ceiling" as const,
        amountMinor: 3000,
        currency: "GBP" as const,
      },
    };
    const after = {
      ...before,
      semanticValue: { ...before.semanticValue, amountMinor: 2000 },
    };
    expect(() => assertTransitionIntent("relax", before, after)).toThrow(
      ContradictoryTransitionIntentError,
    );
    expect(() =>
      assertTransitionIntent("tighten", before, after),
    ).not.toThrow();
  });
});
