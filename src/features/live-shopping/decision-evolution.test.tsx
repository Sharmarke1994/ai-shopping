import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { decisionTransitionSchema } from "@/features/product-understanding/decision-transition";
import { DecisionEvolution } from "./live-shopping";

const transition = decisionTransitionSchema.parse({
  previousRevision: "1",
  currentRevision: "2",
  changes: [
    {
      conceptId: "11111111-1111-4111-8111-111111111111",
      criterionId: null,
      label: "Reviews",
      kind: "strength_changed",
      before: "Strong preference",
      after: "Preference",
    },
    {
      conceptId: "22222222-2222-4222-8222-222222222222",
      criterionId: "33333333-3333-4333-8333-333333333333",
      label: "Comfort for long workdays",
      kind: "added",
      before: null,
      after: "Strong preference",
    },
  ],
  unchangedCriteria: true,
  previous: { state: "no_clear_winner", leaderId: null, leaderTitle: null },
  current: {
    state: "ready_to_choose",
    leaderId: "44444444-4444-4444-8444-444444444444",
    leaderTitle: "Mouse A",
  },
  movement: "tie_broken",
  cause: "brief_refinement",
  headline: "Your priorities broke the tie",
  explanation: "Comfort now separates Mouse A from the alternative.",
  causalCriterionIds: [],
  evidence: "reused",
  evidenceExplanation:
    "Existing product evidence was reused and re-evaluated against your updated priorities.",
  candidateContinuity: "same_listings",
  unresolved: null,
});
describe("Decision Evolution presentation", () => {
  it("shows the short change first and keeps earlier evidence expandable", () => {
    render(<DecisionEvolution transition={transition} />);
    const region = screen.getByRole("region", { name: "What changed" });
    expect(
      within(region).getByText(
        "Comfort now separates Mouse A from the alternative.",
      ),
    ).toBeVisible();
    expect(within(region).getByText(/Earlier evidence:/)).not.toBeVisible();
    fireEvent.click(within(region).getByText("See the change in context"));
    expect(within(region).getByText(/Earlier evidence:/)).toBeVisible();
    expect(region).not.toHaveTextContent(
      /TaskRevision|CriterionAssessment|researchRun|11111111/,
    );
  });
  it("announces pending reassessment once and never inserts a purchase action", () => {
    render(
      <DecisionEvolution
        transition={{
          ...transition,
          movement: "reassessing",
          explanation:
            "Re-evaluating the products against your updated priorities.",
        }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Re-evaluating");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  it("shows no invented history when a prior basis is unavailable", () => {
    render(
      <DecisionEvolution
        transition={{ ...transition, previous: null, movement: "no_history" }}
      />,
    );
    fireEvent.click(screen.getByText("See the change in context"));
    expect(
      screen.getByText("No earlier decision was recorded for this change."),
    ).toBeVisible();
    expect(screen.queryByText(/Earlier evidence:/)).not.toBeInTheDocument();
  });
  it("renders nothing on the initial revision", () => {
    const { container } = render(<DecisionEvolution transition={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
