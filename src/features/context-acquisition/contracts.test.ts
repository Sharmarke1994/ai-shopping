import { describe, expect, it } from "vitest";
import {
  UnsupportedContextActionError,
  validateContextActionCapabilities,
} from "./contracts";

describe("context-action capability firewall", () => {
  it("rejects unavailable actions even when provider output is well formed", () => {
    expect(() =>
      validateContextActionCapabilities({
        proposal: {
          schemaVersion: 1,
          action: "show_refine",
          rationale: { summary: "Refine the current results." },
        },
        capabilities: { canSearch: true, canShowRefine: false },
      }),
    ).toThrow(UnsupportedContextActionError);
  });

  it("rejects an ASK that claims unavailable search can proceed", () => {
    expect(() =>
      validateContextActionCapabilities({
        proposal: {
          schemaVersion: 1,
          action: "ask",
          question: {
            prompt: "What size?",
            responseMode: "open_text",
            options: [],
            expectedImpact: "eligibility",
            whyNow: "Size changes eligibility.",
            canSearchWithoutAnswer: true,
          },
        },
        capabilities: { canSearch: false, canShowRefine: false },
      }),
    ).toThrow(UnsupportedContextActionError);
  });
});
