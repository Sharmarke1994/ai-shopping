/**
 * Development-only product-engine harness. It deliberately seeds authoritative
 * V0-04 state through the public persistence boundary and never participates in
 * a release predicate. Use --preflight before --proof to limit provider spend.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { projectShoppingBrief } from "../src/domain/shopping-state/brief";
import { persistContextAction } from "../src/features/context-acquisition/persistence/context-actions";
import { SerperEvidenceSearchAdapter } from "../src/features/product-understanding/serper-evidence-adapter";
import {
  createOpenAIProductUnderstandingModel,
  V0_07_OPENAI_DEFAULT_CONFIG,
} from "../src/features/product-understanding/openai-adapter";
import type { ProductUnderstandingInputV1 } from "../src/features/product-understanding/provider-wire";
import { PRODUCT_UNDERSTANDING_PROMPT_VERSION } from "../src/features/product-understanding/prompts";
import { executeOrResumeEvidenceResearch } from "../src/features/product-understanding/research-orchestrator";
import { loadCurrentDecisionSupport } from "../src/features/product-understanding/persistence";
import { buildDecisionSupport } from "../src/features/product-understanding/decision-support";
import { loadCurrentShoppingState } from "../src/features/shopping-state/persistence/state-loaders";
import { SerperMerchantDestinationResolver } from "../src/features/purchase-destinations/serper-merchant-destination-resolver";
import { executeOrResumeMerchantDestinationResolution } from "../src/features/purchase-destinations/orchestrator";
import { SerperShoppingAdapter } from "../src/features/retrieval-spike/serper-shopping-adapter";
import { executeOrResumeRetrieval } from "../src/features/retrieval-spike/retrieval-orchestrator";
import { recordInitialShoppingSubject } from "../src/features/retrieval-spike/persistence/shopping-subjects";
import { createShoppingTask } from "../src/features/shopping-state/persistence/tasks";
import { recordTaskInput } from "../src/features/shopping-state/persistence/inputs-and-messages";
import { applyStatePatch } from "../src/features/shopping-state/persistence/state-transitions";
import { saveCandidateListing } from "../src/features/live-shopping/saved-listings";
import { requireTestDatabaseEnvironment } from "../src/infrastructure/config/environment";
import { createDatabaseConnection } from "../src/infrastructure/database/clients";
import { fetchBoundedPage } from "../src/features/product-understanding/page-fetch";
import {
  buildProductEngineInitialPatch,
  buildMouseRevisionTwoPatch,
  V0_09_PRODUCT_ENGINE_CASES,
} from "./support/v0-09-product-engine-cases";

const exec = promisify(execFile);
const preflightOutput = new URL(
  "../docs/evals/v0-09-product-engine-preflight.json",
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

async function secret(name: string, service: string) {
  const configured = process.env[name]?.trim();
  if (configured) return configured;
  const { stdout } = await exec("security", [
    "find-generic-password",
    "-s",
    service,
    "-w",
  ]);
  return stdout.trim();
}

async function preflight() {
  const started = new Date().toISOString();
  const result: Record<string, unknown> = {
    kind: "development_product_engine_preflight",
    started,
    providers: {},
  };
  const openAI = await secret("OPENAI_API_KEY", "ai-shopping-openai");
  const serper = await secret("SERPER_API_KEY", "ai-shopping-serper");
  for (const [provider, operation] of Object.entries({
    openai: async () => {
      const model = createOpenAIProductUnderstandingModel({
        apiKey: openAI,
        config: { timeoutMs: 10_000, maxOutputTokens: 64 },
      });
      const input: ProductUnderstandingInputV1 = {
        schemaVersion: 1,
        market: { country: "GB", language: "en-GB", currency: "GBP" },
        candidate: {
          title: "Preflight product",
          merchant: "Preflight merchant",
          observedPriceText: "£1",
        },
        criteria: [
          {
            ordinal: 0,
            label: "Availability",
            definition: "Whether this product is available",
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
            excerpt: "A development-only provider preflight listing.",
          },
        ],
      };
      const result = await model.understand(input, {
        requireCriterionBinding: false,
      });
      if (result.status !== "completed") {
        throw new Error(`adapter_${result.status}_${result.errorCode}`);
      }
    },
    serper: async () => {
      const response = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": serper, "content-type": "application/json" },
        body: JSON.stringify({
          q: "site:johnlewis.com ergonomic mouse",
          gl: "gb",
          hl: "en",
        }),
      });
      if (!response.ok) throw new Error(`provider_http_${response.status}`);
    },
  })) {
    try {
      await operation();
      result.providers = {
        ...(result.providers as object),
        [provider]: { status: "available" },
      };
    } catch (error) {
      result.providers = {
        ...(result.providers as object),
        [provider]: {
          status: "blocked",
          reason: error instanceof Error ? error.message : "provider_failed",
        },
      };
    }
  }
  result.finished = new Date().toISOString();
  await writeFile(
    preflightOutput,
    JSON.stringify(result, null, 2) + "\n",
    "utf8",
  );
  console.log(JSON.stringify(result));
  if (
    Object.values(result.providers as Record<string, { status: string }>).some(
      ({ status }) => status !== "available",
    )
  )
    process.exitCode = 2;
}

async function seed(
  db: ReturnType<typeof createDatabaseConnection>["db"],
  productCase: (typeof cases)[number],
) {
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

async function clear(db: ReturnType<typeof createDatabaseConnection>["db"]) {
  await db.execute(
    sql.raw(
      `TRUNCATE TABLE shopping_private.context_acquisition_attempts, shopping_private.context_action_answers, shopping_private.context_actions, shopping_private.candidate_listings, shopping_private.search_hypothesis_basis_criteria, shopping_private.search_hypotheses, shopping_private.search_queries, shopping_private.search_query_executions, shopping_private.search_runs, shopping_private.shopping_task_subjects, shopping_private.criterion_assessment_observations, shopping_private.criterion_assessments, shopping_private.evidence_attempt_target_criteria, shopping_private.evidence_acquisition_attempts, shopping_private.evidence_page_fetch_targets, shopping_private.evidence_research_runs, shopping_private.evidence_sources, shopping_private.fetched_evidence_documents, shopping_private.product_observations, shopping_private.saved_candidate_listings, shopping_private.rejected_candidate_listings, shopping_private.merchant_destination_resolutions, shopping_private.state_change_applications, shopping_private.criterion_sources, shopping_private.decision_criteria, shopping_private.concept_definitions, shopping_private.user_messages, shopping_private.task_inputs, shopping_private.shopping_tasks RESTART IDENTITY CASCADE`,
    ),
  );
}

async function proof() {
  const preflight = JSON.parse(await readFile(preflightOutput, "utf8")) as {
    providers?: Record<string, { status?: string }>;
  };
  if (
    preflight.providers?.openai?.status !== "available" ||
    preflight.providers?.serper?.status !== "available"
  ) {
    throw new Error("proof_requires_healthy_fresh_preflight");
  }
  const proofId = randomUUID();
  const started = new Date().toISOString();
  const { stdout: gitHead } = await exec("git", ["rev-parse", "HEAD"]);
  await writeFile(
    proofMarkerOutput,
    JSON.stringify(
      {
        schemaVersion: 1,
        proofId,
        started,
        gitHead: gitHead.trim(),
        kind: "development_product_engine_proof",
        contextBypassed: true,
        releaseAccepted: false,
        note: "This is product-engine evidence only; not RC5 or release evidence.",
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  const { TEST_DATABASE_URL } = requireTestDatabaseEnvironment(process.env);
  const connection = createDatabaseConnection({
    url: TEST_DATABASE_URL,
    maxConnections: 5,
    prepare: false,
  });
  const openAIKey = await secret("OPENAI_API_KEY", "ai-shopping-openai");
  const serperKey = await secret("SERPER_API_KEY", "ai-shopping-serper");
  const shopping = new SerperShoppingAdapter({ apiKey: serperKey });
  const evidence = new SerperEvidenceSearchAdapter({ apiKey: serperKey });
  const understanding = createOpenAIProductUnderstandingModel({
    apiKey: openAIKey,
    config: { model: V0_07_OPENAI_DEFAULT_CONFIG.model },
  });
  const destination = new SerperMerchantDestinationResolver({
    apiKey: serperKey,
  });
  const rows: unknown[] = [];
  let failure: { code: string } | null = null;
  try {
    for (const productCase of cases) {
      await clear(connection.db);
      const seeded = await seed(connection.db, productCase);
      const retrieval = await executeOrResumeRetrieval({
        db: connection.db,
        taskId: seeded.task.id,
        contextActionId: seeded.action.id,
        provider: shopping,
      });
      const evidenceDependencies = {
        db: connection.db,
        evidenceProvider: evidence,
        pageFetcher: {
          provider: "server_http" as const,
          fetch: fetchBoundedPage,
        },
        model: understanding,
        modelIdentity: {
          provider: "openai" as const,
          model: V0_07_OPENAI_DEFAULT_CONFIG.model,
          promptVersion: PRODUCT_UNDERSTANDING_PROMPT_VERSION,
        },
      };
      const research = await executeOrResumeEvidenceResearch({
        dependencies: evidenceDependencies,
        taskId: seeded.task.id,
        searchRunId: retrieval.run.portfolio.run.id,
        mode: "first_pass",
      });
      let support = await loadCurrentDecisionSupport({
        db: connection.db,
        taskId: seeded.task.id,
      });
      const ids = support.candidates.slice(0, 2).map(({ id }) => id);
      for (const candidateListingId of ids) {
        await saveCandidateListing({
          db: connection.db,
          taskId: seeded.task.id,
          candidateListingId,
        });
      }
      const savedSupport = await loadCurrentDecisionSupport({
        db: connection.db,
        taskId: seeded.task.id,
      });
      const decision = buildDecisionSupport({
        support: savedSupport,
        savedListingIds: new Set(ids),
        savedListings: savedSupport.candidates,
      });
      const gap = decision.decisionGaps[0];
      let deepening: { status: string; attempts: number } | null = null;
      if (gap !== undefined && gap.candidateListingIds[0] !== undefined) {
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
          attempts: targeted.attempts.length,
        };
        support = await loadCurrentDecisionSupport({
          db: connection.db,
          taskId: seeded.task.id,
        });
      }
      let refinement: {
        revision: string;
        reassessmentAttempts: number;
      } | null = null;
      if (productCase.name === "ergonomic-mouse" && productCase.refinement) {
        const state = await loadCurrentShoppingState(
          connection.db,
          seeded.task.id,
        );
        const conceptLabel = (conceptId: string) =>
          state.concepts.find(({ id }) => id === conceptId)?.label;
        const reviews = state.activeCriteria.find(
          ({ criterion }) => conceptLabel(criterion.conceptId) === "Reviews",
        )?.criterion;
        if (reviews === undefined)
          throw new Error("mouse_reviews_criterion_missing");
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
        const reassessment = await executeOrResumeEvidenceResearch({
          dependencies: evidenceDependencies,
          taskId: seeded.task.id,
          searchRunId: retrieval.run.portfolio.run.id,
          mode: "reassessment",
          savedCandidateListingIds: ids,
        });
        refinement = {
          revision: (
            await loadCurrentShoppingState(connection.db, seeded.task.id)
          ).task.currentRevision.toString(),
          reassessmentAttempts: reassessment.attempts.length,
        };
        support = await loadCurrentDecisionSupport({
          db: connection.db,
          taskId: seeded.task.id,
        });
      }
      const destinations = await executeOrResumeMerchantDestinationResolution({
        db: connection.db,
        taskId: seeded.task.id,
        visibleTopCandidateListingIds: ids,
        resolver: destination,
      });
      rows.push({
        name: productCase.name,
        revision: projectShoppingBrief(
          await loadCurrentShoppingState(connection.db, seeded.task.id),
        ).revision.toString(),
        brief: projectShoppingBrief(
          await loadCurrentShoppingState(connection.db, seeded.task.id),
        ).items.map(
          ({ conceptLabel, strength, targetSemantics, semanticValue }) => ({
            label: conceptLabel,
            strength,
            targetSemantics,
            semanticValue,
          }),
        ),
        queries: retrieval.run.portfolio.queries.map(({ text }) => text),
        listings: support.candidates
          .slice(0, 2)
          .map(({ title, merchant, priceText, url, imageUrl }) => ({
            title,
            merchant,
            priceText,
            url,
            image: imageUrl,
          })),
        evidenceAttempts: research.attempts.length,
        observations: support.observations.length,
        assessments: support.assessments.length,
        unknowns: decision.decisionGaps.length,
        savedCandidates: ids.length,
        comparisonRows: decision.comparison?.rows.length ?? 0,
        deepening,
        refinement,
        destinations: destinations.results.length,
      });
    }
  } catch (error) {
    failure = {
      code: error instanceof Error ? error.name : "proof_failed",
    };
  } finally {
    await connection.close();
  }
  await writeFile(
    proofOutput,
    JSON.stringify(
      {
        kind: "development_product_engine_proof",
        proofId,
        started,
        finished: new Date().toISOString(),
        releaseAccepted: false,
        contextBypassed: true,
        status: failure === null ? "completed" : "failed",
        failure,
        rows,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await writeFile(
    proofMarkdownOutput,
    `# Development product-engine proof\n\nRelease acceptance: false\nContext bypassed: true\nStatus: ${failure === null ? "completed" : "failed"}\nCategories attempted: ${rows.length}/${cases.length}\n`,
    "utf8",
  );
  console.log(
    JSON.stringify({ categories: rows.length, artifact: proofOutput.pathname }),
  );
  if (failure !== null) process.exitCode = 3;
}

if (process.argv.includes("--preflight")) await preflight();
else if (process.argv.includes("--proof")) await proof();
else console.error("Use --preflight or --proof");
