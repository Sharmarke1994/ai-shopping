/**
 * Development-only product-engine proof.
 *
 * These fixtures intentionally bypass context acquisition, but do not bypass
 * the V0-04 authority boundary: every criterion is persisted through
 * createShoppingTask -> recordInitialShoppingSubject -> applyStatePatch.
 * This file is product-engine evidence, never release acceptance evidence.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { persistContextAction } from "../../src/features/context-acquisition/persistence/context-actions";
import { saveCandidateListing } from "../../src/features/live-shopping/saved-listings";
import {
  FakeEvidencePageFetcher,
  FakeEvidenceSearchProvider,
  FakeProductUnderstandingModel,
} from "../../src/features/product-understanding/fakes";
import { executeOrResumeEvidenceResearch } from "../../src/features/product-understanding/research-orchestrator";
import { loadCurrentDecisionSupport } from "../../src/features/product-understanding/persistence";
import { buildDecisionSupport } from "../../src/features/product-understanding/decision-support";
import { executeOrResumeMerchantDestinationResolution } from "../../src/features/purchase-destinations/orchestrator";
import { FakeShoppingProvider } from "../../src/features/retrieval-spike/fake-shopping-provider";
import {
  candidateListingSchema,
  providerSearchResultSchema,
  type SearchQuery,
  type ShoppingSearchProvider,
} from "../../src/features/retrieval-spike/contracts";
import { loadPersistedSearchRun } from "../../src/features/retrieval-spike/persistence/search-runs";
import { executeOrResumeRetrieval } from "../../src/features/retrieval-spike/retrieval-orchestrator";
import { recordInitialShoppingSubject } from "../../src/features/retrieval-spike/persistence/shopping-subjects";
import { createShoppingTask } from "../../src/features/shopping-state/persistence/tasks";
import { recordTaskInput } from "../../src/features/shopping-state/persistence/inputs-and-messages";
import { applyStatePatch } from "../../src/features/shopping-state/persistence/state-transitions";
import { loadCurrentShoppingState } from "../../src/features/shopping-state/persistence/state-loaders";
import {
  createTestDatabaseConnection,
  resetShoppingState,
  type TestDatabaseConnection,
} from "./helpers";

const actionConfig = {
  provider: "fixture",
  model: "v0-09-product-engine-fixture",
  promptVersion: "v0-09-product-engine-proof-v1",
  providerSchemaVersion: 1,
} as const;

type ProductCase = {
  name:
    | "ergonomic-mouse"
    | "office-chair"
    | "cordless-vacuum"
    | "compact-coffee-machine";
  request: string;
  criteria: readonly {
    localRef: string;
    label: string;
    definition: string;
    strength: "hard" | "strong_preference" | "preference";
    targetSemantics: "qualitative" | "range";
    semanticValue: Record<string, unknown>;
  }[];
};

const cases: readonly ProductCase[] = [
  {
    name: "ergonomic-mouse",
    request:
      "I need an ergonomic mouse under £50 with good comfort for long workdays.",
    criteria: [
      {
        localRef: "budget",
        label: "Budget",
        definition: "Maximum purchase price",
        strength: "hard",
        targetSemantics: "range",
        semanticValue: {
          schemaVersion: 1,
          kind: "money",
          mode: "ceiling",
          amountMinor: 5000,
          currency: "GBP",
        },
      },
      {
        localRef: "comfort",
        label: "Long-session comfort",
        definition: "Comfort during extended workdays",
        strength: "strong_preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "comfortable for long workdays",
        },
      },
      {
        localRef: "wireless",
        label: "Wireless",
        definition: "Wireless connectivity",
        strength: "preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "wireless",
        },
      },
    ],
  },
  {
    name: "office-chair",
    request:
      "I need a breathable office chair around £250 for long work sessions.",
    criteria: [
      {
        localRef: "budget",
        label: "Budget",
        definition: "Target chair price",
        strength: "hard",
        targetSemantics: "range",
        semanticValue: {
          schemaVersion: 1,
          kind: "money",
          mode: "ceiling",
          amountMinor: 35000,
          currency: "GBP",
        },
      },
      {
        localRef: "lumbar",
        label: "Lower-back support",
        definition: "Support for the lower back",
        strength: "strong_preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "good lower-back support",
        },
      },
      {
        localRef: "material",
        label: "Breathable material",
        definition: "Fabric or mesh rather than leather",
        strength: "preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "breathable fabric or mesh",
        },
      },
    ],
  },
  {
    name: "cordless-vacuum",
    request:
      "I need a quiet cordless vacuum under £250 for hard floors and rugs.",
    criteria: [
      {
        localRef: "budget",
        label: "Budget",
        definition: "Maximum vacuum price",
        strength: "hard",
        targetSemantics: "range",
        semanticValue: {
          schemaVersion: 1,
          kind: "money",
          mode: "ceiling",
          amountMinor: 25000,
          currency: "GBP",
        },
      },
      {
        localRef: "surfaces",
        label: "Floor coverage",
        definition: "Works on hard floors and rugs",
        strength: "hard",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "hard floors and rugs",
        },
      },
      {
        localRef: "noise",
        label: "Low noise",
        definition: "Suitable around a noise-sensitive cat",
        strength: "strong_preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "not very loud",
        },
      },
    ],
  },
  {
    name: "compact-coffee-machine",
    request: "I need a compact coffee machine under £350 with good espresso.",
    criteria: [
      {
        localRef: "budget",
        label: "Budget",
        definition: "Maximum coffee-machine price",
        strength: "hard",
        targetSemantics: "range",
        semanticValue: {
          schemaVersion: 1,
          kind: "money",
          mode: "ceiling",
          amountMinor: 35000,
          currency: "GBP",
        },
      },
      {
        localRef: "width",
        label: "Compact width",
        definition: "Maximum machine width",
        strength: "hard",
        targetSemantics: "range",
        semanticValue: {
          schemaVersion: 1,
          kind: "measurement_range",
          upper: { amount: "25", inclusive: true },
          unit: "cm",
        },
      },
      {
        localRef: "espresso",
        label: "Espresso quality",
        definition: "Quality of espresso produced",
        strength: "strong_preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "genuinely good espresso",
        },
      },
    ],
  },
];

function completedPatch(
  productCase: ProductCase,
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
      operations: productCase.criteria.flatMap((criterion) => [
        {
          op: "create_concept" as const,
          localRef: criterion.localRef,
          label: criterion.label,
          definition: criterion.definition,
          valueFamily:
            criterion.semanticValue.kind === "money"
              ? ("money" as const)
              : criterion.targetSemantics === "range"
                ? ("measurement" as const)
                : ("qualitative" as const),
          canonicalUnit:
            criterion.semanticValue.kind === "measurement_range"
              ? ("cm" as const)
              : null,
        },
        {
          op: "add_criterion" as const,
          concept: { kind: "created" as const, localRef: criterion.localRef },
          target: {
            strength: criterion.strength,
            targetSemantics: criterion.targetSemantics,
            semanticValue: criterion.semanticValue,
          },
        },
      ]),
    },
  };
}

async function seedFixture(
  db: TestDatabaseConnection["db"],
  productCase: ProductCase,
) {
  const task = await createShoppingTask(db, {
    country: "GB",
    language: "en-GB",
    currency: "GBP",
  });
  const subject = await recordInitialShoppingSubject({
    db,
    taskId: task.id,
    clientActionId: `product-proof-subject-${productCase.name}-${task.id}`,
    request: {
      inputSchemaVersion: 1,
      expectedRevision: 0n,
      kind: "message",
      body: productCase.request,
    },
  });
  const application = await applyStatePatch(
    db,
    completedPatch(productCase, task.id, subject.input.id),
  );
  const trigger = await recordTaskInput({
    db,
    taskId: task.id,
    clientActionId: `product-proof-search-${task.id}`,
    request: {
      inputSchemaVersion: 1,
      expectedRevision: 1n,
      kind: "message",
      body: "The seeded brief is ready for product search.",
    },
  });
  const triggerApplication = await applyStatePatch(db, {
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
    stateChangeApplicationId: triggerApplication.application.id,
    selectedAtRevision: 1n,
    proposal: {
      schemaVersion: 1,
      action: "search",
      rationale: {
        summary:
          "Seeded authoritative brief is ready for bounded product retrieval.",
      },
    },
    config: actionConfig,
  });
  return { task, subject, application, action: action.action };
}

function productProvider(): ShoppingSearchProvider {
  let call = 0;
  return {
    provider: "fixture",
    maxRequestDurationMs: 0,
    search: async (query: SearchQuery) => {
      call += 1;
      const listings = [0, 1].map((offset) => {
        const url = `https://www.google.com/shopping/product/product-proof-${call}-${offset}`;
        return candidateListingSchema.parse({
          taskId: query.taskId,
          runId: query.runId,
          queryId: query.id,
          provider: "fixture",
          providerResultId: `product-proof:${call}:${offset}`,
          sourceRank: offset + 1,
          surface: "shopping",
          title: `Product-engine candidate ${offset + 1} ${query.text.slice(0, 60)}`,
          url,
          canonicalUrl: url,
          merchantDestinationUrl: null,
          merchantDestinationSource: null,
          merchant: "Fixture Outfitters",
          price: { amountMinor: 2499 + offset * 1000, currency: "GBP" },
          priceText: `£${(24.99 + offset * 10).toFixed(2)}`,
          imageUrl: "https://example.test/images/product-proof.jpg",
          deliveryText: "Delivery available",
          availabilityText: "In stock",
          reviewEvidence: null,
          retrievedAt: new Date("2026-09-02T12:00:00.000Z"),
        });
      });
      return providerSearchResultSchema.parse({
        listings,
        diagnostics: {
          receivedResultCount: listings.length,
          rejectedResultCount: 0,
        },
      });
    },
  };
}

describe("development-only V0-09 product engine proof", () => {
  let connection: TestDatabaseConnection;
  beforeAll(() => {
    connection = createTestDatabaseConnection("v009_product_engine_proof");
  });
  beforeEach(async () => {
    await resetShoppingState(connection);
  });
  afterAll(async () => {
    await connection.close();
  });

  it.each(cases)(
    "runs the $name seeded journey through retrieval, evidence, assessment, save/compare and destination",
    async (productCase) => {
      const seeded = await seedFixture(connection.db, productCase);
      const retrieval = await executeOrResumeRetrieval({
        db: connection.db,
        taskId: seeded.task.id,
        contextActionId: seeded.action.id,
        provider: productProvider(),
      });
      expect(retrieval.state).toBe("completed");
      expect(retrieval.run.status).toBe("succeeded");
      expect(retrieval.run.portfolio.queries.length).toBeGreaterThanOrEqual(2);
      expect(
        new Set(retrieval.run.portfolio.queries.map(({ text }) => text)).size,
      ).toBeGreaterThan(1);

      const evidenceSearch = new FakeEvidenceSearchProvider();
      const understanding = new FakeProductUnderstandingModel();
      const firstPass = await executeOrResumeEvidenceResearch({
        dependencies: {
          db: connection.db,
          evidenceProvider: evidenceSearch,
          pageFetcher: new FakeEvidencePageFetcher(),
          model: understanding,
          modelIdentity: {
            provider: "fixture",
            model: "product-proof-understanding",
            promptVersion: "product-proof-v1",
          },
        },
        taskId: seeded.task.id,
        searchRunId: retrieval.run.portfolio.run.id,
        mode: "first_pass",
      });
      expect(firstPass.run.status).toBe("succeeded");
      expect(
        firstPass.attempts.some(
          ({ stage, status }) =>
            stage === "page_fetch" && status === "succeeded",
        ),
      ).toBe(true);
      expect(
        firstPass.attempts.some(
          ({ stage, status }) =>
            stage === "observation_extraction" && status === "succeeded",
        ),
      ).toBe(true);

      const support = await loadCurrentDecisionSupport({
        db: connection.db,
        taskId: seeded.task.id,
      });
      expect(support.observations.length).toBeGreaterThan(0);
      expect(support.assessments.length).toBeGreaterThan(0);
      const candidateIds = support.candidates.slice(0, 2).map(({ id }) => id);
      expect(candidateIds).toHaveLength(2);
      for (const candidateListingId of candidateIds)
        await saveCandidateListing({
          db: connection.db,
          taskId: seeded.task.id,
          candidateListingId,
        });
      const savedSupport = await loadCurrentDecisionSupport({
        db: connection.db,
        taskId: seeded.task.id,
      });
      const comparison = buildDecisionSupport({
        support: savedSupport,
        savedListingIds: new Set(candidateIds),
        savedListings: savedSupport.candidates,
      });
      expect(comparison.comparison?.rows.length ?? 0).toBeGreaterThanOrEqual(2);

      const reassessment = await executeOrResumeEvidenceResearch({
        dependencies: {
          db: connection.db,
          evidenceProvider: evidenceSearch,
          pageFetcher: new FakeEvidencePageFetcher(),
          model: understanding,
          modelIdentity: {
            provider: "fixture",
            model: "product-proof-understanding",
            promptVersion: "product-proof-v1",
          },
        },
        taskId: seeded.task.id,
        searchRunId: retrieval.run.portfolio.run.id,
        mode: "reassessment",
        savedCandidateListingIds: candidateIds,
      });
      expect(reassessment.run.phase).toBe("reassessment");
      expect(reassessment.run.status).toBe("succeeded");

      const destinations = await executeOrResumeMerchantDestinationResolution({
        db: connection.db,
        taskId: seeded.task.id,
        visibleTopCandidateListingIds: candidateIds,
        resolver: {
          provider: "fixture",
          maxRequestDurationMs: 0,
          resolve: async (request) => ({
            outcome: "resolved" as const,
            destinationUrl: `https://fixtureoutfitters.co.uk/products/${request.candidateListingId}`,
            acceptedResultTitle: request.title,
            observedResultUrl: null,
            consideredResultCount: 1,
          }),
        },
      });
      expect(destinations.results).toHaveLength(2);
      expect(
        destinations.results.every(
          ({ resolution }) => resolution?.status === "resolved",
        ),
      ).toBe(true);
    },
  );

  it("switches the mouse authority to a refined revision while retaining exact saved candidates", async () => {
    const seeded = await seedFixture(connection.db, cases[0]!);
    const retrieval = await executeOrResumeRetrieval({
      db: connection.db,
      taskId: seeded.task.id,
      contextActionId: seeded.action.id,
      provider: productProvider(),
    });
    const fakeDeps = {
      db: connection.db,
      evidenceProvider: new FakeEvidenceSearchProvider(),
      pageFetcher: new FakeEvidencePageFetcher(),
      model: new FakeProductUnderstandingModel(),
      modelIdentity: {
        provider: "fixture" as const,
        model: "product-proof-understanding",
        promptVersion: "product-proof-v1",
      },
    };
    await executeOrResumeEvidenceResearch({
      dependencies: fakeDeps,
      taskId: seeded.task.id,
      searchRunId: retrieval.run.portfolio.run.id,
      mode: "first_pass",
    });
    const before = await loadCurrentDecisionSupport({
      db: connection.db,
      taskId: seeded.task.id,
    });
    const candidateId = before.candidates[0]?.id;
    const comfort = (
      await loadCurrentShoppingState(connection.db, seeded.task.id)
    ).activeCriteria.find(
      ({ criterion }) => criterion.targetSemantics === "qualitative",
    )?.criterion;
    expect(candidateId).toBeDefined();
    expect(comfort).toBeDefined();
    await saveCandidateListing({
      db: connection.db,
      taskId: seeded.task.id,
      candidateListingId: candidateId!,
    });
    const refinement = await recordTaskInput({
      db: connection.db,
      taskId: seeded.task.id,
      clientActionId: `product-proof-refine-${seeded.task.id}`,
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 1n,
        kind: "message",
        body: "Comfort for long workdays matters most now.",
      },
    });
    await applyStatePatch(connection.db, {
      applicationSchemaVersion: 1,
      applicationKind: "patch",
      taskId: seeded.task.id,
      expectedRevision: 1n,
      source: { kind: "user_explicit", inputId: refinement.input.id },
      patch: {
        schemaVersion: 1,
        outcome: "change",
        operations: [
          {
            op: "replace_target",
            targetCriterionId: comfort!.id,
            result: {
              strength: "hard",
              targetSemantics: "qualitative",
              semanticValue: {
                schemaVersion: 1,
                kind: "qualitative",
                mode: "text",
                text: "comfortable for long workdays",
              },
            },
          },
        ],
      },
    });
    const afterState = await loadCurrentShoppingState(
      connection.db,
      seeded.task.id,
    );
    expect(afterState.task.currentRevision).toBe(2n);
    await executeOrResumeEvidenceResearch({
      dependencies: fakeDeps,
      taskId: seeded.task.id,
      searchRunId: retrieval.run.portfolio.run.id,
      mode: "reassessment",
      savedCandidateListingIds: [candidateId!],
    });
    const after = await loadCurrentDecisionSupport({
      db: connection.db,
      taskId: seeded.task.id,
    });
    expect(after.brief.revision).toBe(2n);
    expect(
      after.assessments.some(({ taskRevision }) => taskRevision === 2n),
    ).toBe(true);
  });
});
