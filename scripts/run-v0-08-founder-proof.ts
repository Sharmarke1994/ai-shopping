import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import postgres from "postgres";
import { projectShoppingBrief } from "../src/domain/shopping-state/brief";
import {
  answerLiveShoppingQuestion,
  deepenLiveShoppingResearch,
  loadLiveShoppingSession,
  refineLiveShopping,
  researchLiveCandidate,
  researchLiveShopping,
  retryLiveShoppingContext,
  setLiveListingRejected,
  setLiveListingSaved,
  startLiveShopping,
  type LiveShoppingDependencies,
} from "../src/features/live-shopping/application";
import type { LiveShoppingView } from "../src/features/live-shopping/contracts";
import { createOpenAIContextAcquisitionModel } from "../src/features/context-acquisition/openai-adapter";
import type { ContextAcquisitionModel } from "../src/features/context-acquisition/model-port";
import type { EvidenceSearchProvider } from "../src/features/product-understanding/evidence-search";
import type { ProductUnderstandingModel } from "../src/features/product-understanding/model-port";
import {
  DIRECT_TITLE_DESCRIPTOR_PROPERTY,
  isPurchasePriceCriterion,
} from "../src/features/product-understanding/assessment-policy";
import {
  createOpenAIProductUnderstandingModel,
  V0_07_OPENAI_DEFAULT_CONFIG,
} from "../src/features/product-understanding/openai-adapter";
import { PRODUCT_UNDERSTANDING_PROMPT_VERSION } from "../src/features/product-understanding/prompts";
import { SerperEvidenceSearchAdapter } from "../src/features/product-understanding/serper-evidence-adapter";
import type { ShoppingSearchProvider } from "../src/features/retrieval-spike/contracts";
import { SerperShoppingAdapter } from "../src/features/retrieval-spike/serper-shopping-adapter";
import { loadCurrentShoppingState } from "../src/features/shopping-state/persistence/state-loaders";
import { requireTestDatabaseEnvironment } from "../src/infrastructure/config/environment";
import { createDatabaseConnection } from "../src/infrastructure/database/clients";
import { migrateDatabase } from "../src/infrastructure/database/migrate";
import {
  candidateListings,
  criterionAssessmentObservations,
  criterionAssessments,
  evidenceAcquisitionAttempts,
  evidenceAttemptTargetCriteria,
  evidenceResearchRuns,
  evidenceSources,
  founderLiveSessions,
  productObservations,
  rejectedCandidateListings,
  savedCandidateListings,
  searchQueries,
  searchRuns,
} from "../src/infrastructure/database/schema";

const executeFile = promisify(execFile);
const disposableDatabasePattern = /^ai_shopping_test_v008_[a-f0-9]{32}$/;
const outputDirectory = new URL("../docs/evals/", import.meta.url);

function sanitizeArtifactSourceUrl(sourceUrl: string | null) {
  if (sourceUrl === null) return null;
  try {
    const parsed = new URL(sourceUrl);
    const trackingKeys = [...parsed.searchParams.keys()].filter(
      (key) =>
        key === "srsltid" ||
        key === "gclid" ||
        key === "fbclid" ||
        key.startsWith("utm_"),
    );
    if (trackingKeys.length === 0) return sourceUrl;
    for (const key of trackingKeys) parsed.searchParams.delete(key);
    return parsed.toString();
  } catch {
    return sourceUrl;
  }
}

const cases = [
  {
    name: "ergonomic-mouse",
    request:
      "I need an ergonomic mouse under £50. I don’t know much about mouse brands, so I want the best options rather than having to know which specs matter. Reviews matter a lot to me. I’d prefer wireless, but only if the battery life is very good. I like mice that are a little chunkier and sculpted, with a noticeable side profile or thumb-rest shape rather than something flat and minimal. Good brands only, no Amazon Basics stuff or bad brands.",
    refinement:
      "Reviews matter less now. Comfort for long workdays matters most.",
  },
  {
    name: "office-chair",
    request:
      "I need a comfortable office chair for working from home most days, around £250. I can stretch to £350 if it’s genuinely better for long sessions. I’m 5'10 and don’t want anything huge or gamer-looking. Good lower-back support matters a lot, and I’d prefer breathable fabric or mesh over leather. I don’t care about brand or colour.",
    refinement: null,
  },
  {
    name: "cordless-vacuum",
    request:
      "I need a cordless vacuum for a small flat under £250. It must work well on both hard floors and rugs, and it must not be very loud because I have a noise-sensitive cat. I prefer something under 3kg with at least 40 minutes of useful runtime. I don’t care about colour or brand.",
    refinement: null,
  },
] as const;

type Counts = {
  interpretationCalls: number;
  actionCalls: number;
  shoppingRequests: number;
  merchantResolutionRequests: number;
  evidenceSearchCalls: number;
  understandingCalls: number;
};

type UnderstandingCallTrace = Readonly<{
  callOrdinal: number;
  candidateTitle: string;
  criteria: readonly Readonly<{ ordinal: number; label: string }>[];
  requireCriterionBinding: boolean;
  structuredOutputContract: "focused" | "broad";
}>;

type ArmedEvidenceGate = Readonly<{
  entered: Promise<void>;
  release: () => void;
}>;

type MutableEvidenceGate = {
  candidateTitle: string;
  claimed: boolean;
  signalEntered: () => void;
  released: Promise<void>;
  release: () => void;
};

async function readSecret(environmentName: string, service: string) {
  const configured = process.env[environmentName]?.trim();
  if (configured) return configured;
  if (process.platform !== "darwin") {
    throw new Error(`${environmentName} is not configured`);
  }
  const { stdout } = await executeFile("security", [
    "find-generic-password",
    "-s",
    service,
    "-w",
  ]);
  const value = stdout.trim();
  if (!value) throw new Error(`${environmentName} is empty`);
  return value;
}

function createCountedDependencies(options: {
  db: LiveShoppingDependencies["db"];
  openAIKey: string;
  serperKey: string;
}) {
  const counts: Counts = {
    interpretationCalls: 0,
    actionCalls: 0,
    shoppingRequests: 0,
    merchantResolutionRequests: 0,
    evidenceSearchCalls: 0,
    understandingCalls: 0,
  };
  const understandingCallTrace: UnderstandingCallTrace[] = [];
  const context = createOpenAIContextAcquisitionModel({
    environment: { ...process.env, OPENAI_API_KEY: options.openAIKey },
  });
  const model: ContextAcquisitionModel = {
    interpret: (input) => {
      counts.interpretationCalls += 1;
      return context.interpret(input);
    },
    selectAction: (input) => {
      counts.actionCalls += 1;
      return context.selectAction(input);
    },
  };
  const shopping = new SerperShoppingAdapter({
    apiKey: options.serperKey,
    onRequest: (surface) => {
      if (surface === "shopping") counts.shoppingRequests += 1;
      else counts.merchantResolutionRequests += 1;
    },
  });
  const provider: ShoppingSearchProvider = {
    provider: shopping.provider,
    maxRequestDurationMs: shopping.maxRequestDurationMs,
    search: (query) => shopping.search(query),
  };
  const evidence = new SerperEvidenceSearchAdapter({
    apiKey: options.serperKey,
  });
  let armedEvidenceGate: MutableEvidenceGate | null = null;
  let postResponseFailureCandidateTitle: string | null = null;
  const armEvidenceGate = (candidateTitle: string): ArmedEvidenceGate => {
    if (armedEvidenceGate !== null) {
      throw new Error("An evidence request gate is already armed");
    }
    let signalEntered: () => void = () => undefined;
    let release: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    armedEvidenceGate = {
      candidateTitle,
      claimed: false,
      signalEntered,
      released,
      release,
    };
    return {
      entered,
      release: () => {
        const gate = armedEvidenceGate;
        if (gate !== null && gate.candidateTitle === candidateTitle) {
          gate.release();
          armedEvidenceGate = null;
        }
      },
    };
  };
  const evidenceProvider: EvidenceSearchProvider = {
    provider: evidence.provider,
    search: async (input) => {
      counts.evidenceSearchCalls += 1;
      const gate = armedEvidenceGate;
      if (
        gate !== null &&
        !gate.claimed &&
        gate.candidateTitle === input.candidateTitle
      ) {
        gate.claimed = true;
        gate.signalEntered();
        await gate.released;
      }
      const response = await evidence.search(input);
      if (postResponseFailureCandidateTitle === input.candidateTitle) {
        postResponseFailureCandidateTitle = null;
        throw new Error(
          "Controlled V0-08 proof failure after one real evidence response",
        );
      }
      return response;
    },
  };
  const productUnderstanding = createOpenAIProductUnderstandingModel({
    apiKey: options.openAIKey,
  });
  const understanding: ProductUnderstandingModel = {
    understand: (input, policy) => {
      counts.understandingCalls += 1;
      understandingCallTrace.push({
        callOrdinal: counts.understandingCalls,
        candidateTitle: input.candidate.title,
        criteria: input.criteria.map(({ ordinal, label }) => ({
          ordinal,
          label,
        })),
        requireCriterionBinding: policy.requireCriterionBinding,
        structuredOutputContract: policy.requireCriterionBinding
          ? "focused"
          : "broad",
      });
      return productUnderstanding.understand(input, policy);
    },
  };
  return {
    counts,
    understandingCallTrace,
    armEvidenceGate,
    armPostResponseEvidenceFailure: (candidateTitle: string) => {
      if (postResponseFailureCandidateTitle !== null) {
        throw new Error("A post-response evidence failure is already armed");
      }
      postResponseFailureCandidateTitle = candidateTitle;
    },
    dependencies: {
      db: options.db,
      model,
      provider,
      research: {
        evidenceProvider,
        model: understanding,
        modelIdentity: {
          provider: "openai" as const,
          model: V0_07_OPENAI_DEFAULT_CONFIG.model,
          promptVersion: PRODUCT_UNDERSTANDING_PROMPT_VERSION,
        },
      },
    } satisfies LiveShoppingDependencies,
  };
}

function delta(after: Counts, before: Counts): Counts {
  return Object.fromEntries(
    Object.entries(after).map(([key, value]) => [
      key,
      value - before[key as keyof Counts],
    ]),
  ) as Counts;
}

function exactFocusedCallTrace(options: {
  traces: readonly UnderstandingCallTrace[];
  target: ReturnType<typeof chooseNamedGapTarget>;
}) {
  const matches = options.traces.filter(
    (trace) =>
      trace.candidateTitle === options.target.candidateTitle &&
      trace.requireCriterionBinding &&
      trace.structuredOutputContract === "focused" &&
      trace.criteria.length === 1 &&
      trace.criteria[0]?.ordinal === 0 &&
      trace.criteria[0]?.label === options.target.criterionLabel,
  );
  assertProof(
    matches.length === 1,
    `${options.target.criterionLabel} did not use exactly one focused provider contract with only the named local criterion`,
  );
  return matches[0]!;
}

async function waitForEvidenceGate(gate: ArmedEvidenceGate, label: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      gate.entered,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} did not reach evidence search`)),
          30_000,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function chooseOption(caseName: string, prompt: string, labels: string[]) {
  const question = prompt.toLocaleLowerCase("en-GB");
  const preferredTerms =
    caseName === "ergonomic-mouse"
      ? question.includes("hand")
        ? ["right", "average"]
        : ["wireless", "sculpt", "chunk", "flexible", "not sure"]
      : caseName === "office-chair"
        ? question.includes("material")
          ? ["mesh", "fabric"]
          : ["350", "medium", "flexible", "no preference"]
        : question.includes("floor")
          ? ["both", "hard", "rug"]
          : question.includes("noise")
            ? ["quiet", "low noise"]
            : question.includes("runtime")
              ? ["40", "long"]
              : ["compact", "flexible", "no preference", "not sure"];
  for (const term of preferredTerms) {
    const index = labels.findIndex((label) =>
      label.toLocaleLowerCase("en-GB").includes(term),
    );
    if (index >= 0) return index;
  }
  const honestFallback = labels.findIndex((label) =>
    /flexible|not sure|don.t know|no preference|doesn.t matter/i.test(label),
  );
  return honestFallback >= 0 ? honestFallback : 0;
}

async function resolveQuestions(options: {
  dependencies: LiveShoppingDependencies;
  caseName: string;
  view: LiveShoppingView;
  questions: Array<Record<string, unknown>>;
}) {
  let current = options.view;
  let providerRecoveryCount = 0;
  for (let turn = 0; turn < 6; turn += 1) {
    if (current.action.kind === "understanding_failed") {
      if (providerRecoveryCount >= 1) {
        throw new Error(
          `${options.caseName} understanding failed again after one safe retry`,
        );
      }
      providerRecoveryCount += 1;
      options.questions.push({
        kind: "provider_recovery",
        notice: current.action.notice,
      });
      current = await retryLiveShoppingContext({
        dependencies: options.dependencies,
        sessionId: current.sessionId,
      });
      continue;
    }
    if (current.action.kind !== "ask") return current;
    const action = current.action;
    if (action.responseMode === "open_text") {
      const answer =
        options.caseName === "ergonomic-mouse" && /hand/i.test(action.prompt)
          ? "Right-handed, with an average-sized hand."
          : "I do not have another requirement; keep that flexible.";
      options.questions.push({ prompt: action.prompt, answer });
      current = await answerLiveShoppingQuestion({
        dependencies: options.dependencies,
        input: {
          operation: "answer",
          sessionId: current.sessionId,
          turnId: randomUUID(),
          answer: { mode: "open_text", text: answer },
        },
      });
      continue;
    }
    const index = chooseOption(
      options.caseName,
      action.prompt,
      action.options.map(({ label }) => label),
    );
    const answer = action.options[index]!;
    options.questions.push({
      prompt: action.prompt,
      options: action.options.map(({ label }) => label),
      answer: answer.label,
    });
    current = await answerLiveShoppingQuestion({
      dependencies: options.dependencies,
      input: {
        operation: "answer",
        sessionId: current.sessionId,
        turnId: randomUUID(),
        answer: { mode: "single_select", optionOrdinal: answer.ordinal },
      },
    });
  }
  throw new Error(`${options.caseName} did not converge within six turns`);
}

function isDirectRetailer(listing: LiveShoppingView["savedListings"][number]) {
  return !listing.destinationLabel.includes("Google Shopping");
}

function hardUnknowns(view: LiveShoppingView) {
  return (
    view.decisionSupport?.topOptions.reduce(
      (total, option) => total + option.unresolvedMustHaves.length,
      0,
    ) ?? 0
  );
}

function decisionSnapshot(view: LiveShoppingView) {
  const support = view.decisionSupport;
  return {
    researchStatus: support?.researchStatus ?? null,
    deepResearchStatus: support?.deepResearchStatus ?? null,
    sectionMode: support?.sectionMode ?? null,
    hardUnknowns: hardUnknowns(view),
    decisionGaps: support?.decisionGaps ?? [],
    researchActivity: support?.researchActivity ?? null,
    topOptions:
      support?.topOptions.map((option) => ({
        candidateListingId: option.listing.candidateListingId,
        title: option.listing.title,
        merchant: option.listing.merchant,
        price: option.listing.priceText,
        readiness: option.readiness,
        researchState: option.researchState,
        directRetailer: isDirectRetailer(option.listing),
        destinationUrl: option.listing.destinationUrl,
        mustHaves: `${option.supportedMustHaveCount}/${option.mustHaveCount}`,
        unresolvedMustHaves: option.unresolvedMustHaves.map(
          ({ label }) => label,
        ),
        whyItFits: option.whyItFits,
        watchouts: option.watchouts,
        unknowns: option.unknowns,
      })) ?? [],
    comparison: support?.comparison ?? null,
  };
}

async function scopedPersistence(options: {
  db: LiveShoppingDependencies["db"];
  sessionId: string;
}) {
  const sessionRows = await options.db.select().from(founderLiveSessions);
  const session = sessionRows.find(({ id }) => id === options.sessionId);
  if (session === undefined) throw new Error("Founder session disappeared");
  const taskId = session.taskId;
  const [
    runs,
    queries,
    listings,
    research,
    attempts,
    targets,
    assessments,
    sources,
    observations,
    assessmentObservationBindings,
    saved,
    rejected,
  ] = await Promise.all([
    options.db.select().from(searchRuns),
    options.db.select().from(searchQueries),
    options.db.select().from(candidateListings),
    options.db.select().from(evidenceResearchRuns),
    options.db.select().from(evidenceAcquisitionAttempts),
    options.db.select().from(evidenceAttemptTargetCriteria),
    options.db.select().from(criterionAssessments),
    options.db.select().from(evidenceSources),
    options.db.select().from(productObservations),
    options.db.select().from(criterionAssessmentObservations),
    options.db.select().from(savedCandidateListings),
    options.db.select().from(rejectedCandidateListings),
  ]);
  const state = await loadCurrentShoppingState(options.db, taskId);
  const brief = projectShoppingBrief(state);
  const taskListings = listings.filter(
    ({ taskId: rowTaskId }) => rowTaskId === taskId,
  );
  const taskResearch = research.filter((row) => row.taskId === taskId);
  const researchIds = new Set(taskResearch.map(({ id }) => id));
  const taskAttempts = attempts.filter(({ researchRunId }) =>
    researchIds.has(researchRunId),
  );
  const taskTargets = targets.filter(({ researchRunId }) =>
    researchIds.has(researchRunId),
  );
  const targetCriterionIdsByAttempt = new Map<string, string[]>();
  for (const target of taskTargets) {
    const criterionIds =
      targetCriterionIdsByAttempt.get(target.attemptId) ?? [];
    criterionIds.push(target.criterionId);
    targetCriterionIdsByAttempt.set(target.attemptId, criterionIds);
  }
  const taskSources = sources.filter(
    ({ taskId: rowTaskId }) => rowTaskId === taskId,
  );
  const taskAssessments = assessments.filter(
    ({ taskId: rowTaskId }) => rowTaskId === taskId,
  );
  const taskObservations = observations.filter(
    ({ taskId: rowTaskId }) => rowTaskId === taskId,
  );
  const taskAssessmentBindings = assessmentObservationBindings.filter(
    ({ taskId: rowTaskId }) => rowTaskId === taskId,
  );
  const candidateCoverage = new Map<
    string,
    { searches: number; criteria: Set<string>; sources: number }
  >();
  for (const attempt of taskAttempts.filter(
    ({ stage }) => stage === "organic_search",
  )) {
    const coverage = candidateCoverage.get(attempt.candidateListingId) ?? {
      searches: 0,
      criteria: new Set<string>(),
      sources: 0,
    };
    coverage.searches += 1;
    for (const target of taskTargets.filter(
      ({ attemptId }) => attemptId === attempt.id,
    )) {
      coverage.criteria.add(target.criterionId);
    }
    candidateCoverage.set(attempt.candidateListingId, coverage);
  }
  for (const source of taskSources) {
    const coverage = candidateCoverage.get(source.candidateListingId);
    if (coverage !== undefined) coverage.sources += 1;
  }
  return {
    taskId,
    currentRevision: brief.revision,
    brief,
    retrievalRuns: runs.filter(({ taskId: rowTaskId }) => rowTaskId === taskId)
      .length,
    retrievalQueries: queries
      .filter(({ taskId: rowTaskId }) => rowTaskId === taskId)
      .map(({ queryText }) => queryText),
    rawCandidateListings: taskListings.length,
    listings: taskListings.map(
      ({
        id,
        runId,
        title,
        merchant,
        priceAmountMinor,
        priceCurrencyCode,
      }) => ({
        id,
        runId,
        title,
        merchant,
        price:
          priceAmountMinor === null || priceCurrencyCode === null
            ? null
            : { amountMinor: priceAmountMinor, currency: priceCurrencyCode },
      }),
    ),
    researchRuns: taskResearch.map((run) => ({
      id: run.id,
      taskRevision: run.taskRevision,
      policyVersion: run.policyVersion,
      phase: run.phase,
      status: run.status,
      selectedCandidateCount: run.selectedCandidateCount,
      plannedSearchCount: run.plannedSearchCount,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    })),
    attempts: taskAttempts.map((attempt) => ({
      id: attempt.id,
      researchRunId: attempt.researchRunId,
      candidateListingId: attempt.candidateListingId,
      stage: attempt.stage,
      purpose: attempt.purpose,
      planKey: attempt.planKey,
      query: attempt.query,
      status: attempt.status,
      provider: attempt.provider,
      model: attempt.model,
      promptVersion: attempt.promptVersion,
      providerRequestId: attempt.providerRequestId,
      receivedResultCount: attempt.receivedResultCount,
      failureCode: attempt.failureCode,
      targetCriterionIds: [
        ...(targetCriterionIdsByAttempt.get(attempt.id) ?? []),
      ].sort(),
    })),
    evidenceSearches: taskAttempts
      .filter(({ stage }) => stage === "organic_search")
      .map((attempt) => ({
        attemptId: attempt.id,
        researchRunId: attempt.researchRunId,
        candidateListingId: attempt.candidateListingId,
        purpose: attempt.purpose,
        query: attempt.query,
        status: attempt.status,
        providerRequestId: attempt.providerRequestId,
        receivedResultCount: attempt.receivedResultCount,
        failureCode: attempt.failureCode,
        targetCriterionIds: [
          ...(targetCriterionIdsByAttempt.get(attempt.id) ?? []),
        ].sort(),
      })),
    candidateCoverage: [...candidateCoverage].map(
      ([candidateListingId, coverage]) => ({
        candidateListingId,
        searches: coverage.searches,
        criterionCount: coverage.criteria.size,
        sourceCount: coverage.sources,
      }),
    ),
    assessmentCount: taskAssessments.length,
    currentAssessmentCount: taskAssessments.filter(
      ({ supersededAt, taskRevision }) =>
        supersededAt === null && taskRevision === brief.revision,
    ).length,
    assessments: taskAssessments.map((assessment) => ({
      id: assessment.id,
      researchRunId: assessment.researchRunId,
      taskRevision: assessment.taskRevision,
      candidateListingId: assessment.candidateListingId,
      criterionId: assessment.criterionId,
      generation: assessment.generation,
      supersedesAssessmentId: assessment.supersedesAssessmentId,
      supersededAt: assessment.supersededAt,
      status: assessment.status,
      relation: assessment.relation,
      explanation: assessment.explanation,
      method: assessment.method,
    })),
    currentAssessments: taskAssessments
      .filter(
        ({ supersededAt, taskRevision }) =>
          supersededAt === null && taskRevision === brief.revision,
      )
      .map((assessment) => ({
        id: assessment.id,
        researchRunId: assessment.researchRunId,
        taskRevision: assessment.taskRevision,
        candidateListingId: assessment.candidateListingId,
        criterionId: assessment.criterionId,
        generation: assessment.generation,
        supersedesAssessmentId: assessment.supersedesAssessmentId,
        supersededAt: assessment.supersededAt,
        status: assessment.status,
        relation: assessment.relation,
        explanation: assessment.explanation,
        method: assessment.method,
      })),
    titleDescriptorObservations: taskObservations
      .filter(
        ({ propertyLabel }) =>
          propertyLabel === DIRECT_TITLE_DESCRIPTOR_PROPERTY,
      )
      .map((observation) => ({
        id: observation.id,
        researchRunId: observation.researchRunId,
        candidateListingId: observation.candidateListingId,
        evidenceSourceId: observation.evidenceSourceId,
        conceptId: observation.conceptId,
        propertyLabel: observation.propertyLabel,
        claim: observation.claim,
        value: observation.value,
        derivation: observation.derivation,
      })),
    observations: taskObservations.map((observation) => ({
      id: observation.id,
      researchRunId: observation.researchRunId,
      candidateListingId: observation.candidateListingId,
      evidenceSourceId: observation.evidenceSourceId,
      conceptId: observation.conceptId,
      support: observation.support,
      observationKind: observation.observationKind,
      propertyLabel: observation.propertyLabel,
      claim: observation.claim,
      value: observation.value,
      derivation: observation.derivation,
    })),
    assessmentObservationBindings: taskAssessmentBindings.map(
      ({ assessmentId, observationId, candidateListingId }) => ({
        assessmentId,
        observationId,
        candidateListingId,
      }),
    ),
    evidenceSources: taskSources.map(
      ({
        id,
        researchRunId,
        candidateListingId,
        sourceRole,
        sourceKind,
        sourceUrl,
        sourceTitle,
      }) => ({
        id,
        researchRunId,
        candidateListingId,
        sourceRole,
        sourceKind,
        sourceUrl: sanitizeArtifactSourceUrl(sourceUrl),
        sourceTitle,
      }),
    ),
    savedCount: saved.filter(({ taskId: rowTaskId }) => rowTaskId === taskId)
      .length,
    rejectedCount: rejected.filter(
      ({ taskId: rowTaskId }) => rowTaskId === taskId,
    ).length,
  };
}

type PersistenceSnapshot = Awaited<ReturnType<typeof scopedPersistence>>;
type CaseName = (typeof cases)[number]["name"];

function assertProof(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`V0-08 proof failed: ${message}`);
}

function sameNullableDate(left: Date | null, right: Date | null) {
  return left?.toISOString() === right?.toISOString();
}

function sameAssessmentIdentity(
  left: PersistenceSnapshot["currentAssessments"][number] | undefined,
  right: PersistenceSnapshot["currentAssessments"][number] | undefined,
) {
  if (left === undefined || right === undefined) return left === right;
  return (
    left.id === right.id &&
    left.generation === right.generation &&
    left.supersedesAssessmentId === right.supersedesAssessmentId &&
    sameNullableDate(left.supersededAt, right.supersededAt)
  );
}

function assessmentIdentityChanges(options: {
  before: PersistenceSnapshot;
  after: PersistenceSnapshot;
}) {
  const beforeByCriterion = new Map(
    options.before.currentAssessments.map((assessment) => [
      `${assessment.candidateListingId}:${assessment.criterionId}`,
      assessment,
    ]),
  );
  const afterByCriterion = new Map(
    options.after.currentAssessments.map((assessment) => [
      `${assessment.candidateListingId}:${assessment.criterionId}`,
      assessment,
    ]),
  );
  return [...new Set([...beforeByCriterion.keys(), ...afterByCriterion.keys()])]
    .sort()
    .flatMap((identity) => {
      const before = beforeByCriterion.get(identity);
      const after = afterByCriterion.get(identity);
      return sameAssessmentIdentity(before, after)
        ? []
        : [
            {
              candidateListingId:
                after?.candidateListingId ?? before!.candidateListingId,
              criterionId: after?.criterionId ?? before!.criterionId,
              before:
                before === undefined
                  ? null
                  : {
                      id: before.id,
                      generation: before.generation,
                      supersededAt: before.supersededAt,
                      supersedesAssessmentId: before.supersedesAssessmentId,
                    },
              after:
                after === undefined
                  ? null
                  : {
                      id: after.id,
                      generation: after.generation,
                      supersededAt: after.supersededAt,
                      supersedesAssessmentId: after.supersedesAssessmentId,
                      researchRunId: after.researchRunId,
                    },
            },
          ];
    });
}

function priority(
  strength: PersistenceSnapshot["brief"]["items"][number]["strength"],
) {
  return strength === "hard" ? 0 : strength === "strong_preference" ? 1 : 2;
}

function predictedAutomaticTargets(options: {
  persistence: PersistenceSnapshot;
  candidateListingId: string;
}) {
  const assessmentByCriterion = new Map(
    options.persistence.currentAssessments
      .filter(
        ({ candidateListingId }) =>
          candidateListingId === options.candidateListingId,
      )
      .map((assessment) => [assessment.criterionId, assessment]),
  );
  return [...options.persistence.brief.items]
    .sort(
      (left, right) =>
        priority(left.strength) - priority(right.strength) ||
        left.conceptLabel.localeCompare(right.conceptLabel),
    )
    .filter((item) => {
      const assessment = assessmentByCriterion.get(item.criterionId);
      return (
        !assessment?.relation.startsWith("target_distance_minor:") &&
        (assessment === undefined ||
          assessment.status === "uncertain" ||
          assessment.status === "not_applicable")
      );
    })
    .slice(0, 2)
    .map(({ criterionId }) => String(criterionId));
}

function chooseNamedGapTarget(options: {
  caseName: CaseName;
  view: LiveShoppingView;
  persistence: PersistenceSnapshot;
}) {
  const support = options.view.decisionSupport;
  assertProof(support !== null, `${options.caseName} has no decision support`);
  const preferredLabelPatterns: Record<CaseName, readonly RegExp[]> = {
    "ergonomic-mouse": [/battery/i, /brand/i, /review/i],
    "office-chair": [/lower.?back|lumbar/i, /chair size|size/i, /budget/i],
    "cordless-vacuum": [/floor/i, /noise/i, /runtime/i],
  };
  const availableById = new Map(
    support.topOptions
      .filter(({ researchState }) => researchState === "available")
      .map((option) => [option.listing.candidateListingId, option]),
  );
  const automaticCandidateIds = [
    ...new Set(
      support.decisionGaps.flatMap(
        ({ candidateListingIds }) => candidateListingIds,
      ),
    ),
  ].slice(0, 2);
  const candidates = preferredLabelPatterns[options.caseName].flatMap(
    (pattern) =>
      support.decisionGaps.filter(({ label }) => pattern.test(label)),
  );
  const orderedGaps = [
    ...new Map(
      [...candidates, ...support.decisionGaps].map((gap) => [
        gap.criterionId,
        gap,
      ]),
    ).values(),
  ];
  for (const gap of orderedGaps) {
    for (const candidateListingId of gap.candidateListingIds) {
      const option = availableById.get(candidateListingId);
      if (option === undefined) continue;
      const automaticTargetCriterionIds = predictedAutomaticTargets({
        persistence: options.persistence,
        candidateListingId,
      });
      if (
        options.caseName === "ergonomic-mouse" &&
        (!automaticCandidateIds.includes(candidateListingId) ||
          !automaticTargetCriterionIds.includes(gap.criterionId))
      ) {
        continue;
      }
      return {
        criterionId: gap.criterionId,
        criterionLabel: gap.label,
        criterionStrength: gap.strength,
        candidateListingId,
        candidateTitle: option.listing.title,
        automaticCandidateIds,
        automaticTargetCriterionIds,
      };
    }
  }
  throw new Error(
    `V0-08 proof failed: ${options.caseName} has no eligible named decision gap`,
  );
}

type GapTarget = ReturnType<typeof chooseNamedGapTarget>;

function targetedPersistenceProof(options: {
  before: PersistenceSnapshot;
  after: PersistenceSnapshot;
  target: GapTarget;
  calls: Counts;
  logicalRequests: number;
  expectedDuplicateCallsPrevented: number;
  requireGloballyCleanNonTargetState: boolean;
}) {
  const beforeRunIds = new Set(options.before.researchRuns.map(({ id }) => id));
  const beforeAttemptIds = new Set(options.before.attempts.map(({ id }) => id));
  const beforeAssessmentIds = new Set(
    options.before.assessments.map(({ id }) => id),
  );
  const newResearchRuns = options.after.researchRuns.filter(
    ({ id }) => !beforeRunIds.has(id),
  );
  const newAttempts = options.after.attempts.filter(
    ({ id }) => !beforeAttemptIds.has(id),
  );
  const exactPairOrganicAttempts = newAttempts.filter(
    (attempt) =>
      attempt.stage === "organic_search" &&
      attempt.candidateListingId === options.target.candidateListingId &&
      attempt.targetCriterionIds.includes(options.target.criterionId),
  );
  assertProof(
    exactPairOrganicAttempts.length === 1,
    `${options.target.criterionLabel} created ${exactPairOrganicAttempts.length} organic candidate+criterion attempts instead of one`,
  );
  const exactAttempt = exactPairOrganicAttempts[0]!;
  assertProof(
    exactAttempt.targetCriterionIds.length === 1 &&
      exactAttempt.targetCriterionIds[0] === options.target.criterionId,
    `${options.target.criterionLabel} organic plan was not exact-criterion scoped`,
  );
  const exactRun = newResearchRuns.find(
    ({ id }) => id === exactAttempt.researchRunId,
  );
  assertProof(
    exactRun !== undefined,
    `${options.target.criterionLabel} exact plan did not belong to a fresh deepening run`,
  );
  const exactModelAttempts = newAttempts.filter(
    (attempt) =>
      attempt.researchRunId === exactAttempt.researchRunId &&
      attempt.candidateListingId === options.target.candidateListingId &&
      (attempt.stage === "observation_extraction" ||
        attempt.stage === "criterion_assessment"),
  );
  assertProof(
    exactModelAttempts.length === 2 &&
      exactModelAttempts.every(
        ({ targetCriterionIds }) =>
          targetCriterionIds.length === 1 &&
          targetCriterionIds[0] === options.target.criterionId,
      ),
    `${options.target.criterionLabel} model attempts were not structurally target-scoped`,
  );
  const exactRunAssessmentWrites = options.after.assessments.filter(
    (assessment) =>
      !beforeAssessmentIds.has(assessment.id) &&
      assessment.researchRunId === exactAttempt.researchRunId &&
      assessment.candidateListingId === options.target.candidateListingId,
  );
  const beforeTargetAssessment = options.before.currentAssessments.find(
    (assessment) =>
      assessment.candidateListingId === options.target.candidateListingId &&
      assessment.criterionId === options.target.criterionId,
  );
  const afterTargetAssessment = options.after.currentAssessments.find(
    (assessment) =>
      assessment.candidateListingId === options.target.candidateListingId &&
      assessment.criterionId === options.target.criterionId,
  );
  assertProof(
    beforeTargetAssessment !== undefined &&
      afterTargetAssessment !== undefined &&
      exactRunAssessmentWrites.length === 1 &&
      exactRunAssessmentWrites[0]?.id === afterTargetAssessment.id &&
      exactRunAssessmentWrites[0]?.criterionId === options.target.criterionId &&
      afterTargetAssessment.researchRunId === exactRun.id &&
      afterTargetAssessment.id !== beforeTargetAssessment.id &&
      afterTargetAssessment.generation ===
        beforeTargetAssessment.generation + 1 &&
      afterTargetAssessment.supersedesAssessmentId ===
        beforeTargetAssessment.id,
    `${options.target.criterionLabel} did not produce exactly one new target generation superseding its prior assessment`,
  );
  assertProof(
    exactModelAttempts.every(({ status }) => status === "succeeded"),
    `${options.target.criterionLabel} model work did not complete successfully`,
  );
  const assessmentChanges = assessmentIdentityChanges({
    before: options.before,
    after: options.after,
  });
  const authorizedConcurrentPairs = new Set(
    newAttempts
      .filter((attempt) => attempt.stage === "criterion_assessment")
      .flatMap(({ candidateListingId, targetCriterionIds }) =>
        targetCriterionIds.map(
          (criterionId) => `${candidateListingId}:${criterionId}`,
        ),
      ),
  );
  const unauthorizedAssessmentChanges = assessmentChanges.filter(
    ({ candidateListingId, criterionId }) =>
      !authorizedConcurrentPairs.has(`${candidateListingId}:${criterionId}`),
  );
  assertProof(
    unauthorizedAssessmentChanges.length === 0,
    `${options.target.criterionLabel} operation changed an assessment outside every persisted target plan`,
  );
  const globallyChangedNonTargets = assessmentChanges.filter(
    ({ candidateListingId, criterionId }) =>
      candidateListingId !== options.target.candidateListingId ||
      criterionId !== options.target.criterionId,
  );
  if (options.requireGloballyCleanNonTargetState) {
    assertProof(
      globallyChangedNonTargets.length === 0,
      `${options.target.criterionLabel} clean target operation changed non-target assessment identity`,
    );
  }
  const duplicateCallsPrevented =
    options.logicalRequests - exactPairOrganicAttempts.length;
  assertProof(
    duplicateCallsPrevented === options.expectedDuplicateCallsPrevented,
    `${options.target.criterionLabel} duplicate prevention evidence was not exact`,
  );
  return {
    requestedTarget: {
      criterionId: options.target.criterionId,
      criterionLabel: options.target.criterionLabel,
      criterionStrength: options.target.criterionStrength,
      candidateListingId: options.target.candidateListingId,
      candidateTitle: options.target.candidateTitle,
    },
    persistedExactPlan: {
      researchRunId: exactRun.id,
      taskRevision: exactRun.taskRevision,
      policyVersion: exactRun.policyVersion,
      runStatus: exactRun.status,
      organicAttemptId: exactAttempt.id,
      purpose: exactAttempt.purpose,
      query: exactAttempt.query,
      targetCriterionIds: exactAttempt.targetCriterionIds,
      status: exactAttempt.status,
      providerRequestId: exactAttempt.providerRequestId,
      receivedResultCount: exactAttempt.receivedResultCount,
      failureCode: exactAttempt.failureCode,
      modelAttempts: exactModelAttempts,
    },
    calls: options.calls,
    logicalRequestsForExactPair: options.logicalRequests,
    organicAttemptsForExactPair: exactPairOrganicAttempts.length,
    duplicateCallsPrevented,
    assessmentIdentityChanges: assessmentChanges,
    exactRunAssessmentWrites,
    exactRunOutOfScopeAssessmentWrites: 0,
    targetGenerationProof: {
      before: beforeTargetAssessment,
      after: afterTargetAssessment,
      exactSuccess: true,
    },
    nonTargetCurrentIdentityUnchanged: globallyChangedNonTargets.length === 0,
    concurrentAuthorizedNonTargetChanges: globallyChangedNonTargets,
    untargetedCurrentIdentityChanges: unauthorizedAssessmentChanges,
    newResearchRuns,
  };
}

function purchaseSummaryProof(options: {
  caseName: CaseName;
  view: LiveShoppingView;
  persistence: PersistenceSnapshot;
}) {
  const comparison = options.view.decisionSupport?.comparison;
  assertProof(
    comparison !== null && comparison !== undefined,
    `${options.caseName} did not produce a saved comparison`,
  );
  const purchasePriceItems = options.persistence.brief.items.filter(
    isPurchasePriceCriterion,
  );
  if (options.caseName === "office-chair") {
    assertProof(
      purchasePriceItems.length === 1 &&
        /budget|price|purchase|cost|spend/i.test(
          purchasePriceItems[0]!.conceptLabel,
        ),
      "office-chair proof did not retain one authoritative purchase-price criterion",
    );
  }
  const purchasePriceItem =
    purchasePriceItems.length === 1 ? purchasePriceItems[0] : undefined;
  let conditionalStretch: null | {
    criterionId: string;
    targetMinor: number;
    stretchCeilingMinor: number;
    currency: string;
    condition: string;
  } = null;
  if (options.caseName === "office-chair") {
    assertProof(
      purchasePriceItem?.semanticValue.kind === "money_stretch" &&
        purchasePriceItem.semanticValue.targetMinor === 25_000 &&
        purchasePriceItem.semanticValue.stretchCeilingMinor === 35_000 &&
        purchasePriceItem.semanticValue.currency === "GBP" &&
        purchasePriceItem.semanticValue.condition.length > 0,
      "office-chair proof did not preserve £250 / conditional £350 stretch authority",
    );
    conditionalStretch = {
      criterionId: purchasePriceItem.criterionId,
      targetMinor: purchasePriceItem.semanticValue.targetMinor,
      stretchCeilingMinor: purchasePriceItem.semanticValue.stretchCeilingMinor,
      currency: purchasePriceItem.semanticValue.currency,
      condition: purchasePriceItem.semanticValue.condition,
    };
  }
  const rows = comparison.purchaseSummaries.map((summary) => {
    const assessment =
      purchasePriceItem === undefined
        ? undefined
        : options.persistence.currentAssessments.find(
            (entry) =>
              entry.candidateListingId === summary.candidateListingId &&
              entry.criterionId === purchasePriceItem.criterionId,
          );
    const expected =
      assessment?.explanation ??
      (purchasePriceItems.length === 0
        ? "No purchase-price target is stated in the current brief."
        : purchasePriceItems.length > 1
          ? "Multiple purchase-price targets are stated, so no single purchase summary is assumed."
          : "Its observed purchase price has not been related to the stated purchase-price target.");
    return {
      ...summary,
      authoritativeCriterionId: purchasePriceItem?.criterionId ?? null,
      authoritativeCriterionLabel: purchasePriceItem?.conceptLabel ?? null,
      assessmentId: assessment?.id ?? null,
      expected,
      exactMatch: summary.priceRelationship === expected,
    };
  });
  assertProof(
    rows.every(({ exactMatch }) => exactMatch),
    `${options.caseName} comparison bypassed the purchase-price authority boundary`,
  );
  return {
    purchasePriceCriterionCount: purchasePriceItems.length,
    conditionalStretch,
    rows,
  };
}

function directTitleTradeoffProof(options: {
  caseName: CaseName;
  view: LiveShoppingView;
  persistence: PersistenceSnapshot;
}) {
  const top = options.view.decisionSupport?.topOptions ?? [];
  if (options.caseName !== "office-chair") {
    return {
      applicable: false,
      liveMarketExercised: false,
      selfDescribedGamingOptionCount: 0,
      rows: [],
    };
  }
  const selfDescribedGamingOptions = top.filter(({ listing }) =>
    /\bgaming\b/i.test(listing.title),
  );
  const observationsById = new Map(
    options.persistence.titleDescriptorObservations.map((observation) => [
      observation.id,
      observation,
    ]),
  );
  const sourcesById = new Map(
    options.persistence.evidenceSources.map((source) => [source.id, source]),
  );
  const rows = selfDescribedGamingOptions.map((option) => {
    const assessments = options.persistence.currentAssessments.filter(
      (assessment) =>
        assessment.candidateListingId === option.listing.candidateListingId &&
        assessment.relation === "direct_title_preference_mismatch",
    );
    const boundObservations = options.persistence.assessmentObservationBindings
      .filter(({ assessmentId }) =>
        assessments.some(({ id }) => id === assessmentId),
      )
      .map(({ observationId }) => observationsById.get(observationId))
      .filter((observation) => observation !== undefined);
    const exactListingSources = boundObservations
      .map(({ evidenceSourceId }) => sourcesById.get(evidenceSourceId))
      .filter((source) => source !== undefined);
    const surfacedHonestly =
      (option.readiness === "trade_off" ||
        option.readiness === "needs_verification") &&
      option.watchouts.some((watchout) => /gaming|gamer/i.test(watchout)) &&
      assessments.some(({ status }) => status === "conflicts") &&
      boundObservations.some(
        ({ claim }) =>
          /exact listing title/i.test(claim) && /gaming/i.test(claim),
      ) &&
      exactListingSources.some(
        ({ sourceKind, sourceRole }) =>
          sourceKind === "listing_field" && sourceRole === "listing",
      );
    return {
      candidateListingId: option.listing.candidateListingId,
      title: option.listing.title,
      readiness: option.readiness,
      watchouts: option.watchouts,
      assessments,
      observations: boundObservations,
      sources: exactListingSources,
      surfacedHonestly,
    };
  });
  assertProof(
    rows.every(({ surfacedHonestly }) => surfacedHonestly),
    "a presented self-described Gaming option silently remained qualified without an evidenced appearance trade-off",
  );
  return {
    applicable: true,
    liveMarketExercised: rows.length > 0,
    selfDescribedGamingOptionCount: rows.length,
    rows,
  };
}

function statusProjectionProof(options: {
  view: LiveShoppingView;
  persistence: PersistenceSnapshot;
}) {
  const support = options.view.decisionSupport;
  assertProof(
    support !== null,
    "decision support disappeared during status proof",
  );
  const currentRuns = options.persistence.researchRuns.filter(
    ({ taskRevision }) => taskRevision === options.persistence.currentRevision,
  );
  const firstPassRuns = currentRuns.filter(
    ({ phase }) => phase === "first_pass",
  );
  const deepeningRuns = currentRuns.filter(
    ({ phase }) => phase === "deepening",
  );
  const evidenceBackedAssessmentIds = new Set(
    options.persistence.assessmentObservationBindings.map(
      ({ assessmentId }) => assessmentId,
    ),
  );
  const evidenceBackedRunIds = new Set(
    options.persistence.currentAssessments
      .filter(({ id }) => evidenceBackedAssessmentIds.has(id))
      .map(({ researchRunId }) => researchRunId),
  );
  const firstPassHasUsefulAssessment = firstPassRuns.some(({ id }) =>
    evidenceBackedRunIds.has(id),
  );
  const deepeningHasUsefulAssessment = deepeningRuns.some(({ id }) =>
    evidenceBackedRunIds.has(id),
  );
  const expectedResearchStatus =
    firstPassRuns.length === 0
      ? "not_started"
      : firstPassRuns.some(({ status }) => status === "running")
        ? "researching"
        : firstPassRuns.every(({ status }) => status === "succeeded")
          ? "ready"
          : firstPassRuns.some(
                ({ status }) => status === "partial" || status === "succeeded",
              ) || firstPassHasUsefulAssessment
            ? "partial"
            : "failed";
  const expectedDeepResearchStatus =
    deepeningRuns.length === 0
      ? support.decisionGaps.length === 0
        ? "not_needed"
        : "available"
      : deepeningRuns.some(({ status }) => status === "running")
        ? "researching"
        : deepeningRuns.every(({ status }) => status === "succeeded")
          ? "complete"
          : deepeningRuns.some(
                ({ status }) => status === "partial" || status === "succeeded",
              ) || deepeningHasUsefulAssessment
            ? "partial"
            : "failed";
  assertProof(
    support.researchStatus === expectedResearchStatus,
    `first-pass status ${support.researchStatus} disagrees with persisted runs`,
  );
  assertProof(
    support.deepResearchStatus === expectedDeepResearchStatus,
    `deep status ${support.deepResearchStatus} disagrees with persisted runs`,
  );
  return {
    projected: {
      researchStatus: support.researchStatus,
      deepResearchStatus: support.deepResearchStatus,
    },
    expected: { expectedResearchStatus, expectedDeepResearchStatus },
    evidenceBackedRunIds: [...evidenceBackedRunIds].sort(),
    currentPersistedRuns: currentRuns,
    exactMatch: true,
  };
}

function boundedCostProof(persistence: PersistenceSnapshot) {
  const firstPass = persistence.researchRuns
    .filter(({ phase }) => phase === "first_pass")
    .map((run) => {
      const attempts = persistence.attempts.filter(
        ({ researchRunId }) => researchRunId === run.id,
      );
      const searches = attempts.filter(
        ({ stage }) => stage === "organic_search",
      );
      const searchCountsByCandidate = new Map<string, number>();
      for (const attempt of searches) {
        searchCountsByCandidate.set(
          attempt.candidateListingId,
          (searchCountsByCandidate.get(attempt.candidateListingId) ?? 0) + 1,
        );
      }
      assertProof(
        run.selectedCandidateCount <= 4 &&
          run.plannedSearchCount === run.selectedCandidateCount &&
          searches.length === run.selectedCandidateCount &&
          [...searchCountsByCandidate.values()].every((count) => count === 1),
        `first-pass run ${run.id} exceeded four candidates or one evidence search per candidate`,
      );
      return {
        researchRunId: run.id,
        selectedCandidateCount: run.selectedCandidateCount,
        evidenceSearchCount: searches.length,
        oneSearchPerCandidate: true,
      };
    });
  const deepening = persistence.researchRuns
    .filter(({ phase }) => phase === "deepening")
    .map((run) => {
      const attempts = persistence.attempts.filter(
        ({ researchRunId }) => researchRunId === run.id,
      );
      const searches = attempts.filter(
        ({ stage }) => stage === "organic_search",
      );
      assertProof(
        run.selectedCandidateCount <= 3 &&
          run.plannedSearchCount === run.selectedCandidateCount &&
          searches.length === run.selectedCandidateCount &&
          searches.every(
            ({ targetCriterionIds }) =>
              targetCriterionIds.length >= 1 && targetCriterionIds.length <= 2,
          ),
        `deepening run ${run.id} exceeded its candidate, search, or criterion bounds`,
      );
      return {
        researchRunId: run.id,
        selectedCandidateCount: run.selectedCandidateCount,
        evidenceSearchCount: searches.length,
        targetCriterionCounts: searches.map(
          ({ targetCriterionIds }) => targetCriterionIds.length,
        ),
      };
    });
  return { firstPass, deepening };
}

function categoryHonestyProof(options: {
  caseName: CaseName;
  view: LiveShoppingView;
  persistence: PersistenceSnapshot;
}) {
  const support = options.view.decisionSupport;
  assertProof(support !== null, `${options.caseName} has no decision support`);
  const bindingIds = new Set(
    options.persistence.assessmentObservationBindings.map(
      ({ assessmentId }) => assessmentId,
    ),
  );
  const hardItems = options.persistence.brief.items.filter(
    ({ strength }) => strength === "hard",
  );
  const hardRows = support.topOptions.flatMap((option) =>
    hardItems.map((item) => {
      const assessment = options.persistence.currentAssessments.find(
        (entry) =>
          entry.candidateListingId === option.listing.candidateListingId &&
          entry.criterionId === item.criterionId,
      );
      const isUnknown =
        assessment === undefined ||
        assessment.status === "uncertain" ||
        assessment.status === "not_applicable";
      const surfacedUnknown = option.unresolvedMustHaves.some(
        ({ label }) => label === item.conceptLabel,
      );
      assertProof(
        assessment?.status !== "conflicts",
        `${options.caseName} presented a candidate with a hard conflict on ${item.conceptLabel}`,
      );
      assertProof(
        isUnknown === surfacedUnknown,
        `${options.caseName} hid or invented resolution for hard criterion ${item.conceptLabel}`,
      );
      if (assessment?.status === "meets") {
        assertProof(
          bindingIds.has(assessment.id),
          `${options.caseName} marked hard criterion ${item.conceptLabel} met without bound evidence`,
        );
      }
      return {
        candidateListingId: option.listing.candidateListingId,
        criterionId: item.criterionId,
        label: item.conceptLabel,
        assessmentStatus: assessment?.status ?? null,
        surfacedUnknown,
        evidenceBound:
          assessment === undefined ? false : bindingIds.has(assessment.id),
      };
    }),
  );

  if (options.caseName === "office-chair") {
    const comfortItems = options.persistence.brief.items.filter((item) =>
      /comfort|long.?session|long workday/i.test(
        `${item.conceptLabel} ${item.conceptDefinition} ${JSON.stringify(item.semanticValue)}`,
      ),
    );
    assertProof(
      comfortItems.length > 0,
      "office-chair brief lost the explicit long-session comfort concern",
    );
    const personalComfortUnknowns = support.topOptions.flatMap((option) =>
      comfortItems.flatMap((item) => {
        const assessment = options.persistence.currentAssessments.find(
          (entry) =>
            entry.candidateListingId === option.listing.candidateListingId &&
            entry.criterionId === item.criterionId,
        );
        return assessment === undefined ||
          assessment.status === "uncertain" ||
          assessment.status === "not_applicable"
          ? [
              {
                candidateListingId: option.listing.candidateListingId,
                criterionId: item.criterionId,
                label: item.conceptLabel,
                status: assessment?.status ?? null,
              },
            ]
          : [];
      }),
    );
    assertProof(
      personalComfortUnknowns.length > 0,
      "office-chair proof converted every personal long-session comfort question into certainty",
    );
    return { hardRows, personalComfortUnknowns };
  }

  if (options.caseName === "cordless-vacuum") {
    const floorAndNoiseItems = options.persistence.brief.items.filter((item) =>
      /hard floor|rug|floor|noise|quiet|loud/i.test(
        `${item.conceptLabel} ${item.conceptDefinition} ${JSON.stringify(item.semanticValue)}`,
      ),
    );
    assertProof(
      floorAndNoiseItems.length >= 2,
      "vacuum brief lost the explicit floor/rug or noise requirement",
    );
    const durabilityItems = options.persistence.brief.items.filter((item) =>
      /durab|longevity|lifespan/i.test(
        `${item.conceptLabel} ${item.conceptDefinition}`,
      ),
    );
    assertProof(
      durabilityItems.length === 0,
      "vacuum brief invented a durability requirement the shopper did not state",
    );
    const attributedClaims = support.topOptions.flatMap((option) =>
      floorAndNoiseItems.flatMap((item) => {
        const assessment = options.persistence.currentAssessments.find(
          (entry) =>
            entry.candidateListingId === option.listing.candidateListingId &&
            entry.criterionId === item.criterionId,
        );
        if (assessment?.status !== "meets") return [];
        const observationIds = options.persistence.assessmentObservationBindings
          .filter(({ assessmentId }) => assessmentId === assessment.id)
          .map(({ observationId }) => observationId);
        assertProof(
          observationIds.length > 0,
          `vacuum ${item.conceptLabel} was presented as met without attributable evidence`,
        );
        return [
          {
            candidateListingId: option.listing.candidateListingId,
            criterionId: item.criterionId,
            label: item.conceptLabel,
            assessmentId: assessment.id,
            observationIds,
          },
        ];
      }),
    );
    return { hardRows, floorAndNoiseItems, attributedClaims };
  }

  return { hardRows };
}

function leaveAppObservation(options: {
  caseName: string;
  view: LiveShoppingView;
}) {
  const gaps =
    options.view.decisionSupport?.decisionGaps.map(({ label }) => label) ?? [];
  const top = options.view.decisionSupport?.topOptions ?? [];
  const reasons: string[] = [];
  if (gaps.length > 0) {
    reasons.push(
      `verify ${gaps.slice(0, 3).join(", ")} from richer product pages or specialist reviews`,
    );
  }
  if (top.some(({ listing }) => !isDirectRetailer(listing))) {
    reasons.push(
      "reach a direct retailer page for options that still use Google Shopping fallback",
    );
  }
  if (options.caseName === "office-chair") {
    reasons.push(
      "check returns and personal long-session comfort before purchase",
    );
  }
  if (options.caseName === "cordless-vacuum") {
    reasons.push(
      "validate real-world noise and durability beyond search snippets",
    );
  }
  return reasons.length === 0
    ? "I could proceed to the surfaced retailer, while still checking ordinary returns and current stock."
    : `I would still leave Consider to ${reasons.join("; ")}.`;
}

async function runCase(options: {
  fixture: (typeof cases)[number];
  dependencies: LiveShoppingDependencies;
  counts: Counts;
  understandingCallTrace: UnderstandingCallTrace[];
  armEvidenceGate: (candidateTitle: string) => ArmedEvidenceGate;
  armPostResponseEvidenceFailure: (candidateTitle: string) => void;
  onSessionCreated: (sessionId: string) => void;
}) {
  const sessionId = randomUUID();
  options.onSessionCreated(sessionId);
  const questions: Array<Record<string, unknown>> = [];
  const startCounts = { ...options.counts };
  const startUnderstandingTraceIndex = options.understandingCallTrace.length;
  const startedAt = performance.now();
  let view = await startLiveShopping({
    dependencies: options.dependencies,
    input: {
      operation: "start",
      sessionId,
      turnId: randomUUID(),
      message: options.fixture.request,
    },
  });
  view = await resolveQuestions({
    dependencies: options.dependencies,
    caseName: options.fixture.name,
    view,
    questions,
  });
  if (view.action.kind !== "search" || view.action.search === null) {
    throw new Error(
      `${options.fixture.name} did not reach a product search: ${JSON.stringify(view.action)}`,
    );
  }
  const firstListingsMs = Math.round(performance.now() - startedAt);
  const retrieval = {
    status: view.action.search.status,
    queryCount: view.action.search.queryCount,
    completedQueryCount: view.action.search.completedQueryCount,
    visibleListings: view.action.search.listings.length,
  };
  const hardCriterionCount = view.brief.filter(
    ({ emphasis }) => emphasis === "must",
  ).length;

  const beforeFirstPassCounts = { ...options.counts };
  const firstPassStartedAt = performance.now();
  view = await researchLiveShopping({
    dependencies: options.dependencies,
    input: { operation: "research", sessionId },
  });
  const firstDecisionMs = Math.round(performance.now() - startedAt);
  const firstPass = decisionSnapshot(view);
  const firstPassCalls = delta(options.counts, beforeFirstPassCounts);
  const firstPassPersistence = await scopedPersistence({
    db: options.dependencies.db,
    sessionId,
  });
  const firstPassTitleTradeoffEvidence = directTitleTradeoffProof({
    caseName: options.fixture.name,
    view,
    persistence: firstPassPersistence,
  });
  const target = chooseNamedGapTarget({
    caseName: options.fixture.name,
    view,
    persistence: firstPassPersistence,
  });
  const beforeDeepStageCounts = { ...options.counts };
  const beforeTargetCounts = { ...options.counts };
  const beforeTargetTraceIndex = options.understandingCallTrace.length;
  let targetedPersistence: PersistenceSnapshot;
  let targetedCalls: Counts;
  let targeted: ReturnType<typeof targetedPersistenceProof>;
  let automaticDeepening: Record<string, unknown>;
  let controlledPartialEvidence: Record<string, unknown> | null = null;

  if (options.fixture.name === "ergonomic-mouse") {
    assertProof(
      target.automaticCandidateIds.includes(target.candidateListingId) &&
        target.automaticTargetCriterionIds.includes(target.criterionId),
      "mouse overlap target was not in the authoritative automatic plan baseline",
    );
    const gate = options.armEvidenceGate(target.candidateTitle);
    const manualPromise = researchLiveCandidate({
      dependencies: options.dependencies,
      input: {
        operation: "research_candidate",
        sessionId,
        candidateListingId: target.candidateListingId,
        criterionId: target.criterionId,
      },
    });
    let automaticView: LiveShoppingView | null = null;
    let overlapFailure: unknown;
    try {
      await waitForEvidenceGate(gate, "mouse exact-gap request");
      automaticView = await deepenLiveShoppingResearch({
        dependencies: options.dependencies,
        input: { operation: "deepen_research", sessionId },
      });
    } catch (error) {
      overlapFailure = error;
    } finally {
      gate.release();
    }
    await manualPromise;
    if (overlapFailure !== undefined) throw overlapFailure;
    assertProof(
      automaticView?.decisionSupport?.deepResearchStatus === "researching",
      "mouse concurrent view did not expose the still-running exact-gap work",
    );
    view = await loadLiveShoppingSession({
      db: options.dependencies.db,
      sessionId,
    });
    targetedCalls = delta(options.counts, beforeTargetCounts);
    targetedPersistence = await scopedPersistence({
      db: options.dependencies.db,
      sessionId,
    });
    targeted = targetedPersistenceProof({
      before: firstPassPersistence,
      after: targetedPersistence,
      target,
      calls: targetedCalls,
      logicalRequests: 2,
      expectedDuplicateCallsPrevented: 1,
      requireGloballyCleanNonTargetState: false,
    });
    automaticDeepening = {
      mode: "concurrent_with_exact_gap",
      automaticCandidateIds: target.automaticCandidateIds,
      automaticBaselineTargetCriterionIds: target.automaticTargetCriterionIds,
      decisionWhileExactRequestWasActive:
        automaticView === null ? null : decisionSnapshot(automaticView),
      exactPairDuplicateCallsPrevented: targeted.duplicateCallsPrevented,
    };
  } else {
    if (options.fixture.name === "cordless-vacuum") {
      options.armPostResponseEvidenceFailure(target.candidateTitle);
    }
    view = await researchLiveCandidate({
      dependencies: options.dependencies,
      input: {
        operation: "research_candidate",
        sessionId,
        candidateListingId: target.candidateListingId,
        criterionId: target.criterionId,
      },
    });
    targetedCalls = delta(options.counts, beforeTargetCounts);
    targetedPersistence = await scopedPersistence({
      db: options.dependencies.db,
      sessionId,
    });
    targeted = targetedPersistenceProof({
      before: firstPassPersistence,
      after: targetedPersistence,
      target,
      calls: targetedCalls,
      logicalRequests: 1,
      expectedDuplicateCallsPrevented: 0,
      requireGloballyCleanNonTargetState: true,
    });
    if (options.fixture.name === "cordless-vacuum") {
      assertProof(
        targeted.persistedExactPlan.status === "failed" &&
          targeted.persistedExactPlan.failureCode === "provider_failed" &&
          targeted.persistedExactPlan.runStatus === "partial",
        "vacuum controlled real-response failure did not persist as useful partial research",
      );
      controlledPartialEvidence = {
        kind: "post_real_provider_response_failure",
        candidateListingId: target.candidateListingId,
        criterionId: target.criterionId,
        organicAttemptId: targeted.persistedExactPlan.organicAttemptId,
        runStatus: targeted.persistedExactPlan.runStatus,
        modelAttemptsSucceeded: true,
      };
    } else {
      assertProof(
        targeted.persistedExactPlan.status === "succeeded",
        `${options.fixture.name} exact targeted evidence search did not succeed`,
      );
    }
    const beforeAutomaticCounts = { ...options.counts };
    const shouldDeepen =
      (view.decisionSupport?.decisionGaps.length ?? 0) > 0 &&
      view.decisionSupport?.deepResearchStatus !== "not_needed";
    if (shouldDeepen) {
      view = await deepenLiveShoppingResearch({
        dependencies: options.dependencies,
        input: { operation: "deepen_research", sessionId },
      });
    }
    automaticDeepening = {
      mode: "after_clean_exact_gap",
      attempted: shouldDeepen,
      calls: delta(options.counts, beforeAutomaticCounts),
      decision: decisionSnapshot(view),
    };
  }
  if (options.fixture.name === "ergonomic-mouse") {
    assertProof(
      targeted.persistedExactPlan.status === "succeeded",
      "mouse exact targeted evidence search did not succeed",
    );
  }
  const targetedUnderstandingTrace = exactFocusedCallTrace({
    traces: options.understandingCallTrace.slice(beforeTargetTraceIndex),
    target,
  });
  const afterDeep = decisionSnapshot(view);
  const deepCalls = delta(options.counts, beforeDeepStageCounts);
  const afterDeepPersistence = await scopedPersistence({
    db: options.dependencies.db,
    sessionId,
  });
  const targetStatusProof = statusProjectionProof({
    view,
    persistence: afterDeepPersistence,
  });
  if (options.fixture.name === "cordless-vacuum") {
    assertProof(
      targetStatusProof.projected.deepResearchStatus === "partial" &&
        controlledPartialEvidence !== null,
      "vacuum did not expose the controlled useful-partial research state",
    );
  }
  const afterDeepTitleTradeoffEvidence = directTitleTradeoffProof({
    caseName: options.fixture.name,
    view,
    persistence: afterDeepPersistence,
  });
  const targetedDecision = decisionSnapshot(view);

  const saveTargets = view.decisionSupport?.topOptions.slice(0, 2) ?? [];
  assertProof(
    saveTargets.length === 2,
    `${options.fixture.name} did not retain two exact listings for comparison`,
  );
  for (const option of saveTargets) {
    view = await setLiveListingSaved({
      dependencies: options.dependencies,
      input: {
        operation: "save_listing",
        sessionId,
        candidateListingId: option.listing.candidateListingId,
      },
    });
  }
  let rejection: Record<string, unknown> | null = null;
  const rejectTarget = saveTargets[1] ?? saveTargets[0];
  if (rejectTarget !== undefined) {
    const candidateListingId = rejectTarget.listing.candidateListingId;
    view = await setLiveListingRejected({
      dependencies: options.dependencies,
      input: { operation: "reject_listing", sessionId, candidateListingId },
    });
    const atomicallyUnsaved = !view.savedListings.some(
      (listing) => listing.candidateListingId === candidateListingId,
    );
    view = await setLiveListingRejected({
      dependencies: options.dependencies,
      input: {
        operation: "undo_reject_listing",
        sessionId,
        candidateListingId,
      },
    });
    const undoDidNotResave = !view.savedListings.some(
      (listing) => listing.candidateListingId === candidateListingId,
    );
    if (!atomicallyUnsaved || !undoDidNotResave) {
      throw new Error("Reject/save semantics did not match the V0-08 contract");
    }
    view = await setLiveListingSaved({
      dependencies: options.dependencies,
      input: { operation: "save_listing", sessionId, candidateListingId },
    });
    rejection = { candidateListingId, atomicallyUnsaved, undoDidNotResave };
  }
  const comparison = view.decisionSupport?.comparison ?? null;
  const comparisonPersistence = await scopedPersistence({
    db: options.dependencies.db,
    sessionId,
  });
  const comparisonEvidence = purchaseSummaryProof({
    caseName: options.fixture.name,
    view,
    persistence: comparisonPersistence,
  });
  const titleTradeoffEvidence = {
    firstPass: firstPassTitleTradeoffEvidence,
    afterDeep: afterDeepTitleTradeoffEvidence,
    liveMarketExercised:
      firstPassTitleTradeoffEvidence.liveMarketExercised ||
      afterDeepTitleTradeoffEvidence.liveMarketExercised,
  };

  let refinement: Record<string, unknown> | null = null;
  if (options.fixture.refinement !== null) {
    const refinementCounts = { ...options.counts };
    const beforeLabels =
      view.decisionSupport?.decisionGaps.map(({ label }) => label) ?? [];
    view = await refineLiveShopping({
      dependencies: options.dependencies,
      input: {
        operation: "refine",
        sessionId,
        turnId: randomUUID(),
        message: options.fixture.refinement,
      },
    });
    view = await resolveQuestions({
      dependencies: options.dependencies,
      caseName: options.fixture.name,
      view,
      questions,
    });
    if (view.action.kind !== "search") {
      throw new Error("Refinement did not return to search");
    }
    view = await researchLiveShopping({
      dependencies: options.dependencies,
      input: { operation: "research", sessionId },
    });
    view = await deepenLiveShoppingResearch({
      dependencies: options.dependencies,
      input: { operation: "deepen_research", sessionId },
    });
    refinement = {
      message: options.fixture.refinement,
      previousDecisionGapLabels: beforeLabels,
      currentDecisionGapLabels:
        view.decisionSupport?.decisionGaps.map(({ label }) => label) ?? [],
      brief: view.brief,
      calls: delta(options.counts, refinementCounts),
      decision: decisionSnapshot(view),
    };
  }

  const restored = await loadLiveShoppingSession({
    db: options.dependencies.db,
    sessionId,
  });
  const persistence = await scopedPersistence({
    db: options.dependencies.db,
    sessionId,
  });
  const initialPromisingCandidates = Math.max(
    0,
    ...firstPassPersistence.researchRuns
      .filter(({ phase }) => phase === "first_pass")
      .map(({ selectedCandidateCount }) => selectedCandidateCount),
  );
  const initialFirstPassPlannedSearches = firstPassPersistence.researchRuns
    .filter(({ phase }) => phase === "first_pass")
    .reduce((total, run) => total + run.plannedSearchCount, 0);
  const initialFirstPassCandidates = firstPassPersistence.researchRuns
    .filter(({ phase }) => phase === "first_pass")
    .reduce((total, run) => total + run.selectedCandidateCount, 0);
  assertProof(
    firstPassCalls.evidenceSearchCalls === initialFirstPassPlannedSearches &&
      firstPassCalls.understandingCalls === initialFirstPassCandidates,
    `${options.fixture.name} initial first-pass logical call accounting disagrees with persisted attempts`,
  );
  const firstPassResearchRunIds = new Set(
    firstPassPersistence.researchRuns.map(({ id }) => id),
  );
  const initialDeepRuns = afterDeepPersistence.researchRuns.filter(
    ({ id }) => !firstPassResearchRunIds.has(id),
  );
  assertProof(
    deepCalls.evidenceSearchCalls ===
      initialDeepRuns.reduce(
        (total, run) => total + run.plannedSearchCount,
        0,
      ) &&
      deepCalls.understandingCalls ===
        initialDeepRuns.reduce(
          (total, run) => total + run.selectedCandidateCount,
          0,
        ),
    `${options.fixture.name} deep logical call accounting disagrees with persisted attempts`,
  );
  const actualProviderRequests = delta(options.counts, startCounts);
  const costBoundary = boundedCostProof(persistence);
  const categoryHonesty = categoryHonestyProof({
    caseName: options.fixture.name,
    view: restored,
    persistence,
  });
  return {
    proofedAt: new Date().toISOString(),
    name: options.fixture.name,
    request: options.fixture.request,
    sessionId,
    questions,
    retrieval,
    evidenceEfficiency: {
      retrievalQueries: persistence.retrievalQueries.length,
      candidatesBeforeTriage: persistence.rawCandidateListings,
      initialPromisingCandidates,
      initialFirstPassEvidenceCalls: firstPassCalls.evidenceSearchCalls,
      initialDeepeningEvidenceCalls: deepCalls.evidenceSearchCalls,
      initialProductUnderstandingCalls:
        firstPassCalls.understandingCalls + deepCalls.understandingCalls,
      totalEvidenceSearchPortInvocations:
        actualProviderRequests.evidenceSearchCalls,
      totalProductUnderstandingPortInvocations:
        actualProviderRequests.understandingCalls,
      callCountSemantics:
        "Logical application/provider-port invocations; underlying SDK transport retries are not separately instrumented.",
      hardUnknownsBeforeResearch:
        hardCriterionCount * initialPromisingCandidates,
      hardUnknownsAfterFirstPass: firstPass.hardUnknowns,
      hardUnknownsAfterDeepening: targetedDecision.hardUnknowns,
      duplicateCallsPrevented: targeted.duplicateCallsPrevented,
      targetedAssessmentIdentityChanges:
        targeted.assessmentIdentityChanges.length,
      savedCandidates: restored.savedListings.length,
      rejectedCandidates: restored.rejectedListings.length,
      directRetailerCoverage: {
        top: `${restored.decisionSupport?.topOptions.filter(({ listing }) => isDirectRetailer(listing)).length ?? 0}/${restored.decisionSupport?.topOptions.length ?? 0}`,
        saved: `${restored.savedListings.filter(isDirectRetailer).length}/${restored.savedListings.length}`,
      },
      timeToInitialListingsMs: firstListingsMs,
      timeToFirstDecisionSupportMs: firstDecisionMs,
      firstPassDurationMs: Math.round(
        firstDecisionMs - (firstPassStartedAt - startedAt),
      ),
      logicalPortInvocations: actualProviderRequests,
      refinementLogicalPortInvocations:
        refinement === null ? null : refinement.calls,
      costBoundary,
    },
    firstPass,
    afterDeep,
    targeted: {
      ...targeted,
      modelContract: targetedUnderstandingTrace,
      decision: targetedDecision,
      statusProjection: targetStatusProof,
    },
    automaticDeepening,
    controlledPartialEvidence,
    rejection,
    comparison,
    comparisonEvidence,
    titleTradeoffEvidence,
    categoryHonesty,
    productUnderstandingCallTrace: options.understandingCallTrace.slice(
      startUnderstandingTraceIndex,
    ),
    refinement,
    restored: decisionSnapshot(restored),
    persistence,
    leaveTheApp: leaveAppObservation({
      caseName: options.fixture.name,
      view: restored,
    }),
  };
}

function json(value: unknown) {
  return JSON.stringify(
    value,
    (_key, entry) => (typeof entry === "bigint" ? entry.toString() : entry),
    2,
  );
}

function markdown(report: {
  generatedAt: string;
  flows: readonly Awaited<ReturnType<typeof runCase>>[];
}) {
  const journeys = report.flows
    .map((flow) => {
      const options = flow.restored.topOptions
        .slice(0, 3)
        .map(
          (option, index) =>
            `${index + 1}. **${option.title}** — ${option.price ?? "price unknown"}; ${option.readiness}; must-haves ${option.mustHaves}`,
        )
        .join("\n");
      return `## ${flow.name}\n\n- Retrieval: ${JSON.stringify(flow.retrieval)}\n- Efficiency: ${JSON.stringify(flow.evidenceEfficiency)}\n- Exact gap target: ${flow.targeted.requestedTarget.criterionLabel} (${flow.targeted.requestedTarget.criterionId}) for ${flow.targeted.requestedTarget.candidateTitle}\n- Persisted target query: ${flow.targeted.persistedExactPlan.query ?? "no query"}\n- Target call delta: ${JSON.stringify(flow.targeted.calls)}\n- Duplicate candidate + criterion calls prevented: ${flow.targeted.duplicateCallsPrevented}\n- Assessment identities changed: ${JSON.stringify(flow.targeted.assessmentIdentityChanges)}\n- Untargeted identities changed: ${flow.targeted.untargetedCurrentIdentityChanges.length}\n- Status projection: ${JSON.stringify(flow.targeted.statusProjection.projected)}\n- Purchase summary authority: ${JSON.stringify(flow.comparisonEvidence)}\n- Direct-title trade-off: ${JSON.stringify(flow.titleTradeoffEvidence)}\n- Reject / undo: ${JSON.stringify(flow.rejection)}\n- Comparison: ${flow.comparison?.judgement ?? "not available"}\n- Leave-the-app test: ${flow.leaveTheApp}\n\n### Current options\n\n${options || "No decision option survived."}\n`;
    })
    .join("\n");
  return `# V0-08 founder decision-loop proof\n\nGenerated: ${report.generatedAt}\n\nThis is one fresh, non-aggregated, sanitized real OpenAI + Serper run across all three categories against a guarded disposable PostgreSQL database. Unknowns and provider failures are preserved rather than converted into fit claims.\n\n${journeys}\n## Honest boundary\n\n- Search snippets remain attributable assertions, not crawled product-page truth.\n- Personal fit, long-session comfort, real-world noise and durability can remain unknown after bounded research.\n- A direct-title trade-off is required only when an applicable self-described listing is actually returned; zero live-market examples are recorded honestly rather than manufactured.\n- Direct retailer destinations appear only when supplied or conservatively verified; Google Shopping remains the fallback.\n- Exact listing rejection is task-local and is not preference learning.\n- No ProductIdentity, crawler, affiliate ranking or hidden score was introduced.\n`;
}

const { TEST_DATABASE_URL } = requireTestDatabaseEnvironment(process.env);
const baseUrl = new URL(TEST_DATABASE_URL);
const baseDatabaseName = baseUrl.pathname.slice(1);
const databaseName = `ai_shopping_test_v008_${randomUUID().replaceAll("-", "")}`;
if (
  !/(?:^|[_-])test(?:[_-]|$)/.test(baseDatabaseName) ||
  !disposableDatabasePattern.test(databaseName)
) {
  throw new Error("Refusing to create an unguarded V0-08 proof database");
}
const disposableUrl = new URL(TEST_DATABASE_URL);
disposableUrl.pathname = `/${databaseName}`;
const [openAIKey, serperKey] = await Promise.all([
  readSecret("OPENAI_API_KEY", "ai-shopping-openai"),
  readSecret("SERPER_API_KEY", "ai-shopping-serper"),
]);
const admin = postgres(TEST_DATABASE_URL, { max: 1, prepare: false });
let connection: ReturnType<typeof createDatabaseConnection> | null = null;

if (process.env.V0_08_CASE?.trim()) {
  throw new Error(
    "V0_08_CASE partial/aggregate runs are disabled for the fresh release proof",
  );
}

type FounderFlow = Awaited<ReturnType<typeof runCase>>;

function addCounts(left: Counts, right: Counts): Counts {
  return {
    interpretationCalls: left.interpretationCalls + right.interpretationCalls,
    actionCalls: left.actionCalls + right.actionCalls,
    shoppingRequests: left.shoppingRequests + right.shoppingRequests,
    merchantResolutionRequests:
      left.merchantResolutionRequests + right.merchantResolutionRequests,
    evidenceSearchCalls: left.evidenceSearchCalls + right.evidenceSearchCalls,
    understandingCalls: left.understandingCalls + right.understandingCalls,
  };
}

const completedFlows: FounderFlow[] = [];
let activeCaseName: CaseName | null = null;
let activeSessionId: string | null = null;
let runtimeCounts: Counts | null = null;
let runtimeUnderstandingCallTrace: UnderstandingCallTrace[] | null = null;

try {
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    rm(new URL("v0-08-live-founder-proof.json", outputDirectory), {
      force: true,
    }),
    rm(new URL("v0-08-live-founder-proof.md", outputDirectory), {
      force: true,
    }),
    rm(new URL("v0-08-live-founder-proof-failure.json", outputDirectory), {
      force: true,
    }),
    rm(new URL("v0-08-live-founder-proof-failure.md", outputDirectory), {
      force: true,
    }),
  ]);
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  await migrateDatabase({ url: disposableUrl.toString() });
  connection = createDatabaseConnection({
    url: disposableUrl.toString(),
    prepare: false,
  });
  const runtime = createCountedDependencies({
    db: connection.db,
    openAIKey,
    serperKey,
  });
  runtimeCounts = runtime.counts;
  runtimeUnderstandingCallTrace = runtime.understandingCallTrace;
  for (const fixture of cases) {
    activeCaseName = fixture.name;
    completedFlows.push(
      await runCase({
        fixture,
        dependencies: runtime.dependencies,
        counts: runtime.counts,
        understandingCallTrace: runtime.understandingCallTrace,
        armEvidenceGate: runtime.armEvidenceGate,
        armPostResponseEvidenceFailure: runtime.armPostResponseEvidenceFailure,
        onSessionCreated: (sessionId) => {
          activeSessionId = sessionId;
        },
      }),
    );
  }
  activeCaseName = null;
  activeSessionId = null;
  const flows = completedFlows;
  assertProof(
    flows.length === cases.length &&
      cases.every(({ name }) => flows.some((flow) => flow.name === name)),
    "fresh release proof did not complete all three categories in one run",
  );
  const totalLogicalPortInvocations = flows.reduce(
    (total, flow) =>
      addCounts(total, flow.evidenceEfficiency.logicalPortInvocations),
    {
      interpretationCalls: 0,
      actionCalls: 0,
      shoppingRequests: 0,
      merchantResolutionRequests: 0,
      evidenceSearchCalls: 0,
      understandingCalls: 0,
    },
  );
  const report = {
    schemaVersion: 2,
    proofMode: "fresh_three_category_release" as const,
    generatedAt: new Date().toISOString(),
    model: V0_07_OPENAI_DEFAULT_CONFIG.model,
    market: { country: "GB", language: "en-GB", currency: "GBP" },
    flows,
    totalLogicalPortInvocations,
    v007Reference: {
      evidenceSearches: 40,
      productUnderstandingCalls: 20,
      journeys: 2,
    },
  };
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      new URL("v0-08-live-founder-proof.json", outputDirectory),
      `${json(report)}\n`,
      "utf8",
    ),
    writeFile(
      new URL("v0-08-live-founder-proof.md", outputDirectory),
      markdown(report),
      "utf8",
    ),
    rm(new URL("v0-08-live-founder-proof-failure.json", outputDirectory), {
      force: true,
    }),
    rm(new URL("v0-08-live-founder-proof-failure.md", outputDirectory), {
      force: true,
    }),
  ]);
  process.stdout.write(
    `${json({
      generatedAt: report.generatedAt,
      proofMode: report.proofMode,
      totalLogicalPortInvocations: report.totalLogicalPortInvocations,
      journeys: flows.map(
        ({ name, evidenceEfficiency, targeted, leaveTheApp }) => ({
          name,
          evidenceEfficiency,
          exactTarget: targeted.requestedTarget,
          duplicateCallsPrevented: targeted.duplicateCallsPrevented,
          assessmentIdentityChanges: targeted.assessmentIdentityChanges,
          leaveTheApp,
        }),
      ),
    })}\n`,
  );
} catch (error) {
  let activeCaseSnapshot: null | {
    persistence: Awaited<ReturnType<typeof scopedPersistence>>;
    decision: ReturnType<typeof decisionSnapshot>;
  } = null;
  if (connection !== null && activeSessionId !== null) {
    try {
      const [persistence, view] = await Promise.all([
        scopedPersistence({ db: connection.db, sessionId: activeSessionId }),
        loadLiveShoppingSession({
          db: connection.db,
          sessionId: activeSessionId,
        }),
      ]);
      activeCaseSnapshot = { persistence, decision: decisionSnapshot(view) };
    } catch {
      activeCaseSnapshot = null;
    }
  }
  const rawMessage =
    error instanceof Error ? error.message : "Unknown V0-08 proof failure";
  const sanitizedMessage = rawMessage
    .replaceAll(openAIKey, "[redacted-openai-key]")
    .replaceAll(serperKey, "[redacted-serper-key]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted-api-key]")
    .slice(0, 1_000);
  const failureReport = {
    schemaVersion: 1,
    proofMode: "fresh_three_category_release_failed" as const,
    generatedAt: new Date().toISOString(),
    failedCase: activeCaseName,
    failedSessionId: activeSessionId,
    completedFlows,
    activeCaseSnapshot,
    logicalPortInvocationsAtFailure: runtimeCounts,
    productUnderstandingCallTraceAtFailure: runtimeUnderstandingCallTrace,
    failure: {
      name: error instanceof Error ? error.name : "UnknownError",
      message: sanitizedMessage,
    },
    releaseAccepted: false,
  };
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      new URL("v0-08-live-founder-proof-failure.json", outputDirectory),
      `${json(failureReport)}\n`,
      "utf8",
    ),
    writeFile(
      new URL("v0-08-live-founder-proof-failure.md", outputDirectory),
      `# V0-08 founder decision-loop proof — failed\n\nGenerated: ${failureReport.generatedAt}\n\n- Failed case: ${failureReport.failedCase ?? "before a category started"}\n- Completed categories: ${failureReport.completedFlows.map(({ name }) => name).join(", ") || "none"}\n- Active-case state captured: ${failureReport.activeCaseSnapshot === null ? "no" : "yes"}\n- Sanitized failure: ${failureReport.failure.name}: ${failureReport.failure.message}\n- Release accepted: no\n\nThe stale success artifact was removed before this attempt, and the disposable database was destroyed after the active case snapshot was sanitized. This artifact preserves the one-shot failure honestly and is not release evidence.\n`,
      "utf8",
    ),
  ]);
  throw error;
} finally {
  if (connection !== null) await connection.close();
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  await admin.end();
}
