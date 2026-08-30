import { createHash } from "node:crypto";

export const FIRST_PASS_UNDERSTANDING_POLICY_IDENTITY = "first-pass-batched-v1";
export const MAX_FIRST_PASS_CRITERIA_PER_MODEL_CALL = 2;
export const MAX_FIRST_PASS_CRITERIA_PER_CANDIDATE = 50;
export const MAX_FIRST_PASS_MODEL_CALLS_PER_CANDIDATE =
  MAX_FIRST_PASS_CRITERIA_PER_CANDIDATE /
  MAX_FIRST_PASS_CRITERIA_PER_MODEL_CALL;

const FIRST_PASS_BATCH_PLAN_VERSION = "first-pass-understanding-v1";
const firstPassBatchPlanKeyPattern =
  /^first-pass-understanding-v1:(extraction|assessment):(\d+)-of-(\d+):([a-f0-9]{20})$/;

export type FirstPassUnderstandingBatch = Readonly<{
  ordinal: number;
  total: number;
  criterionIds: readonly string[];
  targetHash: string;
  extractionPlanKey: string;
  assessmentPlanKey: string;
}>;

type UnderstandingAttempt = Readonly<{
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
}>;

export type FirstPassUnderstandingAttemptPair<
  Attempt extends UnderstandingAttempt,
> = Readonly<{
  ordinal: number;
  total: number;
  extraction: Attempt;
  assessment: Attempt;
}>;

function targetHash(criterionIds: readonly string[]) {
  return createHash("sha256")
    .update(JSON.stringify([...criterionIds].sort()))
    .digest("hex")
    .slice(0, 20);
}

function planKey(
  kind: "extraction" | "assessment",
  ordinal: number,
  total: number,
  hash: string,
) {
  return `${FIRST_PASS_BATCH_PLAN_VERSION}:${kind}:${ordinal}-of-${total}:${hash}`;
}

/**
 * Live evidence shows focused one- and two-criterion calls are reliable while
 * one broad eight-criterion call is not. Keep the server-owned groups at two;
 * an odd final criterion remains a one-criterion focused call rather than
 * expanding an unevidenced group to three.
 */
export function planFirstPassUnderstandingBatches(
  criterionIds: readonly string[],
): readonly FirstPassUnderstandingBatch[] {
  if (criterionIds.length === 0) {
    throw new Error("First-pass understanding requires a criterion");
  }
  if (new Set(criterionIds).size !== criterionIds.length) {
    throw new Error("First-pass understanding criteria must be unique");
  }
  if (criterionIds.length > MAX_FIRST_PASS_CRITERIA_PER_CANDIDATE) {
    throw new Error(
      "First-pass understanding exceeds the authoritative input bound",
    );
  }
  const groups: string[][] = [];
  for (
    let index = 0;
    index < criterionIds.length;
    index += MAX_FIRST_PASS_CRITERIA_PER_MODEL_CALL
  ) {
    groups.push(
      criterionIds.slice(index, index + MAX_FIRST_PASS_CRITERIA_PER_MODEL_CALL),
    );
  }
  return groups.map((ids, index) => {
    const ordinal = index + 1;
    const total = groups.length;
    const hash = targetHash(ids);
    return {
      ordinal,
      total,
      criterionIds: ids,
      targetHash: hash,
      extractionPlanKey: planKey("extraction", ordinal, total, hash),
      assessmentPlanKey: planKey("assessment", ordinal, total, hash),
    };
  });
}

export function parseFirstPassUnderstandingPlanKey(value: string) {
  const match = firstPassBatchPlanKeyPattern.exec(value);
  if (match === null) return null;
  const ordinal = Number(match[2]);
  const total = Number(match[3]);
  if (
    !Number.isSafeInteger(ordinal) ||
    !Number.isSafeInteger(total) ||
    ordinal < 1 ||
    total < 1 ||
    ordinal > total ||
    ordinal > MAX_FIRST_PASS_MODEL_CALLS_PER_CANDIDATE ||
    total > MAX_FIRST_PASS_MODEL_CALLS_PER_CANDIDATE
  ) {
    return null;
  }
  return {
    kind: match[1] as "extraction" | "assessment",
    ordinal,
    total,
    targetHash: match[4]!,
  } as const;
}

function exactDate(left: Date | null, right: Date | null) {
  return left?.getTime() === right?.getTime();
}

function exactTargets(left: readonly string[], right: readonly string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    leftSet.size === left.length &&
    rightSet.size === right.length &&
    leftSet.size === rightSet.size &&
    [...leftSet].every((criterionId) => rightSet.has(criterionId))
  );
}

/**
 * Validates the complete persisted batch reservation. Encoded total/ordinal
 * makes omission of a whole pair detectable; the target hash makes mutation of
 * an otherwise plausible binding fail closed.
 */
export function pairFirstPassUnderstandingAttempts<
  Attempt extends UnderstandingAttempt,
>(
  attempts: readonly Attempt[],
): readonly FirstPassUnderstandingAttemptPair<Attempt>[] {
  const modelAttempts = attempts.filter(
    ({ stage }) =>
      stage === "observation_extraction" || stage === "criterion_assessment",
  );
  if (modelAttempts.length === 0 || modelAttempts.length % 2 !== 0) {
    throw new Error("First-pass understanding batch reservation is incomplete");
  }
  if (
    new Set(modelAttempts.map(({ candidateListingId }) => candidateListingId))
      .size !== 1
  ) {
    throw new Error("First-pass batches must belong to one exact candidate");
  }
  const parsed = modelAttempts.map((attempt) => {
    const identity = parseFirstPassUnderstandingPlanKey(attempt.planKey);
    if (
      identity === null ||
      (attempt.stage === "observation_extraction" &&
        identity.kind !== "extraction") ||
      (attempt.stage === "criterion_assessment" &&
        identity.kind !== "assessment") ||
      targetHash(attempt.targetCriterionIds) !== identity.targetHash ||
      attempt.targetCriterionIds.length < 1 ||
      attempt.targetCriterionIds.length > MAX_FIRST_PASS_CRITERIA_PER_MODEL_CALL
    ) {
      throw new Error("First-pass understanding batch identity is invalid");
    }
    return { attempt, identity };
  });
  const totals = new Set(parsed.map(({ identity }) => identity.total));
  if (totals.size !== 1) {
    throw new Error("First-pass understanding batch totals disagree");
  }
  const total = parsed[0]!.identity.total;
  const pairs: FirstPassUnderstandingAttemptPair<Attempt>[] = [];
  const reservedCriteria = new Set<string>();
  for (let ordinal = 1; ordinal <= total; ordinal += 1) {
    const extraction = parsed.filter(
      ({ identity }) =>
        identity.ordinal === ordinal && identity.kind === "extraction",
    );
    const assessment = parsed.filter(
      ({ identity }) =>
        identity.ordinal === ordinal && identity.kind === "assessment",
    );
    if (extraction.length !== 1 || assessment.length !== 1) {
      throw new Error("First-pass understanding batch pair is incomplete");
    }
    const extractionAttempt = extraction[0]!.attempt;
    const assessmentAttempt = assessment[0]!.attempt;
    if (
      extraction[0]!.identity.targetHash !==
        assessment[0]!.identity.targetHash ||
      !exactTargets(
        extractionAttempt.targetCriterionIds,
        assessmentAttempt.targetCriterionIds,
      ) ||
      extractionAttempt.purpose !== "combined" ||
      assessmentAttempt.purpose !== "current_brief" ||
      extractionAttempt.provider !== assessmentAttempt.provider ||
      extractionAttempt.model !== assessmentAttempt.model ||
      extractionAttempt.promptVersion !== assessmentAttempt.promptVersion ||
      extractionAttempt.status !== assessmentAttempt.status ||
      extractionAttempt.providerRequestId !==
        assessmentAttempt.providerRequestId ||
      extractionAttempt.receivedResultCount !==
        assessmentAttempt.receivedResultCount ||
      extractionAttempt.failureCode !== assessmentAttempt.failureCode ||
      !exactDate(extractionAttempt.startedAt, assessmentAttempt.startedAt) ||
      !exactDate(extractionAttempt.finishedAt, assessmentAttempt.finishedAt)
    ) {
      throw new Error("First-pass understanding batch pair is incoherent");
    }
    for (const criterionId of extractionAttempt.targetCriterionIds) {
      if (reservedCriteria.has(criterionId)) {
        throw new Error(
          "First-pass understanding criteria overlap across batches",
        );
      }
      reservedCriteria.add(criterionId);
    }
    pairs.push({
      ordinal,
      total,
      extraction: extractionAttempt,
      assessment: assessmentAttempt,
    });
  }
  if (pairs.length !== total || parsed.length !== total * 2) {
    throw new Error("First-pass understanding batch sequence is incomplete");
  }
  const reservedIdentity = pairs[0]!.extraction;
  if (
    pairs.some(
      ({ extraction }) =>
        extraction.provider !== reservedIdentity.provider ||
        extraction.model !== reservedIdentity.model ||
        extraction.promptVersion !== reservedIdentity.promptVersion,
    )
  ) {
    throw new Error(
      "First-pass understanding batches disagree on reserved model identity",
    );
  }
  return pairs;
}

export function assertFirstPassUnderstandingPairsMatchCriteria<
  Attempt extends UnderstandingAttempt,
>(
  pairs: readonly FirstPassUnderstandingAttemptPair<Attempt>[],
  authoritativeCriterionIds: readonly string[],
) {
  const expected = planFirstPassUnderstandingBatches(authoritativeCriterionIds);
  if (pairs.length !== expected.length) {
    throw new Error(
      "First-pass understanding batches do not cover the authoritative brief",
    );
  }
  for (const [index, batch] of expected.entries()) {
    const pair = pairs[index];
    if (
      pair === undefined ||
      pair.ordinal !== batch.ordinal ||
      pair.total !== batch.total ||
      !exactTargets(pair.extraction.targetCriterionIds, batch.criterionIds)
    ) {
      throw new Error(
        "First-pass understanding batch differs from its server-owned partition",
      );
    }
  }
}
