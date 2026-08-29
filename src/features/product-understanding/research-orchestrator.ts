import { projectShoppingBrief } from "@/domain/shopping-state/brief";
import { loadCurrentShoppingState } from "@/features/shopping-state/persistence/state-loaders";
import { loadPersistedSearchRun } from "@/features/retrieval-spike/persistence/search-runs";
import type { ShoppingDatabase } from "@/infrastructure/database/clients";
import { admitFetchedPageEvidence } from "./page-evidence-admission";
import { extractProductPageDocument } from "./page-extraction";
import { type BoundedPageFetch, PageFetchError } from "./page-fetch";
import type {
  EvidenceSearchProvider,
  EvidenceSearchResponse,
} from "./evidence-search";
import type {
  ProductUnderstandingCallPolicy,
  ProductUnderstandingModel,
  ProductUnderstandingModelResult,
} from "./model-port";
import { PRODUCT_UNDERSTANDING_PROMPT_VERSION } from "./prompts";
import {
  productUnderstandingInputV1Schema,
  productUnderstandingProviderWireV1SchemaForInput,
  type ProductUnderstandingInputV1,
} from "./provider-wire";
import {
  claimEvidenceResearch,
  loadEvidenceResearchRun,
  planEvidencePageFetches,
  prepareEvidenceResearch,
  recordCandidateUnderstanding,
  recordEvidenceAttemptFailure,
  recordEvidencePageFetchFailure,
  recordEvidenceSearchSuccess,
  recordFetchedPageSuccess,
  releaseEvidenceResearchLease,
  renewEvidenceResearchLease,
  type EvidenceResearchSnapshot,
} from "./persistence";

export const EVIDENCE_SEARCH_CONCURRENCY = 3;
export const PAGE_FETCH_CONCURRENCY = 2;
export const PRODUCT_UNDERSTANDING_CONCURRENCY = 2;

export type EvidencePageFetcher = Readonly<{
  provider: "server_http" | "fixture";
  fetch(input: {
    url: string;
    candidateTitle: string;
    merchant: string | null;
    discoveredTitle: string;
    discoveredRole:
      | "retailer"
      | "manufacturer"
      | "independent_review"
      | "retailer_review_aggregate"
      | "other";
  }): Promise<BoundedPageFetch>;
}>;

export type EvidenceResearchDependencies = Readonly<{
  db: ShoppingDatabase;
  evidenceProvider: EvidenceSearchProvider;
  pageFetcher?: EvidencePageFetcher;
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
  if (source.sourceKind === "fetched_page") return 1;
  if (source.sourceKind === "organic_result") return 2;
  return 3;
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
  const run = await loadPersistedSearchRun({
    db: options.dependencies.db,
    taskId: options.snapshot.run.taskId,
    runId: options.snapshot.run.searchRunId,
  });
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

function throwFirstRejected(
  settlements: readonly PromiseSettledResult<unknown>[],
) {
  const rejected = settlements.find(
    (settlement): settlement is PromiseRejectedResult =>
      settlement.status === "rejected",
  );
  if (rejected !== undefined) throw rejected.reason;
}

function createStageLimiter(concurrency: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  const acquire = () => {
    if (active < concurrency) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => waiting.push(resolve));
  };
  const release = () => {
    const next = waiting.shift();
    if (next === undefined) {
      active -= 1;
      return;
    }
    // Transfer the released permit directly to the oldest waiter. `active`
    // remains unchanged, so a newly arriving task cannot steal the permit.
    next();
  };
  return async <Value>(operation: () => Promise<Value>) => {
    await acquire();
    try {
      return await operation();
    } finally {
      release();
    }
  };
}

function extractedPageIdentity(
  fetch: BoundedPageFetch,
  document: ReturnType<typeof extractProductPageDocument>,
) {
  return {
    finalUrl: fetch.finalUrl,
    canonicalUrl: document.canonicalUrlCandidate,
    title: document.title,
    openGraphTitle: document.metadata.openGraphTitle,
    products: document.jsonLdProducts.map((product) => ({
      productName: product.name,
      brand: product.brand,
      model: product.model,
      sku: product.sku,
      mpn: product.mpn,
    })),
  } as const;
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

  const unsafeAttemptIds = new Set<string>();
  try {
    const claimedSnapshot = await loadEvidenceResearchRun({
      db: options.dependencies.db,
      taskId: prepared.run.taskId,
      researchRunId: prepared.run.id,
    });
    if (claimedSnapshot === null) {
      throw new Error("Claimed research run is unavailable");
    }
    const candidateRun = await loadPersistedSearchRun({
      db: options.dependencies.db,
      taskId: claimedSnapshot.run.taskId,
      runId: claimedSnapshot.run.searchRunId,
    });
    if (candidateRun === null) {
      throw new Error("Research search run is unavailable");
    }
    const listingsById = new Map(
      candidateRun.listings.map((listing) => [listing.id, listing]),
    );
    const pageFetcher = options.dependencies.pageFetcher;
    if (
      pageFetcher === undefined &&
      claimedSnapshot.attempts.some(
        ({ stage, status }) => stage === "page_fetch" && status === "planned",
      )
    ) {
      throw new Error("Planned page acquisition has no configured fetcher");
    }
    const selectedCandidateIds = new Set(
      claimedSnapshot.attempts.map(
        ({ candidateListingId }) => candidateListingId,
      ),
    );
    const candidateIds = candidateRun.listings
      .filter(({ id }) => selectedCandidateIds.has(id))
      .map(({ id }) => id);
    if (candidateIds.length !== selectedCandidateIds.size) {
      throw new Error("Research candidate portfolio is incomplete");
    }
    const runEvidenceSearch = createStageLimiter(EVIDENCE_SEARCH_CONCURRENCY);
    const runPageFetch = createStageLimiter(PAGE_FETCH_CONCURRENCY);
    const runUnderstanding = createStageLimiter(
      PRODUCT_UNDERSTANDING_CONCURRENCY,
    );
    const loadCurrentSnapshot = async () =>
      (await loadEvidenceResearchRun({
        db: options.dependencies.db,
        taskId: prepared.run.taskId,
        researchRunId: prepared.run.id,
      })) ?? claimedSnapshot;

    const candidateSettlements = await Promise.allSettled(
      candidateIds.map(async (candidateListingId) => {
        const organicSettlements = await Promise.allSettled(
          claimedSnapshot.attempts
            .filter(
              (attempt) =>
                attempt.candidateListingId === candidateListingId &&
                attempt.stage === "organic_search" &&
                attempt.status === "planned",
            )
            .map((attempt) =>
              runEvidenceSearch(async () => {
                await renewEvidenceResearchLease({
                  db: options.dependencies.db,
                  taskId: prepared.run.taskId,
                  researchRunId: prepared.run.id,
                  leaseToken,
                });
                const listing = listingsById.get(attempt.candidateListingId);
                if (listing === undefined || attempt.query === null) {
                  throw new Error("Planned evidence candidate is unavailable");
                }
                const startedAt = new Date();
                unsafeAttemptIds.add(attempt.id);
                let response: EvidenceSearchResponse;
                try {
                  response = await options.dependencies.evidenceProvider.search(
                    {
                      query: attempt.query,
                      candidateTitle: listing.title,
                      merchant: listing.merchant,
                    },
                  );
                } catch {
                  await recordEvidenceAttemptFailure({
                    db: options.dependencies.db,
                    taskId: prepared.run.taskId,
                    researchRunId: prepared.run.id,
                    attemptIds: [attempt.id],
                    leaseToken,
                    failureCode: "provider_failed",
                    startedAt,
                    finishedAt: new Date(),
                  });
                  unsafeAttemptIds.delete(attempt.id);
                  return;
                }
                await recordEvidenceSearchSuccess({
                  db: options.dependencies.db,
                  taskId: prepared.run.taskId,
                  researchRunId: prepared.run.id,
                  attemptId: attempt.id,
                  leaseToken,
                  response,
                  startedAt,
                  finishedAt: new Date(),
                });
                unsafeAttemptIds.delete(attempt.id);
              }),
            ),
        );
        throwFirstRejected(organicSettlements);

        if (pageFetcher !== undefined) {
          const pagePlans = (
            await planEvidencePageFetches({
              db: options.dependencies.db,
              taskId: prepared.run.taskId,
              researchRunId: prepared.run.id,
              candidateListingId,
              leaseToken,
              provider: pageFetcher.provider,
            })
          ).filter(({ attempt }) => attempt.status === "planned");
          const pageSettlements = await Promise.allSettled(
            pagePlans.map((plan) =>
              runPageFetch(async () => {
                await renewEvidenceResearchLease({
                  db: options.dependencies.db,
                  taskId: prepared.run.taskId,
                  researchRunId: prepared.run.id,
                  leaseToken,
                });
                const listing = listingsById.get(
                  plan.attempt.candidateListingId,
                );
                if (listing === undefined) {
                  throw new Error("Planned page candidate is unavailable");
                }
                const startedAt = new Date();
                unsafeAttemptIds.add(plan.attempt.id);
                let fetch: BoundedPageFetch;
                try {
                  fetch = await pageFetcher.fetch({
                    url: plan.requestedUrl,
                    candidateTitle: listing.title,
                    merchant: listing.merchant,
                    discoveredTitle: plan.discoveredSource.sourceTitle,
                    discoveredRole: plan.discoveredSource.sourceRole,
                  });
                } catch (error) {
                  await recordEvidencePageFetchFailure({
                    db: options.dependencies.db,
                    taskId: prepared.run.taskId,
                    researchRunId: prepared.run.id,
                    attemptId: plan.attempt.id,
                    leaseToken,
                    failureCode:
                      error instanceof PageFetchError
                        ? error.code
                        : "network_failed",
                    startedAt,
                    finishedAt: new Date(),
                  });
                  unsafeAttemptIds.delete(plan.attempt.id);
                  return;
                }
                let document: ReturnType<typeof extractProductPageDocument>;
                try {
                  document = extractProductPageDocument({
                    html: fetch.text,
                    sourceUrl: fetch.finalUrl,
                  });
                } catch {
                  await recordEvidencePageFetchFailure({
                    db: options.dependencies.db,
                    taskId: prepared.run.taskId,
                    researchRunId: prepared.run.id,
                    attemptId: plan.attempt.id,
                    leaseToken,
                    failureCode: "invalid_extraction",
                    startedAt,
                    finishedAt: new Date(),
                  });
                  unsafeAttemptIds.delete(plan.attempt.id);
                  return;
                }
                const admission = admitFetchedPageEvidence({
                  candidateTitle: listing.title,
                  merchant: listing.merchant,
                  discovered: {
                    sourceRole: plan.discoveredSource.sourceRole,
                    url: plan.discoveredSource.sourceUrl,
                    title: plan.discoveredSource.sourceTitle,
                  },
                  page: extractedPageIdentity(fetch, document),
                });
                if (admission.decision === "reject") {
                  await recordEvidencePageFetchFailure({
                    db: options.dependencies.db,
                    taskId: prepared.run.taskId,
                    researchRunId: prepared.run.id,
                    attemptId: plan.attempt.id,
                    leaseToken,
                    failureCode: "identity_mismatch",
                    startedAt,
                    finishedAt: new Date(),
                  });
                  unsafeAttemptIds.delete(plan.attempt.id);
                  return;
                }
                await recordFetchedPageSuccess({
                  db: options.dependencies.db,
                  taskId: prepared.run.taskId,
                  researchRunId: prepared.run.id,
                  attemptId: plan.attempt.id,
                  leaseToken,
                  fetch: {
                    requestedUrl: fetch.requestedUrl,
                    finalUrl: fetch.finalUrl,
                    contentType: fetch.contentType,
                    encodedBytes: fetch.encodedBytes,
                    decodedBytes: fetch.decodedBytes,
                    fetchedAt: fetch.fetchedAt,
                    responseHash: fetch.responseHash,
                  },
                  document,
                  admission,
                  startedAt,
                  finishedAt: new Date(),
                });
                unsafeAttemptIds.delete(plan.attempt.id);
              }),
            ),
          );
          throwFirstRejected(pageSettlements);
        }

        await runUnderstanding(async () => {
          const snapshot = await loadCurrentSnapshot();
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
            return;
          }
          await renewEvidenceResearchLease({
            db: options.dependencies.db,
            taskId: prepared.run.taskId,
            researchRunId: prepared.run.id,
            leaseToken,
          });
          const { input, sourceIdsInOrder } = await buildUnderstandingInput({
            dependencies: options.dependencies,
            snapshot,
            candidateListingId,
          });
          const callPolicy: ProductUnderstandingCallPolicy = {
            requireCriterionBinding: snapshot.run.phase === "deepening",
          };
          const startedAt = new Date();
          unsafeAttemptIds.add(extraction.id);
          unsafeAttemptIds.add(assessment.id);
          let result: ProductUnderstandingModelResult;
          try {
            result = await options.dependencies.model.understand(
              input,
              callPolicy,
            );
          } catch {
            await recordCandidateUnderstanding({
              db: options.dependencies.db,
              taskId: prepared.run.taskId,
              researchRunId: prepared.run.id,
              candidateListingId,
              extractionAttemptId: extraction.id,
              assessmentAttemptId: assessment.id,
              leaseToken,
              sourceIdsInOrder,
              result: null,
              metadata: null,
              failureCode: "model_failed",
              startedAt,
              finishedAt: new Date(),
            });
            unsafeAttemptIds.delete(extraction.id);
            unsafeAttemptIds.delete(assessment.id);
            return;
          }
          const scopedResult =
            result.status === "completed"
              ? productUnderstandingProviderWireV1SchemaForInput({
                  input,
                  requireCriterionBinding: callPolicy.requireCriterionBinding,
                }).safeParse(result.value)
              : null;
          await recordCandidateUnderstanding({
            db: options.dependencies.db,
            taskId: prepared.run.taskId,
            researchRunId: prepared.run.id,
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
          unsafeAttemptIds.delete(extraction.id);
          unsafeAttemptIds.delete(assessment.id);
        });
      }),
    );
    throwFirstRejected(candidateSettlements);
    return (
      (await loadEvidenceResearchRun({
        db: options.dependencies.db,
        taskId: prepared.run.taskId,
        researchRunId: prepared.run.id,
      })) ?? prepared
    );
  } finally {
    if (unsafeAttemptIds.size === 0) {
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
