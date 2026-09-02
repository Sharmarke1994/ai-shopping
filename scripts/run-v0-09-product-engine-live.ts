/**
 * Development-only product-engine harness. It deliberately seeds authoritative
 * V0-04 state through the public persistence boundary and never participates in
 * a release predicate. Use --preflight before --proof to limit provider spend.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
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
import { loadCurrentShoppingState } from "../src/features/shopping-state/persistence/state-loaders";
import { SerperMerchantDestinationResolver } from "../src/features/purchase-destinations/serper-merchant-destination-resolver";
import { executeOrResumeMerchantDestinationResolution } from "../src/features/purchase-destinations/orchestrator";
import { SerperShoppingAdapter } from "../src/features/retrieval-spike/serper-shopping-adapter";
import { executeOrResumeRetrieval } from "../src/features/retrieval-spike/retrieval-orchestrator";
import { recordInitialShoppingSubject } from "../src/features/retrieval-spike/persistence/shopping-subjects";
import { createShoppingTask } from "../src/features/shopping-state/persistence/tasks";
import { recordTaskInput } from "../src/features/shopping-state/persistence/inputs-and-messages";
import { applyStatePatch } from "../src/features/shopping-state/persistence/state-transitions";
import { requireTestDatabaseEnvironment } from "../src/infrastructure/config/environment";
import { createDatabaseConnection } from "../src/infrastructure/database/clients";
import { fetchBoundedPage } from "../src/features/product-understanding/page-fetch";

const exec = promisify(execFile);
const output = new URL(
  "../docs/evals/v0-09-product-engine-preflight.json",
  import.meta.url,
);
const cases = [
  {
    name: "ergonomic-mouse",
    request: "ergonomic mouse under £50, comfortable for long workdays",
    criteria: [
      [
        "Budget",
        "Maximum price",
        "range",
        {
          schemaVersion: 1,
          kind: "money",
          mode: "ceiling",
          amountMinor: 5000,
          currency: "GBP",
        },
      ],
      [
        "Comfort",
        "Long-session comfort",
        "qualitative",
        {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "comfortable for long workdays",
        },
      ],
      [
        "Wireless",
        "Wireless connectivity",
        "qualitative",
        {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "wireless",
        },
      ],
    ],
  },
  {
    name: "office-chair",
    request: "breathable office chair around £250 for long sessions",
    criteria: [
      [
        "Budget",
        "Maximum price",
        "range",
        {
          schemaVersion: 1,
          kind: "money",
          mode: "ceiling",
          amountMinor: 35000,
          currency: "GBP",
        },
      ],
      [
        "Lumbar support",
        "Lower-back support",
        "qualitative",
        {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "good lower-back support",
        },
      ],
      [
        "Material",
        "Breathable fabric or mesh",
        "qualitative",
        {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "breathable fabric or mesh",
        },
      ],
    ],
  },
  {
    name: "cordless-vacuum",
    request: "quiet cordless vacuum under £250 for hard floors and rugs",
    criteria: [
      [
        "Budget",
        "Maximum price",
        "range",
        {
          schemaVersion: 1,
          kind: "money",
          mode: "ceiling",
          amountMinor: 25000,
          currency: "GBP",
        },
      ],
      [
        "Floor coverage",
        "Hard floors and rugs",
        "qualitative",
        {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "hard floors and rugs",
        },
      ],
      [
        "Noise",
        "Low noise around a cat",
        "qualitative",
        {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "not very loud",
        },
      ],
    ],
  },
  {
    name: "compact-coffee-machine",
    request: "compact coffee machine under £350 with good espresso",
    criteria: [
      [
        "Budget",
        "Maximum price",
        "range",
        {
          schemaVersion: 1,
          kind: "money",
          mode: "ceiling",
          amountMinor: 35000,
          currency: "GBP",
        },
      ],
      [
        "Width",
        "Maximum machine width",
        "range",
        {
          schemaVersion: 1,
          kind: "measurement_range",
          upper: { amount: "25", inclusive: true },
          unit: "cm",
        },
      ],
      [
        "Espresso",
        "Espresso quality",
        "qualitative",
        {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "genuinely good espresso",
        },
      ],
    ],
  },
] as const;

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
  await writeFile(output, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(result));
  if (
    Object.values(result.providers as Record<string, { status: string }>).some(
      ({ status }) => status !== "available",
    )
  )
    process.exitCode = 2;
}

function patchFor(
  productCase: (typeof cases)[number],
  taskId: string,
  inputId: string,
) {
  return {
    applicationSchemaVersion: 1,
    applicationKind: "patch" as const,
    taskId,
    expectedRevision: 0n,
    source: { kind: "user_explicit" as const, inputId },
    patch: {
      schemaVersion: 1 as const,
      outcome: "change" as const,
      operations: productCase.criteria.flatMap(
        ([label, definition, semantics, value]) => [
          {
            op: "create_concept" as const,
            localRef: label
              .toLocaleLowerCase("en-GB")
              .replace(/[^a-z0-9]+/g, "_"),
            label,
            definition,
            valueFamily:
              value.kind === "money"
                ? ("money" as const)
                : value.kind === "measurement_range"
                  ? ("measurement" as const)
                  : ("qualitative" as const),
            canonicalUnit:
              value.kind === "measurement_range" ? value.unit : null,
          },
          {
            op: "add_criterion" as const,
            concept: {
              kind: "created" as const,
              localRef: label
                .toLocaleLowerCase("en-GB")
                .replace(/[^a-z0-9]+/g, "_"),
            },
            target: {
              strength:
                semantics === "range"
                  ? ("hard" as const)
                  : ("preference" as const),
              targetSemantics:
                semantics === "range"
                  ? ("range" as const)
                  : ("qualitative" as const),
              semanticValue: value,
            },
          },
        ],
      ),
    },
  };
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
  await applyStatePatch(db, patchFor(productCase, task.id, subject.input.id));
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
      const research = await executeOrResumeEvidenceResearch({
        dependencies: {
          db: connection.db,
          evidenceProvider: evidence,
          pageFetcher: { provider: "server_http", fetch: fetchBoundedPage },
          model: understanding,
          modelIdentity: {
            provider: "openai",
            model: V0_07_OPENAI_DEFAULT_CONFIG.model,
            promptVersion: PRODUCT_UNDERSTANDING_PROMPT_VERSION,
          },
        },
        taskId: seeded.task.id,
        searchRunId: retrieval.run.portfolio.run.id,
        mode: "first_pass",
      });
      const support = await loadCurrentDecisionSupport({
        db: connection.db,
        taskId: seeded.task.id,
      });
      const ids = support.candidates.slice(0, 2).map(({ id }) => id);
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
        destinations: destinations.results.length,
      });
    }
  } finally {
    await connection.close();
  }
  await writeFile(
    output,
    JSON.stringify(
      { kind: "development_product_engine_proof", rows },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  console.log(
    JSON.stringify({ categories: rows.length, artifact: output.pathname }),
  );
}

if (process.argv.includes("--preflight")) await preflight();
else if (process.argv.includes("--proof")) await proof();
else console.error("Use --preflight or --proof");
