/**
 * Development-only product-engine proof.
 *
 * These fixtures intentionally bypass context acquisition, but do not bypass
 * the V0-04 authority boundary: every criterion is persisted through
 * createShoppingTask -> recordInitialShoppingSubject -> applyStatePatch.
 * This file is product-engine evidence, never release acceptance evidence.
 */
import { createHash, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  buildMouseRevisionTwoPatch,
  buildProductEngineInitialPatch,
  V0_09_PRODUCT_ENGINE_CASES,
  type ProductEngineFixture,
} from "../../scripts/support/v0-09-product-engine-cases";
import { persistContextAction } from "../../src/features/context-acquisition/persistence/context-actions";
import { saveCandidateListing } from "../../src/features/live-shopping/saved-listings";
import {
  captureDecisionRefinementBasis,
  loadDecisionTransitionInTransaction,
} from "../../src/features/live-shopping/decision-history";
import {
  deepenLiveShoppingResearch,
  loadLiveShoppingSession,
  researchLiveShopping,
  resolveLivePurchaseDestinations,
  setLiveListingSaved,
  setLiveListingRejected,
  type LiveShoppingDependencies,
} from "../../src/features/live-shopping/application";
import {
  FakeEvidencePageFetcher,
  FakeEvidenceSearchProvider,
  FakeProductUnderstandingModel,
} from "../../src/features/product-understanding/fakes";
import { executeOrResumeEvidenceResearch } from "../../src/features/product-understanding/research-orchestrator";
import {
  loadCurrentDecisionSupport,
  loadCurrentDecisionSupportInTransaction,
} from "../../src/features/product-understanding/persistence";
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
  criterionAssessmentObservations,
  criterionAssessments,
  evidenceAcquisitionAttempts,
  evidenceSources,
  fetchedEvidenceDocuments,
  founderLiveSessions,
  productObservations,
  savedCandidateListings,
} from "../../src/infrastructure/database/schema";
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
    const evidenceProvider = new FakeEvidenceSearchProvider();
    const pageFetcher = new FakeEvidencePageFetcher();
    const understanding = new FakeProductUnderstandingModel();
    const fakeDeps = {
      db: connection.db,
      evidenceProvider,
      pageFetcher,
      model: understanding,
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
    const candidateIds = before.candidates.slice(0, 2).map(({ id }) => id);
    const candidateId = candidateIds[0];
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
    expect(candidateIds).toHaveLength(2);
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
    for (const candidateListingId of candidateIds) {
      await saveCandidateListing({
        db: connection.db,
        taskId: seeded.task.id,
        candidateListingId,
      });
    }
    const beforeSavedRows = await connection.db
      .select()
      .from(savedCandidateListings)
      .where(eq(savedCandidateListings.taskId, seeded.task.id));
    const beforeObservations = await connection.db
      .select()
      .from(productObservations)
      .where(inArray(productObservations.candidateListingId, [candidateId!]));
    const beforeSources = await connection.db
      .select()
      .from(evidenceSources)
      .where(inArray(evidenceSources.candidateListingId, [candidateId!]));
    const beforeDocuments = await connection.db
      .select()
      .from(fetchedEvidenceDocuments)
      .where(
        inArray(fetchedEvidenceDocuments.candidateListingId, [candidateId!]),
      );
    const beforeAssessments = await connection.db
      .select()
      .from(criterionAssessments)
      .where(inArray(criterionAssessments.candidateListingId, [candidateId!]));
    const callsBeforeRefinement = {
      evidenceSearch: evidenceProvider.calls.length,
      pageFetch: pageFetcher.calls.length,
      model: understanding.calls.length,
      modelCriterionTargets: understanding.calls.map((call) =>
        call.criteria.map(({ label }) => label),
      ),
    };
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
    await captureDecisionRefinementBasis({
      db: connection.db,
      taskId: seeded.task.id,
      sourceTaskInputId: refinement.input.id,
    });
    await captureDecisionRefinementBasis({
      db: connection.db,
      taskId: seeded.task.id,
      sourceTaskInputId: refinement.input.id,
    });
    await expect(
      connection.client`UPDATE shopping_private.decision_refinement_bases SET task_revision = 99 WHERE source_task_input_id = ${refinement.input.id}`,
    ).rejects.toThrow("immutable");
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
    const loadTransition = () =>
      connection.db.transaction(
        async (tx) => {
          const support = await loadCurrentDecisionSupportInTransaction({
            tx,
            taskId: seeded.task.id,
          });
          return loadDecisionTransitionInTransaction({
            tx,
            support,
            rejectedIds: new Set(),
          });
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    const pendingTransition = await loadTransition();
    expect(pendingTransition).toMatchObject({
      movement: "reassessing",
      previous: { state: "no_clear_winner" },
      current: { leaderId: null },
    });
    expect(pendingTransition?.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Reviews",
          kind: "strength_changed",
          before: "Strong preference",
          after: "Preference",
        }),
        expect.objectContaining({
          label: "Comfort for long workdays",
          kind: "added",
        }),
      ]),
    );
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
      savedCandidateListingIds: candidateIds,
    });
    const after = await loadCurrentDecisionSupport({
      db: connection.db,
      taskId: seeded.task.id,
    });
    expect(after.brief.revision).toBe(2n);
    const evolution = await loadTransition();
    expect(evolution?.previous).toEqual(pendingTransition?.previous);
    expect(evolution?.evidence).toBe("reused");
    expect(evolution?.current.state).toBe("no_clear_winner");
    expect(evolution?.candidateContinuity).toBe("same_listings");
    expect(await loadTransition()).toEqual(evolution);
    const evolutionSession = randomUUID();
    await connection.db.insert(founderLiveSessions).values({
      id: evolutionSession,
      taskId: seeded.task.id,
      initialTurnId: randomUUID(),
      initialRequestFingerprint: createHash("sha256")
        .update(cases[0]!.request)
        .digest("hex"),
      currentContextActionId: seeded.action.id,
      pendingTaskInputId: null,
    });
    const appView = await loadLiveShoppingSession({
      db: connection.db,
      sessionId: evolutionSession,
    });
    expect(appView.decisionSupport?.transition).toEqual(evolution);
    expect(
      (
        await loadLiveShoppingSession({
          db: connection.db,
          sessionId: evolutionSession,
        })
      ).decisionSupport?.transition,
    ).toEqual(evolution);
    expect(after.assessments.length).toBeGreaterThan(0);
    expect(
      after.assessments.every(({ taskRevision }) => taskRevision === 2n),
    ).toBe(true);
    expect(
      after.assessments.some(({ criterionId }) => criterionId === comfort?.id),
    ).toBe(true);
    expect(
      after.assessments.some(
        ({ criterionId }) => criterionId === afterReviews?.id,
      ),
    ).toBe(true);

    const afterSavedRows = await connection.db
      .select()
      .from(savedCandidateListings)
      .where(eq(savedCandidateListings.taskId, seeded.task.id));
    const afterObservations = await connection.db
      .select()
      .from(productObservations)
      .where(inArray(productObservations.candidateListingId, [candidateId!]));
    const afterSources = await connection.db
      .select()
      .from(evidenceSources)
      .where(inArray(evidenceSources.candidateListingId, [candidateId!]));
    const afterDocuments = await connection.db
      .select()
      .from(fetchedEvidenceDocuments)
      .where(
        inArray(fetchedEvidenceDocuments.candidateListingId, [candidateId!]),
      );
    const allAssessments = await connection.db
      .select()
      .from(criterionAssessments)
      .where(inArray(criterionAssessments.candidateListingId, [candidateId!]));
    expect(
      afterSavedRows.map(({ candidateListingId }) => candidateListingId),
    ).toEqual(
      beforeSavedRows.map(({ candidateListingId }) => candidateListingId),
    );
    expect(
      afterSavedRows.map(({ candidateListingId }) => candidateListingId).sort(),
    ).toEqual([...candidateIds].sort());
    const afterObservationIds = new Set(afterObservations.map(({ id }) => id));
    expect(
      beforeObservations.every(({ id }) => afterObservationIds.has(id)),
    ).toBe(true);
    expect(
      afterObservations.every(
        ({ candidateListingId }) => candidateListingId === candidateId,
      ),
    ).toBe(true);
    expect(
      new Set(afterObservations.map(({ fingerprint }) => fingerprint)).size,
    ).toBe(afterObservations.length);
    expect(afterSources.map(({ id }) => id).sort()).toEqual(
      beforeSources.map(({ id }) => id).sort(),
    );
    expect(afterDocuments.map(({ id }) => id).sort()).toEqual(
      beforeDocuments.map(({ id }) => id).sort(),
    );
    expect(
      afterDocuments.map(({ evidenceSourceId }) => evidenceSourceId).sort(),
    ).toEqual(
      beforeDocuments.map(({ evidenceSourceId }) => evidenceSourceId).sort(),
    );
    expect(evidenceProvider.calls).toHaveLength(
      callsBeforeRefinement.evidenceSearch,
    );
    expect(pageFetcher.calls).toHaveLength(callsBeforeRefinement.pageFetch);
    expect(understanding.calls.length).toBeGreaterThan(
      callsBeforeRefinement.model,
    );
    expect(
      understanding.calls
        .slice(callsBeforeRefinement.model)
        .flatMap((call) => call.criteria.map(({ label }) => label)),
    ).toEqual(expect.arrayContaining(["Reviews", "Comfort for long workdays"]));
    expect(
      callsBeforeRefinement.modelCriterionTargets.every(
        (batch) => batch.length <= 2,
      ),
    ).toBe(true);
    expect(
      new Set(allAssessments.map(({ taskRevision }) => taskRevision)).size,
    ).toBe(2);
    expect(allAssessments.some(({ taskRevision }) => taskRevision === 1n)).toBe(
      true,
    );
    expect(allAssessments.some(({ taskRevision }) => taskRevision === 2n)).toBe(
      true,
    );
    expect(
      beforeAssessments.every(({ taskRevision }) => taskRevision === 1n),
    ).toBe(true);

    const pageSourceIds = new Set(
      afterSources
        .filter(({ sourceKind }) => sourceKind === "fetched_page")
        .map(({ id }) => id),
    );
    const pageObservationIds = new Set(
      afterObservations
        .filter(({ evidenceSourceId }) => pageSourceIds.has(evidenceSourceId))
        .map(({ id }) => id),
    );
    const currentPageAssessment = after.assessments.find(({ observationIds }) =>
      observationIds.some((id) => pageObservationIds.has(id)),
    );
    expect(beforeDocuments.length).toBeGreaterThan(0);
    expect(pageObservationIds.size).toBeGreaterThan(0);
    expect(currentPageAssessment).toBeDefined();
    expect(currentPageAssessment?.taskRevision).toBe(2n);
    const linked = await connection.db
      .select()
      .from(criterionAssessmentObservations)
      .where(
        inArray(criterionAssessmentObservations.assessmentId, [
          currentPageAssessment!.id,
        ]),
      );
    expect(
      linked.some(({ observationId }) => pageObservationIds.has(observationId)),
    ).toBe(true);
    const currentComparison = buildDecisionSupport({
      support: after,
      savedListingIds: new Set(candidateIds),
      savedListings: after.candidates.filter(({ id }) =>
        candidateIds.includes(id),
      ),
    });
    expect(
      currentComparison.topOptions.some(
        ({ listing }) => listing.id === candidateId,
      ),
    ).toBe(true);
    expect(
      currentComparison.comparison?.candidates.map(({ id }) => id).sort(),
    ).toEqual([...candidateIds].sort());
    const rejectedView = await setLiveListingRejected({
      dependencies: { db: connection.db },
      input: {
        operation: "reject_listing",
        sessionId: evolutionSession,
        candidateListingId: candidateIds[0],
      },
    });
    expect(rejectedView.decisionSupport?.transition).toMatchObject({
      cause: "candidate_rejection",
      causalCriterionIds: [],
      previous: evolution?.previous,
    });
    const undoView = await setLiveListingRejected({
      dependencies: { db: connection.db },
      input: {
        operation: "undo_reject_listing",
        sessionId: evolutionSession,
        candidateListingId: candidateIds[0],
      },
    });
    expect(undoView.decisionSupport?.transition).toEqual(evolution);
  });

  it("projects a faithfully seeded product task through the real live application operations", async () => {
    const seeded = await seedFixture(connection.db, cases[0]!);
    const retrievalProvider = productProvider();
    await executeOrResumeRetrieval({
      db: connection.db,
      taskId: seeded.task.id,
      contextActionId: seeded.action.id,
      provider: retrievalProvider,
    });
    const sessionId = randomUUID();
    await connection.db.insert(founderLiveSessions).values({
      id: sessionId,
      taskId: seeded.task.id,
      initialTurnId: randomUUID(),
      initialRequestFingerprint: createHash("sha256")
        .update(cases[0]!.request)
        .digest("hex"),
      currentContextActionId: seeded.action.id,
      pendingTaskInputId: null,
    });
    const evidenceProvider = new FakeEvidenceSearchProvider();
    const pageFetcher = new FakeEvidencePageFetcher();
    const understanding = new FakeProductUnderstandingModel();
    let destinationCalls = 0;
    const dependencies = {
      db: connection.db,
      model: {
        interpret: vi.fn(() => {
          throw new Error("seeded application proof must not acquire context");
        }),
        selectAction: vi.fn(() => {
          throw new Error("seeded application proof must not acquire context");
        }),
      },
      provider: retrievalProvider,
      research: {
        evidenceProvider,
        pageFetcher,
        model: understanding,
        modelIdentity: {
          provider: "fixture" as const,
          model: "product-proof-understanding",
          promptVersion: "product-proof-v1",
        },
      },
      destinationResolver: {
        provider: "fixture" as const,
        maxRequestDurationMs: 0,
        resolve: async (request: {
          candidateListingId: string;
          title: string;
        }) => {
          destinationCalls += 1;
          return destinationCalls === 1
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
    } satisfies LiveShoppingDependencies;

    const initial = await loadLiveShoppingSession({
      db: connection.db,
      sessionId,
    });
    expect(initial.action.kind).toBe("search");
    if (initial.action.kind !== "search" || initial.action.search === null) {
      throw new Error("Expected seeded live search projection");
    }
    expect(initial.action.search.listings.length).toBeGreaterThanOrEqual(2);
    expect(initial.decisionSupport?.researchStatus).toBe("not_started");

    const researched = await researchLiveShopping({
      dependencies,
      input: { operation: "research", sessionId },
    });
    expect(
      researched.decisionSupport?.topOptions.length,
    ).toBeGreaterThanOrEqual(2);
    expect(researched.decisionSupport?.currentDecision).toMatchObject({
      state: "no_clear_winner",
      recommendationLevel: "none",
      leadingCandidateListingId: null,
      recommendationBasis: "equivalent_evidence",
    });
    expect(
      JSON.stringify(researched.decisionSupport?.currentDecision),
    ).not.toMatch(/\d+(?:\.\d+)?%|\/10/);
    const decisionBeforeSave = researched.decisionSupport?.currentDecision;
    const candidateIds = researched
      .decisionSupport!.topOptions.slice(0, 2)
      .map(({ listing }) => listing.candidateListingId);
    for (const candidateListingId of candidateIds) {
      await setLiveListingSaved({
        dependencies,
        input: { operation: "save_listing", sessionId, candidateListingId },
      });
    }
    const compared = await loadLiveShoppingSession({
      db: connection.db,
      sessionId,
    });
    expect(compared.decisionSupport?.comparison?.candidates).toHaveLength(2);
    expect(compared.decisionSupport?.currentDecision).toEqual(
      decisionBeforeSave,
    );
    const deepened = await deepenLiveShoppingResearch({
      dependencies,
      input: { operation: "deepen_research", sessionId },
    });
    expect(deepened.decisionSupport?.researchStatus).toBe("ready");
    const withDestinations = await resolveLivePurchaseDestinations({
      dependencies,
      input: { operation: "resolve_destinations", sessionId },
    });
    expect(
      withDestinations.decisionSupport?.topOptions.some(
        ({ listing }) => listing.purchaseState === "direct",
      ),
    ).toBe(true);
    expect(
      withDestinations.decisionSupport?.topOptions.some(
        ({ listing }) => listing.purchaseState === "fallback",
      ),
    ).toBe(true);
    const refreshed = await loadLiveShoppingSession({
      db: connection.db,
      sessionId,
    });
    expect(refreshed).toEqual(withDestinations);
    expect(refreshed.decisionSupport?.currentDecision).toEqual(
      withDestinations.decisionSupport?.currentDecision,
    );
    expect(evidenceProvider.calls.length).toBeGreaterThan(0);
    expect(pageFetcher.calls.length).toBeGreaterThan(0);
    expect(understanding.calls.length).toBeGreaterThan(0);
    expect(destinationCalls).toBe(2);
    expect(
      await connection.db.select().from(evidenceAcquisitionAttempts),
    ).not.toEqual([]);
  });
});
