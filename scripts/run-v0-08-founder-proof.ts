import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import postgres from "postgres";
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
  createOpenAIProductUnderstandingModel,
  V0_07_OPENAI_DEFAULT_CONFIG,
} from "../src/features/product-understanding/openai-adapter";
import { PRODUCT_UNDERSTANDING_PROMPT_VERSION } from "../src/features/product-understanding/prompts";
import { SerperEvidenceSearchAdapter } from "../src/features/product-understanding/serper-evidence-adapter";
import type { ShoppingSearchProvider } from "../src/features/retrieval-spike/contracts";
import { SerperShoppingAdapter } from "../src/features/retrieval-spike/serper-shopping-adapter";
import { requireTestDatabaseEnvironment } from "../src/infrastructure/config/environment";
import { createDatabaseConnection } from "../src/infrastructure/database/clients";
import { migrateDatabase } from "../src/infrastructure/database/migrate";
import {
  candidateListings,
  criterionAssessments,
  evidenceAcquisitionAttempts,
  evidenceAttemptTargetCriteria,
  evidenceResearchRuns,
  evidenceSources,
  founderLiveSessions,
  rejectedCandidateListings,
  savedCandidateListings,
  searchQueries,
  searchRuns,
} from "../src/infrastructure/database/schema";

const executeFile = promisify(execFile);
const disposableDatabasePattern = /^ai_shopping_test_v008_[a-f0-9]{32}$/;
const outputDirectory = new URL("../docs/evals/", import.meta.url);

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
  const evidenceProvider: EvidenceSearchProvider = {
    provider: evidence.provider,
    search: (input) => {
      counts.evidenceSearchCalls += 1;
      return evidence.search(input);
    },
  };
  const productUnderstanding = createOpenAIProductUnderstandingModel({
    apiKey: options.openAIKey,
  });
  const understanding: ProductUnderstandingModel = {
    understand: (input) => {
      counts.understandingCalls += 1;
      return productUnderstanding.understand(input);
    },
  };
  return {
    counts,
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
    options.db.select().from(savedCandidateListings),
    options.db.select().from(rejectedCandidateListings),
  ]);
  const taskResearch = research.filter((row) => row.taskId === taskId);
  const researchIds = new Set(taskResearch.map(({ id }) => id));
  const taskAttempts = attempts.filter(({ researchRunId }) =>
    researchIds.has(researchRunId),
  );
  const taskTargets = targets.filter(({ researchRunId }) =>
    researchIds.has(researchRunId),
  );
  const taskSources = sources.filter(
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
    retrievalRuns: runs.filter(({ taskId: rowTaskId }) => rowTaskId === taskId)
      .length,
    retrievalQueries: queries
      .filter(({ taskId: rowTaskId }) => rowTaskId === taskId)
      .map(({ queryText }) => queryText),
    rawCandidateListings: listings.filter(
      ({ taskId: rowTaskId }) => rowTaskId === taskId,
    ).length,
    researchRuns: taskResearch.map((run) => ({
      phase: run.phase,
      status: run.status,
      selectedCandidateCount: run.selectedCandidateCount,
      plannedSearchCount: run.plannedSearchCount,
    })),
    evidenceSearches: taskAttempts
      .filter(({ stage }) => stage === "organic_search")
      .map(({ purpose, query, status }) => ({ purpose, query, status })),
    candidateCoverage: [...candidateCoverage].map(
      ([candidateListingId, coverage]) => ({
        candidateListingId,
        searches: coverage.searches,
        criterionCount: coverage.criteria.size,
        sourceCount: coverage.sources,
      }),
    ),
    assessmentCount: assessments.filter(
      ({ taskId: rowTaskId }) => rowTaskId === taskId,
    ).length,
    currentAssessmentCount: assessments.filter(
      ({ taskId: rowTaskId, supersededAt }) =>
        rowTaskId === taskId && supersededAt === null,
    ).length,
    savedCount: saved.filter(({ taskId: rowTaskId }) => rowTaskId === taskId)
      .length,
    rejectedCount: rejected.filter(
      ({ taskId: rowTaskId }) => rowTaskId === taskId,
    ).length,
  };
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
}) {
  const sessionId = randomUUID();
  const questions: Array<Record<string, unknown>> = [];
  const startCounts = { ...options.counts };
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

  const beforeDeepCounts = { ...options.counts };
  view = await deepenLiveShoppingResearch({
    dependencies: options.dependencies,
    input: { operation: "deepen_research", sessionId },
  });
  const afterDeep = decisionSnapshot(view);
  const deepCalls = delta(options.counts, beforeDeepCounts);

  const target = view.decisionSupport?.topOptions.find(
    ({ researchState }) => researchState === "available",
  );
  const beforeTargetCounts = { ...options.counts };
  if (target !== undefined) {
    view = await researchLiveCandidate({
      dependencies: options.dependencies,
      input: {
        operation: "research_candidate",
        sessionId,
        candidateListingId: target.listing.candidateListingId,
      },
    });
  }
  const targeted = {
    candidateListingId: target?.listing.candidateListingId ?? null,
    calls: delta(options.counts, beforeTargetCounts),
    decision: decisionSnapshot(view),
  };

  const saveTargets = view.decisionSupport?.topOptions.slice(0, 2) ?? [];
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
  const promisingCandidates = Math.max(
    0,
    ...persistence.researchRuns
      .filter(({ phase }) => phase === "first_pass")
      .map(({ selectedCandidateCount }) => selectedCandidateCount),
  );
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
      promisingCandidates,
      firstPassEvidenceCalls: firstPassCalls.evidenceSearchCalls,
      deepeningEvidenceCalls:
        deepCalls.evidenceSearchCalls + targeted.calls.evidenceSearchCalls,
      productUnderstandingCalls:
        firstPassCalls.understandingCalls +
        deepCalls.understandingCalls +
        targeted.calls.understandingCalls,
      hardUnknownsBeforeResearch: hardCriterionCount * promisingCandidates,
      hardUnknownsAfterFirstPass: firstPass.hardUnknowns,
      hardUnknownsAfterDeepening: targeted.decision.hardUnknowns,
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
      actualProviderRequests: delta(options.counts, startCounts),
    },
    firstPass,
    afterDeep,
    targeted,
    rejection,
    comparison,
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
      return `## ${flow.name}\n\n- Retrieval: ${JSON.stringify(flow.retrieval)}\n- Efficiency: ${JSON.stringify(flow.evidenceEfficiency)}\n- Reject / undo: ${JSON.stringify(flow.rejection)}\n- Comparison: ${flow.comparison?.judgement ?? "not available"}\n- Leave-the-app test: ${flow.leaveTheApp}\n\n### Current options\n\n${options || "No decision option survived."}\n`;
    })
    .join("\n");
  return `# V0-08 founder decision-loop proof\n\nGenerated: ${report.generatedAt}\n\nThis is a sanitized real OpenAI + Serper run against a guarded disposable PostgreSQL database. Unknowns and provider failures are preserved rather than converted into fit claims.\n\n${journeys}\n## Honest boundary\n\n- Search snippets remain attributable assertions, not crawled product-page truth.\n- Personal fit, long-session comfort, real-world noise and durability can remain unknown after bounded research.\n- Direct retailer destinations appear only when supplied or conservatively verified; Google Shopping remains the fallback.\n- Exact listing rejection is task-local and is not preference learning.\n- No ProductIdentity, crawler, affiliate ranking or hidden score was introduced.\n`;
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

const selectedCaseName = process.env.V0_08_CASE?.trim() || null;
const selectedCases =
  selectedCaseName === null
    ? cases
    : cases.filter(({ name }) => name === selectedCaseName);
if (selectedCases.length === 0) {
  throw new Error(`Unknown V0_08_CASE: ${selectedCaseName}`);
}

type FounderFlow = Awaited<ReturnType<typeof runCase>>;

async function existingFlows() {
  if (selectedCaseName === null) return [] as FounderFlow[];
  try {
    const parsed: unknown = JSON.parse(
      await readFile(
        new URL("v0-08-live-founder-proof.json", outputDirectory),
        "utf8",
      ),
    );
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("flows" in parsed) ||
      !Array.isArray(parsed.flows)
    ) {
      return [];
    }
    return parsed.flows.filter(
      (flow): flow is FounderFlow =>
        typeof flow === "object" &&
        flow !== null &&
        "name" in flow &&
        cases.some(({ name }) => name === flow.name),
    );
  } catch {
    return [];
  }
}

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

try {
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
  const newFlows: FounderFlow[] = [];
  for (const fixture of selectedCases) {
    newFlows.push(
      await runCase({
        fixture,
        dependencies: runtime.dependencies,
        counts: runtime.counts,
      }),
    );
  }
  const priorFlows = await existingFlows();
  const flowByName = new Map(
    [...priorFlows, ...newFlows].map((flow) => [flow.name, flow]),
  );
  const flows = cases.flatMap(({ name }) => {
    const flow = flowByName.get(name);
    return flow === undefined ? [] : [flow];
  });
  const totalProviderRequests = flows.reduce(
    (total, flow) =>
      addCounts(total, flow.evidenceEfficiency.actualProviderRequests),
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
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    model: V0_07_OPENAI_DEFAULT_CONFIG.model,
    market: { country: "GB", language: "en-GB", currency: "GBP" },
    flows,
    totalProviderRequests,
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
  ]);
  process.stdout.write(
    `${json({
      generatedAt: report.generatedAt,
      totalProviderRequests: report.totalProviderRequests,
      journeys: flows.map(({ name, evidenceEfficiency, leaveTheApp }) => ({
        name,
        evidenceEfficiency,
        leaveTheApp,
      })),
    })}\n`,
  );
} finally {
  if (connection !== null) await connection.close();
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  await admin.end();
}
