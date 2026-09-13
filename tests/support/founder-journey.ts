import { createHash, randomUUID } from "node:crypto";
import {
  buildMouseRevisionTwoPatch,
  buildProductEngineInitialPatch,
  V0_09_PRODUCT_ENGINE_CASES,
  type ProductEngineCaseName,
} from "../../scripts/support/v0-09-product-engine-cases";
import type { ShoppingDatabase } from "@/infrastructure/database/clients";
import { founderLiveSessions } from "@/infrastructure/database/schema";
import { createShoppingTask } from "@/features/shopping-state/persistence/tasks";
import { recordInitialShoppingSubject } from "@/features/retrieval-spike/persistence/shopping-subjects";
import { recordTaskInput } from "@/features/shopping-state/persistence/inputs-and-messages";
import { applyStatePatch } from "@/features/shopping-state/persistence/state-transitions";
import { persistContextAction } from "@/features/context-acquisition/persistence/context-actions";
import { executeOrResumeRetrieval } from "@/features/retrieval-spike/retrieval-orchestrator";
import { executeOrResumeEvidenceResearch } from "@/features/product-understanding/research-orchestrator";
import { loadCurrentDecisionSupport } from "@/features/product-understanding/persistence";
import { loadLiveShoppingSession } from "@/features/live-shopping/application";
import { captureDecisionRefinementBasis } from "@/features/live-shopping/decision-history";
import { founderCorpus, type CorpusProduct } from "./founder-product-evidence";

/** Test-only seeding seam: real persistence and ports; no context model/provider. */
export async function seedFounderJourney(
  db: ShoppingDatabase,
  name: ProductEngineCaseName,
  products: readonly CorpusProduct[],
) {
  const fixture = V0_09_PRODUCT_ENGINE_CASES.find((c) => c.name === name)!;
  const corpus = founderCorpus(products);
  const task = await createShoppingTask(db, {
    country: "GB",
    language: "en-GB",
    currency: "GBP",
  });
  const subject = await recordInitialShoppingSubject({
    db,
    taskId: task.id,
    clientActionId: randomUUID(),
    request: {
      inputSchemaVersion: 1,
      expectedRevision: 0n,
      kind: "message",
      body: fixture.request,
    },
  });
  const applied = await applyStatePatch(
    db,
    buildProductEngineInitialPatch(fixture, task.id, subject.input.id),
  );
  const action = await persistContextAction({
    db,
    taskId: task.id,
    stateChangeApplicationId: applied.application.id,
    selectedAtRevision: 1n,
    proposal: {
      schemaVersion: 1,
      action: "search",
      rationale: {
        summary: "Exact founder authority, seeded without context acquisition.",
      },
    },
    config: {
      provider: "fixture",
      model: "founder-seed",
      promptVersion: "founder-corpus-v1",
      providerSchemaVersion: 1,
    },
  });
  const retrieval = await executeOrResumeRetrieval({
    db,
    taskId: task.id,
    contextActionId: action.action.id,
    provider: corpus.provider,
  });
  const research = {
    evidenceProvider: corpus.evidenceProvider,
    pageFetcher: corpus.pageFetcher,
    model: corpus.model,
    modelIdentity: {
      provider: "fixture" as const,
      model: "source-row-extractor",
      promptVersion: "founder-corpus-v1",
    },
  };
  const dependencies = {
    db,
    research,
    provider: corpus.provider,
    model: {
      interpret: async () => {
        throw new Error(
          "Context acquisition is forbidden in founder source fixtures",
        );
      },
      selectAction: async () => {
        throw new Error(
          "Context acquisition is forbidden in founder source fixtures",
        );
      },
    },
  };
  await executeOrResumeEvidenceResearch({
    dependencies: { db, ...research },
    taskId: task.id,
    searchRunId: retrieval.run.portfolio.run.id,
    mode: "first_pass",
  });
  const sessionId = randomUUID();
  await db.insert(founderLiveSessions).values({
    id: sessionId,
    taskId: task.id,
    initialTurnId: randomUUID(),
    initialRequestFingerprint: createHash("sha256")
      .update(fixture.request)
      .digest("hex"),
    currentContextActionId: action.action.id,
    pendingTaskInputId: null,
  });
  const load = () => loadLiveShoppingSession({ db, sessionId });
  return {
    taskId: task.id,
    sessionId,
    corpus,
    dependencies,
    load,
    async refine(message: string) {
      if (name !== "ergonomic-mouse" || message !== fixture.refinement?.request)
        throw new Error("Only the exact labelled refinement is seeded");
      const before = await loadCurrentDecisionSupport({ db, taskId: task.id });
      const reviews = before.brief.items.find(
        (i) => i.conceptLabel === "Reviews",
      )!;
      const input = await recordTaskInput({
        db,
        taskId: task.id,
        clientActionId: randomUUID(),
        request: {
          inputSchemaVersion: 1,
          expectedRevision: before.brief.revision,
          kind: "message",
          body: message,
        },
      });
      await captureDecisionRefinementBasis({
        db,
        taskId: task.id,
        sourceTaskInputId: input.input.id,
      });
      await applyStatePatch(
        db,
        buildMouseRevisionTwoPatch(
          fixture,
          task.id,
          input.input.id,
          reviews.criterionId,
        ),
      );
      await executeOrResumeEvidenceResearch({
        dependencies: { db, ...research },
        taskId: task.id,
        searchRunId: retrieval.run.portfolio.run.id,
        mode: "reassessment",
        savedCandidateListingIds: before.candidates.map((c) => c.id),
      });
      return load();
    },
  };
}
