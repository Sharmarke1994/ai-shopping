/**
 * One-shot development product-engine proof.
 *
 * Context acquisition is intentionally bypassed, while all authoritative
 * shopper truth still enters through the V0-04 persistence boundary. This is
 * product evidence only: it is not RC5 and can never accept a release.
 */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { projectShoppingBrief } from "../src/domain/shopping-state/brief";
import { persistContextAction } from "../src/features/context-acquisition/persistence/context-actions";
import { saveCandidateListing } from "../src/features/live-shopping/saved-listings";
import { buildDecisionSupport } from "../src/features/product-understanding/decision-support";
import type { EvidenceSearchProvider } from "../src/features/product-understanding/evidence-search";
import type { ProductUnderstandingModel } from "../src/features/product-understanding/model-port";
import {
  createOpenAIProductUnderstandingModel,
  V0_07_OPENAI_DEFAULT_CONFIG,
} from "../src/features/product-understanding/openai-adapter";
import { fetchBoundedPage } from "../src/features/product-understanding/page-fetch";
import {
  loadCurrentDecisionSupport,
  type CurrentDecisionSupport,
} from "../src/features/product-understanding/persistence";
import type { ProductUnderstandingInputV1 } from "../src/features/product-understanding/provider-wire";
import { PRODUCT_UNDERSTANDING_PROMPT_VERSION } from "../src/features/product-understanding/prompts";
import {
  executeOrResumeEvidenceResearch,
  type EvidencePageFetcher,
} from "../src/features/product-understanding/research-orchestrator";
import { SerperEvidenceSearchAdapter } from "../src/features/product-understanding/serper-evidence-adapter";
import type { MerchantDestinationResolver } from "../src/features/purchase-destinations/contracts";
import { executeOrResumeMerchantDestinationResolution } from "../src/features/purchase-destinations/orchestrator";
import { SerperMerchantDestinationResolver } from "../src/features/purchase-destinations/serper-merchant-destination-resolver";
import {
  searchQuerySchema,
  type ShoppingSearchProvider,
} from "../src/features/retrieval-spike/contracts";
import { recordInitialShoppingSubject } from "../src/features/retrieval-spike/persistence/shopping-subjects";
import { executeOrResumeRetrieval } from "../src/features/retrieval-spike/retrieval-orchestrator";
import { SerperShoppingAdapter } from "../src/features/retrieval-spike/serper-shopping-adapter";
import { recordTaskInput } from "../src/features/shopping-state/persistence/inputs-and-messages";
import { loadCurrentShoppingState } from "../src/features/shopping-state/persistence/state-loaders";
import { applyStatePatch } from "../src/features/shopping-state/persistence/state-transitions";
import { createShoppingTask } from "../src/features/shopping-state/persistence/tasks";
import { requireTestDatabaseEnvironment } from "../src/infrastructure/config/environment";
import { createDatabaseConnection } from "../src/infrastructure/database/clients";
import {
  criterionAssessments,
  evidenceAcquisitionAttempts,
  evidenceSources,
  fetchedEvidenceDocuments,
  merchantDestinationResolutions,
  productObservations,
  savedCandidateListings,
  searchQueryExecutions,
} from "../src/infrastructure/database/schema";
import {
  buildMouseRevisionTwoPatch,
  buildProductEngineInitialPatch,
  V0_09_PRODUCT_ENGINE_CASES,
} from "./support/v0-09-product-engine-cases";

const exec = promisify(execFile);
const freshPreflightOutput = new URL(
  "../docs/evals/v0-09-product-engine-preflight-fresh.json",
  import.meta.url,
);
const checkpointTwoPreflightOutput = new URL(
  "../docs/evals/v0-09-product-engine-preflight-checkpoint-2.json",
  import.meta.url,
);
const proofMarkerOutput = new URL(
  "../docs/evals/v0-09-product-engine-proof-marker.json",
  import.meta.url,
);
const proofOutput = new URL(
  "../docs/evals/v0-09-product-engine-proof.json",
  import.meta.url,
);
const proofMarkdownOutput = new URL(
  "../docs/evals/v0-09-product-engine-proof.md",
  import.meta.url,
);
const cases = V0_09_PRODUCT_ENGINE_CASES;

const checkpointTwoPreflightSchema = z.strictObject({
  schemaVersion: z.literal(2),
  preflightId: z.uuid(),
  kind: z.literal("development_product_engine_preflight"),
  checkpointNumber: z.literal(2),
  checkpointName: z.literal("product_engine_preflight_checkpoint_2"),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  gitHead: z.string().regex(/^[a-f0-9]{40}$/),
  contextBypassed: z.literal(true),
  releaseAccepted: z.literal(false),
  rc5: z.literal(false),
  adapters: z.strictObject({
    shopping: z.literal("SerperShoppingAdapter"),
    evidence: z.literal("SerperEvidenceSearchAdapter"),
    productUnderstanding: z.literal("OpenAIProductUnderstandingModel"),
  }),
  model: z.strictObject({
    provider: z.literal("openai"),
    identity: z.string().min(1).max(160),
    promptVersion: z.string().min(1).max(120),
  }),
  providers: z.strictObject({
    openai: z.strictObject({
      status: z.enum(["available", "blocked"]),
      failureCode: z.string().min(1).max(120).nullable(),
      providerRequestId: z.string().min(1).max(240).nullable(),
    }),
    serper: z.strictObject({
      status: z.enum(["available", "blocked"]),
      failureCode: z.string().min(1).max(120).nullable(),
      shoppingListingCount: z.number().int().nonnegative(),
      evidenceResultCount: z.number().int().nonnegative(),
    }),
  }),
});

type Database = ReturnType<typeof createDatabaseConnection>["db"];
type ProductCase = (typeof cases)[number];

async function exists(url: URL) {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
}

async function gitHead() {
  const { stdout } = await exec("git", ["rev-parse", "HEAD"]);
  return z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .parse(stdout.trim());
}

async function dirtyCodePaths() {
  const { stdout } = await exec("git", ["status", "--porcelain=v1"]);
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).split(" -> ").at(-1) ?? "")
    .filter((path) => !path.startsWith("docs/evals/"));
}

async function secret(name: string, service: string) {
  const configured = process.env[name]?.trim();
  if (configured) return configured;
  const { stdout } = await exec("security", [
    "find-generic-password",
    "-s",
    service,
    "-w",
  ]);
  const value = stdout.trim();
  if (!value) throw new Error(`${name.toLowerCase()}_unavailable`);
  return value;
}

function stableFailureCode(error: unknown) {
  const safeMessage =
    error instanceof Error && /^[a-z0-9_]{1,120}$/.test(error.message)
      ? error.message
      : null;
  const candidate =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : (safeMessage ??
        (error instanceof Error ? error.name : "unknown_failure"));
  return candidate
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .toLocaleLowerCase("en-GB")
    .slice(0, 120);
}

function blockedProvider(error: unknown) {
  return {
    status: "blocked" as const,
    failureCode: stableFailureCode(error),
  };
}

async function preflight() {
  if (!(await exists(freshPreflightOutput))) {
    throw new Error("checkpoint_2_requires_preserved_checkpoint_1");
  }
  if (await exists(checkpointTwoPreflightOutput)) {
    throw new Error("checkpoint_2_preflight_already_exists");
  }
  const preflightId = randomUUID();
  const startedAt = new Date().toISOString();
  const head = await gitHead();
  if ((await dirtyCodePaths()).length > 0) {
    throw new Error("preflight_requires_clean_code_tree");
  }
  let openai: {
    status: "available" | "blocked";
    failureCode: string | null;
    providerRequestId: string | null;
  } = {
    status: "blocked",
    failureCode: "not_run",
    providerRequestId: null,
  };
  let serper: {
    status: "available" | "blocked";
    failureCode: string | null;
    shoppingListingCount: number;
    evidenceResultCount: number;
  } = {
    status: "blocked",
    failureCode: "not_run",
    shoppingListingCount: 0,
    evidenceResultCount: 0,
  };

  try {
    const key = await secret("OPENAI_API_KEY", "ai-shopping-openai");
    const model = createOpenAIProductUnderstandingModel({
      apiKey: key,
      config: { maxOutputTokens: 256 },
    });
    const input: ProductUnderstandingInputV1 = {
      schemaVersion: 1,
      market: { country: "GB", language: "en-GB", currency: "GBP" },
      candidate: {
        title: "Preflight ergonomic mouse",
        merchant: "Preflight merchant",
        observedPriceText: "£1",
      },
      criteria: [
        {
          ordinal: 0,
          label: "Availability",
          definition: "Whether this exact product is currently available",
          strength: "preference",
          targetSemantics: "qualitative",
          value: {
            schemaVersion: 1,
            kind: "qualitative",
            mode: "text",
            text: "available",
          },
        },
      ],
      sources: [
        {
          ordinal: 0,
          role: "listing",
          kind: "listing_field",
          title: "Preflight listing",
          url: "https://example.com/preflight",
          excerpt: "The listing is available.",
        },
      ],
    };
    const response = await model.understand(input, {
      requireCriterionBinding: false,
    });
    if (response.status !== "completed") {
      openai = {
        status: "blocked",
        failureCode: response.errorCode,
        providerRequestId: response.metadata.providerRequestId,
      };
    } else {
      openai = {
        status: "available",
        failureCode: null,
        providerRequestId: response.metadata.providerRequestId,
      };
    }
  } catch (error) {
    openai = { ...blockedProvider(error), providerRequestId: null };
  }

  try {
    const key = await secret("SERPER_API_KEY", "ai-shopping-serper");
    const shopping = new SerperShoppingAdapter({
      apiKey: key,
      timeoutMs: 10_000,
    });
    const evidence = new SerperEvidenceSearchAdapter({
      apiKey: key,
      timeoutMs: 10_000,
    });
    const query = searchQuerySchema.parse({
      id: randomUUID(),
      runId: randomUUID(),
      taskId: randomUUID(),
      taskRevision: 1n,
      hypothesisId: randomUUID(),
      purpose: "literal_precision",
      text: "ergonomic mouse under £50",
      market: { country: "GB", language: "en-GB", currency: "GBP" },
      surface: "shopping",
      limit: 2,
    });
    const shoppingResult = await shopping.search(query);
    const evidenceResult = await evidence.search({
      query: "Logitech Lift official specifications",
      candidateTitle: "Logitech Lift",
      merchant: "Logitech",
    });
    serper = {
      status: "available",
      failureCode: null,
      shoppingListingCount: shoppingResult.listings.length,
      evidenceResultCount: evidenceResult.results.length,
    };
  } catch (error) {
    serper = {
      ...blockedProvider(error),
      shoppingListingCount: 0,
      evidenceResultCount: 0,
    };
  }

  const result = checkpointTwoPreflightSchema.parse({
    schemaVersion: 2,
    preflightId,
    kind: "development_product_engine_preflight",
    checkpointNumber: 2,
    checkpointName: "product_engine_preflight_checkpoint_2",
    startedAt,
    finishedAt: new Date().toISOString(),
    gitHead: head,
    contextBypassed: true,
    releaseAccepted: false,
    rc5: false,
    adapters: {
      shopping: "SerperShoppingAdapter",
      evidence: "SerperEvidenceSearchAdapter",
      productUnderstanding: "OpenAIProductUnderstandingModel",
    },
    model: {
      provider: "openai",
      identity: V0_07_OPENAI_DEFAULT_CONFIG.model,
      promptVersion: PRODUCT_UNDERSTANDING_PROMPT_VERSION,
    },
    providers: { openai, serper },
  });
  await writeFile(
    checkpointTwoPreflightOutput,
    `${JSON.stringify(result, null, 2)}\n`,
    {
      encoding: "utf8",
      flag: "wx",
    },
  );
  console.log(
    JSON.stringify({
      preflightId,
      gitHead: head,
      providers: result.providers,
      artifact: "docs/evals/v0-09-product-engine-preflight-checkpoint-2.json",
    }),
  );
  if (openai.status !== "available" || serper.status !== "available") {
    process.exitCode = 2;
  }
}

async function seed(db: Database, productCase: ProductCase) {
  const task = await createShoppingTask(db, {
    country: "GB",
    language: "en-GB",
    currency: "GBP",
  });
  const subject = await recordInitialShoppingSubject({
    db,
    taskId: task.id,
    clientActionId: `product-live-subject-${task.id}`,
    request: {
      inputSchemaVersion: 1,
      expectedRevision: 0n,
      kind: "message",
      body: productCase.request,
    },
  });
  await applyStatePatch(
    db,
    buildProductEngineInitialPatch(productCase, task.id, subject.input.id),
  );
  const trigger = await recordTaskInput({
    db,
    taskId: task.id,
    clientActionId: `product-live-trigger-${task.id}`,
    request: {
      inputSchemaVersion: 1,
      expectedRevision: 1n,
      kind: "message",
      body: "The seeded brief is ready for search.",
    },
  });
  const application = await applyStatePatch(db, {
    applicationSchemaVersion: 1,
    applicationKind: "patch",
    taskId: task.id,
    expectedRevision: 1n,
    source: { kind: "user_explicit", inputId: trigger.input.id },
    patch: { schemaVersion: 1, outcome: "no_change" },
  });
  const action = await persistContextAction({
    db,
    taskId: task.id,
    stateChangeApplicationId: application.application.id,
    selectedAtRevision: 1n,
    proposal: {
      schemaVersion: 1,
      action: "search",
      rationale: { summary: "Seeded product-engine state is ready." },
    },
    config: {
      provider: "serper",
      model: "product-engine-live",
      promptVersion: "v0-09-product-engine-live-v1",
      providerSchemaVersion: 1,
    },
  });
  return { task, action: action.action };
}

async function clear(db: Database) {
  await db.execute(
    sql.raw(
      `TRUNCATE TABLE shopping_private.context_acquisition_attempts, shopping_private.context_action_answers, shopping_private.context_actions, shopping_private.candidate_listings, shopping_private.search_hypothesis_basis_criteria, shopping_private.search_hypotheses, shopping_private.search_queries, shopping_private.search_query_executions, shopping_private.search_runs, shopping_private.shopping_task_subjects, shopping_private.criterion_assessment_observations, shopping_private.criterion_assessments, shopping_private.evidence_attempt_target_criteria, shopping_private.evidence_acquisition_attempts, shopping_private.evidence_page_fetch_targets, shopping_private.evidence_research_runs, shopping_private.evidence_sources, shopping_private.fetched_evidence_documents, shopping_private.product_observations, shopping_private.saved_candidate_listings, shopping_private.rejected_candidate_listings, shopping_private.merchant_destination_resolutions, shopping_private.state_change_applications, shopping_private.criterion_sources, shopping_private.decision_criteria, shopping_private.concept_definitions, shopping_private.user_messages, shopping_private.task_inputs, shopping_private.shopping_tasks RESTART IDENTITY CASCADE`,
    ),
  );
}

function countAttempts(
  attempts: readonly Readonly<{ stage: string; status: string }>[],
) {
  const counts: Record<string, number> = {};
  for (const attempt of attempts) {
    const key = `${attempt.stage}:${attempt.status}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function decisionSnapshot(
  support: CurrentDecisionSupport,
  savedCandidateListingIds: readonly string[],
) {
  const decision = buildDecisionSupport({
    support,
    savedListingIds: new Set(savedCandidateListingIds),
    savedListings: support.candidates.filter(({ id }) =>
      savedCandidateListingIds.includes(id),
    ),
  });
  return {
    revision: support.brief.revision.toString(),
    observations: support.observations.length,
    currentAssessmentIds: support.assessments.map(({ id }) => id),
    currentAssessmentCount: support.assessments.length,
    currentAssessmentRevisions: [
      ...new Set(
        support.assessments.map(({ taskRevision }) => taskRevision.toString()),
      ),
    ],
    decisionGapCount: decision.decisionGaps.length,
    decisionGaps: decision.decisionGaps.slice(0, 8).map((gap) => ({
      criterionId: gap.criterionId,
      label: gap.label,
      candidateListingIds: gap.candidateListingIds,
    })),
    comparisonRows: decision.comparison?.rows.length ?? 0,
    topOptions: decision.topOptions.slice(0, 4).map((option) => ({
      candidateListingId: option.listing.id,
      title: option.listing.title,
      readiness: option.readiness,
      whyItFits: option.whyItFits,
      watchouts: option.watchouts,
      unknowns: option.unknowns,
      disclosedSourceUrls: option.evidenceSources.map(({ url }) => url),
    })),
  };
}

async function identitySnapshot(db: Database, taskId: string) {
  const [saved, observations, sources, documents, assessments] =
    await Promise.all([
      db
        .select()
        .from(savedCandidateListings)
        .where(eq(savedCandidateListings.taskId, taskId)),
      db
        .select()
        .from(productObservations)
        .where(eq(productObservations.taskId, taskId)),
      db
        .select()
        .from(evidenceSources)
        .where(eq(evidenceSources.taskId, taskId)),
      db
        .select()
        .from(fetchedEvidenceDocuments)
        .where(eq(fetchedEvidenceDocuments.taskId, taskId)),
      db
        .select()
        .from(criterionAssessments)
        .where(eq(criterionAssessments.taskId, taskId)),
    ]);
  return {
    savedCandidateListingIds: saved
      .map(({ candidateListingId }) => candidateListingId)
      .sort(),
    observationIds: observations.map(({ id }) => id).sort(),
    observationCandidatePairs: observations.map(
      ({ id, candidateListingId }) => ({ id, candidateListingId }),
    ),
    sourceIds: sources.map(({ id }) => id).sort(),
    fetchedDocuments: documents.map(
      ({ id, evidenceSourceId, candidateListingId }) => ({
        id,
        evidenceSourceId,
        candidateListingId,
      }),
    ),
    assessments: assessments.map(
      ({ id, taskRevision, criterionId, candidateListingId }) => ({
        id,
        taskRevision: taskRevision.toString(),
        criterionId,
        candidateListingId,
      }),
    ),
  };
}

function domainPath(value: string | null) {
  if (value === null) return null;
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`.slice(0, 300);
  } catch {
    return null;
  }
}

function classifyFailure(options: {
  error: unknown;
  category: string | null;
  stage: string;
  listingsAvailable: boolean;
  partialDecisionSupport: boolean;
}) {
  const layerByStage: Record<string, string> = {
    seed: "harness/infrastructure",
    retrieval: "retrieval",
    first_pass: "product evidence",
    projection: "decision UX",
    save_compare: "comparative judgement",
    deepening: "product evidence",
    refinement: "assessment",
    destinations: "purchase destination",
  };
  const providerByStage: Record<string, string> = {
    retrieval: "serper",
    first_pass: "serper/openai/page_transport",
    deepening: "serper/openai/page_transport",
    refinement: "openai",
    destinations: "serper",
  };
  return {
    category: options.category,
    stage: options.stage,
    layer: layerByStage[options.stage] ?? "harness/infrastructure",
    provider: providerByStage[options.stage] ?? null,
    code: stableFailureCode(options.error),
    occurredAfterListings: options.listingsAvailable,
    partialDecisionSupportExisted: options.partialDecisionSupport,
  };
}

async function proof() {
  const head = await gitHead();
  if (await exists(proofMarkerOutput))
    throw new Error("proof_marker_already_exists");
  if ((await exists(proofOutput)) || (await exists(proofMarkdownOutput))) {
    throw new Error("proof_result_already_exists");
  }
  const preflight = checkpointTwoPreflightSchema.parse(
    JSON.parse(await readFile(checkpointTwoPreflightOutput, "utf8")),
  );
  if (
    preflight.gitHead !== head ||
    preflight.providers.openai.status !== "available" ||
    preflight.providers.serper.status !== "available"
  ) {
    throw new Error("proof_requires_healthy_exact_head_preflight");
  }
  const dirty = await dirtyCodePaths();
  if (dirty.length > 0) throw new Error("proof_requires_clean_code_tree");

  const proofId = randomUUID();
  const startedAt = new Date().toISOString();
  await writeFile(
    proofMarkerOutput,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        proofId,
        preflightId: preflight.preflightId,
        preflightCheckpoint: preflight.checkpointNumber,
        startedAt,
        gitHead: head,
        kind: "development_product_engine_proof",
        configuration: {
          shopping: "SerperShoppingAdapter",
          evidence: "SerperEvidenceSearchAdapter",
          pageFetch: "fetchBoundedPage",
          productUnderstandingModel: V0_07_OPENAI_DEFAULT_CONFIG.model,
          productUnderstandingPrompt: PRODUCT_UNDERSTANDING_PROMPT_VERSION,
          destination: "SerperMerchantDestinationResolver",
        },
        contextBypassed: true,
        releaseAccepted: false,
        rc5: false,
        note: "One-shot product evidence only; not RC5 or release evidence.",
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", flag: "wx" },
  );

  let connection: ReturnType<typeof createDatabaseConnection> | null = null;
  const rows: Record<string, unknown>[] = [];
  let failure: ReturnType<typeof classifyFailure> | null = null;
  let activeCategory: string | null = null;
  let activeStage = "seed";
  let activePartial: Record<string, unknown> = {};
  try {
    const { TEST_DATABASE_URL } = requireTestDatabaseEnvironment(process.env);
    connection = createDatabaseConnection({
      url: TEST_DATABASE_URL,
      maxConnections: 5,
      prepare: false,
    });
    const openAIKey = await secret("OPENAI_API_KEY", "ai-shopping-openai");
    const serperKey = await secret("SERPER_API_KEY", "ai-shopping-serper");
    for (const productCase of cases) {
      activeCategory = productCase.name;
      activeStage = "seed";
      activePartial = { name: productCase.name };
      await clear(connection.db);
      const categoryStarted = performance.now();
      const elapsed = () => Math.round(performance.now() - categoryStarted);
      const providerCalls = {
        shopping: 0,
        evidenceSearch: 0,
        pageFetch: 0,
        model: 0,
        destination: 0,
      };
      const modelBatches: { criteria: string[]; criterionCount: number }[] = [];
      const pageTransports: Record<string, unknown>[] = [];
      const shopping = new SerperShoppingAdapter({
        apiKey: serperKey,
        onRequest: () => {
          providerCalls.shopping += 1;
        },
      });
      const baseEvidence = new SerperEvidenceSearchAdapter({
        apiKey: serperKey,
      });
      const evidence: EvidenceSearchProvider = {
        provider: "serper",
        search: async (input) => {
          providerCalls.evidenceSearch += 1;
          return baseEvidence.search(input);
        },
      };
      const pageFetcher: EvidencePageFetcher = {
        provider: "server_http",
        fetch: async (input) => {
          providerCalls.pageFetch += 1;
          try {
            const result = await fetchBoundedPage(input);
            pageTransports.push({
              candidateTitle: input.candidateTitle.slice(0, 200),
              domainPath: domainPath(result.finalUrl),
              sourceRole: input.discoveredRole,
              status: "succeeded",
              contentType: result.contentType,
              encodedBytes: result.encodedBytes,
              decodedBytes: result.decodedBytes,
            });
            return result;
          } catch (error) {
            pageTransports.push({
              candidateTitle: input.candidateTitle.slice(0, 200),
              domainPath: domainPath(input.url),
              sourceRole: input.discoveredRole,
              status: "failed",
              failureCode: stableFailureCode(error),
            });
            throw error;
          }
        },
      };
      const baseUnderstanding = createOpenAIProductUnderstandingModel({
        apiKey: openAIKey,
        config: { model: V0_07_OPENAI_DEFAULT_CONFIG.model },
      });
      const understanding: ProductUnderstandingModel = {
        understand: async (input, policy) => {
          providerCalls.model += 1;
          modelBatches.push({
            criteria: input.criteria.map(({ label }) => label),
            criterionCount: input.criteria.length,
          });
          return baseUnderstanding.understand(input, policy);
        },
      };
      const baseDestination = new SerperMerchantDestinationResolver({
        apiKey: serperKey,
      });
      const destination: MerchantDestinationResolver = {
        provider: "serper",
        maxRequestDurationMs: baseDestination.maxRequestDurationMs,
        resolve: async (request) => {
          providerCalls.destination += 1;
          return baseDestination.resolve(request);
        },
      };
      const seeded = await seed(connection.db, productCase);

      activeStage = "retrieval";
      const retrieval = await executeOrResumeRetrieval({
        db: connection.db,
        taskId: seeded.task.id,
        contextActionId: seeded.action.id,
        provider: shopping as ShoppingSearchProvider,
      });
      const initialListingsMs = elapsed();
      activePartial = {
        ...activePartial,
        retrievalStatus: retrieval.run.status,
        queryCount: retrieval.run.portfolio.queries.length,
        listingCount: retrieval.run.listings.length,
        initialListingsMs,
      };
      const executionRows = await connection.db
        .select()
        .from(searchQueryExecutions)
        .where(eq(searchQueryExecutions.taskId, seeded.task.id));
      const evidenceDependencies = {
        db: connection.db,
        evidenceProvider: evidence,
        pageFetcher,
        model: understanding,
        modelIdentity: {
          provider: "openai" as const,
          model: V0_07_OPENAI_DEFAULT_CONFIG.model,
          promptVersion: PRODUCT_UNDERSTANDING_PROMPT_VERSION,
        },
      };

      activeStage = "first_pass";
      const research = await executeOrResumeEvidenceResearch({
        dependencies: evidenceDependencies,
        taskId: seeded.task.id,
        searchRunId: retrieval.run.portfolio.run.id,
        mode: "first_pass",
      });
      const firstPassMs = elapsed();
      activeStage = "projection";
      let support = await loadCurrentDecisionSupport({
        db: connection.db,
        taskId: seeded.task.id,
      });
      const candidateIds = support.candidates.slice(0, 2).map(({ id }) => id);
      const firstDecision = decisionSnapshot(support, []);
      const firstDecisionSupportMs = elapsed();
      activePartial = {
        ...activePartial,
        firstPassStatus: research.run.status,
        firstDecisionSupportMs,
        partialDecisionSupport: firstDecision,
      };

      activeStage = "save_compare";
      for (const candidateListingId of candidateIds) {
        await saveCandidateListing({
          db: connection.db,
          taskId: seeded.task.id,
          candidateListingId,
        });
      }
      support = await loadCurrentDecisionSupport({
        db: connection.db,
        taskId: seeded.task.id,
      });
      let mouseRevisionOne: {
        state: ReturnType<typeof decisionSnapshot>;
        identities: Awaited<ReturnType<typeof identitySnapshot>>;
        providerCalls: typeof providerCalls;
      } | null = null;
      const savedDecision = buildDecisionSupport({
        support,
        savedListingIds: new Set(candidateIds),
        savedListings: support.candidates.filter(({ id }) =>
          candidateIds.includes(id),
        ),
      });

      activeStage = "deepening";
      const gap = savedDecision.decisionGaps[0];
      let deepening: Record<string, unknown> | null = null;
      if (gap?.candidateListingIds[0] !== undefined) {
        const targeted = await executeOrResumeEvidenceResearch({
          dependencies: evidenceDependencies,
          taskId: seeded.task.id,
          searchRunId: retrieval.run.portfolio.run.id,
          mode: "targeted",
          targetCandidateListingId: gap.candidateListingIds[0],
          targetCriterionId: gap.criterionId,
        });
        deepening = {
          status: targeted.run.status,
          selectedCandidateCount: targeted.run.selectedCandidateCount,
          attempts: countAttempts(targeted.attempts),
        };
      }
      support = await loadCurrentDecisionSupport({
        db: connection.db,
        taskId: seeded.task.id,
      });
      const postDeepening = decisionSnapshot(support, candidateIds);
      const postDeepeningMs = elapsed();
      if (productCase.name === "ergonomic-mouse") {
        mouseRevisionOne = {
          state: postDeepening,
          identities: await identitySnapshot(connection.db, seeded.task.id),
          providerCalls: { ...providerCalls },
        };
      }

      activeStage = "refinement";
      let refinement: Record<string, unknown> | null = null;
      if (productCase.name === "ergonomic-mouse" && productCase.refinement) {
        const state = await loadCurrentShoppingState(
          connection.db,
          seeded.task.id,
        );
        const label = (conceptId: string) =>
          state.concepts.find(({ id }) => id === conceptId)?.label;
        const reviews = state.activeCriteria.find(
          ({ criterion }) => label(criterion.conceptId) === "Reviews",
        )?.criterion;
        if (!reviews) throw new Error("mouse_reviews_criterion_missing");
        const input = await recordTaskInput({
          db: connection.db,
          taskId: seeded.task.id,
          clientActionId: `product-live-refinement-${seeded.task.id}`,
          request: {
            inputSchemaVersion: 1,
            expectedRevision: 1n,
            kind: "message",
            body: productCase.refinement.request,
          },
        });
        await applyStatePatch(
          connection.db,
          buildMouseRevisionTwoPatch(
            productCase,
            seeded.task.id,
            input.input.id,
            reviews.id,
          ),
        );
        const callsBefore = { ...providerCalls };
        const reassessment = await executeOrResumeEvidenceResearch({
          dependencies: evidenceDependencies,
          taskId: seeded.task.id,
          searchRunId: retrieval.run.portfolio.run.id,
          mode: "reassessment",
          savedCandidateListingIds: candidateIds,
        });
        support = await loadCurrentDecisionSupport({
          db: connection.db,
          taskId: seeded.task.id,
        });
        const revisionTwoBrief = projectShoppingBrief(
          await loadCurrentShoppingState(connection.db, seeded.task.id),
        );
        const identities = await identitySnapshot(
          connection.db,
          seeded.task.id,
        );
        refinement = {
          exactInput: productCase.refinement.request,
          revision: revisionTwoBrief.revision.toString(),
          reviews: revisionTwoBrief.items.find(
            ({ conceptLabel }) => conceptLabel === "Reviews",
          ),
          comfort: revisionTwoBrief.items.find(
            ({ conceptLabel }) => conceptLabel === "Comfort for long workdays",
          ),
          reassessmentStatus: reassessment.run.status,
          reassessmentAttempts: countAttempts(reassessment.attempts),
          state: decisionSnapshot(support, candidateIds),
          identities,
          extraProviderCalls: {
            evidenceSearch:
              providerCalls.evidenceSearch - callsBefore.evidenceSearch,
            pageFetch: providerCalls.pageFetch - callsBefore.pageFetch,
            model: providerCalls.model - callsBefore.model,
          },
          productTruthReuse: {
            savedCandidateIdsPreserved:
              JSON.stringify(identities.savedCandidateListingIds) ===
              JSON.stringify(
                mouseRevisionOne?.identities.savedCandidateListingIds,
              ),
            priorObservationIdsRetained:
              mouseRevisionOne?.identities.observationIds.every((id) =>
                identities.observationIds.includes(id),
              ) ?? false,
            sourceIdsUnchanged:
              JSON.stringify(identities.sourceIds) ===
              JSON.stringify(mouseRevisionOne?.identities.sourceIds),
            fetchedDocumentsUnchanged:
              JSON.stringify(identities.fetchedDocuments) ===
              JSON.stringify(mouseRevisionOne?.identities.fetchedDocuments),
          },
        };
      }

      const finalDecision = decisionSnapshot(support, candidateIds);
      const stableDecisionSupportMs = elapsed();
      activePartial = { ...activePartial, finalDecisionSupport: finalDecision };

      activeStage = "destinations";
      const destinations = await executeOrResumeMerchantDestinationResolution({
        db: connection.db,
        taskId: seeded.task.id,
        visibleTopCandidateListingIds: candidateIds,
        resolver: destination,
      });
      const purchaseDestinationsMs = elapsed();
      const persistedDestinations = await connection.db
        .select()
        .from(merchantDestinationResolutions)
        .where(eq(merchantDestinationResolutions.taskId, seeded.task.id));
      const candidateById = new Map(
        support.candidates.map((candidate) => [candidate.id, candidate]),
      );
      const destinationByCandidate = new Map(
        persistedDestinations.map((resolution) => [
          resolution.candidateListingId,
          resolution,
        ]),
      );
      const purchase = candidateIds.map((candidateListingId) => {
        const candidate = candidateById.get(candidateListingId)!;
        const resolution = destinationByCandidate.get(candidateListingId);
        const directUrl =
          candidate.merchantDestinationUrl ??
          resolution?.destinationUrl ??
          null;
        return {
          candidateListingId,
          title: candidate.title,
          merchant: candidate.merchant,
          outcome:
            directUrl !== null
              ? "direct"
              : (resolution?.status ??
                destinations.results.find(
                  (row) => row.candidateListingId === candidateListingId,
                )?.state ??
                "fallback"),
          exactSameMerchantDestinationAccepted: directUrl !== null,
          rejectionCode:
            resolution?.status === "rejected" || resolution?.status === "failed"
              ? resolution.outcomeCode
              : null,
          acceptedDestination: domainPath(directUrl),
          googleShoppingFallbackAvailable:
            domainPath(candidate.url)?.includes("google.") ?? false,
          consideredResultCount: resolution?.consideredResultCount ?? 0,
        };
      });

      const [attemptRows, sourceRows, documentRows, observationRows] =
        await Promise.all([
          connection.db
            .select()
            .from(evidenceAcquisitionAttempts)
            .where(eq(evidenceAcquisitionAttempts.taskId, seeded.task.id)),
          connection.db
            .select()
            .from(evidenceSources)
            .where(eq(evidenceSources.taskId, seeded.task.id)),
          connection.db
            .select()
            .from(fetchedEvidenceDocuments)
            .where(eq(fetchedEvidenceDocuments.taskId, seeded.task.id)),
          connection.db
            .select()
            .from(productObservations)
            .where(eq(productObservations.taskId, seeded.task.id)),
        ]);
      const pageSourceIds = new Set(
        sourceRows
          .filter(({ sourceKind }) => sourceKind === "fetched_page")
          .map(({ id }) => id),
      );
      const pageObservations = observationRows.filter(({ evidenceSourceId }) =>
        pageSourceIds.has(evidenceSourceId),
      );
      const pageObservationIds = new Set<string>(
        pageObservations.map(({ id }) => id),
      );
      const pageBackedAssessments = support.assessments.filter(
        ({ observationIds }) =>
          observationIds.some((id) => pageObservationIds.has(id)),
      );
      const visibleSourceUrls = new Set(
        finalDecision.topOptions.flatMap(
          ({ disclosedSourceUrls }) => disclosedSourceUrls,
        ),
      );
      const valueChain = pageBackedAssessments.slice(0, 8).map((assessment) => {
        const assessmentObservationIds = new Set<string>(
          assessment.observationIds,
        );
        const observation = pageObservations.find(({ id }) =>
          assessmentObservationIds.has(id),
        );
        const source = sourceRows.find(
          ({ id }) => id === observation?.evidenceSourceId,
        );
        const document = documentRows.find(
          ({ evidenceSourceId }) => evidenceSourceId === source?.id,
        );
        return {
          fetchedDocumentId: document?.id ?? null,
          sourceId: source?.id ?? null,
          observationId: observation?.id ?? null,
          currentAssessmentId: assessment.id,
          candidateListingId: assessment.candidateListingId,
          sourceRole: source?.sourceRole ?? null,
          visibleSourceDisclosure: source
            ? visibleSourceUrls.has(source.sourceUrl)
            : false,
        };
      });
      const pageEvidence = documentRows.map((document) => {
        const source = sourceRows.find(
          ({ id }) => id === document.evidenceSourceId,
        );
        const admission = document.admission as { decision?: unknown };
        return {
          candidateListingId: document.candidateListingId,
          domainPath: domainPath(document.finalUrl),
          sourceRole: source?.sourceRole ?? null,
          contentType: document.contentType,
          encodedBytes: document.encodedBytes,
          decodedBytes: document.decodedBytes,
          retainedDocumentBytes: Buffer.byteLength(
            JSON.stringify(document.document),
            "utf8",
          ),
          admissionDecision:
            typeof admission.decision === "string"
              ? admission.decision
              : "admitted",
          admittedIntoCurrentUnderstanding: pageBackedAssessments.some(
            ({ observationIds }) =>
              pageObservations.some(
                ({ id, evidenceSourceId }) =>
                  evidenceSourceId === document.evidenceSourceId &&
                  new Set<string>(observationIds).has(id),
              ),
          ),
        };
      });
      const finalBrief = projectShoppingBrief(
        await loadCurrentShoppingState(connection.db, seeded.task.id),
      );
      rows.push({
        name: productCase.name,
        authoritativeRequest: productCase.request,
        authoritativeBrief: {
          revision: finalBrief.revision.toString(),
          market: finalBrief.market,
          items: finalBrief.items.map(
            ({ conceptLabel, strength, targetSemantics, semanticValue }) => ({
              label: conceptLabel,
              strength,
              targetSemantics,
              semanticValue,
            }),
          ),
        },
        retrieval: {
          status: retrieval.run.status,
          generatedQueryCount: retrieval.run.portfolio.queries.length,
          queryTexts: retrieval.run.portfolio.queries.map(({ text }) => text),
          uniqueQueryCount: new Set(
            retrieval.run.portfolio.queries.map(({ text }) => text),
          ).size,
          providerQueryCount: providerCalls.shopping,
          receivedListingCount: executionRows.reduce(
            (sum, row) => sum + (row.receivedResultCount ?? 0),
            0,
          ),
          rejectedListingCount: executionRows.reduce(
            (sum, row) => sum + (row.rejectedResultCount ?? 0),
            0,
          ),
          finalCandidateCount: retrieval.run.listings.length,
          representativeCandidates: retrieval.run.listings
            .slice(0, 4)
            .map(({ title, merchant, priceText }) => ({
              title,
              merchant,
              priceText,
            })),
        },
        timingsMs: {
          initialUsableListings: initialListingsMs,
          firstUsefulDecisionSupport: firstDecisionSupportMs,
          afterFirstPassResearch: firstPassMs,
          afterTargetedDeepening: postDeepeningMs,
          stableFinalDecisionSupport: stableDecisionSupportMs,
          purchaseDestinations: purchaseDestinationsMs,
          total: elapsed(),
        },
        progressiveBoundary: {
          listingsObservedBeforeResearchStarted:
            initialListingsMs <= firstPassMs,
          initialListingsMs,
          researchCompletedMs: firstPassMs,
        },
        research: {
          firstPass: {
            phase: research.run.phase,
            status: research.run.status,
            selectedCandidateCount: research.run.selectedCandidateCount,
            selectedCandidateListingIds: [
              ...new Set(
                research.attempts.map(
                  ({ candidateListingId }) => candidateListingId,
                ),
              ),
            ],
            attempts: countAttempts(research.attempts),
          },
          allAttempts: countAttempts(attemptRows),
          providerCalls,
          modelBatchCount: modelBatches.length,
          modelBatches,
          firstPassBatchesWithinTwoCriteria: modelBatches
            .slice(
              0,
              research.attempts.filter(
                ({ stage }) => stage === "criterion_assessment",
              ).length,
            )
            .every(
              ({ criterionCount }) =>
                criterionCount >= 1 && criterionCount <= 2,
            ),
          deepening,
          reassessmentCount: refinement === null ? 0 : 1,
        },
        pages: {
          transports: pageTransports,
          attemptOutcomes: attemptRows
            .filter(({ stage }) => stage === "page_fetch")
            .map(({ candidateListingId, status, failureCode }) => ({
              candidateListingId,
              status,
              rejectionOrFailureCode: failureCode,
            })),
          admittedDocuments: pageEvidence,
          admittedSourceRoles: [
            ...new Set(
              pageEvidence.map(({ sourceRole }) => sourceRole).filter(Boolean),
            ),
          ],
        },
        decisionSupport: {
          firstUseful: firstDecision,
          postDeepening,
          finalCurrent: finalDecision,
          pageToUserValueChain: valueChain,
          realPageReachedCurrentUserValue: valueChain.some(
            ({ visibleSourceDisclosure }) => visibleSourceDisclosure,
          ),
        },
        savedCandidateListingIds: candidateIds,
        purchase,
        mouseRevisionOne,
        refinement,
      });
      activePartial = rows.at(-1) ?? activePartial;
    }
  } catch (error) {
    failure = classifyFailure({
      error,
      category: activeCategory,
      stage: activeStage,
      listingsAvailable: Number(activePartial.listingCount ?? 0) > 0,
      partialDecisionSupport:
        "partialDecisionSupport" in activePartial ||
        "finalDecisionSupport" in activePartial,
    });
  } finally {
    try {
      await connection?.close();
    } catch (error) {
      failure ??= classifyFailure({
        error,
        category: activeCategory,
        stage: "seed",
        listingsAvailable: Number(activePartial.listingCount ?? 0) > 0,
        partialDecisionSupport:
          "partialDecisionSupport" in activePartial ||
          "finalDecisionSupport" in activePartial,
      });
    }
  }

  const result = {
    schemaVersion: 1,
    kind: "development_product_engine_proof",
    proofId,
    gitHead: head,
    startedAt,
    finishedAt: new Date().toISOString(),
    releaseAccepted: false,
    contextBypassed: true,
    rc5: false,
    status: failure === null ? "completed" : "failed",
    failure,
    completedCategories: rows,
    partialCategory: failure === null ? null : activePartial,
  };
  await writeFile(proofOutput, `${JSON.stringify(result, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  const categoryLines = rows.map((row) => {
    const timings = row.timingsMs as Record<string, number>;
    const decision = row.decisionSupport as {
      realPageReachedCurrentUserValue: boolean;
    };
    return `- ${row.name}: ${timings.total} ms total; page-to-user-value=${decision.realPageReachedCurrentUserValue ? "yes" : "no"}`;
  });
  await writeFile(
    proofMarkdownOutput,
    `# Development product-engine proof\n\n- Proof ID: ${proofId}\n- Git HEAD: ${head}\n- Release acceptance: false\n- Context bypassed: true\n- RC5: false\n- Status: ${result.status}\n- Categories completed: ${rows.length}/${cases.length}\n\n${categoryLines.join("\n")}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  console.log(
    JSON.stringify({
      proofId,
      status: result.status,
      categories: rows.length,
      failure,
      artifacts: [
        "docs/evals/v0-09-product-engine-proof-marker.json",
        "docs/evals/v0-09-product-engine-proof.json",
        "docs/evals/v0-09-product-engine-proof.md",
      ],
    }),
  );
  if (failure !== null) process.exitCode = 3;
}

if (process.argv.includes("--preflight")) await preflight();
else if (process.argv.includes("--proof")) await proof();
else {
  console.error("Use --preflight or --proof");
  process.exitCode = 1;
}
