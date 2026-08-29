import { projectShoppingBrief } from "@/domain/shopping-state/brief";
import { loadCurrentShoppingState } from "@/features/shopping-state/persistence/state-loaders";
import type { ShoppingDatabase } from "@/infrastructure/database/clients";
import type {
  EvidenceSearchProvider,
  EvidenceSearchResponse,
} from "./evidence-search";
import type { ProductUnderstandingModel } from "./model-port";
import { PRODUCT_UNDERSTANDING_PROMPT_VERSION } from "./prompts";
import {
  productUnderstandingInputV1Schema,
  productUnderstandingProviderWireV1SchemaForInput,
  type ProductUnderstandingInputV1,
} from "./provider-wire";
import {
  claimEvidenceResearch,
  loadEvidenceResearchRun,
  prepareEvidenceResearch,
  recordCandidateUnderstanding,
  recordEvidenceAttemptFailure,
  recordEvidenceSearchSuccess,
  releaseEvidenceResearchLease,
  renewEvidenceResearchLease,
  type EvidenceResearchSnapshot,
} from "./persistence";

export type EvidenceResearchDependencies = Readonly<{
  db: ShoppingDatabase;
  evidenceProvider: EvidenceSearchProvider;
  model: ProductUnderstandingModel;
  modelIdentity: Readonly<{
    provider: "openai" | "fixture";
    model: string;
    promptVersion: string;
  }>;
}>;

function hasVisualCriterion(
  criteria: ReturnType<typeof projectShoppingBrief>["items"],
) {
  return criteria.some(({ conceptLabel, conceptDefinition }) =>
    /shape|profile|thumb|visual|style|gamer|bulky|mesh|fabric|leather|material|sculpt/i.test(
      `${conceptLabel} ${conceptDefinition}`,
    ),
  );
}

function sourcePriority(source: EvidenceResearchSnapshot["sources"][number]) {
  if (source.sourceKind === "listing_field") return 0;
  if (source.sourceKind === "organic_result") return 1;
  return 2;
}

async function buildUnderstandingInput(options: {
  dependencies: EvidenceResearchDependencies;
  snapshot: EvidenceResearchSnapshot;
  candidateListingId: string;
}): Promise<{
  input: ProductUnderstandingInputV1;
  sourceIdsInOrder: readonly string[];
}> {
  const state = await options.dependencies.db.transaction((tx) =>
    loadCurrentShoppingState(tx, options.snapshot.run.taskId),
  );
  const brief = projectShoppingBrief(state);
  if (brief.revision !== options.snapshot.run.taskRevision) {
    throw new Error("Research snapshot is stale before model acquisition");
  }
  const run =
    await import("@/features/retrieval-spike/persistence/search-runs").then(
      ({ loadPersistedSearchRun }) =>
        loadPersistedSearchRun({
          db: options.dependencies.db,
          taskId: options.snapshot.run.taskId,
          runId: options.snapshot.run.searchRunId,
        }),
    );
  const listing = run?.listings.find(
    ({ id }) => id === options.candidateListingId,
  );
  if (listing === undefined) throw new Error("Research listing is unavailable");
  const candidateModelAttempts = options.snapshot.attempts.filter(
    (attempt) =>
      attempt.candidateListingId === options.candidateListingId &&
      (attempt.stage === "observation_extraction" ||
        attempt.stage === "criterion_assessment"),
  );
  const extractionTargets = candidateModelAttempts.find(
    ({ stage }) => stage === "observation_extraction",
  )?.targetCriterionIds;
  const assessmentTargets = candidateModelAttempts.find(
    ({ stage }) => stage === "criterion_assessment",
  )?.targetCriterionIds;
  if (extractionTargets === undefined || assessmentTargets === undefined) {
    throw new Error("Research model target bindings are unavailable");
  }
  const extractionTargetSet = new Set(extractionTargets);
  const assessmentTargetSet = new Set(assessmentTargets);
  if (
    extractionTargetSet.size === 0 ||
    extractionTargetSet.size !== assessmentTargetSet.size ||
    [...extractionTargetSet].some(
      (criterionId) => !assessmentTargetSet.has(criterionId),
    )
  ) {
    throw new Error("Research model target bindings disagree");
  }
  const targetCriteria = brief.items.filter(({ criterionId }) =>
    extractionTargetSet.has(criterionId),
  );
  if (targetCriteria.length !== extractionTargetSet.size) {
    throw new Error("Research model target is not current");
  }
  const includeVisual = hasVisualCriterion(targetCriteria);
  const sources = options.snapshot.sources
    .filter(
      (source) =>
        source.candidateListingId === listing.id &&
        (source.sourceKind !== "listing_image" || includeVisual),
    )
    .sort(
      (left, right) =>
        Number(right.researchRunId === options.snapshot.run.id) -
          Number(left.researchRunId === options.snapshot.run.id) ||
        sourcePriority(left) - sourcePriority(right) ||
        right.observedAt.getTime() - left.observedAt.getTime() ||
        left.id.localeCompare(right.id),
    )
    .slice(0, 20);
  const input = productUnderstandingInputV1Schema.parse({
    schemaVersion: 1,
    market: brief.market,
    candidate: {
      title: listing.title,
      merchant: listing.merchant,
      observedPriceText: listing.priceText,
    },
    criteria: targetCriteria.map((item, ordinal) => ({
      ordinal,
      label: item.conceptLabel,
      definition: item.conceptDefinition,
      strength: item.strength,
      targetSemantics: item.targetSemantics,
      value: item.semanticValue,
    })),
    sources: sources.map((source, ordinal) => ({
      ordinal,
      role: source.sourceRole,
      kind: source.sourceKind,
      title: source.sourceTitle,
      url: source.sourceUrl,
      excerpt: source.excerpt,
    })),
  });
  return { input, sourceIdsInOrder: sources.map(({ id }) => id) };
}

export async function executeOrResumeEvidenceResearch(options: {
  dependencies: EvidenceResearchDependencies;
  taskId: unknown;
  searchRunId: unknown;
  mode?: "first_pass" | "deepening" | "targeted" | "reassessment";
  targetCandidateListingId?: unknown;
  targetCriterionId?: unknown;
  savedCandidateListingIds?: readonly unknown[];
}): Promise<EvidenceResearchSnapshot> {
  const prepared = await prepareEvidenceResearch({
    db: options.dependencies.db,
    taskId: options.taskId,
    searchRunId: options.searchRunId,
    evidenceProvider: options.dependencies.evidenceProvider.provider,
    modelProvider: options.dependencies.modelIdentity.provider,
    model: options.dependencies.modelIdentity.model,
    promptVersion:
      options.dependencies.modelIdentity.promptVersion ||
      PRODUCT_UNDERSTANDING_PROMPT_VERSION,
    ...(options.mode === undefined ? {} : { mode: options.mode }),
    ...(options.targetCandidateListingId === undefined
      ? {}
      : { targetCandidateListingId: options.targetCandidateListingId }),
    ...(options.targetCriterionId === undefined
      ? {}
      : { targetCriterionId: options.targetCriterionId }),
    ...(options.savedCandidateListingIds === undefined
      ? {}
      : { savedCandidateListingIds: options.savedCandidateListingIds }),
  });
  if (prepared.run.status !== "running") return prepared;
  const leaseToken = await claimEvidenceResearch({
    db: options.dependencies.db,
    taskId: prepared.run.taskId,
    researchRunId: prepared.run.id,
  });
  if (leaseToken === null) {
    return (
      (await loadEvidenceResearchRun({
        db: options.dependencies.db,
        taskId: prepared.run.taskId,
        researchRunId: prepared.run.id,
      })) ?? prepared
    );
  }

  let unsafeToRelease = false;
  try {
    let snapshot = prepared;
    for (const attempt of snapshot.attempts.filter(
      (entry) => entry.stage === "organic_search" && entry.status === "planned",
    )) {
      await renewEvidenceResearchLease({
        db: options.dependencies.db,
        taskId: snapshot.run.taskId,
        researchRunId: snapshot.run.id,
        leaseToken,
      });
      const startedAt = new Date();
      unsafeToRelease = true;
      let response: EvidenceSearchResponse;
      try {
        const candidateRun =
          await import("@/features/retrieval-spike/persistence/search-runs").then(
            ({ loadPersistedSearchRun }) =>
              loadPersistedSearchRun({
                db: options.dependencies.db,
                taskId: snapshot.run.taskId,
                runId: snapshot.run.searchRunId,
              }),
          );
        const listing = candidateRun?.listings.find(
          ({ id }) => id === attempt.candidateListingId,
        );
        if (listing === undefined || attempt.query === null) {
          throw new Error("Planned evidence candidate is unavailable");
        }
        response = await options.dependencies.evidenceProvider.search({
          query: attempt.query,
          candidateTitle: listing.title,
          merchant: listing.merchant,
        });
      } catch {
        await recordEvidenceAttemptFailure({
          db: options.dependencies.db,
          taskId: snapshot.run.taskId,
          researchRunId: snapshot.run.id,
          attemptIds: [attempt.id],
          leaseToken,
          failureCode: "provider_failed",
          startedAt,
          finishedAt: new Date(),
        });
        unsafeToRelease = false;
        snapshot =
          (await loadEvidenceResearchRun({
            db: options.dependencies.db,
            taskId: snapshot.run.taskId,
            researchRunId: snapshot.run.id,
          })) ?? snapshot;
        continue;
      }
      await recordEvidenceSearchSuccess({
        db: options.dependencies.db,
        taskId: snapshot.run.taskId,
        researchRunId: snapshot.run.id,
        attemptId: attempt.id,
        leaseToken,
        response,
        startedAt,
        finishedAt: new Date(),
      });
      unsafeToRelease = false;
      snapshot =
        (await loadEvidenceResearchRun({
          db: options.dependencies.db,
          taskId: snapshot.run.taskId,
          researchRunId: snapshot.run.id,
        })) ?? snapshot;
    }

    const candidateIds = [
      ...new Set(
        snapshot.attempts.map(({ candidateListingId }) => candidateListingId),
      ),
    ];
    for (const candidateListingId of candidateIds) {
      const extraction = snapshot.attempts.find(
        (attempt) =>
          attempt.candidateListingId === candidateListingId &&
          attempt.stage === "observation_extraction",
      );
      const assessment = snapshot.attempts.find(
        (attempt) =>
          attempt.candidateListingId === candidateListingId &&
          attempt.stage === "criterion_assessment",
      );
      if (
        extraction?.status !== "planned" ||
        assessment?.status !== "planned"
      ) {
        continue;
      }
      await renewEvidenceResearchLease({
        db: options.dependencies.db,
        taskId: snapshot.run.taskId,
        researchRunId: snapshot.run.id,
        leaseToken,
      });
      const { input, sourceIdsInOrder } = await buildUnderstandingInput({
        dependencies: options.dependencies,
        snapshot,
        candidateListingId,
      });
      const startedAt = new Date();
      unsafeToRelease = true;
      const result = await options.dependencies.model.understand(input);
      const scopedResult =
        result.status === "completed"
          ? productUnderstandingProviderWireV1SchemaForInput({
              input,
              requireCriterionBinding: snapshot.run.phase === "deepening",
            }).safeParse(result.value)
          : null;
      await recordCandidateUnderstanding({
        db: options.dependencies.db,
        taskId: snapshot.run.taskId,
        researchRunId: snapshot.run.id,
        candidateListingId,
        extractionAttemptId: extraction.id,
        assessmentAttemptId: assessment.id,
        leaseToken,
        sourceIdsInOrder,
        result:
          result.status === "completed" && scopedResult?.success === true
            ? scopedResult.data
            : null,
        metadata: result.metadata,
        ...(result.status === "completed" && scopedResult?.success === true
          ? {}
          : {
              failureCode:
                result.status === "malformed" ||
                (result.status === "completed" &&
                  scopedResult?.success === false)
                  ? ("invalid_model_output" as const)
                  : ("model_failed" as const),
            }),
        startedAt,
        finishedAt: new Date(),
      });
      unsafeToRelease = false;
      snapshot =
        (await loadEvidenceResearchRun({
          db: options.dependencies.db,
          taskId: snapshot.run.taskId,
          researchRunId: snapshot.run.id,
        })) ?? snapshot;
    }
    return (
      (await loadEvidenceResearchRun({
        db: options.dependencies.db,
        taskId: prepared.run.taskId,
        researchRunId: prepared.run.id,
      })) ?? prepared
    );
  } finally {
    if (!unsafeToRelease) {
      const current = await loadEvidenceResearchRun({
        db: options.dependencies.db,
        taskId: prepared.run.taskId,
        researchRunId: prepared.run.id,
      });
      if (current?.run.status === "running") {
        await releaseEvidenceResearchLease({
          db: options.dependencies.db,
          taskId: prepared.run.taskId,
          researchRunId: prepared.run.id,
          leaseToken,
        }).catch(() => undefined);
      }
    }
  }
}
