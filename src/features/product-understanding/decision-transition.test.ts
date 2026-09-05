import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { historicalShoppingStateSchema } from "@/domain/shopping-state/shopping-state";
import { projectShoppingBrief } from "@/domain/shopping-state/brief";
import type { SemanticValue } from "@/domain/shopping-state/semantic-value";
import { persistedCandidateListingSchema } from "@/features/retrieval-spike/persistence/contracts";
import { criterionAssessmentV1Schema } from "./contracts";
import type { CurrentDecisionSupport } from "./persistence";
import { briefChanges, projectDecisionTransition } from "./decision-transition";

const taskId = randomUUID();
const identities = new Map<string, { concept: string; lineage: string }>();
type Seed = {
  label: string;
  strength?: "hard" | "strong_preference" | "preference";
  value?: SemanticValue;
};
function state(revision: bigint, seeds: Seed[]) {
  const time = new Date("2026-09-01T00:00:00Z");
  const entries = seeds.map((seed) => {
    const identity = identities.get(seed.label) ?? {
      concept: randomUUID(),
      lineage: randomUUID(),
    };
    identities.set(seed.label, identity);
    const value = seed.value ?? {
      schemaVersion: 1,
      kind: "qualitative",
      mode: "text",
      text: seed.label,
    };
    return { seed, identity, value };
  });
  return historicalShoppingStateSchema.parse({
    task: {
      id: taskId,
      currentRevision: revision,
      market: { country: "GB", language: "en-GB", currency: "GBP" },
      createdAt: time,
      updatedAt: time,
    },
    revision,
    concepts: entries.map(({ seed, identity }) => ({
      id: identity.concept,
      taskId,
      label: seed.label,
      definition: seed.label,
      valueFamily: "qualitative",
      canonicalUnit: null,
      createdRevision: 1n,
      createdAt: time,
    })),
    effectiveCriteria: entries.map(({ seed, identity, value }) => ({
      criterion: {
        id: randomUUID(),
        taskId,
        conceptId: identity.concept,
        lineageId: identity.lineage,
        authority: "user_explicit",
        strength:
          value.kind === "indifferent" ? null : (seed.strength ?? "preference"),
        targetSemantics:
          value.kind === "indifferent"
            ? "indifferent"
            : value.kind === "money_stretch"
              ? "stretch"
              : value.kind === "categorical"
                ? "categorical"
                : value.kind === "measurement_range" || value.kind === "money"
                  ? "range"
                  : "qualitative",
        valueSchemaVersion: 1,
        valueKind: value.kind,
        semanticValue: value,
        lifecycle: "active",
        createdRevision: revision,
        endedRevision: null,
        supersededById: null,
        createdAt: time,
        updatedAt: time,
      },
      sources: [],
    })),
  });
}
const a = randomUUID(),
  b = randomUUID(),
  runId = randomUUID(),
  observationId = randomUUID();
function support(
  authority: ReturnType<typeof state>,
  profiles: Record<string, ("meets" | "uncertain" | "conflicts")[]>,
  ids = [a, b],
): CurrentDecisionSupport {
  const brief = projectShoppingBrief(authority);
  const candidates = ids.map((id, index) =>
    persistedCandidateListingSchema.parse({
      id,
      taskId,
      runId,
      queryId: randomUUID(),
      queryExecutionId: randomUUID(),
      provider: "fixture",
      providerResultId: id,
      sourceRank: index + 1,
      surface: "shopping",
      title: id === a ? "Mouse A" : "Mouse B",
      url: `https://example.test/${id}`,
      canonicalUrl: `https://example.test/${id}`,
      merchantDestinationUrl: null,
      merchantDestinationSource: null,
      merchant: "Test merchant",
      price: { amountMinor: 4000, currency: "GBP" },
      priceText: "£40",
      imageUrl: null,
      deliveryText: null,
      availabilityText: null,
      reviewEvidence: null,
      retrievedAt: new Date(),
    }),
  );
  return {
    brief,
    researchRuns: [],
    deepResearchCoverage: [],
    candidates,
    sources: [],
    observations: [
      { id: observationId } as CurrentDecisionSupport["observations"][number],
    ],
    assessments: candidates.flatMap((candidate, index) =>
      brief.items.map((item) =>
        criterionAssessmentV1Schema.parse({
          schemaVersion: 1,
          id: randomUUID(),
          taskId,
          taskRevision: brief.revision,
          researchRunId: runId,
          candidateRunId: runId,
          candidateListingId: candidate.id,
          criterionId: item.criterionId,
          status: profiles[item.conceptLabel]?.[index] ?? "meets",
          relation: "source_support",
          explanation: `${item.conceptLabel} evidence for ${candidate.title}`,
          method: "deterministic",
          model: null,
          promptVersion: null,
          observationIds: [observationId],
          createdAt: new Date(),
        }),
      ),
    ),
  };
}
function transition(
  before: ReturnType<typeof state>,
  after: ReturnType<typeof state>,
  prior: CurrentDecisionSupport | null,
  current: CurrentDecisionSupport,
  rejected: string[] = [],
) {
  return projectDecisionTransition({
    before,
    after,
    previousSupport: prior,
    currentSupport: current,
    previousRejected: new Set(),
    currentRejected: new Set(rejected),
  });
}

describe("Decision Evolution authority and movement", () => {
  const before = state(1n, [
    { label: "Reviews", strength: "strong_preference" },
    { label: "Price", strength: "hard" },
  ]);
  const after = state(2n, [
    { label: "Reviews" },
    { label: "Price", strength: "hard" },
    { label: "Comfort for long workdays", strength: "strong_preference" },
  ]);
  const prior = support(before, { Reviews: ["meets", "uncertain"] });
  const current = support(after, {
    Reviews: ["uncertain", "meets"],
    "Comfort for long workdays": ["meets", "uncertain"],
  });
  it("has no transition at revision one", () => {
    expect(transition(before, before, null, prior)).toBeNull();
  });
  it("breaks the mouse tie with a supported comfort change", () => {
    expect(transition(before, after, prior, current)).toMatchObject({
      movement: "tie_broken",
      previous: { state: "no_clear_winner", leaderId: null },
      current: { state: "ready_to_choose", leaderId: a },
      cause: "brief_refinement",
      evidence: "reused",
      candidateContinuity: "same_listings",
    });
  });
  it("describes Reviews becoming weaker and Comfort being added; omits Price", () => {
    const result = transition(before, after, prior, current)!;
    expect(result.changes).toHaveLength(2);
    expect(result.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Reviews",
          before: "Strong preference",
          after: "Preference",
        }),
        expect.objectContaining({
          label: "Comfort for long workdays",
          kind: "added",
        }),
      ]),
    );
    expect(result.causalCriterionIds).toEqual([
      current.brief.items.find(
        ({ conceptLabel }) => conceptLabel === "Comfort for long workdays",
      )!.criterionId,
    ]);
  });
  it("uses no stale current assessments and never rewrites prior evidence", () => {
    const staleCurrent = {
      ...current,
      assessments: [...current.assessments, ...prior.assessments],
    };
    expect(transition(before, after, prior, staleCurrent)?.current).toEqual(
      transition(before, after, prior, current)?.current,
    );
    expect(
      transition(
        before,
        after,
        {
          ...prior,
          assessments: [...prior.assessments, ...current.assessments],
        },
        current,
      )?.previous,
    ).toEqual(transition(before, after, prior, current)?.previous);
  });
  it("keeps the exact listings and does not claim evidence was newly fetched", () => {
    const result = transition(before, after, prior, current)!;
    expect(result.candidateContinuity).toBe("same_listings");
    expect(result.evidenceExplanation).toContain("reused");
  });
  it("does not fabricate previous decisions without a captured basis", () => {
    expect(transition(before, after, null, current)).toMatchObject({
      previous: null,
      movement: "no_history",
      causalCriterionIds: [],
    });
    expect(transition(before, after, null, current, [a])).toMatchObject({
      previous: null,
      cause: "undetermined",
      movement: "no_history",
    });
  });
  it("shows reassessment while current assessments are absent", () => {
    expect(
      transition(before, after, prior, { ...current, assessments: [] }),
    ).toMatchObject({
      movement: "reassessing",
      current: { leaderId: null },
      evidence: "pending",
    });
  });
  it("does not attribute a rejection-driven movement to refinement", () => {
    expect(transition(before, after, prior, current, [a])).toMatchObject({
      cause: "candidate_rejection",
      causalCriterionIds: [],
    });
  });
  it("does not infer identity for new listings with the same titles", () => {
    expect(
      transition(
        before,
        after,
        prior,
        support(
          after,
          { "Comfort for long workdays": ["meets", "uncertain"] },
          [randomUUID(), randomUUID()],
        ),
      )?.candidateContinuity,
    ).toBe("changed_listings");
  });
  it("is stable across reload and does not depend on saved state", () => {
    expect(transition(before, after, prior, current)).toEqual(
      transition(before, after, prior, current),
    );
  });
  it("marks new evidence conservatively rather than claiming refinement alone caused the change", () => {
    const fresh = {
      ...current,
      assessments: current.assessments.map((entry) => ({
        ...entry,
        observationIds: [],
      })),
    };
    expect(transition(before, after, prior, fresh)?.evidence).toBe("unknown");
  });

  it("moves ready to provisional when a new hard vacuum noise requirement is unresolved", () => {
    const old = state(1n, [
      { label: "Runtime", strength: "strong_preference" },
    ]);
    const next = state(2n, [
      { label: "Runtime", strength: "strong_preference" },
      { label: "Noise", strength: "hard" },
    ]);
    expect(
      transition(
        old,
        next,
        support(old, { Runtime: ["meets", "uncertain"] }),
        support(next, {
          Runtime: ["meets", "uncertain"],
          Noise: ["uncertain", "uncertain"],
        }),
      ),
    ).toMatchObject({
      movement: "needs_verification",
      current: { state: "leader_needs_verification" },
    });
  });
  it("moves provisional to ready when a relaxed hard requirement is supported", () => {
    const old = state(1n, [
      { label: "Noise", strength: "hard" },
      { label: "Runtime", strength: "strong_preference" },
    ]);
    const next = state(2n, [
      { label: "Noise" },
      { label: "Runtime", strength: "strong_preference" },
    ]);
    expect(
      transition(
        old,
        next,
        support(old, {
          Runtime: ["meets", "uncertain"],
          Noise: ["uncertain", "uncertain"],
        }),
        support(next, {
          Runtime: ["meets", "uncertain"],
          Noise: ["meets", "meets"],
        }),
      )?.movement,
    ).toBe("ready");
  });
  it("moves leader A to B on a different strong priority", () => {
    const old = state(1n, [
      { label: "Comfort", strength: "strong_preference" },
      { label: "Weight" },
    ]);
    const next = state(2n, [
      { label: "Comfort" },
      { label: "Weight", strength: "strong_preference" },
    ]);
    const profiles = {
      Comfort: ["meets", "uncertain"],
      Weight: ["uncertain", "meets"],
    } as const;
    expect(
      transition(
        old,
        next,
        support(old, {
          Comfort: [...profiles.Comfort],
          Weight: [...profiles.Weight],
        }),
        support(next, {
          Comfort: [...profiles.Comfort],
          Weight: [...profiles.Weight],
        }),
      ),
    ).toMatchObject({
      movement: "leader_changed",
      previous: { leaderId: a },
      current: { leaderId: b },
    });
  });
  it("remembers the same leader with a different rationale", () => {
    const old = state(1n, [{ label: "Shape", strength: "strong_preference" }]);
    const next = state(2n, [
      { label: "Shape" },
      { label: "Comfort", strength: "strong_preference" },
    ]);
    expect(
      transition(
        old,
        next,
        support(old, { Shape: ["meets", "uncertain"] }),
        support(next, {
          Shape: ["meets", "meets"],
          Comfort: ["meets", "uncertain"],
        }),
      )?.movement,
    ).toBe("rationale_changed");
  });
  it("returns a tie when removing the separating preference", () => {
    const old = state(1n, [
      { label: "Shape", strength: "strong_preference" },
      { label: "Colour" },
    ]);
    const next = state(2n, [{ label: "Colour" }]);
    expect(
      transition(
        old,
        next,
        support(old, { Shape: ["meets", "uncertain"] }),
        support(next, {}),
      )?.movement,
    ).toBe("tie");
  });
  it("permits a coffee machine only after the width boundary changes", () => {
    const old = state(1n, [{ label: "Width", strength: "hard" }]);
    const next = state(2n, [{ label: "Width" }]);
    expect(
      transition(
        old,
        next,
        support(old, { Width: ["conflicts", "meets"] }),
        support(next, { Width: ["meets", "uncertain"] }),
      ),
    ).toMatchObject({ previous: { leaderId: b }, current: { leaderId: a } });
  });
});

describe("resulting authority delta grammar", () => {
  it.each([
    [
      "relax",
      { label: "Comfort", strength: "hard" },
      { label: "Comfort", strength: "preference" },
      "strength_changed",
    ],
    [
      "tighten",
      { label: "Comfort", strength: "preference" },
      { label: "Comfort", strength: "hard" },
      "strength_changed",
    ],
    [
      "target",
      { label: "Comfort" },
      {
        label: "Comfort",
        value: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "long workdays",
        },
      },
      "target_changed",
    ],
    [
      "indifferent",
      { label: "Comfort" },
      { label: "Comfort", value: { schemaVersion: 1, kind: "indifferent" } },
      "marked_indifferent",
    ],
    [
      "indifference ended",
      { label: "Comfort", value: { schemaVersion: 1, kind: "indifferent" } },
      { label: "Comfort" },
      "indifference_ended",
    ],
    [
      "exclusion",
      {
        label: "Colour",
        value: {
          schemaVersion: 1,
          kind: "categorical",
          operator: "exclude",
          values: ["white"],
        },
      },
      {
        label: "Colour",
        value: {
          schemaVersion: 1,
          kind: "categorical",
          operator: "exclude",
          values: ["white", "red"],
        },
      },
      "target_changed",
    ],
    [
      "chair money stretch",
      {
        label: "Price",
        value: {
          schemaVersion: 1,
          kind: "money_stretch",
          currency: "GBP",
          targetMinor: 25000,
          stretchCeilingMinor: 35000,
          condition: "better for long sessions",
        },
      },
      {
        label: "Price",
        value: {
          schemaVersion: 1,
          kind: "money_stretch",
          currency: "GBP",
          targetMinor: 30000,
          stretchCeilingMinor: 35000,
          condition: "better for long sessions",
        },
      },
      "target_changed",
    ],
  ] as [string, Seed, Seed, string][])(
    "projects %s from before and after truth",
    (_, before, after, kind) => {
      expect(briefChanges(state(1n, [before]), state(2n, [after]))).toEqual([
        expect.objectContaining({ kind }),
      ]);
    },
  );
});
