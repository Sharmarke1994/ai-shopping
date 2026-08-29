import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import postgres from "postgres";
import {
  answerLiveShoppingQuestion,
  loadLiveShoppingSession,
  refineLiveShopping,
  researchLiveShopping,
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
  criterionAssessmentObservations,
  criterionAssessments,
  evidenceAcquisitionAttempts,
  evidenceResearchRuns,
  evidenceSources,
  productObservations,
  searchQueries,
  searchRuns,
  shoppingTasks,
} from "../src/infrastructure/database/schema";

const executeFile = promisify(execFile);
const disposableDatabasePattern = /^ai_shopping_test_v007_[a-f0-9]{32}$/;
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
] as const;

async function readSecret(environmentName: string, service: string) {
  const environmentValue = process.env[environmentName]?.trim();
  if (environmentValue) return environmentValue;
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
  if (value.length === 0) throw new Error(`${environmentName} is empty`);
  return value;
}

function countingDependencies(options: {
  db: LiveShoppingDependencies["db"];
  openAIKey: string;
  serperKey: string;
}) {
  const counts = {
    interpretationCalls: 0,
    actionCalls: 0,
    shoppingCalls: 0,
    evidenceSearchCalls: 0,
    understandingCalls: 0,
  };
  const contextBase = createOpenAIContextAcquisitionModel({
    environment: { ...process.env, OPENAI_API_KEY: options.openAIKey },
  });
  const model: ContextAcquisitionModel = {
    interpret: (input) => {
      counts.interpretationCalls += 1;
      return contextBase.interpret(input);
    },
    selectAction: (input) => {
      counts.actionCalls += 1;
      return contextBase.selectAction(input);
    },
  };
  const shoppingBase = new SerperShoppingAdapter({ apiKey: options.serperKey });
  const provider: ShoppingSearchProvider = {
    provider: shoppingBase.provider,
    maxRequestDurationMs: shoppingBase.maxRequestDurationMs,
    search: (query) => {
      counts.shoppingCalls += 1;
      return shoppingBase.search(query);
    },
  };
  const evidenceBase = new SerperEvidenceSearchAdapter({
    apiKey: options.serperKey,
  });
  const evidenceProvider: EvidenceSearchProvider = {
    provider: evidenceBase.provider,
    search: (input) => {
      counts.evidenceSearchCalls += 1;
      return evidenceBase.search(input);
    },
  };
  const understandingBase = createOpenAIProductUnderstandingModel({
    apiKey: options.openAIKey,
  });
  const understanding: ProductUnderstandingModel = {
    understand: (input, policy) => {
      counts.understandingCalls += 1;
      return understandingBase.understand(input, policy);
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

function countDelta(
  after: Record<string, number>,
  before: Record<string, number>,
) {
  return Object.fromEntries(
    Object.entries(after).map(([key, value]) => [key, value - before[key]!]),
  );
}

function preferredOption(caseName: string, prompt: string, labels: string[]) {
  const haystack = prompt.toLocaleLowerCase("en-GB");
  const preferences =
    caseName === "ergonomic-mouse"
      ? haystack.includes("shape") || haystack.includes("vertical")
        ? ["sculpted", "normal", "not vertical"]
        : haystack.includes("hand")
          ? ["right"]
          : ["wireless", "chunk", "flexible", "not sure", "no preference"]
      : haystack.includes("material")
        ? ["mesh", "fabric"]
        : haystack.includes("budget") || haystack.includes("price")
          ? ["350", "stretch"]
          : ["medium", "flexible", "no preference", "not sure"];
  for (const preference of preferences) {
    const match = labels.findIndex((label) =>
      label.toLocaleLowerCase("en-GB").includes(preference),
    );
    if (match >= 0) return match;
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
  let view = options.view;
  for (let questionNumber = 0; questionNumber < 4; questionNumber += 1) {
    if (view.action.kind !== "ask") return view;
    const action = view.action;
    if (action.responseMode === "open_text") {
      const text =
        options.caseName === "ergonomic-mouse"
          ? /hand/i.test(action.prompt)
            ? "Right-handed, with an average-sized hand."
            : "I don’t know; keep that flexible and do not add a requirement."
          : /size|dimension|space/i.test(action.prompt)
            ? "No exact maximum; just avoid an unusually huge chair."
            : "I don’t have another requirement; keep that flexible.";
      options.questions.push({
        prompt: action.prompt,
        responseMode: action.responseMode,
        answer: text,
      });
      view = await answerLiveShoppingQuestion({
        dependencies: options.dependencies,
        input: {
          operation: "answer",
          sessionId: view.sessionId,
          turnId: randomUUID(),
          answer: { mode: "open_text", text },
        },
      });
      continue;
    }
    const optionIndex = preferredOption(
      options.caseName,
      action.prompt,
      action.options.map(({ label }) => label),
    );
    const chosen = action.options[optionIndex]!;
    options.questions.push({
      prompt: action.prompt,
      responseMode: action.responseMode,
      options: action.options.map(({ label }) => label),
      answer: chosen.label,
    });
    view = await answerLiveShoppingQuestion({
      dependencies: options.dependencies,
      input: {
        operation: "answer",
        sessionId: view.sessionId,
        turnId: randomUUID(),
        answer: { mode: "single_select", optionOrdinal: chosen.ordinal },
      },
    });
  }
  if (view.action.kind === "ask") {
    throw new Error("Clarification did not converge within four bounded turns");
  }
  return view;
}

function assessmentSummary(view: LiveShoppingView) {
  return {
    researchStatus: view.decisionSupport?.researchStatus ?? null,
    researchedCandidateCount:
      view.decisionSupport?.researchedCandidateCount ?? 0,
    topOptions:
      view.decisionSupport?.topOptions.map((option) => ({
        candidateListingId: option.listing.candidateListingId,
        title: option.listing.title,
        merchant: option.listing.merchant,
        price: option.listing.priceText,
        destinationUrl: option.listing.destinationUrl,
        directRetailer:
          option.listing.sourceUrl !== null ||
          !option.listing.destinationLabel.includes("Google Shopping"),
        strongestSupported: option.strongestSupported,
        whyItFits: option.whyItFits,
        watchouts: option.watchouts,
        unknowns: option.unknowns,
        evidenceSources: option.evidenceSources,
      })) ?? [],
    comparison: view.decisionSupport?.comparison ?? null,
  };
}

async function runCase(options: {
  fixture: (typeof cases)[number];
  dependencies: LiveShoppingDependencies;
  counts: Record<string, number>;
}) {
  const beforeCounts = { ...options.counts };
  const questions: Array<Record<string, unknown>> = [];
  const sessionId = randomUUID();
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
    throw new Error(`${options.fixture.name} did not reach product search`);
  }
  const retrieved = {
    status: view.action.search.status,
    queryCount: view.action.search.queryCount,
    completedQueryCount: view.action.search.completedQueryCount,
    displayedListingCount: view.action.search.listings.length,
    directRetailerCount: view.action.search.listings.filter(
      ({ sourceUrl }) => sourceUrl !== null,
    ).length,
  };
  view = await researchLiveShopping({
    dependencies: options.dependencies,
    input: { operation: "research", sessionId },
  });
  const initialBrief = view.brief;
  const initialDecision = assessmentSummary(view);
  const optionsToSave = initialDecision.topOptions.slice(0, 2);
  for (const option of optionsToSave) {
    view = await setLiveListingSaved({
      dependencies: options.dependencies,
      input: {
        operation: "save_listing",
        sessionId,
        candidateListingId: option.candidateListingId,
      },
    });
  }
  const initialComparison = assessmentSummary(view).comparison;
  let refinement: Record<string, unknown> | null = null;
  if (options.fixture.refinement !== null) {
    const beforeRefinementCounts = { ...options.counts };
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
      throw new Error(
        `${options.fixture.name} refinement did not reach search`,
      );
    }
    view = await researchLiveShopping({
      dependencies: options.dependencies,
      input: { operation: "research", sessionId },
    });
    refinement = {
      message: options.fixture.refinement,
      brief: view.brief,
      decision: assessmentSummary(view),
      calls: countDelta(options.counts, beforeRefinementCounts),
    };
  }
  const restored = await loadLiveShoppingSession({
    db: options.dependencies.db,
    sessionId,
  });
  return {
    name: options.fixture.name,
    request: options.fixture.request,
    sessionId,
    questions,
    retrieved,
    initialBrief,
    initialDecision,
    initialComparison,
    refinement,
    restoredDecision: assessmentSummary(restored),
    calls: countDelta(options.counts, beforeCounts),
  };
}

function jsonValue(value: unknown) {
  return JSON.stringify(
    value,
    (_key, entry) => (typeof entry === "bigint" ? entry.toString() : entry),
    2,
  );
}

function persistenceSummary(value: Record<string, unknown>) {
  const attempts = value.evidenceQueries as Array<{
    status: "succeeded" | "failed";
  }>;
  const sources = value.evidenceSources as Array<{ role: string }>;
  const sourceRoles = Object.fromEntries(
    [...new Set(sources.map(({ role }) => role))]
      .sort()
      .map((role) => [
        role,
        sources.filter((source) => source.role === role).length,
      ]),
  );
  return {
    tasks: value.tasks,
    searchRuns: value.searchRuns,
    searchQueryCount: (value.searchQueries as unknown[]).length,
    rawCandidateListings: value.rawCandidateListings,
    directMerchantDestinations: value.directMerchantDestinations,
    researchRuns: value.researchRuns,
    evidenceSearches: {
      total: attempts.length,
      succeeded: attempts.filter(({ status }) => status === "succeeded").length,
      failed: attempts.filter(({ status }) => status === "failed").length,
    },
    evidenceSources: { total: sources.length, byRole: sourceRoles },
    observations: (value.observations as unknown[]).length,
    assessments: (value.assessments as unknown[]).length,
    unknownAssessmentCount: value.unknownAssessmentCount,
    observationsReusedAcrossRevisions: value.observationsReusedAcrossRevisions,
    totalCalls: value.totalCalls,
  };
}

function markdown(report: Record<string, unknown>) {
  const flows = report.flows as Array<Record<string, unknown>>;
  const sections = flows.map((flow) => {
    const initial = flow.initialDecision as ReturnType<
      typeof assessmentSummary
    >;
    const top = initial.topOptions
      .map(
        (option, index) =>
          `${index + 1}. **${option.title}** — ${option.price ?? "price unknown"}; ${option.whyItFits.join(" ") || "no supported fit yet"}`,
      )
      .join("\n");
    const refinement = flow.refinement as {
      message: string;
      brief: Array<{ label: string; value: string }>;
      decision: ReturnType<typeof assessmentSummary>;
      calls: Record<string, number>;
    } | null;
    const refinementSummary =
      refinement === null
        ? "No refinement was required for this proof."
        : [
            `Shopper turn: “${refinement.message}”`,
            `Current brief: ${refinement.brief.map(({ label, value }) => `${label} — ${value}`).join("; ")}`,
            `New top options: ${refinement.decision.topOptions
              .map(
                ({ title, price }) => `${title} (${price ?? "price unknown"})`,
              )
              .join("; ")}`,
            `Comparison: ${refinement.decision.comparison?.judgement ?? "not available"}`,
            `Calls: ${JSON.stringify(refinement.calls)}`,
          ].join("\n\n");
    return `## ${flow.name}\n\n- Clarification turns: ${(flow.questions as unknown[]).length}\n- Retrieval: ${JSON.stringify(flow.retrieved)}\n- Research: ${initial.researchStatus}; ${initial.researchedCandidateCount} candidates assessed\n- Provider/model calls: ${JSON.stringify(flow.calls)}\n\n### Best-supported options\n\n${top || "No supported option surfaced."}\n\n### Comparison\n\n${flow.initialComparison === null ? "A two-product comparison was not available." : (flow.initialComparison as { judgement: string }).judgement}\n\n### Refinement\n\n${refinementSummary}\n`;
  });
  return `# V0-07 live founder proof\n\nGenerated: ${report.generatedAt}\n\nThis is a sanitized real OpenAI + Serper run against a guarded disposable PostgreSQL database. It is evidence, not a permanent benchmark.\n\n${sections.join("\n")}\n## Persisted evidence totals\n\n${jsonValue(persistenceSummary(report.persistence as Record<string, unknown>))}\n\n## Known limitations\n\n- Search snippets remain attributable assertions, not crawled page truth.\n- Personal comfort remains uncertain even when independent sources report support features.\n- Google Shopping intermediary links remain when a direct merchant destination is unavailable.\n- The proof does not create ProductIdentity or fuzzy cross-offer identity.\n`;
}

const { TEST_DATABASE_URL } = requireTestDatabaseEnvironment(process.env);
const baseUrl = new URL(TEST_DATABASE_URL);
const baseDatabaseName = baseUrl.pathname.slice(1);
const databaseName = `ai_shopping_test_v007_${randomUUID().replaceAll("-", "")}`;
if (
  !/(?:^|[_-])test(?:[_-]|$)/.test(baseDatabaseName) ||
  !disposableDatabasePattern.test(databaseName)
) {
  throw new Error("Refusing to create an unguarded V0-07 proof database");
}
const disposableUrl = new URL(TEST_DATABASE_URL);
disposableUrl.pathname = `/${databaseName}`;
const [openAIKey, serperKey] = await Promise.all([
  readSecret("OPENAI_API_KEY", "ai-shopping-openai"),
  readSecret("SERPER_API_KEY", "ai-shopping-serper"),
]);
const admin = postgres(TEST_DATABASE_URL, { max: 1, prepare: false });
let connection: ReturnType<typeof createDatabaseConnection> | null = null;

try {
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  await migrateDatabase({ url: disposableUrl.toString() });
  connection = createDatabaseConnection({
    url: disposableUrl.toString(),
    prepare: false,
  });
  const runtime = countingDependencies({
    db: connection.db,
    openAIKey,
    serperKey,
  });
  const flows: Array<Record<string, unknown>> = [];
  for (const fixture of cases) {
    flows.push(
      await runCase({
        fixture,
        dependencies: runtime.dependencies,
        counts: runtime.counts,
      }),
    );
  }
  const tasks = await connection.db.select().from(shoppingTasks);
  const taskIds = new Set(tasks.map(({ id }) => id));
  const allSearchRuns = (await connection.db.select().from(searchRuns)).filter(
    ({ taskId }) => taskIds.has(taskId),
  );
  const allQueries = (await connection.db.select().from(searchQueries)).filter(
    ({ taskId }) => taskIds.has(taskId),
  );
  const allCandidates = (
    await connection.db.select().from(candidateListings)
  ).filter(({ taskId }) => taskIds.has(taskId));
  const allResearchRuns = (
    await connection.db.select().from(evidenceResearchRuns)
  ).filter(({ taskId }) => taskIds.has(taskId));
  const allAttempts = (
    await connection.db.select().from(evidenceAcquisitionAttempts)
  ).filter(({ taskId }) => taskIds.has(taskId));
  const allSources = (
    await connection.db.select().from(evidenceSources)
  ).filter(({ taskId }) => taskIds.has(taskId));
  const allObservations = (
    await connection.db.select().from(productObservations)
  ).filter(({ taskId }) => taskIds.has(taskId));
  const allAssessments = (
    await connection.db.select().from(criterionAssessments)
  ).filter(({ taskId }) => taskIds.has(taskId));
  const allLinks = (
    await connection.db.select().from(criterionAssessmentObservations)
  ).filter(({ taskId }) => taskIds.has(taskId));
  const assessmentRevision = new Map(
    allAssessments.map(({ id, taskRevision }) => [id, taskRevision]),
  );
  const revisionsByObservation = new Map<string, Set<bigint>>();
  for (const link of allLinks) {
    const revision = assessmentRevision.get(link.assessmentId);
    if (revision === undefined) continue;
    const revisions =
      revisionsByObservation.get(link.observationId) ?? new Set();
    revisions.add(revision);
    revisionsByObservation.set(link.observationId, revisions);
  }
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    model: V0_07_OPENAI_DEFAULT_CONFIG.model,
    market: { country: "GB", language: "en-GB", currency: "GBP" },
    flows,
    persistence: {
      tasks: tasks.length,
      searchRuns: allSearchRuns.length,
      searchQueries: allQueries.map(({ queryText }) => queryText),
      rawCandidateListings: allCandidates.length,
      directMerchantDestinations: allCandidates.filter(
        ({ merchantDestinationUrl }) => merchantDestinationUrl !== null,
      ).length,
      researchRuns: allResearchRuns.map((run) => ({
        taskRevision: run.taskRevision,
        status: run.status,
        selectedCandidateCount: run.selectedCandidateCount,
        plannedSearchCount: run.plannedSearchCount,
      })),
      evidenceQueries: allAttempts
        .filter(({ stage }) => stage === "organic_search")
        .map(({ query, status }) => ({ query, status })),
      evidenceSources: allSources.map((source) => ({
        role: source.sourceRole,
        kind: source.sourceKind,
        title: source.sourceTitle,
        url: source.sourceUrl,
      })),
      observations: allObservations.map((observation) => ({
        candidateListingId: observation.candidateListingId,
        propertyLabel: observation.propertyLabel,
        claim: observation.claim,
        value: observation.value,
        sourceId: observation.evidenceSourceId,
      })),
      assessments: allAssessments.map((assessment) => ({
        taskRevision: assessment.taskRevision,
        candidateListingId: assessment.candidateListingId,
        criterionId: assessment.criterionId,
        status: assessment.status,
        relation: assessment.relation,
        explanation: assessment.explanation,
      })),
      unknownAssessmentCount: allAssessments.filter(
        ({ status }) => status === "uncertain",
      ).length,
      observationsReusedAcrossRevisions: [
        ...revisionsByObservation.values(),
      ].filter((revisions) => revisions.size > 1).length,
      totalCalls: runtime.counts,
    },
  };
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      new URL("v0-07-live-founder-proof.json", outputDirectory),
      `${jsonValue(report)}\n`,
      "utf8",
    ),
    writeFile(
      new URL("v0-07-live-founder-proof.md", outputDirectory),
      markdown(report),
      "utf8",
    ),
  ]);
  process.stdout.write(
    `${jsonValue({
      generatedAt: report.generatedAt,
      flows: flows.map((flow) => ({
        name: flow.name,
        retrieved: flow.retrieved,
        initialDecision: flow.initialDecision,
        refinement: flow.refinement,
        calls: flow.calls,
      })),
      persistence: persistenceSummary(report.persistence),
    })}\n`,
  );
} finally {
  if (connection !== null) await connection.close();
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  await admin.end();
}
