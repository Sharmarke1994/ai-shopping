import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createTestDatabaseConnection, resetShoppingState } from "./helpers";
import { seedFounderJourney } from "../support/founder-journey";
import {
  chairCorpus,
  vacuumCorpus,
  coffeeCorpus,
} from "../support/founder-product-evidence";
import { loadCurrentDecisionSupport } from "@/features/product-understanding/persistence";
import {
  setLiveListingSaved,
  setLiveListingRejected,
} from "@/features/live-shopping/application";

let connection: ReturnType<typeof createTestDatabaseConnection>;
beforeAll(() => {
  connection = createTestDatabaseConnection();
});
afterAll(async () => connection.client.end({ timeout: 5 }));
beforeEach(async () => resetShoppingState(connection));

it.each([
  ["office-chair", chairCorpus, "leader_with_tradeoff", chairCorpus[1]!.title],
  [
    "cordless-vacuum",
    vacuumCorpus,
    "leader_needs_verification",
    vacuumCorpus[0]!.title,
  ],
  [
    "compact-coffee-machine",
    coffeeCorpus,
    "ready_to_choose",
    coffeeCorpus[0]!.title,
  ],
] as const)(
  "source-grounded persisted founder journey: %s",
  async (name, products, expectedState, leaderTitle) => {
    const journey = await seedFounderJourney(connection.db, name, products);
    const support = await loadCurrentDecisionSupport({
      db: connection.db,
      taskId: journey.taskId,
    });
    const beforeSaveFrontier = (await journey.load()).decisionSupport!
      .currentDecision.frontier;
    for (const candidate of support.candidates)
      await setLiveListingSaved({
        dependencies: journey.dependencies,
        input: {
          operation: "save_listing",
          sessionId: journey.sessionId,
          candidateListingId: candidate.id,
        },
      });
    const view = await journey.load();
    const decision = view.decisionSupport!.currentDecision;
    expect(decision.frontier).toEqual(beforeSaveFrontier);
    expect(journey.corpus.calls.page).toBeGreaterThan(0);
    expect(support.sources.some((s) => s.sourceKind === "fetched_page")).toBe(
      true,
    );
    expect(support.observations.length).toBeGreaterThan(0);
    expect(decision.state).toBe(expectedState);
    const leader = support.candidates.find((c) => c.title === leaderTitle)!;
    expect(decision.leadingCandidateListingId).toBe(leader.id);
    expect(view.decisionSupport!.comparison?.candidates).toHaveLength(2);
    expect((await journey.load()).decisionSupport!.currentDecision).toEqual(
      decision,
    );
    if (name === "office-chair") {
      expect(
        support.assessments.find(
          (a) =>
            a.candidateListingId === leader.id &&
            a.relation === "conditional_stretch_supported",
        ),
      ).toBeDefined();
      expect(decision.keyTradeoff).not.toBeNull();
      const alternative = support.candidates.find(
        (c) => c.title === chairCorpus[0]!.title,
      )!;
      expect(decision.frontier).toMatchObject({
        kind: "eligible_alternative",
        candidateListingId: alternative.id,
        money: {
          currency: "GBP",
          targetMinor: 25000,
          leaderAmountMinor: 33000,
          alternativeAmountMinor: 24500,
          savingMinor: 8500,
          belowTargetMinor: 500,
        },
      });
      expect(decision.frontier!.summary).toContain("saves £85");
      expect(decision.frontier!.giveUp).toContain("lower-back support");
      for (const reason of [
        ...decision.frontier!.leaderAdvantages,
        ...decision.frontier!.alternativeAdvantages,
      ]) {
        const source = support.assessments.find(
          (a) => a.id === reason.assessmentId,
        )!;
        expect(source.taskRevision).toBe(support.brief.revision);
        expect(reason.observationIds).toEqual(source.observationIds);
        expect(reason.explanation).toBe(source.explanation);
        expect(
          reason.observationIds.every((id) =>
            support.observations.some((o) => o.id === id),
          ),
        ).toBe(true);
      }
      const unsaved = await setLiveListingSaved({
        dependencies: journey.dependencies,
        input: {
          operation: "unsave_listing",
          sessionId: journey.sessionId,
          candidateListingId: alternative.id,
        },
      });
      expect(unsaved.decisionSupport!.currentDecision.frontier).toEqual(
        decision.frontier,
      );
      const rejected = await setLiveListingRejected({
        dependencies: journey.dependencies,
        input: {
          operation: "reject_listing",
          sessionId: journey.sessionId,
          candidateListingId: alternative.id,
        },
      });
      expect(rejected.decisionSupport!.currentDecision.frontier).toBeNull();
      expect(
        rejected.decisionSupport!.currentDecision.leadingCandidateListingId,
      ).toBe(leader.id);
      const restored = await setLiveListingRejected({
        dependencies: journey.dependencies,
        input: {
          operation: "undo_reject_listing",
          sessionId: journey.sessionId,
          candidateListingId: alternative.id,
        },
      });
      expect(restored.decisionSupport!.currentDecision.frontier).toEqual(
        decision.frontier,
      );
    } else expect(decision.frontier).toBeNull();
    if (name === "cordless-vacuum") {
      expect(decision.blockingGap?.label).toBe("Noise level");
      expect(
        support.assessments.some(
          (a) =>
            a.status === "conflicts" &&
            support.brief.items.some(
              (i) =>
                i.criterionId === a.criterionId &&
                i.conceptLabel === "Noise level" &&
                i.strength === "hard",
            ),
        ),
      ).toBe(true);
    }
    if (name === "compact-coffee-machine")
      expect(
        support.assessments.some(
          (a) =>
            a.status === "conflicts" &&
            support.brief.items.some(
              (i) =>
                i.criterionId === a.criterionId &&
                i.conceptLabel === "Machine width",
            ),
        ),
      ).toBe(true);
  },
  20_000,
);
