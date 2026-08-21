import { describe, expect, it } from "vitest";
import { shoppingTaskIdSchema } from "@/domain/shopping-state/ids";
import { evaluateGoldenCase, V0_05_GOLDEN_CASES } from "./golden-cases";

describe("V0-05 golden-case evaluator", () => {
  it("protects exact lookup from invented criteria", () => {
    const testCase = V0_05_GOLDEN_CASES.find(
      ({ name }) => name === "exact-model-lookup",
    );
    if (testCase === undefined) throw new Error("Missing case");
    const result = evaluateGoldenCase({
      testCase,
      action: "ask",
      brief: {
        schemaVersion: 1,
        taskId: shoppingTaskIdSchema.parse(
          "11111111-1111-4111-8111-111111111111",
        ),
        revision: 0n,
        market: { country: "GB", language: "en-GB", currency: "GBP" },
        items: [],
      },
    });
    expect(result).toEqual({
      passed: false,
      failures: ["action ask not in search"],
    });
  });
});
