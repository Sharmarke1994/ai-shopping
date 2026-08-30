import { describe, expect, it } from "vitest";
import {
  assertFirstPassUnderstandingPairsMatchCriteria,
  MAX_FIRST_PASS_CRITERIA_PER_CANDIDATE,
  MAX_FIRST_PASS_CRITERIA_PER_MODEL_CALL,
  MAX_FIRST_PASS_MODEL_CALLS_PER_CANDIDATE,
  pairFirstPassUnderstandingAttempts,
  parseFirstPassUnderstandingPlanKey,
  planFirstPassUnderstandingBatches,
} from "./understanding-batches";
import { MAX_RESEARCH_CANDIDATES } from "./selection";

type FixtureAttempt = {
  id: string;
  candidateListingId: string;
  stage: string;
  purpose: string;
  planKey: string;
  status: string;
  provider: string;
  model: string | null;
  promptVersion: string | null;
  providerRequestId: string | null;
  receivedResultCount: number | null;
  failureCode: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  targetCriterionIds: readonly string[];
};

function attemptsFor(criteria: readonly string[]): FixtureAttempt[] {
  return planFirstPassUnderstandingBatches(criteria).flatMap(
    (batch) =>
      [
        {
          id: `extract-${batch.ordinal}`,
          candidateListingId: "candidate-1",
          stage: "observation_extraction",
          purpose: "combined",
          planKey: batch.extractionPlanKey,
          status: "planned",
          provider: "fixture",
          model: "fixture-model",
          promptVersion: "fixture-v1",
          providerRequestId: null,
          receivedResultCount: null,
          failureCode: null,
          startedAt: null,
          finishedAt: null,
          targetCriterionIds: batch.criterionIds,
        },
        {
          id: `assess-${batch.ordinal}`,
          candidateListingId: "candidate-1",
          stage: "criterion_assessment",
          purpose: "current_brief",
          planKey: batch.assessmentPlanKey,
          status: "planned",
          provider: "fixture",
          model: "fixture-model",
          promptVersion: "fixture-v1",
          providerRequestId: null,
          receivedResultCount: null,
          failureCode: null,
          startedAt: null,
          finishedAt: null,
          targetCriterionIds: batch.criterionIds,
        },
      ] satisfies FixtureAttempt[],
  );
}

describe("first-pass product-understanding batches", () => {
  it("uses deterministic focused groups with exact local scope", () => {
    const ids = Array.from({ length: 8 }, (_, index) => `criterion-${index}`);
    const batches = planFirstPassUnderstandingBatches(ids);

    expect(batches.map(({ criterionIds }) => criterionIds)).toEqual([
      ["criterion-0", "criterion-1"],
      ["criterion-2", "criterion-3"],
      ["criterion-4", "criterion-5"],
      ["criterion-6", "criterion-7"],
    ]);
    expect(
      batches.every(
        ({ criterionIds }) =>
          criterionIds.length <= MAX_FIRST_PASS_CRITERIA_PER_MODEL_CALL,
      ),
    ).toBe(true);
    expect(
      planFirstPassUnderstandingBatches(ids.slice(0, 7)).at(-1),
    ).toMatchObject({ criterionIds: ["criterion-6"] });
  });

  it("keeps the existing 50-criterion truth bound explicit without truncation", () => {
    const maximumCriteria = Array.from(
      { length: MAX_FIRST_PASS_CRITERIA_PER_CANDIDATE },
      (_, index) => `criterion-${index}`,
    );
    expect(planFirstPassUnderstandingBatches(maximumCriteria)).toHaveLength(
      MAX_FIRST_PASS_MODEL_CALLS_PER_CANDIDATE,
    );
    expect(
      MAX_FIRST_PASS_MODEL_CALLS_PER_CANDIDATE * MAX_RESEARCH_CANDIDATES,
    ).toBe(100);
    expect(() =>
      planFirstPassUnderstandingBatches([
        ...maximumCriteria,
        "criterion-over-bound",
      ]),
    ).toThrow(/input bound/);
  });

  it("rejects an encoded batch total above the bounded call ceiling before pairing", () => {
    const oversizedTotal = MAX_FIRST_PASS_MODEL_CALLS_PER_CANDIDATE + 1;
    const attempts = attemptsFor(["a", "b"]).map((attempt) => ({
      ...attempt,
      planKey: attempt.planKey.replace("1-of-1", `1-of-${oversizedTotal}`),
    }));

    expect(parseFirstPassUnderstandingPlanKey(attempts[0]!.planKey)).toBeNull();
    expect(() => pairFirstPassUnderstandingAttempts(attempts)).toThrow(
      /batch identity is invalid/,
    );
  });

  it("reconstructs one complete disjoint pair per encoded ordinal", () => {
    const pairs = pairFirstPassUnderstandingAttempts(
      attemptsFor(["a", "b", "c", "d", "e"]),
    );
    expect(pairs.map(({ ordinal, total }) => [ordinal, total])).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("rejects a consistently rehashed substitute partition against authoritative order", () => {
    const pairs = pairFirstPassUnderstandingAttempts(
      attemptsFor(["a", "c", "b", "d"]),
    );
    expect(() =>
      assertFirstPassUnderstandingPairsMatchCriteria(pairs, [
        "a",
        "b",
        "c",
        "d",
      ]),
    ).toThrow(/server-owned partition/);
  });

  it.each([
    "missing_pair",
    "overlap",
    "target_mutation",
    "mixed_status",
    "metadata_mismatch",
    "cross_batch_identity",
  ] as const)("rejects %s corruption", (corruption) => {
    const attempts = attemptsFor(["a", "b", "c", "d"]);
    let corrupted = [...attempts];
    if (corruption === "missing_pair") corrupted = corrupted.slice(0, -2);
    if (corruption === "overlap") {
      const firstTargetHash = attempts[0]!.planKey.split(":").at(-1)!;
      corrupted = corrupted.map((attempt) =>
        attempt.id.endsWith("2")
          ? {
              ...attempt,
              planKey: `${attempt.planKey.slice(0, attempt.planKey.lastIndexOf(":") + 1)}${firstTargetHash}`,
              targetCriterionIds: ["a", "b"],
            }
          : attempt,
      );
    }
    if (corruption === "target_mutation") {
      corrupted[0] = { ...corrupted[0]!, targetCriterionIds: ["a"] };
    }
    if (corruption === "mixed_status") {
      corrupted[0] = {
        ...corrupted[0]!,
        status: "failed",
        failureCode: "model_failed",
        startedAt: new Date(0),
        finishedAt: new Date(1),
      };
    }
    if (corruption === "metadata_mismatch") {
      corrupted[0] = { ...corrupted[0]!, model: "different-model" };
    }
    if (corruption === "cross_batch_identity") {
      corrupted = corrupted.map((attempt) =>
        attempt.id.endsWith("2")
          ? {
              ...attempt,
              model: "different-model",
              promptVersion: "different-prompt",
            }
          : attempt,
      );
    }
    expect(() => pairFirstPassUnderstandingAttempts(corrupted)).toThrow();
  });
});
