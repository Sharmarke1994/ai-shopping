import { describe, expect, it } from "vitest";
import { validatePagePlanningTargetCoherence } from "./persistence";

const criteria = ["A", "B", "C", "D", "E", "F"] as const;
const fullAttempt = { targetCriterionIds: criteria };
const firstPassOrganic = { targetCriterionIds: criteria.slice(0, 5) };

describe("page planning target coherence", () => {
  it("allows prioritized first-pass organic subsets of the full model scope", () => {
    expect(
      validatePagePlanningTargetCoherence({
        phase: "first_pass",
        organicAttempts: [
          firstPassOrganic,
          { targetCriterionIds: ["B", "E", "F"] },
        ],
        extractionAttempt: fullAttempt,
        assessmentAttempt: fullAttempt,
      }),
    ).toBe(true);
  });

  it("rejects first-pass organic criteria outside the full model scope", () => {
    expect(
      validatePagePlanningTargetCoherence({
        phase: "first_pass",
        organicAttempts: [{ targetCriterionIds: ["A", "G"] }],
        extractionAttempt: fullAttempt,
        assessmentAttempt: fullAttempt,
      }),
    ).toBe(false);
  });

  it("retains exact target equality for deepening", () => {
    expect(
      validatePagePlanningTargetCoherence({
        phase: "deepening",
        organicAttempts: [{ targetCriterionIds: ["A"] }],
        extractionAttempt: fullAttempt,
        assessmentAttempt: fullAttempt,
      }),
    ).toBe(false);
  });

  it("rejects deepening without an organic discovery attempt", () => {
    expect(
      validatePagePlanningTargetCoherence({
        phase: "deepening",
        organicAttempts: [],
        extractionAttempt: fullAttempt,
        assessmentAttempt: fullAttempt,
      }),
    ).toBe(false);
  });

  it("does not invent organic/page work during reassessment", () => {
    expect(
      validatePagePlanningTargetCoherence({
        phase: "reassessment",
        organicAttempts: [],
        extractionAttempt: fullAttempt,
        assessmentAttempt: fullAttempt,
      }),
    ).toBe(true);
  });
});
