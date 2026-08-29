import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import postgres from "postgres";
import {
  projectShoppingBrief,
  type ShoppingBriefV1,
} from "../src/domain/shopping-state/brief";
import { normalizeMeasurementAmount } from "../src/domain/shopping-state/semantic-value";
import {
  createOpenAIContextAcquisitionModel,
  V0_05_OPENAI_DEFAULT_CONFIG,
} from "../src/features/context-acquisition/openai-adapter";
import type { ContextAcquisitionModel } from "../src/features/context-acquisition/model-port";
import {
  answerLiveShoppingQuestion,
  deepenLiveShoppingResearch,
  loadLiveShoppingSession,
  refineLiveShopping,
  researchLiveCandidate,
  researchLiveShopping,
  resolveLivePurchaseDestinations,
  retryLiveShoppingContext,
  setLiveListingSaved,
  startLiveShopping,
  type LiveShoppingDependencies,
} from "../src/features/live-shopping/application";
import type { LiveShoppingView } from "../src/features/live-shopping/contracts";
import { createOpenAIProductUnderstandingModel } from "../src/features/product-understanding/openai-adapter";
import { fetchBoundedPage } from "../src/features/product-understanding/page-fetch";
import type { EvidenceSearchProvider } from "../src/features/product-understanding/evidence-search";
import type { ProductUnderstandingModel } from "../src/features/product-understanding/model-port";
import { V0_07_OPENAI_DEFAULT_CONFIG } from "../src/features/product-understanding/openai-adapter";
import { PRODUCT_UNDERSTANDING_PROMPT_VERSION } from "../src/features/product-understanding/prompts";
import { SerperEvidenceSearchAdapter } from "../src/features/product-understanding/serper-evidence-adapter";
import type { MerchantDestinationResolver } from "../src/features/purchase-destinations/contracts";
import { SerperMerchantDestinationResolver } from "../src/features/purchase-destinations/serper-merchant-destination-resolver";
import type { ShoppingSearchProvider } from "../src/features/retrieval-spike/contracts";
import { SerperShoppingAdapter } from "../src/features/retrieval-spike/serper-shopping-adapter";
import { loadCurrentShoppingState } from "../src/features/shopping-state/persistence/state-loaders";
import { requireTestDatabaseEnvironment } from "../src/infrastructure/config/environment";
import { createDatabaseConnection } from "../src/infrastructure/database/clients";
import { migrateDatabase } from "../src/infrastructure/database/migrate";
import {
  candidateListings,
  contextAcquisitionAttempts,
  criterionAssessmentObservations,
  criterionAssessments,
  evidenceAcquisitionAttempts,
  evidenceAttemptTargetCriteria,
  evidencePageFetchTargets,
  evidenceResearchRuns,
  evidenceSources,
  fetchedEvidenceDocuments,
  founderLiveSessions,
  merchantDestinationResolutions,
  productObservations,
  rejectedCandidateListings,
  savedCandidateListings,
  searchQueries,
  searchQueryExecutions,
  searchRuns,
} from "../src/infrastructure/database/schema";

const executeFile = promisify(execFile);
const outputDirectory = new URL("../docs/evals/", import.meta.url);
const disposableDatabasePattern = /^ai_shopping_test_v009_[a-f0-9]{32}$/;
const successJson = new URL("v0-09-live-founder-proof.json", outputDirectory);
const successMarkdown = new URL("v0-09-live-founder-proof.md", outputDirectory);
const failureJson = new URL(
  "v0-09-live-founder-proof-failure.json",
  outputDirectory,
);
const failureMarkdown = new URL(
  "v0-09-live-founder-proof-failure.md",
  outputDirectory,
);
const attemptMarker = new URL(
  "v0-09-live-founder-proof-attempt.json",
  outputDirectory,
);
const releaseModel = "gpt-5.6-terra" as const;

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
  {
    name: "compact-coffee-machine",
    request:
      "I need a compact coffee machine for a small kitchen under £350. It must be no more than 25cm wide. I want genuinely good espresso and something that is easy to clean. I’d prefer it not to be very loud, and milk frothing would be useful but isn’t essential. I’m open on brand and colour.",
    refinement: null,
  },
] as const;

type CaseFixture = (typeof cases)[number];
type CaseName = CaseFixture["name"];
type ExternalStage =
  | "interpretation"
  | "action_selection"
  | "shopping"
  | "evidence_search"
  | "page_fetch"
  | "product_understanding"
  | "destination";

type ExternalTrace = {
  caseName: CaseName;
  stage: ExternalStage;
  ordinal: number;
  startedOffsetMs: number;
  finishedOffsetMs: number;
  durationMs: number;
  status: "succeeded" | "failed";
  detail: Readonly<Record<string, unknown>>;
};

function assertProof(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`V0-09 proof failed: ${message}`);
}

function sanitizedDuration(value: number) {
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.round(value)));
}

function traceOffset(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Number(value.toFixed(3)));
}

function sanitizeUrl(value: string | null) {
  if (value === null) return null;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      const normalizedKey = key.toLocaleLowerCase("en-GB");
      if (
        normalizedKey === "srsltid" ||
        normalizedKey === "gclid" ||
        normalizedKey === "fbclid" ||
        normalizedKey === "key" ||
        normalizedKey.includes("token") ||
        normalizedKey.includes("secret") ||
        normalizedKey.includes("password") ||
        normalizedKey.includes("credential") ||
        normalizedKey.startsWith("utm_")
      ) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return value.slice(0, 1_000);
  }
}

function json(value: unknown) {
  return JSON.stringify(
    value,
    (_key, entry) => (typeof entry === "bigint" ? entry.toString() : entry),
    2,
  );
}

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
  if (value.length === 0) throw new Error(`${environmentName} is empty`);
  return value;
}

function decodedSecretComponents(values: readonly string[]) {
  const output = new Set<string>();
  for (const value of values) {
    if (value.trim().length === 0) continue;
    output.add(value);
    try {
      output.add(decodeURIComponent(value));
    } catch {
      // The original opaque value is still scrubbed.
    }
    try {
      const url = new URL(value);
      for (const component of [
        url.username,
        url.password,
        decodeURIComponent(url.username),
        decodeURIComponent(url.password),
      ]) {
        if (component.length >= 3) output.add(component);
      }
    } catch {
      // Not every secret is a URL.
    }
  }
  return [...output].sort((left, right) => right.length - left.length);
}

function scrubFailure(message: string, secrets: readonly string[]) {
  return decodedSecretComponents(secrets)
    .filter((secret) => secret.length >= 3)
    .reduce(
      (value, secret) => value.replaceAll(secret, "[redacted-secret]"),
      message,
    )
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted-api-key]")
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[redacted-database-url]")
    .slice(0, 1_500);
}

type ExplicitAnswerRule = Readonly<{
  question: RegExp;
  option: RegExp;
  openText: string;
}>;

const initialAnswerRules = {
  "ergonomic-mouse": [
    {
      question: /budget|price|spend/i,
      option: /(?:under|up to|maximum|max).*50|£50/i,
      openText: "Under £50.",
    },
    {
      question: /review|rating/i,
      option: /matter a lot|very important|strong|high priority/i,
      openText: "Reviews matter a lot.",
    },
    {
      question: /wireless|connection|connectivity/i,
      option: /wireless.*(?:battery|very good)|prefer wireless/i,
      openText: "Wireless is preferable only if battery life is very good.",
    },
    {
      question: /shape|profile|sculpt|thumb|form/i,
      option: /chunk|sculpt|side profile|thumb.?rest/i,
      openText:
        "A chunkier, sculpted shape with a noticeable side profile or thumb rest.",
    },
    {
      question: /brand/i,
      option: /good|reputable|exclude.*(?:amazon|bad)|no amazon/i,
      openText: "Good brands only; exclude Amazon Basics and bad brands.",
    },
  ],
  "office-chair": [
    {
      question: /stretch|max(?:imum)? (?:budget|price|spend)|how high/i,
      option: /350|£350/i,
      openText:
        "I can stretch to £350 only if it is genuinely better for long sessions.",
    },
    {
      question:
        /^(?!.*(?:stretch|max(?:imum)? (?:budget|price|spend)|how high)).*(?:budget|price|spend)/i,
      option: /250|£250/i,
      openText: "Around £250.",
    },
    {
      question: /height/i,
      option: /5.?10|178|average/i,
      openText: "I am 5'10.",
    },
    {
      question: /material|mesh|fabric|leather/i,
      option: /mesh|fabric|breathable/i,
      openText: "Breathable fabric or mesh, not leather.",
    },
    {
      question: /size|large|huge/i,
      option: /not.*(?:huge|large)/i,
      openText: "I do not want anything huge.",
    },
    {
      question: /style|gamer|appearance/i,
      option: /not.*gamer/i,
      openText: "I do not want it to look like a gamer chair.",
    },
    {
      question: /back|lumbar|support/i,
      option: /lower.?back|lumbar|strong support/i,
      openText: "Good lower-back support matters a lot.",
    },
    {
      question: /brand|colour|color/i,
      option: /no preference|doesn.t matter|open/i,
      openText: "Brand and colour do not matter.",
    },
  ],
  "cordless-vacuum": [
    {
      question: /floor|rug|surface/i,
      option: /both|hard.*rug|rug.*hard/i,
      openText: "It must work well on both hard floors and rugs.",
    },
    {
      question: /noise|quiet|loud/i,
      option: /quiet|low noise|not.*loud/i,
      openText:
        "It must not be very loud because I have a noise-sensitive cat.",
    },
    {
      question: /runtime|battery/i,
      option: /40|at least.*40|long/i,
      openText: "At least 40 minutes of useful runtime is preferred.",
    },
    {
      question: /weight|heavy|light/i,
      option: /under.*3|less than.*3|light/i,
      openText: "Under 3kg is preferred.",
    },
    {
      question: /budget|price|spend/i,
      option: /250|£250|under.*250/i,
      openText: "Under £250.",
    },
    {
      question: /brand|colour|color/i,
      option: /no preference|doesn.t matter|open/i,
      openText: "Brand and colour do not matter.",
    },
    {
      question: /home|flat|living space/i,
      option: /small flat/i,
      openText: "It is for a small flat.",
    },
  ],
  "compact-coffee-machine": [
    {
      question: /width/i,
      option: /25|no more than.*25|max(?:imum)?.*25/i,
      openText: "No more than 25cm wide.",
    },
    {
      question: /milk|froth/i,
      option: /useful|not essential|optional/i,
      openText: "Milk frothing would be useful but is not essential.",
    },
    {
      question: /noise|quiet|loud/i,
      option: /not.*loud/i,
      openText: "I would prefer it not to be very loud.",
    },
    {
      question: /clean/i,
      option: /easy|simple/i,
      openText: "I want something that is easy to clean.",
    },
    {
      question: /espresso|coffee quality|taste/i,
      option: /good|quality|espresso/i,
      openText: "I want genuinely good espresso.",
    },
    {
      question: /brand|colour|color/i,
      option: /no preference|open|doesn.t matter/i,
      openText: "I am open on brand and colour.",
    },
    {
      question: /budget|price|spend/i,
      option: /350|£350|under.*350/i,
      openText: "Under £350.",
    },
    {
      question: /size|space|kitchen|compact/i,
      option: /compact|small/i,
      openText: "I need a compact machine for a small kitchen.",
    },
  ],
} as const satisfies Record<CaseName, readonly ExplicitAnswerRule[]>;

const mouseRefinementRules = [
  {
    question: /review|rating/i,
    option: /less|lower|preference/i,
    openText: "Reviews matter less now.",
  },
  {
    question: /comfort|priority|workday/i,
    option: /comfort|long workday|most|top/i,
    openText: "Comfort for long workdays matters most.",
  },
] as const satisfies readonly ExplicitAnswerRule[];

const explicitCombinedPriorityRules = {
  "ergonomic-mouse": [
    {
      question:
        /(?:review|rating).*(?:comfort|workday)|(?:comfort|workday).*(?:review|rating)/i,
      option: /comfort|long workday|most|top/i,
      openText:
        "Comfort for long workdays matters most; reviews matter less now.",
    },
  ],
  "office-chair": [],
  "cordless-vacuum": [],
  "compact-coffee-machine": [],
} as const satisfies Record<CaseName, readonly ExplicitAnswerRule[]>;

function explicitRule(options: {
  caseName: CaseName;
  prompt: string;
  phase: "initial" | "refinement";
}) {
  const baseRules =
    options.caseName === "ergonomic-mouse" && options.phase === "refinement"
      ? initialAnswerRules["ergonomic-mouse"].filter(
          (_rule, index) => index !== 1,
        )
      : initialAnswerRules[options.caseName];
  const rules = [
    ...(options.caseName === "ergonomic-mouse" && options.phase === "refinement"
      ? mouseRefinementRules
      : []),
    ...baseRules,
  ];
  const matches = rules.filter(({ question }) => question.test(options.prompt));
  const combinedRules =
    options.phase === "refinement"
      ? explicitCombinedPriorityRules[options.caseName]
      : [];
  const combinedMatches = combinedRules.filter(({ question }) =>
    question.test(options.prompt),
  );
  assertProof(
    combinedMatches.length <= 1,
    `${options.caseName} received an ASK matching more than one explicitly ordered combined answer`,
  );
  if (combinedMatches.length === 1) {
    const explicitlyOrderedRules = new Set<ExplicitAnswerRule>(
      mouseRefinementRules,
    );
    assertProof(
      options.caseName === "ergonomic-mouse" &&
        options.phase === "refinement" &&
        matches.length === 2 &&
        matches.every((rule) => explicitlyOrderedRules.has(rule)),
      `${options.caseName} received a combined ASK containing a topic outside the founder's explicit ordering`,
    );
    return combinedMatches[0]!;
  }
  assertProof(
    matches.length === 1,
    matches.length === 0
      ? `${options.caseName} received an ASK that the exact founder message does not justify answering: ${options.prompt}`
      : `${options.caseName} received a multi-topic ASK without an explicit founder ordering: ${options.prompt}`,
  );
  return matches[0]!;
}

function chooseOption(options: {
  caseName: CaseName;
  prompt: string;
  labels: string[];
  phase: "initial" | "refinement";
}) {
  const rule = explicitRule(options);
  const index = options.labels.findIndex((label) => rule.option.test(label));
  assertProof(
    index >= 0,
    `${options.caseName} ASK offered no answer explicitly supported by the founder message: ${options.prompt}`,
  );
  return index;
}

async function resolveQuestions(options: {
  dependencies: LiveShoppingDependencies;
  fixture: CaseFixture;
  view: LiveShoppingView;
  questions: Array<Record<string, unknown>>;
  phase: "initial" | "refinement";
}) {
  let view = options.view;
  let providerRecoveryCount = 0;
  for (let turn = 0; turn < 7; turn += 1) {
    if (view.action.kind === "understanding_failed") {
      assertProof(
        providerRecoveryCount < 1,
        `${options.fixture.name} interpretation failed after one safe retry`,
      );
      providerRecoveryCount += 1;
      options.questions.push({
        kind: "provider_recovery",
        notice: view.action.notice,
      });
      view = await retryLiveShoppingContext({
        dependencies: options.dependencies,
        sessionId: view.sessionId,
      });
      continue;
    }
    if (view.action.kind !== "ask") return view;
    const action = view.action;
    if (action.responseMode === "open_text") {
      const answer = explicitRule({
        caseName: options.fixture.name,
        prompt: action.prompt,
        phase: options.phase,
      }).openText;
      options.questions.push({ prompt: action.prompt, answer });
      view = await answerLiveShoppingQuestion({
        dependencies: options.dependencies,
        input: {
          operation: "answer",
          sessionId: view.sessionId,
          turnId: randomUUID(),
          answer: { mode: "open_text", text: answer },
        },
      });
      continue;
    }
    const index = chooseOption({
      caseName: options.fixture.name,
      prompt: action.prompt,
      labels: action.options.map(({ label }) => label),
      phase: options.phase,
    });
    const answer = action.options[index]!;
    options.questions.push({
      prompt: action.prompt,
      options: action.options.map(({ label }) => label),
      answer: answer.label,
    });
    view = await answerLiveShoppingQuestion({
      dependencies: options.dependencies,
      input: {
        operation: "answer",
        sessionId: view.sessionId,
        turnId: randomUUID(),
        answer: { mode: "single_select", optionOrdinal: answer.ordinal },
      },
    });
  }
  throw new Error(
    `${options.fixture.name} did not converge within seven turns`,
  );
}

function maximumConcurrency(traces: readonly ExternalTrace[]) {
  const events = traces.flatMap((trace) => [
    { at: trace.startedOffsetMs, delta: 1 },
    { at: trace.finishedOffsetMs, delta: -1 },
  ]);
  events.sort((left, right) => left.at - right.at || left.delta - right.delta);
  let active = 0;
  let maximum = 0;
  for (const event of events) {
    active += event.delta;
    maximum = Math.max(maximum, active);
  }
  return maximum;
}

function createInstrumentedDependencies(options: {
  db: LiveShoppingDependencies["db"];
  openAIKey: string;
  serperKey: string;
  activeCase: () => CaseName;
}) {
  assertProof(
    V0_05_OPENAI_DEFAULT_CONFIG.model === releaseModel,
    "context acquisition is not pinned to the Terra release model",
  );
  assertProof(
    V0_07_OPENAI_DEFAULT_CONFIG.model === releaseModel,
    "product understanding is not pinned to the Terra release model",
  );
  const traces: ExternalTrace[] = [];
  const runStartedAt = performance.now();
  let ordinal = 0;
  const measure = async <Value>(
    stage: ExternalStage,
    detail: Readonly<Record<string, unknown>>,
    operation: () => Promise<Value>,
  ) => {
    const caseName = options.activeCase();
    const callOrdinal = (ordinal += 1);
    const startedAt = performance.now();
    let status: ExternalTrace["status"] = "succeeded";
    try {
      return await operation();
    } catch (error) {
      status = "failed";
      throw error;
    } finally {
      const finishedAt = performance.now();
      traces.push({
        caseName,
        stage,
        ordinal: callOrdinal,
        startedOffsetMs: traceOffset(startedAt - runStartedAt),
        finishedOffsetMs: traceOffset(finishedAt - runStartedAt),
        durationMs: sanitizedDuration(finishedAt - startedAt),
        status,
        detail,
      });
    }
  };

  const context = createOpenAIContextAcquisitionModel({
    environment: { ...process.env, OPENAI_API_KEY: options.openAIKey },
    config: { model: releaseModel },
  });
  const model: ContextAcquisitionModel = {
    interpret: (input) =>
      measure(
        "interpretation",
        {
          configuredModel: releaseModel,
          providerInputSchemaVersion: input.providerInputSchemaVersion,
        },
        () => context.interpret(input),
      ),
    selectAction: (input) =>
      measure(
        "action_selection",
        {
          configuredModel: releaseModel,
          providerInputSchemaVersion: input.providerInputSchemaVersion,
        },
        () => context.selectAction(input),
      ),
  };

  const shopping = new SerperShoppingAdapter({ apiKey: options.serperKey });
  const provider: ShoppingSearchProvider = {
    provider: shopping.provider,
    maxRequestDurationMs: shopping.maxRequestDurationMs,
    search: (query) =>
      measure(
        "shopping",
        { queryId: query.id, purpose: query.purpose, query: query.text },
        () => shopping.search(query),
      ),
  };

  const evidence = new SerperEvidenceSearchAdapter({
    apiKey: options.serperKey,
  });
  const evidenceProvider: EvidenceSearchProvider = {
    provider: evidence.provider,
    search: (input) =>
      measure(
        "evidence_search",
        { candidateTitle: input.candidateTitle, query: input.query },
        () => evidence.search(input),
      ),
  };

  const understandingModel = createOpenAIProductUnderstandingModel({
    apiKey: options.openAIKey,
    config: { model: releaseModel },
  });
  const understanding: ProductUnderstandingModel = {
    understand: (input, policy) =>
      measure(
        "product_understanding",
        {
          candidateTitle: input.candidate.title,
          configuredModel: releaseModel,
          criteria: input.criteria.map(({ ordinal, label }) => ({
            ordinal,
            label,
          })),
          focused: policy.requireCriterionBinding,
          sourceDepths: input.sources.map(({ kind }) => kind),
        },
        () => understandingModel.understand(input, policy),
      ),
  };

  const rawDestination = new SerperMerchantDestinationResolver({
    apiKey: options.serperKey,
  });
  const destinationResolver: MerchantDestinationResolver = {
    provider: rawDestination.provider,
    maxRequestDurationMs: rawDestination.maxRequestDurationMs,
    resolve: (request) =>
      measure(
        "destination",
        {
          candidateListingId: request.candidateListingId,
          title: request.title,
          merchant: request.merchant,
          query: request.queryText,
        },
        () => rawDestination.resolve(request),
      ),
  };

  return {
    traces,
    dependencies: {
      db: options.db,
      model,
      provider,
      destinationResolver,
      research: {
        evidenceProvider,
        pageFetcher: {
          provider: "server_http" as const,
          fetch: (input) =>
            measure(
              "page_fetch",
              {
                candidateTitle: input.candidateTitle,
                requestedUrl: sanitizeUrl(input.url),
                discoveredRole: input.discoveredRole,
              },
              () => fetchBoundedPage({ url: input.url }),
            ),
        },
        model: understanding,
        modelIdentity: {
          provider: "openai" as const,
          model: releaseModel,
          promptVersion: PRODUCT_UNDERSTANDING_PROMPT_VERSION,
        },
      },
    } satisfies LiveShoppingDependencies,
  };
}

function elapsedMs(startedAt: Date | null, finishedAt: Date | null) {
  if (startedAt === null || finishedAt === null) return null;
  return Math.max(0, finishedAt.getTime() - startedAt.getTime());
}

async function scopedPersistence(options: {
  db: LiveShoppingDependencies["db"];
  sessionId: string;
}) {
  const sessions = await options.db.select().from(founderLiveSessions);
  const session = sessions.find(({ id }) => id === options.sessionId);
  assertProof(session !== undefined, "founder session disappeared");
  const taskId = session.taskId;
  const state = await loadCurrentShoppingState(options.db, taskId);
  const brief = projectShoppingBrief(state);
  const [
    runs,
    queries,
    executions,
    listings,
    researchRuns,
    attempts,
    targets,
    pageTargets,
    documents,
    sources,
    observations,
    assessments,
    bindings,
    resolutions,
    saved,
    rejected,
    contextAttempts,
  ] = await Promise.all([
    options.db.select().from(searchRuns),
    options.db.select().from(searchQueries),
    options.db.select().from(searchQueryExecutions),
    options.db.select().from(candidateListings),
    options.db.select().from(evidenceResearchRuns),
    options.db.select().from(evidenceAcquisitionAttempts),
    options.db.select().from(evidenceAttemptTargetCriteria),
    options.db.select().from(evidencePageFetchTargets),
    options.db.select().from(fetchedEvidenceDocuments),
    options.db.select().from(evidenceSources),
    options.db.select().from(productObservations),
    options.db.select().from(criterionAssessments),
    options.db.select().from(criterionAssessmentObservations),
    options.db.select().from(merchantDestinationResolutions),
    options.db.select().from(savedCandidateListings),
    options.db.select().from(rejectedCandidateListings),
    options.db.select().from(contextAcquisitionAttempts),
  ]);
  const taskRuns = runs.filter((row) => row.taskId === taskId);
  const runIds = new Set(taskRuns.map(({ id }) => id));
  const taskResearchRuns = researchRuns.filter((row) => row.taskId === taskId);
  const taskAttempts = attempts.filter((row) => row.taskId === taskId);
  const taskTargets = targets.filter((row) => row.taskId === taskId);
  const targetIdsByAttempt = new Map<string, string[]>();
  for (const target of taskTargets) {
    const values = targetIdsByAttempt.get(target.attemptId) ?? [];
    values.push(target.criterionId);
    targetIdsByAttempt.set(target.attemptId, values);
  }
  const taskSources = sources.filter((row) => row.taskId === taskId);
  const taskObservations = observations.filter((row) => row.taskId === taskId);
  const taskAssessments = assessments.filter((row) => row.taskId === taskId);
  const taskBindings = bindings.filter((row) => row.taskId === taskId);
  return {
    taskId,
    currentRevision: brief.revision,
    brief,
    contextAcquisitionAttempts: contextAttempts
      .filter((row) => row.taskId === taskId)
      .map((row) => ({
        id: row.id,
        orchestrationRunId: row.orchestrationRunId,
        stage: row.stage,
        status: row.status,
        provider: row.provider,
        model: row.model,
        durationMs: row.durationMs,
        errorCode: row.errorCode,
        createdAt: row.createdAt,
      })),
    searchRuns: taskRuns.map((row) => ({
      id: row.id,
      status: row.status,
      searchRunId: row.id,
      taskRevision: row.taskRevision,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
    })),
    queries: queries
      .filter(({ runId }) => runIds.has(runId))
      .map((row) => ({
        id: row.id,
        text: row.queryText,
        purpose: row.purpose,
      })),
    queryExecutions: executions
      .filter(({ runId }) => runIds.has(runId))
      .map((row) => ({
        queryId: row.queryId,
        status: row.status,
        receivedResultCount: row.receivedResultCount,
        rejectedResultCount: row.rejectedResultCount,
        failureCode: row.failureCode,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        receiptElapsedMs: elapsedMs(row.startedAt, row.finishedAt),
      })),
    listings: listings
      .filter((row) => row.taskId === taskId)
      .map((row) => ({
        id: row.id,
        runId: row.runId,
        title: row.title,
        merchant: row.merchant,
        priceText: row.priceText,
        googleShoppingUrl: sanitizeUrl(row.url),
        originalMerchantDestinationUrl: sanitizeUrl(row.merchantDestinationUrl),
      })),
    researchRuns: taskResearchRuns.map((row) => ({
      id: row.id,
      searchRunId: row.searchRunId,
      phase: row.phase,
      status: row.status,
      taskRevision: row.taskRevision,
      selectedCandidateCount: row.selectedCandidateCount,
      plannedSearchCount: row.plannedSearchCount,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      receiptElapsedMs: elapsedMs(row.startedAt, row.finishedAt),
    })),
    attempts: taskAttempts.map((row) => ({
      id: row.id,
      researchRunId: row.researchRunId,
      candidateRunId: row.candidateRunId,
      candidateListingId: row.candidateListingId,
      stage: row.stage,
      purpose: row.purpose,
      planKey: row.planKey,
      query: row.query,
      status: row.status,
      provider: row.provider,
      model: row.model,
      failureCode: row.failureCode,
      receivedResultCount: row.receivedResultCount,
      targetCriterionIds: [...(targetIdsByAttempt.get(row.id) ?? [])].sort(),
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      receiptElapsedMs: elapsedMs(row.startedAt, row.finishedAt),
    })),
    pageTargets: pageTargets
      .filter((row) => row.taskId === taskId)
      .map((row) => ({
        researchRunId: row.researchRunId,
        candidateRunId: row.candidateRunId,
        attemptId: row.attemptId,
        candidateListingId: row.candidateListingId,
        discoveredSourceId: row.discoveredSourceId,
        discoveredSourceKind: row.discoveredSourceKind,
        requestedUrl: sanitizeUrl(row.requestedUrl),
        policyVersion: row.policyVersion,
      })),
    fetchedDocuments: documents
      .filter((row) => row.taskId === taskId)
      .map((row) => ({
        id: row.id,
        researchRunId: row.researchRunId,
        candidateRunId: row.candidateRunId,
        candidateListingId: row.candidateListingId,
        attemptId: row.attemptId,
        discoveredSourceId: row.discoveredSourceId,
        evidenceSourceId: row.evidenceSourceId,
        requestedUrl: sanitizeUrl(row.requestedUrl),
        finalUrl: sanitizeUrl(row.finalUrl),
        canonicalUrl: sanitizeUrl(row.canonicalUrl),
        contentType: row.contentType,
        encodedBytes: row.encodedBytes,
        decodedBytes: row.decodedBytes,
        responseHash: row.responseHash,
        documentHash: row.documentHash,
        extractionVersion: row.extractionVersion,
        admission: row.admission,
        fetchedAt: row.fetchedAt,
      })),
    evidenceSources: taskSources.map((row) => ({
      id: row.id,
      researchRunId: row.researchRunId,
      candidateRunId: row.candidateRunId,
      candidateListingId: row.candidateListingId,
      acquisitionAttemptId: row.acquisitionAttemptId,
      sourceRole: row.sourceRole,
      sourceKind: row.sourceKind,
      sourceUrl: sanitizeUrl(row.sourceUrl),
      sourceTitle: row.sourceTitle,
    })),
    observations: taskObservations.map((row) => ({
      id: row.id,
      researchRunId: row.researchRunId,
      candidateRunId: row.candidateRunId,
      candidateListingId: row.candidateListingId,
      evidenceSourceId: row.evidenceSourceId,
      support: row.support,
      propertyLabel: row.propertyLabel,
      claim: row.claim,
    })),
    assessments: taskAssessments.map((row) => ({
      id: row.id,
      researchRunId: row.researchRunId,
      taskRevision: row.taskRevision,
      candidateRunId: row.candidateRunId,
      candidateListingId: row.candidateListingId,
      criterionId: row.criterionId,
      generation: row.generation,
      supersededAt: row.supersededAt,
      status: row.status,
      relation: row.relation,
      explanation: row.explanation,
      method: row.method,
      model: row.model,
    })),
    currentAssessments: taskAssessments
      .filter(
        (row) =>
          row.taskRevision === brief.revision && row.supersededAt === null,
      )
      .map((row) => ({
        id: row.id,
        researchRunId: row.researchRunId,
        candidateRunId: row.candidateRunId,
        candidateListingId: row.candidateListingId,
        criterionId: row.criterionId,
        generation: row.generation,
        status: row.status,
        relation: row.relation,
        explanation: row.explanation,
        method: row.method,
        model: row.model,
      })),
    assessmentObservationBindings: taskBindings.map((row) => ({
      assessmentId: row.assessmentId,
      observationId: row.observationId,
      candidateRunId: row.candidateRunId,
      candidateListingId: row.candidateListingId,
    })),
    destinationResolutions: resolutions
      .filter((row) => row.taskId === taskId)
      .map((row) => ({
        id: row.id,
        searchRunId: row.searchRunId,
        candidateListingId: row.candidateListingId,
        policyVersion: row.policyVersion,
        provider: row.provider,
        queryText: row.queryText,
        status: row.status,
        destinationUrl: sanitizeUrl(row.destinationUrl),
        acceptedResultTitle: row.acceptedResultTitle,
        observedResultUrl: sanitizeUrl(row.observedResultUrl),
        observedResultUrlWasDistinctFromCanonical:
          row.observedResultUrl !== null &&
          row.observedResultUrl !== row.destinationUrl,
        outcomeCode: row.outcomeCode,
        consideredResultCount: row.consideredResultCount,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        receiptElapsedMs: elapsedMs(row.startedAt, row.finishedAt),
      })),
    savedCandidateListingIds: saved
      .filter((row) => row.taskId === taskId)
      .map(({ candidateListingId, savedAt }) => ({
        candidateListingId,
        savedAt,
      })),
    rejectedCandidateListingIds: rejected
      .filter((row) => row.taskId === taskId)
      .map(({ candidateListingId, rejectedAt }) => ({
        candidateListingId,
        rejectedAt,
      })),
    internalTimingVisibility: {
      planningMs: null,
      persistenceWallMs: null,
      projectionMs: null,
      reason:
        "The live application boundary does not expose pure planning/persistence/projection intervals. Persisted lifecycle durations and separately measured fresh projection loads are reported without relabelling residual wall time.",
    },
  };
}

type PersistenceSnapshot = Awaited<ReturnType<typeof scopedPersistence>>;

function briefMeaning(item: ShoppingBriefV1["items"][number]) {
  return `${item.conceptLabel} ${item.conceptDefinition}`
    .trim()
    .toLocaleLowerCase("en-GB");
}

function requireMeaning(
  brief: ShoppingBriefV1,
  pattern: RegExp,
  description: string,
) {
  const item = brief.items.find((candidate) =>
    pattern.test(briefMeaning(candidate)),
  );
  assertProof(item !== undefined, `authoritative brief lost ${description}`);
  return item;
}

function requireMoneyCeiling(
  brief: ShoppingBriefV1,
  amountMinor: number,
  description: string,
) {
  const item = brief.items.find(
    ({ semanticValue }) =>
      semanticValue.kind === "money" &&
      semanticValue.mode === "ceiling" &&
      semanticValue.currency === "GBP" &&
      semanticValue.amountMinor === amountMinor,
  );
  assertProof(item !== undefined, `authoritative brief lost ${description}`);
  assertProof(
    item.strength === "hard",
    `${description} was not preserved as an explicit ceiling`,
  );
  return item;
}

const strengthRank = {
  preference: 1,
  strong_preference: 2,
  hard: 3,
} as const;

const founderIntentCriterionOracle = {
  "ergonomic-mouse": {
    initial: [
      { key: "ergonomic_subject", meaning: /ergonomic/ },
      { key: "budget", meaning: /budget|price|cost|spend/ },
      { key: "reviews", meaning: /review|rating/ },
      {
        key: "wireless_battery_condition",
        meaning: /wireless|connectivity|connection|battery/,
      },
      {
        key: "sculpted_shape",
        meaning: /shape|profile|sculpt|thumb|form factor|chunk/,
      },
      {
        key: "brand_quality",
        meaning: /brand|manufacturer|amazon basics|reputable/,
      },
    ],
    refinement: [
      { key: "ergonomic_subject", meaning: /ergonomic/ },
      { key: "budget", meaning: /budget|price|cost|spend/ },
      { key: "reviews", meaning: /review|rating/ },
      {
        key: "wireless_battery_condition",
        meaning: /wireless|connectivity|connection|battery/,
      },
      {
        key: "sculpted_shape",
        meaning: /shape|profile|sculpt|thumb|form factor|chunk/,
      },
      {
        key: "brand_quality",
        meaning: /brand|manufacturer|amazon basics|reputable/,
      },
      {
        key: "long_workday_comfort",
        meaning: /comfort|long workday|long session|extended use/,
      },
    ],
  },
  "office-chair": {
    initial: [
      { key: "budget", meaning: /budget|price|cost|spend/ },
      {
        key: "long_session_comfort",
        meaning: /comfort|long session|workday|working from home/,
      },
      { key: "lower_back_support", meaning: /lower.?back|lumbar/ },
      {
        key: "breathable_material",
        meaning: /mesh|fabric|leather|material|breathab/,
      },
      { key: "physical_size", meaning: /size|huge|footprint|bulk/ },
      { key: "non_gamer_style", meaning: /gamer|style|appearance/ },
      { key: "shopper_fit", meaning: /height|5.?10|shopper fit/ },
    ],
    refinement: [],
  },
  "cordless-vacuum": {
    initial: [
      {
        key: "cordless_subject",
        meaning: /cordless operation|operates cordless|cord-free operation/,
      },
      { key: "budget", meaning: /budget|price|cost|spend/ },
      { key: "floor_coverage", meaning: /floor|rug|surface|carpet/ },
      { key: "noise", meaning: /noise|quiet|loud|sound/ },
      { key: "weight", meaning: /weight|heavy|light/ },
      { key: "runtime", meaning: /runtime|run time|battery/ },
      { key: "small_flat_context", meaning: /small flat|compact|storage/ },
    ],
    refinement: [],
  },
  "compact-coffee-machine": {
    initial: [
      { key: "budget", meaning: /budget|price|cost|spend/ },
      { key: "compact_kitchen_fit", meaning: /compact|small kitchen|size/ },
      { key: "maximum_width", meaning: /width|wide/ },
      { key: "espresso_quality", meaning: /espresso|coffee quality|taste/ },
      { key: "cleaning", meaning: /clean|maintenance/ },
      { key: "noise", meaning: /noise|quiet|loud|sound/ },
      { key: "milk_frothing", meaning: /milk|froth/ },
    ],
    refinement: [],
  },
} as const satisfies Record<
  CaseName,
  Readonly<{
    initial: readonly Readonly<{ key: string; meaning: RegExp }>[];
    refinement: readonly Readonly<{ key: string; meaning: RegExp }>[];
  }>
>;

type BriefItem = ShoppingBriefV1["items"][number];

function semanticValueText(item: BriefItem) {
  return JSON.stringify(item.semanticValue).toLocaleLowerCase("en-GB");
}

function normalizedUpperEquals(
  item: BriefItem,
  unit: "mm" | "g",
  amount: string,
  inclusive: boolean,
) {
  if (
    item.semanticValue.kind !== "measurement_range" ||
    item.semanticValue.lower !== undefined ||
    item.semanticValue.upper === undefined ||
    item.semanticValue.upper.inclusive !== inclusive
  ) {
    return false;
  }
  try {
    return (
      normalizeMeasurementAmount(
        item.semanticValue.upper.amount,
        item.semanticValue.unit,
        unit,
      ) === amount
    );
  } catch {
    return false;
  }
}

function assertFounderCriterionSemantics(options: {
  fixture: CaseFixture;
  phase: "initial" | "refinement";
  key: string;
  item: BriefItem;
}) {
  const { fixture, phase, key, item } = options;
  const value = item.semanticValue;
  const valueText = semanticValueText(item);
  const fail = () =>
    assertProof(
      false,
      `${fixture.name} ${phase} criterion ${item.conceptLabel} reversed or invented the founder's ${key} semantics`,
    );
  if (key === "budget") {
    const valid =
      fixture.name === "ergonomic-mouse"
        ? item.strength === "hard" &&
          value.kind === "money" &&
          value.mode === "ceiling" &&
          value.amountMinor === 5_000 &&
          value.currency === "GBP"
        : fixture.name === "office-chair"
          ? item.strength === "preference" &&
            value.kind === "money_stretch" &&
            value.targetMinor === 25_000 &&
            value.stretchCeilingMinor === 35_000 &&
            value.currency === "GBP" &&
            /genuinely better|long session/.test(
              value.condition.toLocaleLowerCase("en-GB"),
            )
          : fixture.name === "cordless-vacuum"
            ? item.strength === "hard" &&
              value.kind === "money" &&
              value.mode === "ceiling" &&
              value.amountMinor === 25_000 &&
              value.currency === "GBP"
            : item.strength === "hard" &&
              value.kind === "money" &&
              value.mode === "ceiling" &&
              value.amountMinor === 35_000 &&
              value.currency === "GBP";
    if (!valid) fail();
    return;
  }

  const valid = (() => {
    switch (key) {
      case "ergonomic_subject":
        return (
          item.strength === "preference" &&
          /ergonomic/.test(valueText) &&
          !/not ergonomic|non-ergonomic|avoid ergonomic/.test(valueText) &&
          !(value.kind === "boolean" && !value.value) &&
          !(value.kind === "categorical" && value.operator === "exclude")
        );
      case "reviews":
        return (
          item.strength ===
            (phase === "initial" ? "strong_preference" : "preference") &&
          /review|rating/.test(valueText) &&
          !/poor|bad|low review|ignore review|unimportant|not important|do not matter|don.t matter/.test(
            valueText,
          ) &&
          !(value.kind === "categorical" && value.operator === "exclude")
        );
      case "wireless_battery_condition": {
        const wireless = /wireless|connectivity|connection/.test(
          briefMeaning(item),
        );
        const battery = /battery/.test(briefMeaning(item));
        const positiveWireless =
          !wireless ||
          (value.kind === "boolean"
            ? value.value
            : value.kind === "categorical"
              ? value.operator !== "exclude" &&
                value.values.some((entry) => /wireless/i.test(entry)) &&
                value.values.every((entry) => !/\bwired\b/i.test(entry))
              : /wireless/.test(valueText) &&
                !/\bwired\b|not wireless|avoid wireless/.test(valueText));
        const positiveBattery =
          !battery ||
          (/very good|excellent|long/.test(valueText) &&
            !/not very good|poor|bad|short battery/.test(valueText));
        return (
          (wireless || battery) &&
          positiveWireless &&
          positiveBattery &&
          (item.strength === "preference" ||
            item.strength === "strong_preference")
        );
      }
      case "sculpted_shape":
        return (
          item.strength === "preference" &&
          /sculpt|chunk/.test(valueText) &&
          /thumb|side profile|chunk/.test(valueText) &&
          !/not sculpt|avoid sculpt|prefer flat|flat instead|minimal instead/.test(
            valueText,
          ) &&
          (value.kind !== "categorical" ||
            (value.operator !== "exclude" &&
              value.values.every((entry) => !/flat|minimal/i.test(entry))))
        );
      case "brand_quality":
        return (
          item.strength === "hard" &&
          (value.kind === "categorical"
            ? value.operator === "exclude" &&
              value.values.every((entry) =>
                /amazon basics|bad brand/i.test(entry),
              )
            : (/good brand|reputable/.test(valueText) ||
                /(?:no|exclude|avoid).*(?:amazon basics|bad brand)/.test(
                  valueText,
                )) &&
              !/(?:prefer|allow|includ(?:e|ing)).*amazon basics/.test(
                valueText,
              ) &&
              !/amazon basics.*(?:okay|allowed)|(?:okay|allowed).*amazon basics/.test(
                valueText,
              ))
        );
      case "long_workday_comfort":
        return (
          phase === "refinement" &&
          item.strength === "strong_preference" &&
          /comfort|comfortable/.test(valueText) &&
          /workday|long/.test(valueText) &&
          !/uncomfortable|not comfortable|poor comfort|avoid comfort/.test(
            valueText,
          ) &&
          !(value.kind === "categorical" && value.operator === "exclude")
        );
      case "long_session_comfort":
        return (
          item.strength === "preference" &&
          /comfort|comfortable/.test(valueText) &&
          !/uncomfortable|not comfortable|poor comfort|avoid comfort/.test(
            valueText,
          ) &&
          !(value.kind === "categorical" && value.operator === "exclude")
        );
      case "lower_back_support":
        return (
          item.strength === "strong_preference" &&
          /good|strong/.test(valueText) &&
          /support|lumbar|lower-back/.test(valueText) &&
          !/poor|bad|weak|no support|without support/.test(valueText) &&
          !(value.kind === "categorical" && value.operator === "exclude")
        );
      case "breathable_material":
        return (
          item.strength === "preference" &&
          (value.kind === "categorical"
            ? value.operator === "prefer" &&
              value.values.some((entry) => /mesh/i.test(entry)) &&
              value.values.some((entry) => /fabric/i.test(entry)) &&
              value.values.every((entry) => !/leather/i.test(entry))
            : /mesh/.test(valueText) &&
              /fabric/.test(valueText) &&
              !/not mesh|not fabric|avoid mesh|avoid fabric|prefer.*leather/.test(
                valueText,
              ))
        );
      case "physical_size":
        return (
          item.strength === "preference" &&
          (value.kind === "categorical"
            ? value.operator === "exclude" &&
              value.values.some((entry) => /huge|large/i.test(entry)) &&
              value.values.every((entry) => /huge|large/i.test(entry))
            : /not huge|not large|compact|smaller/.test(valueText) &&
              !/not compact|non-compact|prefer huge|prefer large/.test(
                valueText,
              ))
        );
      case "non_gamer_style":
        return (
          item.strength === "preference" &&
          (value.kind === "categorical"
            ? value.operator === "exclude" &&
              value.values.some((entry) => /gamer/i.test(entry)) &&
              value.values.every((entry) => /gamer/i.test(entry))
            : /not gamer|non-gamer/.test(valueText))
        );
      case "shopper_fit":
        if (value.kind === "measurement") {
          try {
            const millimetres = normalizeMeasurementAmount(
              value.amount,
              value.unit,
              "mm",
            );
            return millimetres === "1778" || millimetres === "1780";
          } catch {
            return false;
          }
        }
        return (
          /5\s*(?:ft|')?\s*10|177\.8\s*cm|178\s*cm/.test(valueText) &&
          !/not 5\s*(?:ft|')?\s*10|not 178\s*cm/.test(valueText)
        );
      case "cordless_subject":
        return (
          item.strength === "preference" &&
          (value.kind === "boolean"
            ? value.value
            : value.kind === "categorical"
              ? value.operator !== "exclude" &&
                value.values.some((entry) =>
                  /cordless|cord-free/i.test(entry),
                ) &&
                value.values.every((entry) => !/\bcorded\b/i.test(entry))
              : /cordless|cord-free/.test(valueText) &&
                !/not cordless|avoid cordless|corded instead/.test(valueText))
        );
      case "floor_coverage":
        return (
          item.strength === "hard" &&
          value.kind === "categorical" &&
          value.operator === "include" &&
          value.values.length === 2 &&
          value.values.some((entry) => /hard floor/i.test(entry)) &&
          value.values.some((entry) => /rug/i.test(entry)) &&
          value.values.every((entry) => /hard floor|rug/i.test(entry))
        );
      case "noise":
        return (
          item.strength ===
            (fixture.name === "cordless-vacuum" ? "hard" : "preference") &&
          (value.kind === "categorical"
            ? value.operator !== "exclude" &&
              value.values.some((entry) => /quiet|low noise/i.test(entry)) &&
              value.values.every((entry) => !/\bloud\b/i.test(entry))
            : /not very loud|not loud|quiet|low noise/.test(valueText) &&
              !/not quiet|avoid quiet|very loud|prefer.*loud|loud is fine/.test(
                valueText,
              ))
        );
      case "weight":
        return (
          item.strength === "preference" &&
          normalizedUpperEquals(item, "g", "3000", false)
        );
      case "runtime":
        return (
          item.strength === "preference" &&
          /40/.test(valueText) &&
          /at least|minimum|useful runtime/.test(valueText) &&
          !/not at least|maximum|up to|under 40|less than 40/.test(valueText) &&
          !(value.kind === "categorical" && value.operator === "exclude")
        );
      case "small_flat_context":
        return (
          /small flat/.test(valueText) &&
          !/not a small flat|large flat|large home/.test(valueText) &&
          !(value.kind === "categorical" && value.operator === "exclude")
        );
      case "compact_kitchen_fit":
        return (
          (item.strength === "hard" || item.strength === "preference") &&
          /compact|small kitchen/.test(valueText) &&
          !/not compact|non-compact|large machine|too large/.test(valueText) &&
          !(value.kind === "categorical" && value.operator === "exclude")
        );
      case "maximum_width":
        return (
          item.strength === "hard" &&
          normalizedUpperEquals(item, "mm", "250", true)
        );
      case "espresso_quality":
        return (
          (item.strength === "strong_preference" ||
            item.strength === "preference") &&
          /good|genuine|high quality/.test(valueText) &&
          /espresso/.test(valueText) &&
          !/poor|bad|low quality|weak|watery/.test(valueText) &&
          !(value.kind === "categorical" && value.operator === "exclude")
        );
      case "cleaning":
        return (
          (item.strength === "strong_preference" ||
            item.strength === "preference") &&
          /easy|simple/.test(valueText) &&
          /clean|maintenance/.test(`${briefMeaning(item)} ${valueText}`) &&
          !/not easy|not simple|difficult|hard to clean/.test(valueText) &&
          !(value.kind === "categorical" && value.operator === "exclude")
        );
      case "milk_frothing":
        return (
          item.strength === "preference" &&
          /milk|froth/.test(valueText) &&
          /useful|not essential|optional|prefer/.test(valueText) &&
          !/not useful|no milk|without milk|must have|required/.test(
            valueText,
          ) &&
          !(value.kind === "categorical" && value.operator === "exclude")
        );
      default:
        return false;
    }
  })();
  if (!valid) fail();
}

const founderIntentCardinality = {
  "ergonomic-mouse": {
    initial: {
      ergonomic_subject: [0, 1],
      budget: [1, 1],
      reviews: [1, 1],
      wireless_battery_condition: [1, 2],
      sculpted_shape: [1, 1],
      brand_quality: [1, 2],
    },
    refinement: {
      ergonomic_subject: [0, 1],
      budget: [1, 1],
      reviews: [1, 1],
      wireless_battery_condition: [1, 2],
      sculpted_shape: [1, 1],
      brand_quality: [1, 2],
      long_workday_comfort: [1, 1],
    },
  },
  "office-chair": {
    initial: {
      budget: [1, 1],
      long_session_comfort: [1, 1],
      lower_back_support: [1, 1],
      breathable_material: [1, 1],
      physical_size: [1, 1],
      non_gamer_style: [1, 1],
      shopper_fit: [0, 1],
    },
    refinement: {},
  },
  "cordless-vacuum": {
    initial: {
      cordless_subject: [1, 1],
      budget: [1, 1],
      floor_coverage: [1, 1],
      noise: [1, 1],
      weight: [1, 1],
      runtime: [1, 1],
      small_flat_context: [0, 1],
    },
    refinement: {},
  },
  "compact-coffee-machine": {
    initial: {
      budget: [1, 1],
      compact_kitchen_fit: [0, 1],
      maximum_width: [1, 1],
      espresso_quality: [1, 1],
      cleaning: [1, 1],
      noise: [1, 1],
      milk_frothing: [1, 1],
    },
    refinement: {},
  },
} as const;

function founderIntentOracleProof(options: {
  fixture: CaseFixture;
  brief: ShoppingBriefV1;
  phase: "initial" | "refinement";
}) {
  const configured = founderIntentCriterionOracle[options.fixture.name];
  const rules =
    options.phase === "refinement" && configured.refinement.length > 0
      ? configured.refinement
      : configured.initial;
  const matched = options.brief.items.map((item) => {
    const meaning = briefMeaning(item);
    const allowedKeys = rules
      .filter((rule) => rule.meaning.test(meaning))
      .map(({ key }) => key);
    assertProof(
      allowedKeys.length === 1,
      `${options.fixture.name} ${options.phase} brief invented an unapproved criterion: ${item.conceptLabel}`,
    );
    const key = allowedKeys[0]!;
    assertFounderCriterionSemantics({ ...options, key, item });
    return {
      criterionId: item.criterionId,
      lineageId: item.lineageId,
      conceptId: item.conceptId,
      conceptLabel: item.conceptLabel,
      founderIntentKey: key,
    };
  });
  const cardinality =
    options.phase === "refinement"
      ? founderIntentCardinality[options.fixture.name].refinement
      : founderIntentCardinality[options.fixture.name].initial;
  for (const [key, range] of Object.entries(cardinality) as Array<
    [string, readonly [number, number]]
  >) {
    const count = matched.filter(
      ({ founderIntentKey }) => founderIntentKey === key,
    ).length;
    const [minimum, maximum] = range;
    assertProof(
      count >= minimum && count <= maximum,
      `${options.fixture.name} ${options.phase} brief has ${count} ${key} criteria; founder oracle permits ${minimum}–${maximum}`,
    );
  }
  if (options.fixture.name === "ergonomic-mouse") {
    const itemsForKey = (key: string) =>
      matched
        .filter(({ founderIntentKey }) => founderIntentKey === key)
        .map(({ criterionId }) =>
          options.brief.items.find((item) => item.criterionId === criterionId),
        )
        .filter((item): item is BriefItem => item !== undefined);
    const wirelessAndBattery = itemsForKey("wireless_battery_condition");
    const wirelessFacetCount = wirelessAndBattery.filter((item) =>
      /wireless|connectivity|connection/.test(
        `${briefMeaning(item)} ${semanticValueText(item)}`,
      ),
    ).length;
    const batteryFacetCount = wirelessAndBattery.filter((item) =>
      /battery/.test(`${briefMeaning(item)} ${semanticValueText(item)}`),
    ).length;
    assertProof(
      wirelessFacetCount === 1 && batteryFacetCount === 1,
      `ergonomic-mouse ${options.phase} brief did not preserve both sides of the conditional wireless + very-good-battery preference`,
    );
    const brandItems = itemsForKey("brand_quality");
    const positiveBrandQualityFacetCount = brandItems.filter((item) =>
      /good brand|reputable/.test(semanticValueText(item)),
    ).length;
    const brandExclusionFacetCount = brandItems.filter((item) => {
      const value = item.semanticValue;
      return value.kind === "categorical"
        ? value.operator === "exclude" &&
            value.values.some((entry) => /amazon basics|bad brand/i.test(entry))
        : /(?:no|exclude|avoid).*(?:amazon basics|bad brand)/.test(
            semanticValueText(item),
          );
    }).length;
    assertProof(
      positiveBrandQualityFacetCount === 1 && brandExclusionFacetCount === 1,
      `ergonomic-mouse ${options.phase} brief did not preserve both reputable-brand and Amazon-Basics/bad-brand exclusion truth`,
    );
  }
  return matched;
}

function semanticItemIdentity(item: ShoppingBriefV1["items"][number]) {
  return {
    criterionId: item.criterionId,
    lineageId: item.lineageId,
    conceptId: item.conceptId,
    conceptLabel: item.conceptLabel,
    conceptDefinition: item.conceptDefinition,
    strength: item.strength,
    targetSemantics: item.targetSemantics,
    semanticValue: item.semanticValue,
  };
}

function assertUnchangedMouseGroup(options: {
  label: string;
  meaning: RegExp;
  initial: readonly ShoppingBriefV1["items"][number][];
  finalBrief: ShoppingBriefV1;
}) {
  assertProof(
    options.initial.length > 0,
    `mouse brief lost its initial ${options.label} criterion group`,
  );
  const before = options.initial
    .map(semanticItemIdentity)
    .sort((left, right) => left.lineageId.localeCompare(right.lineageId));
  const after = options.finalBrief.items
    .filter((item) => options.meaning.test(briefMeaning(item)))
    .map(semanticItemIdentity)
    .sort((left, right) => left.lineageId.localeCompare(right.lineageId));
  assertProof(
    json(before) === json(after),
    `mouse refinement silently changed unrelated ${options.label} semantics`,
  );
  return { label: options.label, before, after };
}

function semanticCaseProof(options: {
  fixture: CaseFixture;
  initialBrief: ShoppingBriefV1;
  finalBrief: ShoppingBriefV1;
}) {
  const { fixture, initialBrief, finalBrief } = options;
  const initialOracle = founderIntentOracleProof({
    fixture,
    brief: initialBrief,
    phase: "initial",
  });
  const finalOracle = founderIntentOracleProof({
    fixture,
    brief: finalBrief,
    phase: fixture.refinement === null ? "initial" : "refinement",
  });
  if (fixture.name === "ergonomic-mouse") {
    const budget = requireMoneyCeiling(initialBrief, 5_000, "mouse £50 budget");
    const initialReviews = requireMeaning(
      initialBrief,
      /review|rating/,
      "mouse review importance",
    );
    const initialProfile = requireMeaning(
      initialBrief,
      /shape|profile|sculpt|thumb|form factor/,
      "mouse sculpted-profile preference",
    );
    const finalReviews = requireMeaning(
      finalBrief,
      /review|rating/,
      "refined mouse review preference",
    );
    const finalComfort = requireMeaning(
      finalBrief,
      /comfort|long workday|long session/,
      "refined mouse comfort priority",
    );
    const initialReviewItems = initialBrief.items.filter((item) =>
      /review|rating/.test(briefMeaning(item)),
    );
    const finalReviewItems = finalBrief.items.filter((item) =>
      /review|rating/.test(briefMeaning(item)),
    );
    const initialComfort = initialBrief.items.filter((item) =>
      /comfort|long workday|long session|extended use/.test(briefMeaning(item)),
    );
    const finalComfortItems = finalBrief.items.filter((item) =>
      /comfort|long workday|long session|extended use/.test(briefMeaning(item)),
    );
    assertProof(
      initialReviewItems.length === 1 && finalReviewItems.length === 1,
      "mouse review change-of-mind did not preserve exactly one review criterion",
    );
    assertProof(
      initialComfort.length === 0 && finalComfortItems.length === 1,
      "mouse comfort change-of-mind was present before the founder stated it or was not added exactly once afterward",
    );
    assertProof(
      initialReviews.strength === "strong_preference" &&
        finalReviews.strength === "preference",
      "mouse review importance was over- or under-stated before/after refinement",
    );
    assertProof(
      finalComfort.strength === "strong_preference" &&
        strengthRank[finalComfort.strength] >
          strengthRank[finalReviews.strength],
      "mouse refinement did not make long-workday comfort a strong priority above reviews",
    );
    assertProof(
      initialProfile.strength === "preference",
      "mouse shape preference was over- or under-stated",
    );
    assertProof(
      initialReviews.lineageId === finalReviews.lineageId &&
        initialReviews.conceptId === finalReviews.conceptId &&
        initialReviews.criterionId !== finalReviews.criterionId &&
        initialReviews.targetSemantics === finalReviews.targetSemantics &&
        json(initialReviews.semanticValue) === json(finalReviews.semanticValue),
      "mouse review change-of-mind did not preserve semantic lineage/value while changing only criterion strength",
    );
    const unchangedUnrelatedCriteria = [
      {
        label: "budget",
        meaning: /budget|price|cost|spend/,
        initial: [budget],
      },
      {
        label: "shape",
        meaning: /shape|profile|sculpt|thumb|form factor|chunk/,
        initial: initialBrief.items.filter((item) =>
          /shape|profile|sculpt|thumb|form factor|chunk/.test(
            briefMeaning(item),
          ),
        ),
      },
      {
        label: "wireless and battery condition",
        meaning: /wireless|connectivity|connection|battery/,
        initial: initialBrief.items.filter((item) =>
          /wireless|connectivity|connection|battery/.test(briefMeaning(item)),
        ),
      },
      {
        label: "brand quality",
        meaning: /brand|manufacturer|amazon basics|reputable/,
        initial: initialBrief.items.filter((item) =>
          /brand|manufacturer|amazon basics|reputable/.test(briefMeaning(item)),
        ),
      },
    ].map((group) =>
      assertUnchangedMouseGroup({
        ...group,
        finalBrief,
      }),
    );
    return {
      initialOracle,
      finalOracle,
      budget,
      initialReviews,
      finalReviews,
      finalComfort,
      sculptedProfile: initialProfile,
      unchangedUnrelatedCriteria,
      changeOfMindProtected: true as const,
    };
  }

  if (fixture.name === "office-chair") {
    const budget = initialBrief.items.find(
      ({ semanticValue }) =>
        semanticValue.kind === "money_stretch" &&
        semanticValue.currency === "GBP" &&
        semanticValue.targetMinor === 25_000 &&
        semanticValue.stretchCeilingMinor === 35_000,
    );
    assertProof(
      budget !== undefined,
      "chair brief lost the £250 target / £350 conditional stretch boundary",
    );
    const lumbar = requireMeaning(
      initialBrief,
      /lower.?back|lumbar/,
      "chair lower-back support priority",
    );
    const material = requireMeaning(
      initialBrief,
      /mesh|fabric|material|breathab/,
      "chair breathable material preference",
    );
    assertProof(
      lumbar.strength === "strong_preference" &&
        material.strength === "preference",
      "chair lower-back/material preferences were over- or under-stated",
    );
    return { initialOracle, finalOracle, budget, lumbar, material };
  }

  if (fixture.name === "cordless-vacuum") {
    const budget = requireMoneyCeiling(
      initialBrief,
      25_000,
      "vacuum £250 budget",
    );
    const floors = requireMeaning(
      initialBrief,
      /floor|rug|surface/,
      "vacuum hard-floor and rug requirement",
    );
    const noise = requireMeaning(
      initialBrief,
      /noise|quiet|loud|sound/,
      "vacuum noise requirement",
    );
    const weight = requireMeaning(
      initialBrief,
      /weight|heavy|light/,
      "vacuum under-3kg preference",
    );
    const runtime = requireMeaning(
      initialBrief,
      /runtime|battery|run time/,
      "vacuum runtime preference",
    );
    assertProof(
      floors.strength === "hard" && noise.strength === "hard",
      "vacuum must-haves were weakened",
    );
    assertProof(
      weight.strength === "preference" &&
        weight.semanticValue.kind === "measurement_range" &&
        weight.semanticValue.lower === undefined &&
        weight.semanticValue.upper !== undefined &&
        !weight.semanticValue.upper.inclusive &&
        normalizeMeasurementAmount(
          weight.semanticValue.upper.amount,
          weight.semanticValue.unit,
          "g",
        ) === "3000",
      "vacuum under-3kg preference was over-stated or changed",
    );
    assertProof(
      runtime.strength === "preference" &&
        JSON.stringify(runtime.semanticValue).includes("40"),
      "vacuum 40-minute runtime preference was over-stated or changed",
    );
    return {
      initialOracle,
      finalOracle,
      budget,
      floors,
      noise,
      weight,
      runtime,
    };
  }

  const budget = requireMoneyCeiling(
    initialBrief,
    35_000,
    "coffee-machine £350 budget",
  );
  const width = requireMeaning(
    initialBrief,
    /width|wide/,
    "coffee-machine maximum width",
  );
  assertProof(
    width.strength === "hard" &&
      width.semanticValue.kind === "measurement_range" &&
      width.semanticValue.lower === undefined &&
      width.semanticValue.upper !== undefined &&
      width.semanticValue.upper.inclusive &&
      normalizeMeasurementAmount(
        width.semanticValue.upper.amount,
        width.semanticValue.unit,
        "mm",
      ) === "250",
    "coffee-machine width is not an inclusive hard maximum of 25cm",
  );
  const espresso = requireMeaning(
    initialBrief,
    /espresso|coffee quality|taste/,
    "coffee-machine espresso quality",
  );
  const cleaning = requireMeaning(
    initialBrief,
    /clean|maintenance/,
    "coffee-machine cleaning requirement",
  );
  const noise = requireMeaning(
    initialBrief,
    /noise|quiet|loud|sound/,
    "coffee-machine noise preference",
  );
  const milk = requireMeaning(
    initialBrief,
    /milk|froth/,
    "coffee-machine optional milk frothing",
  );
  assertProof(
    noise.strength === "preference" && milk.strength === "preference",
    "coffee-machine optional preferences were silently promoted",
  );
  return {
    initialOracle,
    finalOracle,
    budget,
    width,
    espresso,
    cleaning,
    noise,
    milk,
  };
}

function decisionSnapshot(view: LiveShoppingView) {
  const support = view.decisionSupport;
  return {
    researchStatus: support?.researchStatus ?? null,
    deepResearchStatus: support?.deepResearchStatus ?? null,
    decisionGaps: support?.decisionGaps ?? [],
    topOptions:
      support?.topOptions.map((option) => ({
        candidateListingId: option.listing.candidateListingId,
        title: option.listing.title,
        merchant: option.listing.merchant,
        price: option.listing.priceText,
        readiness: option.readiness,
        researchState: option.researchState,
        unresolvedMustHaves: option.unresolvedMustHaves,
        unknowns: option.unknowns,
        evidenceSources: option.evidenceSources.map((source) => ({
          ...source,
          url: sanitizeUrl(source.url),
        })),
        purchase: {
          state: option.listing.purchaseState,
          label: option.listing.destinationLabel,
          destinationUrl: sanitizeUrl(option.listing.destinationUrl),
          googleShoppingSourceUrl: sanitizeUrl(option.listing.sourceUrl),
        },
      })) ?? [],
    comparison:
      support?.comparison === null || support?.comparison === undefined
        ? null
        : {
            candidates: support.comparison.candidates.map((listing) => ({
              candidateListingId: listing.candidateListingId,
              title: listing.title,
              merchant: listing.merchant,
              priceText: listing.priceText,
              purchaseState: listing.purchaseState,
              destinationLabel: listing.destinationLabel,
              destinationUrl: sanitizeUrl(listing.destinationUrl),
            })),
            researchStates: support.comparison.researchStates,
            purchaseSummaries: support.comparison.purchaseSummaries,
            rows: support.comparison.rows.map((row) => ({
              ...row,
              cells: row.cells.map((cell) => ({
                ...cell,
                sources: cell.sources.map((source) => ({
                  ...source,
                  url: sanitizeUrl(source.url),
                })),
              })),
            })),
            judgement: support.comparison.judgement,
            decisionGaps: support.comparison.decisionGaps,
          },
  };
}

function chooseGap(view: LiveShoppingView) {
  const support = view.decisionSupport;
  assertProof(support !== null, "targeted research needs decision support");
  const available = new Set(
    support.topOptions
      .filter(({ researchState }) => researchState !== "researching")
      .map(({ listing }) => listing.candidateListingId),
  );
  for (const gap of support.decisionGaps) {
    const candidateListingId = gap.candidateListingIds.find((id) =>
      available.has(id),
    );
    if (candidateListingId !== undefined) {
      const option = support.topOptions.find(
        ({ listing }) => listing.candidateListingId === candidateListingId,
      );
      if (option !== undefined) {
        return {
          candidateListingId,
          candidateTitle: option.listing.title,
          criterionId: gap.criterionId,
          criterionLabel: gap.label,
        };
      }
    }
  }
  return null;
}

function changedCurrentAssessments(
  before: PersistenceSnapshot,
  after: PersistenceSnapshot,
) {
  const beforeByPair = new Map(
    before.currentAssessments.map((assessment) => [
      `${assessment.candidateListingId}:${assessment.criterionId}`,
      assessment,
    ]),
  );
  return after.currentAssessments.filter((assessment) => {
    const previous = beforeByPair.get(
      `${assessment.candidateListingId}:${assessment.criterionId}`,
    );
    return previous?.id !== assessment.id;
  });
}

function targetedScopeProof(options: {
  before: PersistenceSnapshot;
  after: PersistenceSnapshot;
  target: NonNullable<ReturnType<typeof chooseGap>>;
  view: LiveShoppingView;
}) {
  const beforeRunIds = new Set(options.before.researchRuns.map(({ id }) => id));
  const beforeAttemptIds = new Set(options.before.attempts.map(({ id }) => id));
  const newRuns = options.after.researchRuns.filter(
    ({ id }) => !beforeRunIds.has(id),
  );
  const newAttempts = options.after.attempts.filter(
    ({ id }) => !beforeAttemptIds.has(id),
  );
  assertProof(
    newRuns.length === 1,
    "targeted operation did not create one run",
  );
  assertProof(
    newAttempts.length > 0 &&
      newAttempts.every(
        (attempt) =>
          attempt.candidateListingId === options.target.candidateListingId &&
          attempt.targetCriterionIds.length === 1 &&
          attempt.targetCriterionIds[0] === options.target.criterionId,
      ),
    "targeted operation planned work outside its exact candidate + criterion",
  );
  const changes = changedCurrentAssessments(options.before, options.after);
  assertProof(
    changes.length <= 1 &&
      changes.every(
        (assessment) =>
          assessment.candidateListingId === options.target.candidateListingId &&
          assessment.criterionId === options.target.criterionId,
      ),
    "targeted operation changed an assessment outside its exact candidate + criterion",
  );

  const afterAssessment = options.after.currentAssessments.find(
    (assessment) =>
      assessment.candidateListingId === options.target.candidateListingId &&
      assessment.criterionId === options.target.criterionId,
  );
  const bindings = options.after.assessmentObservationBindings.filter(
    ({ assessmentId }) => assessmentId === afterAssessment?.id,
  );
  const observationIds = new Set(
    bindings.map(({ observationId }) => observationId),
  );
  const sourceIds = new Set(
    options.after.observations
      .filter(({ id }) => observationIds.has(id))
      .map(({ evidenceSourceId }) => evidenceSourceId),
  );
  const fetchedSources = options.after.evidenceSources.filter(
    ({ id, sourceKind }) => sourceIds.has(id) && sourceKind === "fetched_page",
  );
  const supportedFetchedPageLineages = bindings.flatMap((binding) => {
    if (
      afterAssessment === undefined ||
      binding.candidateRunId !== afterAssessment.candidateRunId ||
      binding.candidateListingId !== afterAssessment.candidateListingId
    ) {
      return [];
    }
    const observation = options.after.observations.find(
      ({ id }) => id === binding.observationId,
    );
    const source = options.after.evidenceSources.find(
      ({ id }) => id === observation?.evidenceSourceId,
    );
    const document = options.after.fetchedDocuments.find(
      ({ evidenceSourceId, candidateRunId, candidateListingId }) =>
        evidenceSourceId === source?.id &&
        candidateRunId === afterAssessment.candidateRunId &&
        candidateListingId === afterAssessment.candidateListingId,
    );
    return observation?.support === "supported" &&
      observation.candidateRunId === afterAssessment.candidateRunId &&
      observation.candidateListingId === afterAssessment.candidateListingId &&
      source?.sourceKind === "fetched_page" &&
      source.candidateRunId === afterAssessment.candidateRunId &&
      source.candidateListingId === afterAssessment.candidateListingId &&
      document !== undefined
      ? [
          {
            assessmentId: afterAssessment.id,
            observationId: observation.id,
            fetchedSourceId: source.id,
            fetchedDocumentId: document.id,
          },
        ]
      : [];
  });
  const resolvedByFetchedPage =
    changes.length === 1 &&
    afterAssessment !== undefined &&
    changes[0]?.id === afterAssessment.id &&
    (afterAssessment.status === "meets" ||
      afterAssessment.status === "conflicts") &&
    supportedFetchedPageLineages.length > 0;
  const targetPageAttemptIds = new Set(
    newAttempts
      .filter(
        ({ stage, candidateListingId, targetCriterionIds }) =>
          stage === "page_fetch" &&
          candidateListingId === options.target.candidateListingId &&
          targetCriterionIds.includes(options.target.criterionId),
      )
      .map(({ id }) => id),
  );
  const targetAdmittedDocument = options.after.fetchedDocuments.find(
    ({ attemptId }) => targetPageAttemptIds.has(attemptId),
  );
  const projectedUnknown = options.view.decisionSupport?.topOptions
    .find(
      ({ listing }) =>
        listing.candidateListingId === options.target.candidateListingId,
    )
    ?.unknowns.find(
      ({ criterionId, reason }) =>
        criterionId === options.target.criterionId &&
        reason === "checked_no_answer",
    );
  const pageTargetedUsefulUnknown =
    targetAdmittedDocument !== undefined && projectedUnknown !== undefined;
  return {
    attempted: true as const,
    scopeAdvanced: changes.length === 1,
    target: options.target,
    newRuns,
    newAttempts,
    currentAssessmentChanges: changes,
    afterAssessment: afterAssessment ?? null,
    fetchedSources,
    supportedFetchedPageLineages,
    resolvedByFetchedPage,
    pageTargetedUsefulUnknown,
    checkedNoAnswer:
      projectedUnknown === undefined
        ? null
        : {
            ...projectedUnknown,
            fetchedEvidenceDocumentId: targetAdmittedDocument?.id ?? null,
          },
  };
}

function boundedWorkProof(persistence: PersistenceSnapshot) {
  const runs = persistence.researchRuns.map((run) => {
    const attempts = persistence.attempts.filter(
      ({ researchRunId }) => researchRunId === run.id,
    );
    const searches = attempts.filter(({ stage }) => stage === "organic_search");
    const pages = attempts.filter(({ stage }) => stage === "page_fetch");
    const pagesByCandidate = new Map<string, number>();
    for (const page of pages) {
      pagesByCandidate.set(
        page.candidateListingId,
        (pagesByCandidate.get(page.candidateListingId) ?? 0) + 1,
      );
    }
    const candidateLimit = run.phase === "first_pass" ? 4 : 3;
    assertProof(
      run.selectedCandidateCount <= candidateLimit,
      `${run.phase} run exceeded its candidate bound`,
    );
    assertProof(
      searches.length === run.plannedSearchCount &&
        searches.length === run.selectedCandidateCount &&
        new Set(searches.map(({ candidateListingId }) => candidateListingId))
          .size === searches.length,
      `${run.phase} run search attempts disagree with the persisted plan`,
    );
    assertProof(
      [...pagesByCandidate.values()].every((count) => count <= 2),
      `${run.phase} run exceeded two page fetches for one candidate`,
    );
    if (run.phase === "deepening") {
      assertProof(
        searches.every(
          ({ targetCriterionIds }) =>
            targetCriterionIds.length >= 1 && targetCriterionIds.length <= 2,
        ),
        "deep research exceeded its one-or-two criterion scope",
      );
    }
    return {
      ...run,
      evidenceSearchCount: searches.length,
      pageFetchCount: pages.length,
      maximumPageFetchesPerCandidate: Math.max(0, ...pagesByCandidate.values()),
    };
  });
  return {
    firstPass: runs.filter(({ phase }) => phase === "first_pass"),
    deepening: runs.filter(({ phase }) => phase === "deepening"),
  };
}

function terminalPersistenceProof(persistence: PersistenceSnapshot) {
  assertProof(
    persistence.contextAcquisitionAttempts.length > 0 &&
      persistence.contextAcquisitionAttempts.every(
        ({ provider, model }) =>
          provider === null ||
          (provider === "openai" && model === releaseModel),
      ) &&
      ["interpretation", "context_action"].every((stage) =>
        persistence.contextAcquisitionAttempts.some(
          ({ stage: candidateStage, status }) =>
            candidateStage === stage && status === "completed",
        ),
      ),
    "context acquisition lacks completed Terra interpretation/action evidence or contains another model",
  );
  assertProof(
    persistence.searchRuns.length > 0 &&
      persistence.searchRuns.every(
        ({ status, finishedAt }) =>
          status !== "running" && finishedAt instanceof Date,
      ),
    "a synchronous search run is absent or non-terminal",
  );
  assertProof(
    persistence.queryExecutions.length > 0 &&
      persistence.queryExecutions.every(
        ({ status, startedAt, finishedAt }) =>
          ["succeeded", "failed"].includes(status) &&
          startedAt instanceof Date &&
          finishedAt instanceof Date,
      ),
    "a query execution is absent or non-terminal",
  );
  const usableQueryExecutions = persistence.queryExecutions.filter(
    ({ status, receivedResultCount, rejectedResultCount }) =>
      status === "succeeded" &&
      receivedResultCount !== null &&
      rejectedResultCount !== null &&
      receivedResultCount > rejectedResultCount,
  );
  assertProof(
    usableQueryExecutions.length > 0 && persistence.listings.length > 0,
    "the category has no successful query with an admitted candidate listing",
  );
  assertProof(
    persistence.researchRuns.length > 0 &&
      persistence.researchRuns.every(
        ({ status, finishedAt }) =>
          status !== "running" && finishedAt instanceof Date,
      ),
    "a synchronous evidence research run is absent or non-terminal",
  );
  assertProof(
    persistence.attempts.length > 0 &&
      persistence.attempts.every(
        ({ stage, status, startedAt, finishedAt, model }) =>
          status !== "planned" &&
          startedAt instanceof Date &&
          finishedAt instanceof Date &&
          (!["observation_extraction", "criterion_assessment"].includes(
            stage,
          ) ||
            model === releaseModel),
      ),
    "an evidence acquisition attempt is absent, non-terminal, or records a non-Terra understanding model",
  );
  assertProof(
    persistence.destinationResolutions.every(
      ({ status, startedAt, finishedAt }) =>
        status !== "running" &&
        startedAt instanceof Date &&
        finishedAt instanceof Date,
    ),
    "a synchronous destination resolution remained running",
  );
  return {
    terminalContextAcquisitionAttemptCount:
      persistence.contextAcquisitionAttempts.length,
    terminalSearchRunCount: persistence.searchRuns.length,
    terminalQueryExecutionCount: persistence.queryExecutions.length,
    usableQueryExecutionCount: usableQueryExecutions.length,
    admittedListingCount: persistence.listings.length,
    terminalResearchRunCount: persistence.researchRuns.length,
    terminalEvidenceAttemptCount: persistence.attempts.length,
    terminalDestinationResolutionCount:
      persistence.destinationResolutions.length,
  };
}

function sourceDepthProof(
  persistence: PersistenceSnapshot,
  view: LiveShoppingView,
) {
  const pageAttempts = persistence.attempts.filter(
    ({ stage }) => stage === "page_fetch",
  );
  assertProof(
    persistence.pageTargets.length === pageAttempts.length,
    "page-fetch attempts and exact discovered-source targets disagree",
  );
  const currentLineages: Array<Record<string, unknown>> = [];
  for (const document of persistence.fetchedDocuments) {
    const attempt = pageAttempts.find(({ id }) => id === document.attemptId);
    const target = persistence.pageTargets.find(
      ({ attemptId }) => attemptId === document.attemptId,
    );
    const discoveredSource = persistence.evidenceSources.find(
      ({ id }) => id === document.discoveredSourceId,
    );
    const fetchedSource = persistence.evidenceSources.find(
      ({ id }) => id === document.evidenceSourceId,
    );
    assertProof(
      attempt !== undefined &&
        attempt.status === "succeeded" &&
        attempt.researchRunId === document.researchRunId &&
        attempt.candidateRunId === document.candidateRunId &&
        attempt.candidateListingId === document.candidateListingId,
      "an admitted document does not exactly match its succeeded page attempt",
    );
    assertProof(
      target !== undefined &&
        target.researchRunId === document.researchRunId &&
        target.candidateRunId === document.candidateRunId &&
        target.candidateListingId === document.candidateListingId &&
        target.discoveredSourceId === document.discoveredSourceId &&
        target.discoveredSourceKind === "organic_result" &&
        target.requestedUrl === document.requestedUrl,
      "an admitted document does not exactly match its immutable page target",
    );
    assertProof(
      discoveredSource !== undefined &&
        discoveredSource.sourceKind === "organic_result" &&
        discoveredSource.researchRunId === document.researchRunId &&
        discoveredSource.candidateRunId === document.candidateRunId &&
        discoveredSource.candidateListingId === document.candidateListingId &&
        discoveredSource.sourceUrl === document.requestedUrl,
      "an admitted document does not exactly match its discovered source",
    );
    assertProof(
      fetchedSource !== undefined &&
        fetchedSource.sourceKind === "fetched_page" &&
        fetchedSource.acquisitionAttemptId === document.attemptId &&
        fetchedSource.researchRunId === document.researchRunId &&
        fetchedSource.candidateRunId === document.candidateRunId &&
        fetchedSource.candidateListingId === document.candidateListingId,
      "an admitted document does not exactly match its fetched-page source",
    );

    const documentObservations = persistence.observations.filter(
      (observation) =>
        observation.evidenceSourceId === document.evidenceSourceId &&
        observation.researchRunId === document.researchRunId &&
        observation.candidateRunId === document.candidateRunId &&
        observation.candidateListingId === document.candidateListingId,
    );
    for (const observation of documentObservations) {
      const assessmentIds = persistence.assessmentObservationBindings
        .filter(
          (binding) =>
            binding.observationId === observation.id &&
            binding.candidateRunId === observation.candidateRunId &&
            binding.candidateListingId === observation.candidateListingId,
        )
        .map(({ assessmentId }) => assessmentId);
      for (const assessment of persistence.currentAssessments.filter(
        (candidate) =>
          assessmentIds.includes(candidate.id) &&
          candidate.candidateRunId === observation.candidateRunId &&
          candidate.candidateListingId === observation.candidateListingId,
      )) {
        currentLineages.push({
          documentId: document.id,
          pageAttemptId: attempt.id,
          researchRunId: document.researchRunId,
          candidateRunId: document.candidateRunId,
          candidateListingId: document.candidateListingId,
          discoveredSourceId: document.discoveredSourceId,
          fetchedSourceId: document.evidenceSourceId,
          fetchedSourceRole: fetchedSource.sourceRole,
          observationId: observation.id,
          observationSupport: observation.support,
          currentAssessmentId: assessment.id,
          currentAssessmentResearchRunId: assessment.researchRunId,
          currentAssessmentStatus: assessment.status,
          criterionId: assessment.criterionId,
        });
      }
    }
  }
  const fetchedRoles = [
    ...new Set(
      persistence.evidenceSources
        .filter(({ sourceKind }) => sourceKind === "fetched_page")
        .map(({ sourceRole }) => sourceRole),
    ),
  ].sort();
  const usableCurrentLineages = currentLineages.filter(
    (lineage) =>
      lineage.observationSupport === "supported" &&
      (lineage.currentAssessmentStatus === "meets" ||
        lineage.currentAssessmentStatus === "conflicts"),
  );
  const visibleCandidateIds = new Set<string>(
    view.decisionSupport?.topOptions.map(
      ({ listing }) => listing.candidateListingId,
    ) ?? [],
  );
  const usableCategorySupport = persistence.currentAssessments.flatMap(
    (assessment) => {
      if (
        !visibleCandidateIds.has(assessment.candidateListingId) ||
        (assessment.status !== "meets" && assessment.status !== "conflicts")
      ) {
        return [];
      }
      const supportedBindings =
        persistence.assessmentObservationBindings.flatMap((binding) => {
          if (
            binding.assessmentId !== assessment.id ||
            binding.candidateRunId !== assessment.candidateRunId ||
            binding.candidateListingId !== assessment.candidateListingId
          ) {
            return [];
          }
          const observation = persistence.observations.find(
            ({ id }) => id === binding.observationId,
          );
          const source = persistence.evidenceSources.find(
            ({ id }) => id === observation?.evidenceSourceId,
          );
          return observation?.support === "supported" &&
            observation.candidateRunId === assessment.candidateRunId &&
            observation.candidateListingId === assessment.candidateListingId &&
            source?.candidateRunId === assessment.candidateRunId &&
            source.candidateListingId === assessment.candidateListingId
            ? [
                {
                  observationId: observation.id,
                  sourceId: source.id,
                  sourceKind: source.sourceKind,
                  sourceRole: source.sourceRole,
                },
              ]
            : [];
        });
      return supportedBindings.length === 0
        ? []
        : [
            {
              assessmentId: assessment.id,
              candidateListingId: assessment.candidateListingId,
              criterionId: assessment.criterionId,
              status: assessment.status,
              supportedBindings,
            },
          ];
    },
  );
  assertProof(
    usableCategorySupport.length > 0,
    "the category has no visible current assessment with usable evidence-backed support",
  );
  const projectedFetchedPageLinks =
    view.decisionSupport?.topOptions.flatMap((option) =>
      option.evidenceSources.flatMap((projectedSource) => {
        if (projectedSource.depth !== "fetched_page") return [];
        const sourceUrl = sanitizeUrl(projectedSource.url);
        const persistedSource = persistence.evidenceSources.find(
          (source) =>
            source.candidateListingId === option.listing.candidateListingId &&
            source.sourceKind === "fetched_page" &&
            source.sourceUrl === sourceUrl,
        );
        const admittedDocument = persistence.fetchedDocuments.find(
          (document) =>
            document.candidateListingId === option.listing.candidateListingId &&
            document.evidenceSourceId === persistedSource?.id,
        );
        assertProof(
          persistedSource !== undefined && admittedDocument !== undefined,
          `visible fetched-page source for ${option.listing.title} is not the exact persisted admitted evidence for that candidate and URL`,
        );
        return [
          {
            candidateListingId: option.listing.candidateListingId,
            projectedTitle: projectedSource.title,
            projectedUrl: sourceUrl,
            persistedSourceId: persistedSource.id,
            admittedDocumentId: admittedDocument.id,
          },
        ];
      }),
    ) ?? [];
  const postPageUsefulUnknowns =
    view.decisionSupport?.topOptions.flatMap((option) =>
      option.unknowns.flatMap((unknown) => {
        if (
          ![
            "checked_no_answer",
            "check_failed",
            "source_disagreement",
          ].includes(unknown.reason)
        ) {
          return [];
        }
        const matchingAttempts = pageAttempts.filter(
          ({ candidateListingId, targetCriterionIds }) =>
            candidateListingId === option.listing.candidateListingId &&
            targetCriterionIds.includes(unknown.criterionId),
        );
        const hasHonestPageOutcome = matchingAttempts.some((attempt) =>
          attempt.status === "failed"
            ? unknown.reason === "check_failed"
            : persistence.fetchedDocuments.some(
                ({ attemptId }) => attemptId === attempt.id,
              ),
        );
        return hasHonestPageOutcome
          ? [
              {
                candidateListingId: option.listing.candidateListingId,
                criterionId: unknown.criterionId,
                label: unknown.label,
                reason: unknown.reason,
                explanation: unknown.explanation,
                pageAttemptIds: matchingAttempts.map(({ id }) => id),
              },
            ]
          : [];
      }),
    ) ?? [];
  return {
    plannedPageCount: persistence.pageTargets.length,
    admittedDocumentCount: persistence.fetchedDocuments.length,
    rejectedOrFailedPages: pageAttempts
      .filter(({ status }) => status === "failed")
      .map(({ id, candidateListingId, failureCode }) => {
        const target = persistence.pageTargets.find(
          ({ attemptId }) => attemptId === id,
        );
        const discovered = persistence.evidenceSources.find(
          ({ id: sourceId }) => sourceId === target?.discoveredSourceId,
        );
        return {
          attemptId: id,
          candidateListingId,
          requestedUrl: target?.requestedUrl ?? null,
          discoveredRole: discovered?.sourceRole ?? null,
          discoveredTitle: discovered?.sourceTitle ?? null,
          failureCode,
        };
      }),
    sourceRoles: fetchedRoles,
    sourceScarcity: {
      missingExpectedFetchedRoles: (
        ["manufacturer", "retailer"] as const
      ).filter((role) => !fetchedRoles.includes(role)),
      categoryAlreadyComplete:
        (view.decisionSupport?.decisionGaps.length ?? 0) === 0,
    },
    fetchedDocuments: persistence.fetchedDocuments,
    currentAssessmentLineages: currentLineages,
    usableCurrentAssessmentLineages: usableCurrentLineages,
    usableCategorySupport,
    projectedFetchedPageLinks,
    postPageUsefulUnknowns,
    reachesCurrentAssessment: usableCurrentLineages.length > 0,
  };
}

function honestyProof(
  view: LiveShoppingView,
  persistence: PersistenceSnapshot,
) {
  const support = view.decisionSupport;
  assertProof(support !== null, "decision support disappeared");
  const hardIds = new Set<string>(
    persistence.brief.items
      .filter(({ strength }) => strength === "hard")
      .map(({ criterionId }) => criterionId),
  );
  const visibleIds = new Set<string>(
    support.topOptions.map(({ listing }) => listing.candidateListingId),
  );
  const hardConflicts = persistence.currentAssessments.filter(
    ({ candidateListingId, criterionId, status }) =>
      visibleIds.has(candidateListingId) &&
      hardIds.has(criterionId) &&
      status === "conflicts",
  );
  assertProof(
    hardConflicts.length === 0,
    "a visible top option has a persisted hard-criterion conflict",
  );
  const unknowns = support.topOptions.flatMap((option) =>
    option.unknowns.map((unknown) => ({
      candidateListingId: option.listing.candidateListingId,
      ...unknown,
    })),
  );
  assertProof(
    unknowns.every(
      ({ reason, explanation }) =>
        [
          "not_checked",
          "checked_no_answer",
          "source_disagreement",
          "check_failed",
          "personal_fit",
        ].includes(reason) && explanation.trim().length > 0,
    ),
    "an unknown lacks an attributable reason and useful explanation",
  );
  return { hardConflicts, unknowns };
}

function purchaseProof(options: {
  preView: LiveShoppingView;
  postView: LiveShoppingView;
  prePersistence: PersistenceSnapshot;
  postPersistence: PersistenceSnapshot;
  destinationTraces: readonly ExternalTrace[];
}) {
  const top = options.postView.decisionSupport?.topOptions ?? [];
  const preTop = options.preView.decisionSupport?.topOptions ?? [];
  const preTopIds = preTop.map(({ listing }) => listing.candidateListingId);
  const postTopIds = top.map(({ listing }) => listing.candidateListingId);
  const purchaseEvidenceRow = (
    listing: (typeof preTop)[number]["listing"],
  ) => ({
    candidateListingId: listing.candidateListingId,
    title: listing.title,
    merchant: listing.merchant,
    priceText: listing.priceText,
    purchaseState: listing.purchaseState,
    destinationLabel: listing.destinationLabel,
    destinationUrl: sanitizeUrl(listing.destinationUrl),
    googleShoppingSourceUrl: sanitizeUrl(listing.sourceUrl),
  });
  const preTopRows = preTop.map(({ listing }) => purchaseEvidenceRow(listing));
  const postTopRows = top.map(({ listing }) => purchaseEvidenceRow(listing));
  const preSavedRows =
    options.preView.decisionSupport?.comparison?.candidates.map(
      purchaseEvidenceRow,
    ) ?? [];
  const postSavedRows =
    options.postView.decisionSupport?.comparison?.candidates.map(
      purchaseEvidenceRow,
    ) ?? [];
  assertProof(
    JSON.stringify(preTopIds) === JSON.stringify(postTopIds),
    "destination lookup changed the ordered shortlist",
  );
  const savedIds = new Set(
    options.prePersistence.savedCandidateListingIds.map(
      ({ candidateListingId }) => candidateListingId,
    ),
  );
  assertProof(
    preTopIds.slice(0, 2).every((id) => savedIds.has(id)),
    "pre-destination evidence does not contain the two exact saved top offers",
  );
  const persistedPostSavedIds = new Set(
    options.postPersistence.savedCandidateListingIds.map(
      ({ candidateListingId }) => candidateListingId,
    ),
  );
  assertProof(
    preSavedRows.length === savedIds.size &&
      postSavedRows.length === persistedPostSavedIds.size &&
      preSavedRows.every(({ candidateListingId }) =>
        savedIds.has(candidateListingId),
      ) &&
      postSavedRows.every(({ candidateListingId }) =>
        persistedPostSavedIds.has(candidateListingId),
      ) &&
      preSavedRows.every(({ candidateListingId }) =>
        postSavedRows.some(
          (row) => row.candidateListingId === candidateListingId,
        ),
      ),
    "pre/post saved purchase rows do not exactly match durable saved offers",
  );
  assertProof(
    [...preTopRows, ...preSavedRows, ...postTopRows, ...postSavedRows].every(
      ({ purchaseState }) =>
        purchaseState === "direct" || purchaseState === "fallback",
    ),
    "pre/post top or saved purchase evidence contains a non-terminal state",
  );
  const stateCounts = (
    evidenceRows: readonly ReturnType<typeof purchaseEvidenceRow>[],
  ) => ({
    direct: evidenceRows.filter(
      ({ purchaseState }) => purchaseState === "direct",
    ).length,
    fallback: evidenceRows.filter(
      ({ purchaseState }) => purchaseState === "fallback",
    ).length,
  });
  const uniqueQueueRows = (
    evidenceRows: readonly ReturnType<typeof purchaseEvidenceRow>[],
  ) => [
    ...new Map(
      evidenceRows.map((row) => [row.candidateListingId, row] as const),
    ).values(),
  ];
  const preQueueStateCounts = stateCounts(
    uniqueQueueRows([...preTopRows, ...preSavedRows]),
  );
  const postQueueStateCounts = stateCounts(
    uniqueQueueRows([...postTopRows, ...postSavedRows]),
  );
  const preResolutionIds = new Set(
    options.prePersistence.destinationResolutions.map(({ id }) => id),
  );
  const newResolutions = options.postPersistence.destinationResolutions.filter(
    ({ id }) => !preResolutionIds.has(id),
  );
  assertProof(
    newResolutions.every(({ status }) => status !== "running"),
    "post-destination evidence contains an unterminated new resolution",
  );
  for (const resolution of newResolutions) {
    if (resolution.status === "resolved") {
      assertProof(
        resolution.destinationUrl !== null &&
          resolution.acceptedResultTitle !== null &&
          resolution.acceptedResultTitle.trim().length > 0 &&
          resolution.consideredResultCount !== null &&
          resolution.consideredResultCount > 0,
        "a resolved retailer destination lacks its accepted title, URL, or considered-result evidence",
      );
    } else {
      assertProof(
        resolution.destinationUrl === null &&
          resolution.acceptedResultTitle === null &&
          resolution.observedResultUrl === null &&
          resolution.outcomeCode !== null,
        "a rejected/failed retailer lookup lacks an attributable terminal outcome",
      );
    }
  }

  const rows = top.map(({ listing }) => {
    const direct = listing.purchaseState === "direct";
    const fallback = listing.purchaseState === "fallback";
    const persistedListing = options.postPersistence.listings.find(
      ({ id }) => id === listing.candidateListingId,
    );
    const acceptedResolution =
      options.postPersistence.destinationResolutions.find(
        ({ candidateListingId, status, destinationUrl }) =>
          candidateListingId === listing.candidateListingId &&
          status === "resolved" &&
          destinationUrl === sanitizeUrl(listing.destinationUrl),
      );
    const hasVerifiedDirectProvenance =
      persistedListing?.originalMerchantDestinationUrl ===
        sanitizeUrl(listing.destinationUrl) || acceptedResolution !== undefined;
    assertProof(
      direct || fallback,
      `${listing.title} remained in a non-terminal purchase state`,
    );
    assertProof(
      direct
        ? listing.destinationLabel.startsWith("View at ")
        : listing.destinationLabel === "View on Google Shopping" &&
            listing.sourceUrl !== null,
      `${listing.title} has a misleading purchase label or fallback`,
    );
    assertProof(
      !direct || hasVerifiedDirectProvenance,
      `${listing.title} projects a direct CTA without persisted same-offer provenance`,
    );
    assertProof(
      !fallback ||
        sanitizeUrl(listing.destinationUrl) === sanitizeUrl(listing.sourceUrl),
      `${listing.title} fallback does not preserve its Google Shopping destination`,
    );
    return {
      candidateListingId: listing.candidateListingId,
      title: listing.title,
      state: listing.purchaseState,
      label: listing.destinationLabel,
      destinationUrl: sanitizeUrl(listing.destinationUrl),
      googleShoppingSourceUrl: sanitizeUrl(listing.sourceUrl),
      directProvenance:
        persistedListing?.originalMerchantDestinationUrl ===
        sanitizeUrl(listing.destinationUrl)
          ? "original_listing"
          : acceptedResolution !== undefined
            ? "verified_resolution"
            : null,
      verifiedResolution:
        acceptedResolution === undefined
          ? null
          : {
              resolutionId: acceptedResolution.id,
              acceptedResultTitle: acceptedResolution.acceptedResultTitle,
              observedResultUrl: acceptedResolution.observedResultUrl,
              observedResultUrlWasDistinctFromCanonical:
                acceptedResolution.observedResultUrlWasDistinctFromCanonical,
              canonicalDestinationUrl: acceptedResolution.destinationUrl,
              consideredResultCount: acceptedResolution.consideredResultCount,
            },
    };
  });
  assertProof(rows.length > 0, "purchase proof has no visible option");
  const queueRows = uniqueQueueRows([...preTopRows, ...preSavedRows]);
  const rejectedIds = new Set(
    options.prePersistence.rejectedCandidateListingIds.map(
      ({ candidateListingId }) => candidateListingId,
    ),
  );
  const precomputedDestinationQueue = queueRows.map((queueRow) => {
    const listing = options.prePersistence.listings.find(
      ({ id }) => id === queueRow.candidateListingId,
    );
    assertProof(
      listing !== undefined,
      `precomputed destination queue lost persisted listing ${queueRow.candidateListingId}`,
    );
    const terminalResolution =
      options.prePersistence.destinationResolutions.find(
        ({ candidateListingId, status }) =>
          candidateListingId === listing.id && status !== "running",
      );
    const disposition = rejectedIds.has(listing.id)
      ? "excluded_rejected"
      : listing.originalMerchantDestinationUrl !== null
        ? "excluded_existing_direct"
        : terminalResolution !== undefined
          ? "excluded_existing_terminal_resolution"
          : "eligible_provider_lookup";
    return {
      candidateListingId: listing.id,
      searchRunId: listing.runId,
      title: listing.title,
      merchant: listing.merchant,
      disposition,
      existingDirectUrl: listing.originalMerchantDestinationUrl,
      existingResolutionId: terminalResolution?.id ?? null,
    };
  });
  const eligibleForProviderLookup = precomputedDestinationQueue.filter(
    ({ disposition }) => disposition === "eligible_provider_lookup",
  );
  const sortedIds = (ids: readonly string[]) => [...ids].sort();
  const eligibleIds = sortedIds(
    eligibleForProviderLookup.map(({ candidateListingId }) =>
      candidateListingId.toString(),
    ),
  );
  const resolutionIds = sortedIds(
    newResolutions.map(({ candidateListingId }) =>
      candidateListingId.toString(),
    ),
  );
  const traceIds = sortedIds(
    options.destinationTraces.map((trace) => {
      assertProof(
        trace.stage === "destination" &&
          typeof trace.detail.candidateListingId === "string",
        "post-shortlist destination trace lacks an exact candidate identity",
      );
      return trace.detail.candidateListingId;
    }),
  );
  assertProof(
    new Set(eligibleIds).size === eligibleIds.length &&
      new Set(resolutionIds).size === resolutionIds.length &&
      new Set(traceIds).size === traceIds.length &&
      json(resolutionIds) === json(eligibleIds) &&
      json(traceIds) === json(eligibleIds),
    "destination logical operations and durable receipts are not the exact precomputed eligible top+saved queue",
  );
  const exactEligibleLineage = eligibleForProviderLookup.map((eligible) => {
    const resolution = newResolutions.find(
      ({ candidateListingId }) =>
        candidateListingId === eligible.candidateListingId,
    );
    const trace = options.destinationTraces.find(
      ({ detail }) => detail.candidateListingId === eligible.candidateListingId,
    );
    assertProof(
      resolution !== undefined &&
        trace !== undefined &&
        resolution.searchRunId === eligible.searchRunId &&
        resolution.provider === "serper" &&
        trace.detail.title === eligible.title &&
        trace.detail.merchant === eligible.merchant &&
        trace.detail.query === resolution.queryText,
      `destination receipt/trace lineage disagrees with precomputed listing ${eligible.candidateListingId}`,
    );
    return {
      ...eligible,
      resolutionId: resolution.id,
      traceOrdinal: trace.ordinal,
      queryText: resolution.queryText,
      terminalStatus: resolution.status,
    };
  });
  const terminalOutcomes = Object.fromEntries(
    [
      ...new Set(
        newResolutions.map(({ outcomeCode }) => outcomeCode ?? "resolved"),
      ),
    ]
      .sort()
      .map((outcome) => [
        outcome,
        newResolutions.filter(
          ({ outcomeCode }) => (outcomeCode ?? "resolved") === outcome,
        ).length,
      ]),
  );
  return {
    rows,
    directCount: rows.filter(({ state }) => state === "direct").length,
    fallbackCount: rows.filter(({ state }) => state === "fallback").length,
    pre: {
      topCount: preTopRows.length,
      topRows: preTopRows,
      topStateCounts: stateCounts(preTopRows),
      savedCount: preSavedRows.length,
      savedRows: preSavedRows,
      savedStateCounts: stateCounts(preSavedRows),
      durableSavedCandidateListings:
        options.prePersistence.savedCandidateListingIds,
      existingResolutionCount:
        options.prePersistence.destinationResolutions.length,
    },
    post: {
      topCount: postTopRows.length,
      topRows: postTopRows,
      topStateCounts: stateCounts(postTopRows),
      savedCount: postSavedRows.length,
      savedRows: postSavedRows,
      savedStateCounts: stateCounts(postSavedRows),
      durableSavedCandidateListings:
        options.postPersistence.savedCandidateListingIds,
      newResolutions,
      terminalOutcomes,
    },
    coverageDelta: {
      preQueueStateCounts,
      postQueueStateCounts,
      directGain: postQueueStateCounts.direct - preQueueStateCounts.direct,
      fallbackReduction:
        preQueueStateCounts.fallback - postQueueStateCounts.fallback,
      resolvedReceiptCount: newResolutions.filter(
        ({ status }) => status === "resolved",
      ).length,
      rejectedOrFailedReceiptCount: newResolutions.filter(
        ({ status }) => status === "rejected" || status === "failed",
      ).length,
    },
    efficiency: {
      boundedQueueCandidateCount: precomputedDestinationQueue.length,
      eligibleProviderLookupCount: eligibleForProviderLookup.length,
      logicalProviderOperationCount: options.destinationTraces.length,
      actualHttpAttemptCount: null,
      actualHttpAttemptCountReason:
        "The resolver port is instrumented once per logical operation, but transport attempts are not exposed; no HTTP-attempt or cost claim is made.",
    },
    precomputedDestinationQueue,
    exactEligibleLineage,
    attempts: options.postPersistence.destinationResolutions,
  };
}

function logicalCallReceiptProof(options: {
  traces: readonly ExternalTrace[];
  persistence: PersistenceSnapshot;
}) {
  const count = (stage: ExternalStage) =>
    options.traces.filter((trace) => trace.stage === stage).length;
  const organicAttempts = options.persistence.attempts.filter(
    ({ stage }) => stage === "organic_search",
  );
  const pageAttempts = options.persistence.attempts.filter(
    ({ stage }) => stage === "page_fetch",
  );
  const modelPairs = new Set(
    options.persistence.attempts
      .filter(
        ({ stage }) =>
          stage === "observation_extraction" ||
          stage === "criterion_assessment",
      )
      .map(
        ({ researchRunId, candidateListingId }) =>
          `${researchRunId}:${candidateListingId}`,
      ),
  );
  const rows = {
    shopping: {
      logicalCalls: count("shopping"),
      durableReceipts: options.persistence.queryExecutions.length,
    },
    evidenceSearch: {
      logicalCalls: count("evidence_search"),
      durableReceipts: organicAttempts.length,
    },
    pageFetch: {
      logicalCalls: count("page_fetch"),
      durableReceipts: pageAttempts.length,
    },
    productUnderstanding: {
      logicalCalls: count("product_understanding"),
      durableCandidateGenerations: modelPairs.size,
    },
    destination: {
      logicalCalls: count("destination"),
      durableReceipts: options.persistence.destinationResolutions.length,
    },
  };
  assertProof(
    rows.shopping.logicalCalls === rows.shopping.durableReceipts,
    "shopping call count disagrees with durable query receipts",
  );
  assertProof(
    rows.evidenceSearch.logicalCalls === rows.evidenceSearch.durableReceipts,
    "evidence-search call count disagrees with durable attempt receipts",
  );
  assertProof(
    rows.pageFetch.logicalCalls === rows.pageFetch.durableReceipts,
    "page-fetch call count disagrees with durable attempt receipts",
  );
  assertProof(
    rows.productUnderstanding.logicalCalls ===
      rows.productUnderstanding.durableCandidateGenerations,
    "model call count disagrees with durable candidate generations",
  );
  assertProof(
    rows.destination.logicalCalls === rows.destination.durableReceipts,
    "destination call count disagrees with durable resolution receipts",
  );
  return {
    logicalProviderOperations: rows,
    actualHttpAttempts: null,
    actualHttpAttemptReason:
      "Instrumentation wraps provider ports. Redirects or transport-level attempts are not exposed consistently, so logical operations are not relabelled as HTTP attempts.",
    providerCost: null,
    providerCostReason:
      "No billing receipt is exposed by these provider ports, so this proof makes no monetary cost claim.",
  };
}

function leaveAppReason(options: {
  honesty: ReturnType<typeof honestyProof>;
  purchase: ReturnType<typeof purchaseProof>;
  sourceDepth: ReturnType<typeof sourceDepthProof>;
}) {
  const reasons: string[] = [];
  const unknownLabels = [
    ...new Set(options.honesty.unknowns.map(({ label }) => label)),
  ];
  if (unknownLabels.length > 0) {
    reasons.push(`verify ${unknownLabels.slice(0, 3).join(", ")}`);
  }
  if (options.sourceDepth.rejectedOrFailedPages.length > 0) {
    reasons.push("replace failed or mismatched exact-source checks");
  }
  if (options.purchase.fallbackCount > 0) {
    reasons.push(
      "open Google Shopping for offers without a verified retailer page",
    );
  }
  return reasons.length === 0
    ? "I could use the verified retailer path, while still checking current stock, delivery and returns."
    : `I would still leave Consider to ${reasons.join("; ")}.`;
}

function traceSummary(traces: readonly ExternalTrace[]) {
  const stages = [
    "interpretation",
    "action_selection",
    "shopping",
    "evidence_search",
    "page_fetch",
    "product_understanding",
    "destination",
  ] as const;
  return Object.fromEntries(
    stages.map((stage) => {
      const values = traces.filter((trace) => trace.stage === stage);
      return [
        stage,
        {
          logicalCalls: values.length,
          succeeded: values.filter(({ status }) => status === "succeeded")
            .length,
          failed: values.filter(({ status }) => status === "failed").length,
          summedCallDurationMs: values.reduce(
            (total, { durationMs }) => total + durationMs,
            0,
          ),
          observedMaximumConcurrency: maximumConcurrency(values),
        },
      ];
    }),
  );
}

async function runCase(options: {
  fixture: CaseFixture;
  dependencies: LiveShoppingDependencies;
  traces: ExternalTrace[];
  onSession: (sessionId: string) => void;
}) {
  const sessionId = randomUUID();
  options.onSession(sessionId);
  const questions: Array<Record<string, unknown>> = [];
  const traceStart = options.traces.length;
  const caseStartedAt = performance.now();
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
    fixture: options.fixture,
    view,
    questions,
    phase: "initial",
  });
  assertProof(
    view.action.kind === "search" &&
      view.action.search !== null &&
      view.action.search.listings.length > 0,
    `${options.fixture.name} did not reach useful listings`,
  );
  const timeToUsefulListingsResponseMs = sanitizedDuration(
    performance.now() - caseStartedAt,
  );
  const authoritativeBriefBeforeResearch = JSON.stringify(view.brief);

  const firstPassStartedAt = performance.now();
  view = await researchLiveShopping({
    dependencies: options.dependencies,
    input: { operation: "research", sessionId },
  });
  const synchronousFirstPassResponseMs = sanitizedDuration(
    performance.now() - caseStartedAt,
  );
  const firstPassDurationMs = sanitizedDuration(
    performance.now() - firstPassStartedAt,
  );
  assertProof(
    view.decisionSupport !== null,
    "first pass produced no decision support",
  );
  const afterFirstPass = await scopedPersistence({
    db: options.dependencies.db,
    sessionId,
  });
  const initialBrief = afterFirstPass.brief;
  assertProof(
    JSON.stringify(view.brief) === authoritativeBriefBeforeResearch,
    "research mutated the authoritative shopper brief",
  );

  const target = chooseGap(view);
  let targetedDurationMs: number | null = null;
  let targeted:
    | ReturnType<typeof targetedScopeProof>
    | Readonly<{
        attempted: false;
        scopeAdvanced: false;
        skipReason: "category_already_complete";
        target: null;
        newRuns: readonly [];
        newAttempts: readonly [];
        currentAssessmentChanges: readonly [];
        afterAssessment: null;
        fetchedSources: readonly [];
        resolvedByFetchedPage: false;
        pageTargetedUsefulUnknown: false;
        checkedNoAnswer: null;
      }>;
  if (target === null) {
    assertProof(
      (view.decisionSupport?.decisionGaps.length ?? 0) === 0,
      "a category with remaining decision gaps had no exact targetable candidate",
    );
    targeted = {
      attempted: false,
      scopeAdvanced: false,
      skipReason: "category_already_complete",
      target: null,
      newRuns: [],
      newAttempts: [],
      currentAssessmentChanges: [],
      afterAssessment: null,
      fetchedSources: [],
      resolvedByFetchedPage: false,
      pageTargetedUsefulUnknown: false,
      checkedNoAnswer: null,
    };
  } else {
    const targetStartedAt = performance.now();
    view = await researchLiveCandidate({
      dependencies: options.dependencies,
      input: {
        operation: "research_candidate",
        sessionId,
        candidateListingId: target.candidateListingId,
        criterionId: target.criterionId,
      },
    });
    targetedDurationMs = sanitizedDuration(performance.now() - targetStartedAt);
    const afterTarget = await scopedPersistence({
      db: options.dependencies.db,
      sessionId,
    });
    targeted = targetedScopeProof({
      before: afterFirstPass,
      after: afterTarget,
      target,
      view,
    });
  }

  let deepeningDurationMs: number | null = null;
  if (
    (view.decisionSupport?.decisionGaps.length ?? 0) > 0 &&
    view.decisionSupport?.deepResearchStatus !== "not_needed"
  ) {
    const startedAt = performance.now();
    view = await deepenLiveShoppingResearch({
      dependencies: options.dependencies,
      input: { operation: "deepen_research", sessionId },
    });
    deepeningDurationMs = sanitizedDuration(performance.now() - startedAt);
  }

  let refinement: Record<string, unknown> | null = null;
  if (options.fixture.refinement !== null) {
    const before = JSON.stringify(view.brief);
    const startedAt = performance.now();
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
      fixture: options.fixture,
      view,
      questions,
      phase: "refinement",
    });
    assertProof(
      view.action.kind === "search",
      "refinement did not return to search",
    );
    const changedBrief = JSON.stringify(view.brief);
    assertProof(
      changedBrief !== before,
      "mouse change of mind did not change the brief",
    );
    view = await researchLiveShopping({
      dependencies: options.dependencies,
      input: { operation: "research", sessionId },
    });
    assertProof(
      JSON.stringify(view.brief) === changedBrief,
      "post-refinement research mutated shopper truth",
    );
    refinement = {
      message: options.fixture.refinement,
      durationMs: sanitizedDuration(performance.now() - startedAt),
      brief: view.brief,
    };
  }

  const saveTargets = view.decisionSupport?.topOptions.slice(0, 2) ?? [];
  assertProof(saveTargets.length === 2, "comparison needs two exact listings");
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
  const preDestinationView = view;
  const preDestinationPersistence = await scopedPersistence({
    db: options.dependencies.db,
    sessionId,
  });
  const semanticTruth = semanticCaseProof({
    fixture: options.fixture,
    initialBrief,
    finalBrief: preDestinationPersistence.brief,
  });
  assertProof(
    options.traces
      .slice(traceStart)
      .every(({ stage }) => stage !== "destination") &&
      preDestinationPersistence.destinationResolutions.length === 0,
    "destination provider work or durable receipts occurred before the explicit post-shortlist destination phase",
  );
  const destinationTraceStart = options.traces.length;
  const destinationStartedAt = performance.now();
  view = await resolveLivePurchaseDestinations({
    dependencies: options.dependencies,
    input: { operation: "resolve_destinations", sessionId },
  });
  const destinationOperationMs = sanitizedDuration(
    performance.now() - destinationStartedAt,
  );
  const projectionStartedAt = performance.now();
  view = await loadLiveShoppingSession({
    db: options.dependencies.db,
    sessionId,
  });
  const freshProjectionLoadMs = sanitizedDuration(
    performance.now() - projectionStartedAt,
  );
  const stableDecisionSupportObservedAt = new Date().toISOString();
  const stableDecisionSupportObservedMs = sanitizedDuration(
    performance.now() - caseStartedAt,
  );

  const persistence = await scopedPersistence({
    db: options.dependencies.db,
    sessionId,
  });
  const finalSnapshot = decisionSnapshot(view);
  const sourceDepth = sourceDepthProof(persistence, view);
  const honesty = honestyProof(view, persistence);
  const purchase = purchaseProof({
    preView: preDestinationView,
    postView: view,
    prePersistence: preDestinationPersistence,
    postPersistence: persistence,
    destinationTraces: options.traces.slice(destinationTraceStart),
  });
  const boundedWork = boundedWorkProof(persistence);
  const terminalPersistence = terminalPersistenceProof(persistence);
  const caseTraces = options.traces.slice(traceStart);
  const callReceipts = logicalCallReceiptProof({
    traces: caseTraces,
    persistence,
  });
  const concurrency = {
    shopping: maximumConcurrency(
      caseTraces.filter(({ stage }) => stage === "shopping"),
    ),
    evidenceSearch: maximumConcurrency(
      caseTraces.filter(({ stage }) => stage === "evidence_search"),
    ),
    pageFetch: maximumConcurrency(
      caseTraces.filter(({ stage }) => stage === "page_fetch"),
    ),
    productUnderstanding: maximumConcurrency(
      caseTraces.filter(({ stage }) => stage === "product_understanding"),
    ),
    destination: maximumConcurrency(
      caseTraces.filter(({ stage }) => stage === "destination"),
    ),
  };
  assertProof(concurrency.shopping <= 3, "shopping exceeded concurrency three");
  assertProof(
    concurrency.evidenceSearch <= 3,
    "evidence search exceeded concurrency three",
  );
  assertProof(
    concurrency.pageFetch <= 2,
    "page fetch exceeded concurrency two",
  );
  assertProof(
    concurrency.productUnderstanding <= 2,
    "product understanding exceeded concurrency two",
  );
  assertProof(
    concurrency.destination <= 2,
    "destination exceeded concurrency two",
  );
  return {
    name: options.fixture.name,
    request: options.fixture.request,
    sessionId,
    questions,
    timings: {
      timeToUsefulListingsResponseMs,
      firstProjectableDecisionSupportMs: null,
      firstProjectableDecisionSupportReason:
        "The synchronous research API returns only after the orchestrator settles; it does not expose the earlier instant at which one candidate first became projectable.",
      timeToSynchronousFirstPassResponseMs: synchronousFirstPassResponseMs,
      stableDecisionSupportObservedAt,
      stableDecisionSupportObservedMs,
      firstPassDurationMs,
      targetedDurationMs,
      deepeningDurationMs,
      destinationOperationMs,
      freshProjectionLoadMs,
      stageMeasurementSemantics:
        "External stages are logical provider-port wall intervals, not transport-attempt counters. Persisted receipt durations include external work plus surrounding durable recording. The stable observation is after all explicitly invoked synchronous work and a fresh projection; first-projectable and pure planning/persistence intervals remain unknown where the boundary does not expose them.",
    },
    logicalCalls: traceSummary(caseTraces),
    callReceipts,
    observedConcurrency: concurrency,
    boundedWork,
    terminalPersistence,
    targeted,
    sourceDepth,
    honesty,
    purchase,
    founderWouldStillLeave: leaveAppReason({ honesty, purchase, sourceDepth }),
    refinement,
    semanticTruth,
    decision: finalSnapshot,
    persistence,
    externalTraces: caseTraces,
  };
}

type FounderFlow = Awaited<ReturnType<typeof runCase>>;

function releaseAcceptance(flows: readonly FounderFlow[]) {
  assertProof(
    flows.length === cases.length &&
      cases.every(({ name }) => flows.some((flow) => flow.name === name)),
    "one fresh run did not complete all four exact categories",
  );
  const totalFetchedDocuments = flows.reduce(
    (total, flow) => total + flow.sourceDepth.admittedDocumentCount,
    0,
  );
  const fetchedEvidenceReachesDecision = flows.some(
    ({ sourceDepth }) => sourceDepth.reachesCurrentAssessment,
  );
  const aggregateFetchedSourceRoles = [
    ...new Set(flows.flatMap(({ sourceDepth }) => sourceDepth.sourceRoles)),
  ].sort();
  const exactCurrentDocumentLineageCount = flows.reduce(
    (total, flow) =>
      total + flow.sourceDepth.usableCurrentAssessmentLineages.length,
    0,
  );
  const projectedFetchedPageLinkCount = flows.reduce(
    (total, flow) => total + flow.sourceDepth.projectedFetchedPageLinks.length,
    0,
  );
  const resolvedGapCount = flows.filter(
    ({ targeted }) => targeted.resolvedByFetchedPage,
  ).length;
  const targetedScopedAdvancementCount = flows.filter(
    ({ targeted }) => targeted.attempted && targeted.scopeAdvanced,
  ).length;
  const honestUnknownCount = flows.reduce(
    (total, flow) => total + flow.honesty.unknowns.length,
    0,
  );
  const postPageUsefulUnknownCount = flows.reduce(
    (total, flow) => total + flow.sourceDepth.postPageUsefulUnknowns.length,
    0,
  );
  assertProof(
    totalFetchedDocuments > 0,
    "no exact page was admitted in the proof",
  );
  assertProof(
    aggregateFetchedSourceRoles.includes("manufacturer") &&
      aggregateFetchedSourceRoles.includes("retailer"),
    "the four-category proof did not aggregate both manufacturer and retailer exact-page evidence",
  );
  assertProof(
    fetchedEvidenceReachesDecision && exactCurrentDocumentLineageCount > 0,
    "no supported exact admitted-document lineage reached a current meets/conflicts criterion assessment",
  );
  assertProof(
    projectedFetchedPageLinkCount > 0,
    "no visible top option projected an exact admitted fetched-page evidence link",
  );
  assertProof(
    resolvedGapCount > 0,
    "no named decision gap was resolved by admitted fetched-page evidence",
  );
  assertProof(
    honestUnknownCount > 0,
    "the proof manufactured completeness instead of preserving an honest unknown",
  );
  assertProof(
    targetedScopedAdvancementCount > 0,
    "no exact targeted operation advanced only its scoped candidate + criterion",
  );
  assertProof(
    postPageUsefulUnknownCount > 0,
    "no exact page outcome produced an attributable useful unknown",
  );
  assertProof(
    flows.every(({ purchase }) => purchase.rows.length > 0),
    "one journey has no honest direct-or-Google purchase outcome",
  );
  const destinationAttemptCount = flows.reduce(
    (total, flow) => total + flow.purchase.attempts.length,
    0,
  );
  assertProof(
    destinationAttemptCount > 0,
    "post-shortlist destination resolution was never durably exercised",
  );
  return {
    releaseAccepted: true as const,
    completedCaseCount: flows.length,
    totalFetchedDocuments,
    fetchedEvidenceReachesDecision,
    aggregateFetchedSourceRoles,
    exactCurrentDocumentLineageCount,
    projectedFetchedPageLinkCount,
    resolvedGapCount,
    targetedScopedAdvancementCount,
    honestUnknownCount,
    postPageUsefulUnknownCount,
    sourceScarcityByCase: flows.map(({ name, sourceDepth }) => ({
      name,
      ...sourceDepth.sourceScarcity,
    })),
    directDestinationCount: flows.reduce(
      (total, flow) => total + flow.purchase.directCount,
      0,
    ),
    googleFallbackCount: flows.reduce(
      (total, flow) => total + flow.purchase.fallbackCount,
      0,
    ),
    destinationAttemptCount,
  };
}

function markdown(report: {
  generatedAt: string;
  models: {
    contextAcquisition: string;
    productUnderstanding: string;
  };
  acceptance: ReturnType<typeof releaseAcceptance>;
  flows: readonly FounderFlow[];
}) {
  const journeys = report.flows
    .map((flow) => {
      const options = flow.decision.topOptions
        .slice(0, 3)
        .map(
          (option, index) =>
            `${index + 1}. **${option.title}** — ${option.price ?? "price unknown"}; ${option.readiness}; ${option.purchase.label}`,
        )
        .join("\n");
      const targetSummary =
        flow.targeted.target === null
          ? "not run — the category was already complete after first pass"
          : `${flow.targeted.target.criterionLabel} for ${flow.targeted.target.candidateTitle}`;
      return `## ${flow.name}\n\n- Time to useful-listings response: ${flow.timings.timeToUsefulListingsResponseMs} ms\n- First projectable decision support: not observable at this synchronous boundary\n- Time to synchronous first-pass response: ${flow.timings.timeToSynchronousFirstPassResponseMs} ms\n- Stable decision support observed after: ${flow.timings.stableDecisionSupportObservedMs} ms\n- Logical provider-port operations: ${JSON.stringify(flow.logicalCalls)}\n- Actual HTTP attempts / provider cost: not exposed; no claim made\n- Observed logical-operation concurrency: ${JSON.stringify(flow.observedConcurrency)}\n- Exact target: ${targetSummary}\n- Target resolved by fetched page: ${flow.targeted.resolvedByFetchedPage ? "yes" : "no"}\n- Post-page useful unknowns: ${flow.sourceDepth.postPageUsefulUnknowns.length}\n- Page evidence: ${flow.sourceDepth.admittedDocumentCount} admitted; ${flow.sourceDepth.rejectedOrFailedPages.length} rejected/failed\n- Missing exact-page roles in this category: ${flow.sourceDepth.sourceScarcity.missingExpectedFetchedRoles.join(", ") || "none"}\n- Useful remaining unknowns: ${flow.honesty.unknowns.map(({ label, reason }) => `${label} (${reason})`).join(", ") || "none"}\n- Purchase path: ${flow.purchase.directCount} direct; ${flow.purchase.fallbackCount} Google Shopping fallback\n- Founder would still leave: ${flow.founderWouldStillLeave}\n\n### Current options\n\n${options || "No decision option survived."}\n`;
    })
    .join("\n");
  return `# V0-09 deep-source founder proof\n\nGenerated: ${report.generatedAt}\n\nThis is one fresh, non-aggregated, sanitized Terra + Serper run across the exact mouse, chair, vacuum and compact-coffee-machine journeys against a guarded disposable PostgreSQL database. Context acquisition model: ${report.models.contextAcquisition}. Product-understanding model: ${report.models.productUnderstanding}. Success is written only after the full release predicate passes and the disposable database is successfully destroyed.\n\n- Release accepted: yes\n- Admitted fetched documents: ${report.acceptance.totalFetchedDocuments}\n- Aggregate fetched-page roles: ${report.acceptance.aggregateFetchedSourceRoles.join(", ")}\n- Exact document lineages reaching current assessment: ${report.acceptance.exactCurrentDocumentLineageCount}\n- Named gaps resolved by fetched-page evidence: ${report.acceptance.resolvedGapCount}\n- Scoped targeted advancements: ${report.acceptance.targetedScopedAdvancementCount}\n- Post-page useful unknowns: ${report.acceptance.postPageUsefulUnknownCount}\n- Honest remaining unknowns: ${report.acceptance.honestUnknownCount}\n- Verified direct destinations: ${report.acceptance.directDestinationCount}\n- Google Shopping fallbacks: ${report.acceptance.googleFallbackCount}\n\n${journeys}\n## Honest boundary\n\n- Exact pages are admitted only through bounded evidence discovery and identity checks; no arbitrary browsing or crawler is used. Manufacturer and retailer depth are aggregate four-category requirements; honest per-category scarcity is reported instead of manufacturing evidence.\n- A failed, mismatched or scarce page remains an attributable failure/unknown and cannot become product truth.\n- External-call timing is measured at provider ports; actual HTTP attempts, provider cost, first-projectable timing and unexposed internal intervals are not fabricated.\n- A retailer CTA is direct only for a verified same-offer destination. Google Shopping remains available and explicitly labelled otherwise.\n- Personal fit and facts absent from checked sources remain unknown.\n- No ProductIdentity, affiliate ranking, checkout, auth or V0-10 work is part of this proof.\n`;
}

async function exists(url: URL) {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
}

async function claimOneShotAttempt() {
  await mkdir(outputDirectory, { recursive: true });
  const priorEvidence = [
    attemptMarker,
    successJson,
    successMarkdown,
    failureJson,
    failureMarkdown,
  ];
  if ((await Promise.all(priorEvidence.map(exists))).some(Boolean)) {
    throw new Error(
      "V0-09 live proof has already been attempted or has preserved evidence; refusing to overwrite or consume another release run",
    );
  }
  const marker = {
    schemaVersion: 1,
    proofMode: "fresh_four_category_v009_release" as const,
    attemptId: randomUUID(),
    claimedAt: new Date().toISOString(),
    state: "claimed" as const,
    refusalPolicy:
      "This marker is intentionally durable after success, failure, or interruption. A second live V0-09 release attempt is refused and prior failure evidence is never deleted.",
  };
  try {
    await writeFile(attemptMarker, `${json(marker)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error(
        "V0-09 live proof was claimed concurrently; refusing a second attempt",
      );
    }
    throw error;
  }
  return marker;
}

async function cleanupProofResources(options: {
  connection: ReturnType<typeof createDatabaseConnection> | null;
  admin: ReturnType<typeof postgres>;
  databaseCreated: boolean;
  databaseName: string;
}) {
  const errors: unknown[] = [];
  let disposableDatabaseDestroyed = !options.databaseCreated;
  if (options.connection !== null) {
    try {
      await options.connection.close();
    } catch (error) {
      errors.push(error);
    }
  }
  if (options.databaseCreated) {
    if (!disposableDatabasePattern.test(options.databaseName)) {
      errors.push(new Error("refusing to drop an unguarded database"));
    } else {
      try {
        await options.admin.unsafe(
          `DROP DATABASE IF EXISTS "${options.databaseName}" WITH (FORCE)`,
        );
        disposableDatabaseDestroyed = true;
      } catch (error) {
        errors.push(error);
      }
    }
  }
  try {
    await options.admin.end();
  } catch (error) {
    errors.push(error);
  }
  return { errors, disposableDatabaseDestroyed };
}

const configuredTestDatabaseUrl = process.env.TEST_DATABASE_URL?.trim() ?? "";
let testDatabaseEnvironment: ReturnType<typeof requireTestDatabaseEnvironment>;
try {
  testDatabaseEnvironment = requireTestDatabaseEnvironment(process.env);
} catch (error) {
  throw new Error(
    scrubFailure(
      error instanceof Error
        ? error.message
        : "Invalid V0-09 test database configuration",
      [configuredTestDatabaseUrl],
    ),
  );
}
const { TEST_DATABASE_URL } = testDatabaseEnvironment;
const baseUrl = new URL(TEST_DATABASE_URL);
const baseDatabaseName = baseUrl.pathname.slice(1);
const databaseName = `ai_shopping_test_v009_${randomUUID().replaceAll("-", "")}`;
if (
  !/(?:^|[_-])test(?:[_-]|$)/.test(baseDatabaseName) ||
  !disposableDatabasePattern.test(databaseName)
) {
  throw new Error("Refusing to create an unguarded V0-09 proof database");
}
if (process.env.V0_09_CASE?.trim() || process.env.V0_09_ALLOW_PARTIAL?.trim()) {
  throw new Error("Partial or aggregate V0-09 proof runs are disabled");
}
if (process.env.V0_09_LIVE_RELEASE_ACK !== "fresh-four-category-one-shot") {
  throw new Error(
    "Set V0_09_LIVE_RELEASE_ACK=fresh-four-category-one-shot only after every deterministic, database, browser and security gate is green",
  );
}

const disposableUrl = new URL(TEST_DATABASE_URL);
disposableUrl.pathname = `/${databaseName}`;
const admin = postgres(TEST_DATABASE_URL, { max: 1, prepare: false });
let connection: ReturnType<typeof createDatabaseConnection> | null = null;
let databaseCreated = false;
let openAIKey = "";
let serperKey = "";
let activeCaseName: CaseName | null = null;
let activeSessionId: string | null = null;
const completedFlows: FounderFlow[] = [];
let runtimeTraces: ExternalTrace[] = [];
let runtime: ReturnType<typeof createInstrumentedDependencies> | null = null;
let activeCaseSnapshot: PersistenceSnapshot | null = null;
let operationError: unknown = null;

try {
  [openAIKey, serperKey] = await Promise.all([
    readSecret("OPENAI_API_KEY", "ai-shopping-openai"),
    readSecret("SERPER_API_KEY", "ai-shopping-serper"),
  ]);
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;
  await migrateDatabase({ url: disposableUrl.toString() });
  connection = createDatabaseConnection({
    url: disposableUrl.toString(),
    prepare: false,
  });
  runtime = createInstrumentedDependencies({
    db: connection.db,
    openAIKey,
    serperKey,
    activeCase: () => {
      if (activeCaseName === null) {
        throw new Error("External call occurred outside an active proof case");
      }
      return activeCaseName;
    },
  });
  runtimeTraces = runtime.traces;
  assertProof(
    connection !== null && runtime !== null,
    "V0-09 preflight did not construct its isolated runtime",
  );
} catch (error) {
  const cleanup = await cleanupProofResources({
    connection,
    admin,
    databaseCreated,
    databaseName,
  });
  const messages = [
    error instanceof Error ? error.message : "V0-09 preflight failed",
    ...cleanup.errors.map((cleanupError) =>
      cleanupError instanceof Error
        ? `preflight cleanup: ${cleanupError.message}`
        : "preflight cleanup failed",
    ),
  ];
  throw new Error(
    scrubFailure(messages.join("; "), [
      openAIKey,
      serperKey,
      TEST_DATABASE_URL,
      disposableUrl.toString(),
      baseUrl.username,
      baseUrl.password,
    ]),
  );
}

const releaseRuntime = runtime as NonNullable<typeof runtime>;
let successReport: Readonly<{
  schemaVersion: 2;
  proofMode: "fresh_four_category_v009_release";
  attemptId: string;
  generatedAt: string;
  models: {
    contextAcquisition: typeof releaseModel;
    productUnderstanding: typeof releaseModel;
  };
  market: { country: "GB"; language: "en-GB"; currency: "GBP" };
  exactCaseNames: readonly CaseName[];
  acceptance: ReturnType<typeof releaseAcceptance>;
  flows: readonly FounderFlow[];
  logicalProviderOperations: ReturnType<typeof traceSummary>;
  transportAccounting: {
    actualHttpAttempts: null;
    providerCost: null;
    reason: string;
  };
}> | null = null;
let attempt: Awaited<ReturnType<typeof claimOneShotAttempt>>;
try {
  attempt = await claimOneShotAttempt();
} catch (error) {
  const cleanup = await cleanupProofResources({
    connection,
    admin,
    databaseCreated,
    databaseName,
  });
  const messages = [
    error instanceof Error ? error.message : "V0-09 one-shot claim failed",
    ...cleanup.errors.map((cleanupError) =>
      cleanupError instanceof Error
        ? `claim-refusal cleanup: ${cleanupError.message}`
        : "claim-refusal cleanup failed",
    ),
  ];
  throw new Error(
    scrubFailure(messages.join("; "), [
      openAIKey,
      serperKey,
      TEST_DATABASE_URL,
      disposableUrl.toString(),
      baseUrl.username,
      baseUrl.password,
    ]),
  );
}

try {
  for (const fixture of cases) {
    activeCaseName = fixture.name;
    completedFlows.push(
      await runCase({
        fixture,
        dependencies: releaseRuntime.dependencies,
        traces: releaseRuntime.traces,
        onSession: (sessionId) => {
          activeSessionId = sessionId;
        },
      }),
    );
    activeSessionId = null;
  }
  activeCaseName = null;
  const acceptance = releaseAcceptance(completedFlows);
  successReport = {
    schemaVersion: 2,
    proofMode: "fresh_four_category_v009_release",
    attemptId: attempt.attemptId,
    generatedAt: new Date().toISOString(),
    models: {
      contextAcquisition: releaseModel,
      productUnderstanding: releaseModel,
    },
    market: { country: "GB", language: "en-GB", currency: "GBP" },
    exactCaseNames: cases.map(({ name }) => name),
    acceptance,
    flows: completedFlows,
    logicalProviderOperations: traceSummary(runtimeTraces),
    transportAccounting: {
      actualHttpAttempts: null,
      providerCost: null,
      reason:
        "Only provider-port operations are instrumented. Transport attempts and billing receipts are not exposed consistently, so no HTTP-attempt or monetary-cost claim is made.",
    },
  };
} catch (error) {
  operationError = error;
  if (connection !== null && activeSessionId !== null) {
    try {
      activeCaseSnapshot = await scopedPersistence({
        db: connection.db,
        sessionId: activeSessionId,
      });
    } catch {
      activeCaseSnapshot = null;
    }
  }
}

const cleanup = await cleanupProofResources({
  connection,
  admin,
  databaseCreated,
  databaseName,
});
const cleanupErrors = cleanup.errors;
const { disposableDatabaseDestroyed } = cleanup;

const secretMaterial = [
  openAIKey,
  serperKey,
  TEST_DATABASE_URL,
  disposableUrl.toString(),
  baseUrl.username,
  baseUrl.password,
];
if (operationError !== null || cleanupErrors.length > 0) {
  const operationMessage =
    operationError === null
      ? "The product proof completed but disposable database cleanup failed"
      : operationError instanceof Error
        ? operationError.message
        : "Unknown V0-09 proof failure";
  const cleanupMessage = cleanupErrors
    .map((error) =>
      error instanceof Error ? error.message : "unknown cleanup failure",
    )
    .join("; ");
  const sanitizedMessage = scrubFailure(
    cleanupMessage.length === 0
      ? operationMessage
      : `${operationMessage}; cleanup: ${cleanupMessage}`,
    secretMaterial,
  );
  const failureReport = {
    schemaVersion: 2,
    proofMode: "fresh_four_category_v009_release_failed" as const,
    attemptId: attempt.attemptId,
    generatedAt: new Date().toISOString(),
    models: {
      contextAcquisition: releaseModel,
      productUnderstanding: releaseModel,
    },
    failedCase: activeCaseName,
    failedSessionId: activeSessionId,
    completedFlows,
    activeCaseSnapshot,
    logicalProviderOperationsAtFailure: traceSummary(runtimeTraces),
    transportAccounting: {
      actualHttpAttempts: null,
      providerCost: null,
      reason:
        "Only provider-port operations are instrumented; transport attempts and billing are not exposed.",
    },
    tracesAtFailure: runtimeTraces,
    cleanup: {
      disposableDatabaseDestroyed,
      errorCount: cleanupErrors.length,
    },
    failure: {
      name:
        operationError instanceof Error
          ? operationError.name
          : cleanupErrors.length > 0
            ? "CleanupError"
            : "UnknownError",
      message: sanitizedMessage,
    },
    releaseAccepted: false as const,
  };
  await Promise.all([
    writeFile(failureJson, `${json(failureReport)}\n`, {
      encoding: "utf8",
      flag: "wx",
    }),
    writeFile(
      failureMarkdown,
      `# V0-09 deep-source founder proof — failed\n\nGenerated: ${failureReport.generatedAt}\n\n- Failed case: ${failureReport.failedCase ?? "before a category started"}\n- Completed categories: ${failureReport.completedFlows.map(({ name }) => name).join(", ") || "none"}\n- Active-case state captured: ${failureReport.activeCaseSnapshot === null ? "no" : "yes"}\n- Disposable database destroyed: ${failureReport.cleanup.disposableDatabaseDestroyed ? "yes" : "no"}\n- Sanitized failure: ${failureReport.failure.name}: ${failureReport.failure.message}\n- Release accepted: no\n\nThe durable one-shot marker remains in place. This diagnostic is preserved and is not release evidence; a second live attempt is refused.\n`,
      { encoding: "utf8", flag: "wx" },
    ),
  ]);
  throw new Error(sanitizedMessage);
}

assertProof(
  successReport !== null,
  "proof finished without success, failure, or cleanup evidence",
);
await Promise.all([
  writeFile(successJson, `${json(successReport)}\n`, {
    encoding: "utf8",
    flag: "wx",
  }),
  writeFile(successMarkdown, markdown(successReport), {
    encoding: "utf8",
    flag: "wx",
  }),
]);
process.stdout.write(
  `${json({
    generatedAt: successReport.generatedAt,
    proofMode: successReport.proofMode,
    models: successReport.models,
    acceptance: successReport.acceptance,
    journeys: completedFlows.map(
      ({ name, timings, purchase, sourceDepth }) => ({
        name,
        timings,
        purchase: {
          direct: purchase.directCount,
          googleFallback: purchase.fallbackCount,
        },
        sourceDepth: {
          admitted: sourceDepth.admittedDocumentCount,
          rejectedOrFailed: sourceDepth.rejectedOrFailedPages.length,
        },
      }),
    ),
  })}\n`,
);
