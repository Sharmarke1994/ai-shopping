/**
 * Development-only product-engine proof.
 *
 * These fixtures intentionally bypass context acquisition, but do not bypass
 * the V0-04 authority boundary: every criterion is persisted through
 * createShoppingTask -> recordInitialShoppingSubject -> applyStatePatch.
 * This file is product-engine evidence, never release acceptance evidence.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  buildMouseRevisionTwoPatch,
  buildProductEngineInitialPatch,
  V0_09_PRODUCT_ENGINE_CASES,
  type ProductEngineFixture,
} from "../../scripts/support/v0-09-product-engine-cases";
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
import {
  candidateListingSchema,
  providerSearchResultSchema,
  type SearchQuery,
  type ShoppingSearchProvider,
} from "../../src/features/retrieval-spike/contracts";
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

const cases = V0_09_PRODUCT_ENGINE_CASES;

function completedPatch(
  productCase: ProductEngineFixture,
  taskId: Parameters<typeof buildProductEngineInitialPatch>[1],
  inputId: Parameters<typeof buildProductEngineInitialPatch>[2],
) {
  return buildProductEngineInitialPatch(productCase, taskId, inputId);
}

async function seedFixture(
  db: TestDatabaseConnection["db"],
  productCase: ProductEngineFixture,
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
  expect(subject.message.body).toBe(productCase.request);
  expect(application.brief).toMatchObject({
    taskId: task.id,
    revision: 1n,
    market: { country: "GB", language: "en-GB", currency: "GBP" },
  });
  expect(application.brief.items).toHaveLength(productCase.criteria.length);
  for (const expected of productCase.criteria) {
    const item = application.brief.items.find(
      ({ conceptLabel }) => conceptLabel === expected.label,
    );
    expect(item).toMatchObject({
      conceptLabel: expected.label,
      conceptDefinition: expected.definition,
      strength: expected.strength,
      targetSemantics: expected.targetSemantics,
      semanticValue: expected.semanticValue,
    });
  }
  if (productCase.name === "ergonomic-mouse") {
    expect(
      application.brief.items.some(({ conceptLabel }) =>
        /ergonomic design/i.test(conceptLabel),
      ),
    ).toBe(false);
  }
  const persistedState = await loadCurrentShoppingState(db, task.id);
  for (const indifferent of productCase.indifferentConcepts) {
    const concept = persistedState.concepts.find(
      ({ label }) => label === indifferent.label,
    );
    expect(concept).toMatchObject({
      label: indifferent.label,
      definition: indifferent.definition,
    });
    const criterion = persistedState.activeCriteria.find(
      ({ criterion }) => criterion.conceptId === concept?.id,
    )?.criterion;
    expect(criterion?.semanticValue).toEqual({
      schemaVersion: 1,
      kind: "indifferent",
    });
  }
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

      let destinationCall = 0;
      const destinations = await executeOrResumeMerchantDestinationResolution({
        db: connection.db,
        taskId: seeded.task.id,
        visibleTopCandidateListingIds: candidateIds,
        resolver: {
          provider: "fixture",
          maxRequestDurationMs: 0,
          resolve: async (request) => {
            destinationCall += 1;
            return destinationCall === 1
              ? {
                  outcome: "resolved" as const,
                  destinationUrl: `https://fixtureoutfitters.co.uk/products/${request.candidateListingId}`,
                  acceptedResultTitle: request.title,
                  observedResultUrl: null,
                  consideredResultCount: 1,
                }
              : {
                  outcome: "rejected" as const,
                  rejectionCode: "no_results" as const,
                  consideredResultCount: 0,
                };
          },
        },
      });
      expect(destinations.results).toHaveLength(2);
      expect(
        destinations.results.filter(
          ({ resolution }) => resolution?.status === "resolved",
        ),
      ).toHaveLength(1);
      expect(
        destinations.results.filter(
          ({ resolution }) => resolution?.status === "rejected",
        ),
      ).toHaveLength(1);
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
    const stateBeforeRefinement = await loadCurrentShoppingState(
      connection.db,
      seeded.task.id,
    );
    const conceptLabel = (conceptId: string) =>
      stateBeforeRefinement.concepts.find(({ id }) => id === conceptId)?.label;
    const reviews = stateBeforeRefinement.activeCriteria.find(
      ({ criterion }) => conceptLabel(criterion.conceptId) === "Reviews",
    )?.criterion;
    expect(candidateId).toBeDefined();
    expect(reviews).toBeDefined();
    expect(reviews?.strength).toBe("strong_preference");
    const preservedBefore = new Map(
      stateBeforeRefinement.activeCriteria
        .filter(({ criterion }) => criterion.id !== reviews?.id)
        .map(({ criterion }) => [
          conceptLabel(criterion.conceptId),
          {
            criterionId: criterion.id,
            strength: criterion.strength,
            semanticValue: criterion.semanticValue,
          },
        ]),
    );
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
        body: cases[0]!.refinement!.request,
      },
    });
    await applyStatePatch(connection.db, {
      ...buildMouseRevisionTwoPatch(
        cases[0]!,
        seeded.task.id,
        refinement.input.id,
        reviews!.id,
      ),
    });
    const afterState = await loadCurrentShoppingState(
      connection.db,
      seeded.task.id,
    );
    expect(afterState.task.currentRevision).toBe(2n);
    const afterLabel = (conceptId: string) =>
      afterState.concepts.find(({ id }) => id === conceptId)?.label;
    const afterReviews = afterState.activeCriteria.find(
      ({ criterion }) => afterLabel(criterion.conceptId) === "Reviews",
    )?.criterion;
    const comfort = afterState.activeCriteria.find(
      ({ criterion }) =>
        afterLabel(criterion.conceptId) === "Comfort for long workdays",
    )?.criterion;
    expect(afterReviews).toMatchObject({
      strength: "preference",
      targetSemantics: "qualitative",
      semanticValue: {
        schemaVersion: 1,
        kind: "qualitative",
        mode: "text",
        text: "reviews matter less now",
      },
    });
    expect(comfort).toMatchObject({
      strength: "strong_preference",
      targetSemantics: "qualitative",
      semanticValue: {
        schemaVersion: 1,
        kind: "qualitative",
        mode: "text",
        text: "comfort for long workdays matters most",
      },
    });
    expect(comfort?.strength).not.toBe("hard");
    for (const [label, before] of preservedBefore) {
      const current = afterState.activeCriteria.find(
        ({ criterion }) => afterLabel(criterion.conceptId) === label,
      )?.criterion;
      expect(current).toMatchObject({
        strength: before.strength,
        semanticValue: before.semanticValue,
      });
    }
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
