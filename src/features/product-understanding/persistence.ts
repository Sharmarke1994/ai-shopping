import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { projectShoppingBrief } from "@/domain/shopping-state/brief";
import {
  PersistedDataCorruptionError,
  StaleTaskRevisionError,
} from "@/domain/shopping-state/errors";
import {
  candidateListingIdSchema,
  criterionIdSchema,
  shoppingTaskIdSchema,
} from "@/domain/shopping-state/ids";
import { taskRevisionSchema } from "@/domain/shopping-state/task";
import { loadPersistedSearchRunInTransaction } from "@/features/retrieval-spike/persistence/search-runs";
import type { PersistedCandidateListing } from "@/features/retrieval-spike/persistence/contracts";
import { searchRunIdSchema } from "@/features/retrieval-spike/contracts";
import {
  loadCurrentShoppingState,
  loadShoppingStateAtRevision,
} from "@/features/shopping-state/persistence/state-loaders";
import type {
  ShoppingDatabase,
  ShoppingTransaction,
} from "@/infrastructure/database/clients";
import {
  candidateListings,
  criterionAssessmentObservations,
  criterionAssessments,
  evidenceAcquisitionAttempts,
  evidenceAttemptTargetCriteria,
  evidencePageFetchTargets,
  evidenceResearchRuns,
  evidenceSources,
  fetchedEvidenceDocuments,
  productObservations,
  rejectedCandidateListings,
  savedCandidateListings,
  shoppingTasks,
} from "@/infrastructure/database/schema";
import {
  criterionAssessmentIdSchema,
  criterionAssessmentV1Schema,
  evidenceAcquisitionAttemptIdSchema,
  evidenceResearchRunIdSchema,
  evidenceSourceIdSchema,
  evidenceSourceV1Schema,
  productObservationIdSchema,
  productObservationV1Schema,
  type CriterionAssessmentV1,
  type EvidenceSourceV1,
  type ProductObservationV1,
} from "./contracts";
import type { ModelCallMetadata } from "./model-port";
import { MAX_PAGE_TRANSPORT_BYTES } from "./page-budgets";
import {
  productUnderstandingProviderWireV1Schema,
  type ProductUnderstandingProviderWireV1,
} from "./provider-wire";
import type { EvidenceSearchResponse } from "./evidence-search";
import { isCandidateEvidenceRelevant } from "./evidence-relevance";
import {
  admitFetchedPageEvidence,
  pageEvidenceAdmissionV1Schema,
  type PageEvidenceAdmissionV1,
} from "./page-evidence-admission";
import { projectFetchedPageModelExcerpt } from "./page-evidence-projection";
import {
  computeExtractedPageDocumentHash,
  extractedProductPageDocumentV1Schema,
  PAGE_EXTRACTION_VERSION,
  type ExtractedProductPageDocumentV1,
} from "./page-extraction";
import {
  PAGE_FETCH_POLICY_VERSION,
  type BoundedPageFetch,
  type PageFetchFailureCode,
} from "./page-fetch";
import {
  MAX_PAGE_SOURCES_PER_CANDIDATE,
  selectPageSources,
  type PageSourcePurpose,
} from "./page-source-strategy";
import {
  DIRECT_TITLE_DESCRIPTOR_PROPERTY,
  directTitleSoftContradiction,
  guardCriterionAssessment,
  isPurchasePriceCriterion,
  orderCandidatesByAssessments,
  type ObservationWithSource,
} from "./assessment-policy";
import {
  EVIDENCE_POLICY_VERSION,
  planDecisionGapSearch,
  planEvidenceSearches,
  selectDeepResearchCandidates,
  selectResearchCandidates,
} from "./selection";
import {
  assertFirstPassUnderstandingPairsMatchCriteria,
  FIRST_PASS_UNDERSTANDING_POLICY_IDENTITY,
  pairFirstPassUnderstandingAttempts,
  planFirstPassUnderstandingBatches,
} from "./understanding-batches";

const attemptStageSchema = z.enum([
  "organic_search",
  "page_fetch",
  "observation_extraction",
  "criterion_assessment",
]);
const attemptPurposeSchema = z.enum([
  "specifications",
  "experience",
  "source_depth",
  "first_pass",
  "decision_gap",
  "combined",
  "current_brief",
]);
const attemptStatusSchema = z.enum(["planned", "succeeded", "failed"]);
const researchStatusSchema = z.enum([
  "running",
  "succeeded",
  "partial",
  "failed",
]);

const persistedAttemptSchema = z
  .strictObject({
    id: evidenceAcquisitionAttemptIdSchema,
    taskId: shoppingTaskIdSchema,
    researchRunId: evidenceResearchRunIdSchema,
    candidateRunId: searchRunIdSchema,
    candidateListingId: candidateListingIdSchema,
    stage: attemptStageSchema,
    purpose: attemptPurposeSchema,
    planKey: z.string().min(1).max(180),
    query: z.string().min(1).max(500).nullable(),
    status: attemptStatusSchema,
    provider: z.enum(["serper", "server_http", "openai", "fixture"]),
    model: z.string().min(1).max(160).nullable(),
    promptVersion: z.string().min(1).max(120).nullable(),
    providerRequestId: z.string().min(1).max(240).nullable(),
    receivedResultCount: z.number().int().nonnegative().nullable(),
    failureCode: z
      .enum([
        "provider_failed",
        "invalid_provider_result",
        "unsafe_url",
        "dns_failed",
        "network_failed",
        "timeout",
        "redirect_invalid",
        "redirect_limit",
        "http_status",
        "unsupported_content_type",
        "unsupported_content_encoding",
        "response_too_large",
        "invalid_text",
        "invalid_extraction",
        "identity_mismatch",
        "model_failed",
        "invalid_model_output",
      ])
      .nullable(),
    startedAt: z.date().nullable(),
    finishedAt: z.date().nullable(),
    targetCriterionIds: z.array(criterionIdSchema).max(50),
  })
  .superRefine((attempt, context) => {
    if (attempt.status !== "failed") return;
    const allowed =
      attempt.stage === "organic_search"
        ? new Set(["provider_failed", "invalid_provider_result"])
        : attempt.stage === "page_fetch"
          ? new Set([
              "unsafe_url",
              "dns_failed",
              "network_failed",
              "timeout",
              "redirect_invalid",
              "redirect_limit",
              "http_status",
              "unsupported_content_type",
              "unsupported_content_encoding",
              "response_too_large",
              "invalid_text",
              "invalid_extraction",
              "identity_mismatch",
            ])
          : new Set(["model_failed", "invalid_model_output"]);
    if (attempt.failureCode === null || !allowed.has(attempt.failureCode)) {
      context.addIssue({
        code: "custom",
        path: ["failureCode"],
        message: "Failure code does not belong to the acquisition stage",
      });
    }
  });

export type PersistedEvidenceAttempt = z.infer<typeof persistedAttemptSchema>;

const fetchedPageMetadataSchema = z.strictObject({
  requestedUrl: z.url().max(4_000),
  finalUrl: z.url().max(4_000),
  contentType: z.enum(["text/html", "application/xhtml+xml", "text/plain"]),
  encodedBytes: z.number().int().min(1).max(MAX_PAGE_TRANSPORT_BYTES),
  decodedBytes: z.number().int().min(1).max(MAX_PAGE_TRANSPORT_BYTES),
  fetchedAt: z.date(),
  responseHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export type FetchedPageMetadata = Readonly<
  Omit<BoundedPageFetch, "text" | "redirectCount">
>;

const admittedPageEvidenceSchema = pageEvidenceAdmissionV1Schema.refine(
  (value): value is Extract<PageEvidenceAdmissionV1, { decision: "admit" }> =>
    value.decision === "admit",
  "Only admitted exact-product pages can be persisted",
);

const persistedFetchedEvidenceDocumentSchema = z.strictObject({
  id: z.uuid(),
  taskId: shoppingTaskIdSchema,
  researchRunId: evidenceResearchRunIdSchema,
  candidateRunId: searchRunIdSchema,
  candidateListingId: candidateListingIdSchema,
  attemptId: evidenceAcquisitionAttemptIdSchema,
  attemptStage: z.literal("page_fetch"),
  discoveredSourceId: evidenceSourceIdSchema,
  evidenceSourceId: evidenceSourceIdSchema,
  evidenceSourceKind: z.literal("fetched_page"),
  requestedUrl: z.url().max(4_000),
  finalUrl: z.url().max(4_000),
  canonicalUrl: z.url().max(4_000).nullable(),
  contentType: fetchedPageMetadataSchema.shape.contentType,
  encodedBytes: fetchedPageMetadataSchema.shape.encodedBytes,
  decodedBytes: fetchedPageMetadataSchema.shape.decodedBytes,
  responseHash: fetchedPageMetadataSchema.shape.responseHash,
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  extractionVersion: z.literal(PAGE_EXTRACTION_VERSION),
  document: extractedProductPageDocumentV1Schema,
  admission: admittedPageEvidenceSchema,
  fetchedAt: z.date(),
});

export type PersistedFetchedEvidenceDocument = Readonly<
  z.infer<typeof persistedFetchedEvidenceDocumentSchema>
>;

export type PlannedOrganicEvidenceSource = Readonly<
  Omit<
    EvidenceSourceV1,
    "sourceKind" | "sourceRole" | "acquisitionAttemptId" | "providerResultId"
  > & {
    sourceKind: "organic_result";
    sourceRole:
      | "retailer"
      | "manufacturer"
      | "independent_review"
      | "retailer_review_aggregate"
      | "other";
    acquisitionAttemptId: z.infer<typeof evidenceAcquisitionAttemptIdSchema>;
    providerResultId: string;
  }
>;

export type PlannedEvidencePageFetch = Readonly<{
  attempt: PersistedEvidenceAttempt;
  discoveredSource: PlannedOrganicEvidenceSource;
  requestedUrl: string;
  policyVersion: string;
  purpose: PageSourcePurpose;
}>;

export type PageEvidenceFailureCode =
  PageFetchFailureCode | "invalid_extraction" | "identity_mismatch";

const pageAttemptProviderSchema = z.enum(["server_http", "fixture"]);
const pageEvidenceFailureCodeSchema = z.enum([
  "unsafe_url",
  "dns_failed",
  "network_failed",
  "timeout",
  "redirect_invalid",
  "redirect_limit",
  "http_status",
  "unsupported_content_type",
  "unsupported_content_encoding",
  "response_too_large",
  "invalid_text",
  "invalid_extraction",
  "identity_mismatch",
]);

export type EvidenceResearchSnapshot = Readonly<{
  run: Readonly<{
    id: z.infer<typeof evidenceResearchRunIdSchema>;
    taskId: z.infer<typeof shoppingTaskIdSchema>;
    searchRunId: z.infer<typeof searchRunIdSchema>;
    taskRevision: z.infer<typeof taskRevisionSchema>;
    policyVersion: string;
    phase: "first_pass" | "deepening" | "reassessment";
    status: z.infer<typeof researchStatusSchema>;
    selectedCandidateCount: number;
    plannedSearchCount: number;
    startedAt: Date;
    finishedAt: Date | null;
  }>;
  attempts: readonly PersistedEvidenceAttempt[];
  sources: readonly EvidenceSourceV1[];
  observations: readonly ProductObservationV1[];
  assessments: readonly CriterionAssessmentV1[];
}>;

export class EvidenceResearchAuthorityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceResearchAuthorityError";
  }
}

export class EvidenceResearchNotNeededError extends Error {
  constructor() {
    super("No unresolved decision-critical evidence gap is available");
    this.name = "EvidenceResearchNotNeededError";
  }
}

export class EvidenceResearchLeaseError extends Error {
  constructor(readonly researchRunId: string) {
    super(`Evidence research run ${researchRunId} has another active owner`);
    this.name = "EvidenceResearchLeaseError";
  }
}

export class EvidenceAttemptConflictError extends Error {
  constructor(readonly attemptId: string) {
    super(
      `Evidence attempt ${attemptId} already has different terminal content`,
    );
    this.name = "EvidenceAttemptConflictError";
  }
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function deepPolicyVersion(
  selected: readonly {
    listing: PersistedCandidateListing;
    criterionIds: readonly string[];
  }[],
) {
  const identity = createHash("sha256")
    .update(
      JSON.stringify(
        selected.map(({ listing, criterionIds }) => ({
          candidateListingId: listing.id,
          criterionIds: [...criterionIds].sort(),
        })),
      ),
    )
    .digest("hex")
    .slice(0, 20);
  return `${EVIDENCE_POLICY_VERSION}:deep:${identity}`;
}

function failPersisted(
  recordType: string,
  recordId: string,
  cause: unknown,
): never {
  throw new PersistedDataCorruptionError({ recordType, recordId, cause });
}

function parsePersisted<T>(options: {
  recordType: string;
  recordId: string;
  parse: () => T;
}): T {
  try {
    return options.parse();
  } catch (cause) {
    failPersisted(options.recordType, options.recordId, cause);
  }
}

function mapAttemptRow(
  row: typeof evidenceAcquisitionAttempts.$inferSelect,
  targetCriterionIds: readonly string[],
): PersistedEvidenceAttempt {
  const { createdAt, ...value } = row;
  void createdAt;
  return persistedAttemptSchema.parse({ ...value, targetCriterionIds });
}

function hasExactNonEmptyCriterionTargets(
  expected: readonly string[],
  ...actualSets: readonly (readonly string[])[]
) {
  const expectedSet = new Set(expected);
  return (
    expectedSet.size > 0 &&
    actualSets.every((actual) => {
      const actualSet = new Set(actual);
      return (
        actualSet.size === expectedSet.size &&
        [...expectedSet].every((criterionId) => actualSet.has(criterionId))
      );
    })
  );
}

function hasNonEmptyCriterionSubset(
  subset: readonly string[],
  superset: readonly string[],
): boolean {
  const subsetSet = new Set(subset);
  const supersetSet = new Set(superset);
  return (
    subsetSet.size > 0 &&
    [...subsetSet].every((criterionId) => supersetSet.has(criterionId))
  );
}

export function validatePagePlanningTargetCoherence(options: {
  phase: "first_pass" | "deepening" | "reassessment";
  organicAttempts: readonly Readonly<{
    targetCriterionIds: readonly string[];
  }>[];
  extractionAttempt:
    Readonly<{ targetCriterionIds: readonly string[] }> | undefined;
  assessmentAttempt:
    Readonly<{ targetCriterionIds: readonly string[] }> | undefined;
}): boolean {
  const extractionTargets = options.extractionAttempt?.targetCriterionIds ?? [];
  const assessmentTargets = options.assessmentAttempt?.targetCriterionIds ?? [];
  if (!hasExactNonEmptyCriterionTargets(extractionTargets, assessmentTargets)) {
    return false;
  }
  if (options.phase === "reassessment") {
    // Reassessment has no organic discovery stage and must not invent page work.
    return options.organicAttempts.length === 0;
  }
  if (options.phase === "deepening") {
    return (
      options.organicAttempts.length > 0 &&
      hasExactNonEmptyCriterionTargets(
        extractionTargets,
        ...options.organicAttempts.map(
          ({ targetCriterionIds }) => targetCriterionIds,
        ),
      )
    );
  }
  // First-pass organic searches may be deliberately prioritized subsets of the
  // full model scope, but no search may authorize a criterion outside that scope.
  return (
    options.organicAttempts.length > 0 &&
    options.organicAttempts.every(({ targetCriterionIds }) =>
      hasNonEmptyCriterionSubset(targetCriterionIds, extractionTargets),
    )
  );
}

function validateDeepAttemptTargetCoherence(options: {
  run: EvidenceResearchSnapshot["run"];
  attempts: readonly PersistedEvidenceAttempt[];
}) {
  if (options.run.phase !== "deepening") return;
  const candidateListingIds = new Set(
    options.attempts.map(({ candidateListingId }) => candidateListingId),
  );
  for (const candidateListingId of candidateListingIds) {
    const attempts = options.attempts.filter(
      (attempt) => attempt.candidateListingId === candidateListingId,
    );
    const searchAttempts = attempts.filter(
      ({ stage }) => stage === "organic_search",
    );
    const extractionAttempts = attempts.filter(
      ({ stage }) => stage === "observation_extraction",
    );
    const assessmentAttempts = attempts.filter(
      ({ stage }) => stage === "criterion_assessment",
    );
    if (
      searchAttempts.length !== 1 ||
      extractionAttempts.length !== 1 ||
      assessmentAttempts.length !== 1 ||
      !hasExactNonEmptyCriterionTargets(
        searchAttempts[0]?.targetCriterionIds ?? [],
        extractionAttempts[0]?.targetCriterionIds ?? [],
        assessmentAttempts[0]?.targetCriterionIds ?? [],
      )
    ) {
      failPersisted(
        "EvidenceResearchRun",
        options.run.id,
        new Error(
          `Deep research target scope is incoherent for candidate ${candidateListingId}`,
        ),
      );
    }
  }
}

function usesBatchedFirstPassUnderstanding(
  run: EvidenceResearchSnapshot["run"],
) {
  return (
    run.phase === "first_pass" &&
    run.policyVersion ===
      `${EVIDENCE_POLICY_VERSION}:${FIRST_PASS_UNDERSTANDING_POLICY_IDENTITY}`
  );
}

async function validateUnderstandingAttemptCoherence(options: {
  tx: ShoppingTransaction;
  run: EvidenceResearchSnapshot["run"];
  attempts: readonly PersistedEvidenceAttempt[];
}) {
  const authoritativeFirstPassCriterionIds = usesBatchedFirstPassUnderstanding(
    options.run,
  )
    ? projectShoppingBrief(
        await loadShoppingStateAtRevision(
          options.tx,
          options.run.taskId,
          options.run.taskRevision,
        ),
      ).items.map(({ criterionId }) => criterionId)
    : null;
  const candidateListingIds = new Set(
    options.attempts.map(({ candidateListingId }) => candidateListingId),
  );
  for (const candidateListingId of candidateListingIds) {
    const candidateAttempts = options.attempts.filter(
      (attempt) => attempt.candidateListingId === candidateListingId,
    );
    const extractionAttempts = candidateAttempts.filter(
      ({ stage }) => stage === "observation_extraction",
    );
    const assessmentAttempts = candidateAttempts.filter(
      ({ stage }) => stage === "criterion_assessment",
    );
    try {
      if (usesBatchedFirstPassUnderstanding(options.run)) {
        const pairs = pairFirstPassUnderstandingAttempts(candidateAttempts);
        assertFirstPassUnderstandingPairsMatchCriteria(
          pairs,
          authoritativeFirstPassCriterionIds!,
        );
      } else if (
        extractionAttempts.length !== 1 ||
        assessmentAttempts.length !== 1 ||
        !hasExactNonEmptyCriterionTargets(
          extractionAttempts[0]?.targetCriterionIds ?? [],
          assessmentAttempts[0]?.targetCriterionIds ?? [],
        )
      ) {
        throw new Error("Understanding attempt pair is incoherent");
      }
    } catch (cause) {
      failPersisted("EvidenceResearchRun", options.run.id, cause);
    }
  }
}

function mapEvidenceSourceRow(
  row: typeof evidenceSources.$inferSelect,
): EvidenceSourceV1 {
  const { createdAt, ...value } = row;
  void createdAt;
  return evidenceSourceV1Schema.parse({ schemaVersion: 1, ...value });
}

function mapFetchedEvidenceDocumentRow(
  row: typeof fetchedEvidenceDocuments.$inferSelect,
): PersistedFetchedEvidenceDocument {
  const { createdAt, ...value } = row;
  void createdAt;
  const parsed = persistedFetchedEvidenceDocumentSchema.parse(value);
  if (
    parsed.documentHash !== computeExtractedPageDocumentHash(parsed.document) ||
    parsed.extractionVersion !== parsed.document.extractionVersion ||
    parsed.finalUrl !== parsed.document.sourceUrl ||
    parsed.canonicalUrl !== parsed.document.canonicalUrlCandidate
  ) {
    throw new Error("Fetched page document metadata is incoherent");
  }
  return parsed;
}

function fetchedPageFingerprint(options: {
  attemptId: string;
  discoveredSourceId: string;
  requestedUrl: string;
  finalUrl: string;
  canonicalUrl: string | null;
  responseHash: string;
  documentHash: string;
  admission: Extract<PageEvidenceAdmissionV1, { decision: "admit" }>;
}) {
  return fingerprint({ kind: "fetched_page", ...options });
}

function pageIdentityFromDocument(options: {
  fetch: FetchedPageMetadata;
  document: ExtractedProductPageDocumentV1;
}) {
  return {
    finalUrl: options.fetch.finalUrl,
    canonicalUrl: options.document.canonicalUrlCandidate,
    title: options.document.title,
    openGraphTitle: options.document.metadata.openGraphTitle,
    products: options.document.jsonLdProducts.map((product) => ({
      productName: product.name,
      brand: product.brand,
      model: product.model,
      sku: product.sku,
      mpn: product.mpn,
    })),
  } as const;
}

function exactJson(left: unknown, right: unknown) {
  return fingerprint(left) === fingerprint(right);
}

function exactDate(left: Date | null, right: Date) {
  return left !== null && left.getTime() === right.getTime();
}

function mapObservationRow(
  row: typeof productObservations.$inferSelect,
): ProductObservationV1 {
  const { createdAt, ...value } = row;
  void createdAt;
  return productObservationV1Schema.parse({ schemaVersion: 1, ...value });
}

async function loadResearchSnapshotInTransaction(options: {
  tx: ShoppingTransaction;
  taskId: z.infer<typeof shoppingTaskIdSchema>;
  researchRunId: z.infer<typeof evidenceResearchRunIdSchema>;
}): Promise<EvidenceResearchSnapshot | null> {
  const [runRow] = await options.tx
    .select()
    .from(evidenceResearchRuns)
    .where(
      and(
        eq(evidenceResearchRuns.taskId, options.taskId),
        eq(evidenceResearchRuns.id, options.researchRunId),
      ),
    )
    .limit(1);
  if (runRow === undefined) return null;

  const [
    attemptRows,
    targetRows,
    sourceRows,
    fetchedDocumentRows,
    observationRows,
    assessmentRows,
    linkRows,
  ] = await Promise.all([
    options.tx
      .select()
      .from(evidenceAcquisitionAttempts)
      .where(
        and(
          eq(evidenceAcquisitionAttempts.taskId, options.taskId),
          eq(evidenceAcquisitionAttempts.researchRunId, options.researchRunId),
        ),
      )
      .orderBy(asc(evidenceAcquisitionAttempts.createdAt)),
    options.tx
      .select()
      .from(evidenceAttemptTargetCriteria)
      .where(eq(evidenceAttemptTargetCriteria.taskId, options.taskId)),
    options.tx
      .select()
      .from(evidenceSources)
      .where(eq(evidenceSources.taskId, options.taskId)),
    options.tx
      .select()
      .from(fetchedEvidenceDocuments)
      .where(eq(fetchedEvidenceDocuments.taskId, options.taskId)),
    options.tx
      .select()
      .from(productObservations)
      .where(eq(productObservations.taskId, options.taskId)),
    options.tx
      .select()
      .from(criterionAssessments)
      .where(
        and(
          eq(criterionAssessments.taskId, options.taskId),
          eq(criterionAssessments.researchRunId, options.researchRunId),
        ),
      )
      .orderBy(asc(criterionAssessments.createdAt)),
    options.tx
      .select()
      .from(criterionAssessmentObservations)
      .where(eq(criterionAssessmentObservations.taskId, options.taskId)),
  ]);

  const candidateIds = new Set(
    attemptRows.map(({ candidateListingId }) => candidateListingId),
  );
  // Evidence describes the exact candidate, not the shopper revision. Reuse an
  // already admitted fetched page during reassessment instead of refetching it.
  const relevantSources = sourceRows.filter((row) =>
    candidateIds.has(row.candidateListingId),
  );
  const relevantSourceIds = new Set(relevantSources.map(({ id }) => id));
  const relevantObservations = observationRows.filter(
    (row) =>
      candidateIds.has(row.candidateListingId) &&
      relevantSourceIds.has(row.evidenceSourceId),
  );
  const observationIds = new Set(relevantObservations.map(({ id }) => id));
  const assessmentIds = new Set(assessmentRows.map(({ id }) => id));

  const run = parsePersisted({
    recordType: "EvidenceResearchRun",
    recordId: runRow.id,
    parse: () => ({
      id: evidenceResearchRunIdSchema.parse(runRow.id),
      taskId: shoppingTaskIdSchema.parse(runRow.taskId),
      searchRunId: searchRunIdSchema.parse(runRow.searchRunId),
      taskRevision: taskRevisionSchema.parse(runRow.taskRevision),
      policyVersion: z.string().min(1).max(120).parse(runRow.policyVersion),
      phase: z
        .enum(["first_pass", "deepening", "reassessment"])
        .parse(runRow.phase),
      status: researchStatusSchema.parse(runRow.status),
      selectedCandidateCount: z
        .number()
        .int()
        .min(1)
        .max(8)
        .parse(runRow.selectedCandidateCount),
      plannedSearchCount: z
        .number()
        .int()
        .nonnegative()
        .max(16)
        .parse(runRow.plannedSearchCount),
      startedAt: z.date().parse(runRow.startedAt),
      finishedAt: z.date().nullable().parse(runRow.finishedAt),
    }),
  });
  const attempts = attemptRows.map((row) =>
    parsePersisted({
      recordType: "EvidenceAcquisitionAttempt",
      recordId: row.id,
      parse: () =>
        mapAttemptRow(
          row,
          targetRows
            .filter(({ attemptId }) => attemptId === row.id)
            .map(({ criterionId }) => criterionId),
        ),
    }),
  );
  if (
    new Set(attempts.map(({ candidateListingId }) => candidateListingId))
      .size !== run.selectedCandidateCount
  ) {
    failPersisted(
      "EvidenceResearchRun",
      run.id,
      new Error("Selected candidate count does not match its attempts"),
    );
  }
  await validateUnderstandingAttemptCoherence({
    tx: options.tx,
    run,
    attempts,
  });
  validateDeepAttemptTargetCoherence({ run, attempts });
  await validateSnapshotFetchedPageChildren({
    tx: options.tx,
    taskId: options.taskId,
    researchRunId: options.researchRunId,
    runRow,
    attempts,
    sourceRows,
    documentRows: fetchedDocumentRows,
  });
  const reusablePageOwnerIds = [
    ...new Set(
      relevantSources.flatMap((row) =>
        row.sourceKind === "fetched_page" &&
        row.researchRunId !== options.researchRunId
          ? [row.researchRunId]
          : [],
      ),
    ),
  ];
  for (const ownerResearchRunId of reusablePageOwnerIds) {
    const [ownerRunRow, ownerAttemptRows] = await Promise.all([
      options.tx
        .select()
        .from(evidenceResearchRuns)
        .where(
          and(
            eq(evidenceResearchRuns.taskId, options.taskId),
            eq(evidenceResearchRuns.id, ownerResearchRunId),
          ),
        )
        .limit(1),
      options.tx
        .select()
        .from(evidenceAcquisitionAttempts)
        .where(
          and(
            eq(evidenceAcquisitionAttempts.taskId, options.taskId),
            eq(evidenceAcquisitionAttempts.researchRunId, ownerResearchRunId),
          ),
        )
        .orderBy(asc(evidenceAcquisitionAttempts.createdAt)),
    ]);
    if (ownerRunRow[0] === undefined) {
      failPersisted(
        "EvidenceSource",
        ownerResearchRunId,
        new Error("Reusable fetched-page owner is missing"),
      );
    }
    const ownerAttempts = ownerAttemptRows.map((row) =>
      mapAttemptRow(
        row,
        targetRows
          .filter(({ attemptId }) => attemptId === row.id)
          .map(({ criterionId }) => criterionId),
      ),
    );
    await validateSnapshotFetchedPageChildren({
      tx: options.tx,
      taskId: options.taskId,
      researchRunId: evidenceResearchRunIdSchema.parse(ownerResearchRunId),
      runRow: ownerRunRow[0]!,
      attempts: ownerAttempts,
      sourceRows,
      documentRows: fetchedDocumentRows,
    });
  }
  const sources = relevantSources.map((row) =>
    parsePersisted({
      recordType: "EvidenceSource",
      recordId: row.id,
      parse: () => mapEvidenceSourceRow(row),
    }),
  );
  const observations = relevantObservations.map((row) =>
    parsePersisted({
      recordType: "ProductObservation",
      recordId: row.id,
      parse: () => mapObservationRow(row),
    }),
  );
  const assessments = assessmentRows.map((row) => {
    const linked = linkRows
      .filter(
        (link) =>
          link.assessmentId === row.id &&
          observationIds.has(link.observationId),
      )
      .map(({ observationId }) => observationId);
    if (
      linkRows.some(
        (link) =>
          link.assessmentId === row.id &&
          !observationIds.has(link.observationId),
      )
    ) {
      failPersisted(
        "CriterionAssessment",
        row.id,
        new Error("Assessment links evidence from another candidate"),
      );
    }
    return parsePersisted({
      recordType: "CriterionAssessment",
      recordId: row.id,
      parse: () =>
        criterionAssessmentV1Schema.parse({
          schemaVersion: 1,
          ...row,
          observationIds: linked,
        }),
    });
  });
  if (
    linkRows.some(
      (link) =>
        assessmentIds.has(link.assessmentId) &&
        !observationIds.has(link.observationId),
    )
  ) {
    failPersisted(
      "EvidenceResearchRun",
      run.id,
      new Error("Research run contains cross-candidate observation linkage"),
    );
  }
  return { run, attempts, sources, observations, assessments };
}

export async function loadEvidenceResearchRun(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  researchRunId: unknown;
}) {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const researchRunId = evidenceResearchRunIdSchema.parse(
    options.researchRunId,
  );
  return options.db.transaction(
    (tx) => loadResearchSnapshotInTransaction({ tx, taskId, researchRunId }),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

async function insertSourceIdempotently(options: {
  tx: ShoppingTransaction;
  value: Omit<EvidenceSourceV1, "schemaVersion">;
}) {
  const [inserted] = await options.tx
    .insert(evidenceSources)
    .values(options.value)
    .onConflictDoNothing()
    .returning({
      id: evidenceSources.id,
      researchRunId: evidenceSources.researchRunId,
    });
  if (inserted !== undefined) {
    return {
      id: evidenceSourceIdSchema.parse(inserted.id),
      researchRunId: evidenceResearchRunIdSchema.parse(inserted.researchRunId),
    };
  }
  const [existing] = await options.tx
    .select({
      id: evidenceSources.id,
      researchRunId: evidenceSources.researchRunId,
    })
    .from(evidenceSources)
    .where(
      and(
        eq(evidenceSources.taskId, options.value.taskId),
        eq(evidenceSources.candidateRunId, options.value.candidateRunId),
        eq(
          evidenceSources.candidateListingId,
          options.value.candidateListingId,
        ),
        eq(evidenceSources.fingerprint, options.value.fingerprint),
      ),
    )
    .limit(1);
  if (existing === undefined) {
    throw new EvidenceAttemptConflictError(
      options.value.acquisitionAttemptId ?? options.value.id,
    );
  }
  return {
    id: evidenceSourceIdSchema.parse(existing.id),
    researchRunId: evidenceResearchRunIdSchema.parse(existing.researchRunId),
  };
}

async function insertObservationIdempotently(options: {
  tx: ShoppingTransaction;
  value: Omit<ProductObservationV1, "schemaVersion">;
}) {
  const [existing] = await options.tx
    .select({ id: productObservations.id })
    .from(productObservations)
    .where(
      and(
        eq(productObservations.taskId, options.value.taskId),
        eq(productObservations.candidateRunId, options.value.candidateRunId),
        eq(
          productObservations.candidateListingId,
          options.value.candidateListingId,
        ),
        eq(
          productObservations.evidenceSourceId,
          options.value.evidenceSourceId,
        ),
        eq(productObservations.fingerprint, options.value.fingerprint),
      ),
    )
    .limit(1);
  if (existing !== undefined)
    return productObservationIdSchema.parse(existing.id);
  await options.tx.insert(productObservations).values(options.value);
  return options.value.id;
}

function sourceExcerpt(listing: PersistedCandidateListing) {
  return [
    listing.title,
    listing.merchant,
    listing.priceText,
    listing.deliveryText,
    listing.availabilityText,
  ]
    .filter((value): value is string => value !== null)
    .join(" · ")
    .slice(0, 1_000);
}

async function insertDirectEvidence(options: {
  tx: ShoppingTransaction;
  researchRunId: z.infer<typeof evidenceResearchRunIdSchema>;
  listing: PersistedCandidateListing;
  items: ReturnType<typeof projectShoppingBrief>["items"];
  allowCriterionFreeObservations: boolean;
}) {
  const listingFingerprint = fingerprint({
    kind: "listing_field",
    url: options.listing.url,
    title: options.listing.title,
    merchant: options.listing.merchant,
    price: options.listing.price,
    reviewEvidence: options.listing.reviewEvidence,
  });
  const listingSource = await insertSourceIdempotently({
    tx: options.tx,
    value: {
      id: evidenceSourceIdSchema.parse(randomUUID()),
      researchRunId: options.researchRunId,
      taskId: options.listing.taskId,
      candidateRunId: options.listing.runId,
      candidateListingId: options.listing.id,
      acquisitionAttemptId: null,
      sourceRole: "listing",
      sourceKind: "listing_field",
      sourceUrl: options.listing.url,
      sourceTitle: options.listing.title.slice(0, 500),
      excerpt: sourceExcerpt(options.listing),
      provider: "listing",
      providerResultId: options.listing.providerResultId,
      observedAt: options.listing.retrievedAt,
      fingerprint: listingFingerprint,
    },
  });
  const purchasePriceItem = options.items.find(isPurchasePriceCriterion);
  if (
    options.listing.price !== null &&
    (purchasePriceItem !== undefined || options.allowCriterionFreeObservations)
  ) {
    await insertObservationIdempotently({
      tx: options.tx,
      value: {
        id: productObservationIdSchema.parse(randomUUID()),
        researchRunId: listingSource.researchRunId,
        taskId: options.listing.taskId,
        candidateRunId: options.listing.runId,
        candidateListingId: options.listing.id,
        evidenceSourceId: listingSource.id,
        conceptId: purchasePriceItem?.conceptId ?? null,
        support: "supported",
        observationKind: "structured_field",
        propertyLabel: "Observed price",
        claim: `${options.listing.priceText ?? "The listing"} is the observed listing price.`,
        value: {
          schemaVersion: 1,
          kind: "money",
          amountMinor: options.listing.price.amountMinor,
          currency: options.listing.price.currency,
        },
        derivation: "deterministic",
        model: null,
        promptVersion: null,
        observedAt: options.listing.retrievedAt,
        fingerprint: fingerprint({
          property: "price",
          value: options.listing.price,
        }),
      },
    });
  }
  const reviewItem = options.items.find(({ conceptLabel, conceptDefinition }) =>
    /review|customer sentiment/i.test(`${conceptLabel} ${conceptDefinition}`),
  );
  if (
    options.listing.reviewEvidence !== null &&
    (reviewItem !== undefined || options.allowCriterionFreeObservations)
  ) {
    const review = options.listing.reviewEvidence;
    const reviewSource = await insertSourceIdempotently({
      tx: options.tx,
      value: {
        id: evidenceSourceIdSchema.parse(randomUUID()),
        researchRunId: options.researchRunId,
        taskId: options.listing.taskId,
        candidateRunId: options.listing.runId,
        candidateListingId: options.listing.id,
        acquisitionAttemptId: null,
        sourceRole: "retailer_review_aggregate",
        sourceKind: "listing_field",
        sourceUrl: review.sourceUrl,
        sourceTitle:
          `${options.listing.merchant ?? "Retailer"} review aggregate`.slice(
            0,
            500,
          ),
        excerpt: `${(review.ratingHundredths / 100).toFixed(1)}/5 from ${review.reviewCount} reviews`,
        provider: "listing",
        providerResultId: options.listing.providerResultId,
        observedAt: options.listing.retrievedAt,
        fingerprint: fingerprint({ evidenceKind: "review", ...review }),
      },
    });
    await insertObservationIdempotently({
      tx: options.tx,
      value: {
        id: productObservationIdSchema.parse(randomUUID()),
        researchRunId: reviewSource.researchRunId,
        taskId: options.listing.taskId,
        candidateRunId: options.listing.runId,
        candidateListingId: options.listing.id,
        evidenceSourceId: reviewSource.id,
        conceptId: reviewItem?.conceptId ?? null,
        support: "supported",
        observationKind: "structured_field",
        propertyLabel: "Retailer review aggregate",
        claim: `${options.listing.merchant ?? "Retailer"} reports ${(review.ratingHundredths / 100).toFixed(1)}/5 from ${new Intl.NumberFormat("en-GB").format(review.reviewCount)} reviews.`,
        value: {
          schemaVersion: 1,
          kind: "rating_aggregate",
          ratingHundredths: review.ratingHundredths,
          scaleHundredths: 500,
          reviewCount: review.reviewCount,
        },
        derivation: "deterministic",
        model: null,
        promptVersion: null,
        observedAt: options.listing.retrievedAt,
        fingerprint: fingerprint({ property: "review", ...review }),
      },
    });
  }
  const wirelessItem = options.items.find(({ conceptLabel }) =>
    /wireless/i.test(conceptLabel),
  );
  const title = options.listing.title.toLocaleLowerCase("en-GB");
  const explicitWireless = /(^|[^a-z])wireless([^a-z]|$)/i.test(title);
  const explicitWired = /(^|[^a-z])wired([^a-z]|$)/i.test(title);
  if (wirelessItem !== undefined && (explicitWireless || explicitWired)) {
    await insertObservationIdempotently({
      tx: options.tx,
      value: {
        id: productObservationIdSchema.parse(randomUUID()),
        researchRunId: listingSource.researchRunId,
        taskId: options.listing.taskId,
        candidateRunId: options.listing.runId,
        candidateListingId: options.listing.id,
        evidenceSourceId: listingSource.id,
        conceptId: wirelessItem.conceptId,
        support: "supported",
        observationKind: "structured_field",
        propertyLabel: "Wireless connectivity",
        claim: explicitWireless
          ? "The listing title explicitly says wireless."
          : "The listing title explicitly says wired.",
        value: {
          schemaVersion: 1,
          kind: "boolean",
          value: explicitWireless,
        },
        derivation: "deterministic",
        model: null,
        promptVersion: null,
        observedAt: options.listing.retrievedAt,
        fingerprint: fingerprint({ property: "wireless", explicitWireless }),
      },
    });
  }
  for (const item of options.items) {
    const contradiction = directTitleSoftContradiction(
      item,
      options.listing.title,
    );
    if (contradiction === null) continue;
    await insertObservationIdempotently({
      tx: options.tx,
      value: {
        id: productObservationIdSchema.parse(randomUUID()),
        researchRunId: listingSource.researchRunId,
        taskId: options.listing.taskId,
        candidateRunId: options.listing.runId,
        candidateListingId: options.listing.id,
        evidenceSourceId: listingSource.id,
        conceptId: item.conceptId,
        support: "supported",
        observationKind: "structured_field",
        propertyLabel: DIRECT_TITLE_DESCRIPTOR_PROPERTY,
        claim: `The exact listing title uses “${contradiction.titleTerm}”.`,
        value: {
          schemaVersion: 1,
          kind: "text",
          text: contradiction.titleTerm,
        },
        derivation: "deterministic",
        model: null,
        promptVersion: null,
        observedAt: options.listing.retrievedAt,
        fingerprint: fingerprint({
          conceptId: item.conceptId,
          property: DIRECT_TITLE_DESCRIPTOR_PROPERTY,
          titleTerm: contradiction.titleTerm,
        }),
      },
    });
  }
  if (options.listing.imageUrl !== null) {
    await insertSourceIdempotently({
      tx: options.tx,
      value: {
        id: evidenceSourceIdSchema.parse(randomUUID()),
        researchRunId: options.researchRunId,
        taskId: options.listing.taskId,
        candidateRunId: options.listing.runId,
        candidateListingId: options.listing.id,
        acquisitionAttemptId: null,
        sourceRole: "visual",
        sourceKind: "listing_image",
        sourceUrl: options.listing.imageUrl,
        sourceTitle: `${options.listing.title.slice(0, 470)} image`,
        excerpt: null,
        provider: "listing",
        providerResultId: options.listing.providerResultId,
        observedAt: options.listing.retrievedAt,
        fingerprint: fingerprint({
          kind: "listing_image",
          url: options.listing.imageUrl,
        }),
      },
    });
  }
}

export async function prepareEvidenceResearch(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  searchRunId: unknown;
  evidenceProvider: "serper" | "fixture";
  modelProvider: "openai" | "fixture";
  model: string;
  promptVersion: string;
  mode?: "first_pass" | "deepening" | "targeted" | "reassessment";
  targetCandidateListingId?: unknown;
  targetCriterionId?: unknown;
  savedCandidateListingIds?: readonly unknown[];
  now?: Date;
}): Promise<EvidenceResearchSnapshot> {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const searchRunId = searchRunIdSchema.parse(options.searchRunId);
  const targetCandidateListingId =
    options.targetCandidateListingId === undefined
      ? undefined
      : candidateListingIdSchema.parse(options.targetCandidateListingId);
  const targetCriterionId =
    options.targetCriterionId === undefined
      ? undefined
      : criterionIdSchema.parse(options.targetCriterionId);
  const savedCandidateListingIds = [
    ...new Set(
      (options.savedCandidateListingIds ?? []).map((id) =>
        candidateListingIdSchema.parse(id),
      ),
    ),
  ].sort();
  const mode =
    options.mode ??
    (savedCandidateListingIds.length > 0 ? "reassessment" : "first_pass");
  if ((mode === "targeted") !== (targetCandidateListingId !== undefined)) {
    throw new EvidenceResearchAuthorityError(
      "Targeted research requires exactly one candidate listing",
    );
  }
  if (targetCriterionId !== undefined && mode !== "targeted") {
    throw new EvidenceResearchAuthorityError(
      "An exact criterion target is accepted only for targeted research",
    );
  }
  if (savedCandidateListingIds.length > 8) {
    throw new EvidenceResearchAuthorityError(
      "At most eight saved exact listings may be reassessed",
    );
  }
  if (mode === "reassessment" && savedCandidateListingIds.length === 0) {
    throw new EvidenceResearchAuthorityError(
      "Reassessment requires saved exact listings",
    );
  }
  const now = z.date().parse(options.now ?? new Date());
  return options.db.transaction(async (tx) => {
    const [lockedTask] = await tx
      .select({ currentRevision: shoppingTasks.currentRevision })
      .from(shoppingTasks)
      .where(eq(shoppingTasks.id, taskId))
      .for("update")
      .limit(1);
    if (lockedTask === undefined)
      throw new EvidenceResearchAuthorityError("Shopping task was not found");
    const state = await loadCurrentShoppingState(tx, taskId);
    const brief = projectShoppingBrief(state);
    const run = await loadPersistedSearchRunInTransaction({
      tx,
      taskId,
      runId: searchRunId,
    });
    if (run === null || run.status === "running") {
      throw new EvidenceResearchAuthorityError(
        "A completed task-local search run is required before research",
      );
    }
    const [savedRows, rejectedRows] = await Promise.all([
      tx
        .select({
          candidateListingId: savedCandidateListings.candidateListingId,
        })
        .from(savedCandidateListings)
        .where(eq(savedCandidateListings.taskId, taskId)),
      tx
        .select({
          candidateListingId: rejectedCandidateListings.candidateListingId,
        })
        .from(rejectedCandidateListings)
        .where(eq(rejectedCandidateListings.taskId, taskId)),
    ]);
    const savedIds = new Set(
      savedRows.map(({ candidateListingId }) => candidateListingId),
    );
    const rejectedIds = new Set(
      rejectedRows.map(({ candidateListingId }) => candidateListingId),
    );
    const searchRunIsCurrent =
      run.portfolio.run.taskRevision === brief.revision;
    if (
      (mode === "first_pass" || mode === "deepening") &&
      !searchRunIsCurrent
    ) {
      throw new EvidenceResearchAuthorityError(
        "Current-run research requires a search run from the current shopping revision",
      );
    }
    if (targetCandidateListingId !== undefined) {
      if (!run.listings.some(({ id }) => id === targetCandidateListingId)) {
        throw new EvidenceResearchAuthorityError(
          "Target candidate does not belong to this task-local search run",
        );
      }
      if (rejectedIds.has(targetCandidateListingId)) {
        throw new EvidenceResearchAuthorityError(
          "A rejected candidate cannot be researched",
        );
      }
      if (!searchRunIsCurrent && !savedIds.has(targetCandidateListingId)) {
        throw new EvidenceResearchAuthorityError(
          "A historical candidate must still be saved before targeted research",
        );
      }
    }
    if (
      targetCriterionId !== undefined &&
      !brief.items.some(({ criterionId }) => criterionId === targetCriterionId)
    ) {
      throw new EvidenceResearchAuthorityError(
        "Target criterion is not current for this shopping task",
      );
    }
    let selected: {
      listing: PersistedCandidateListing;
      foundAcrossQueryCount: number;
      criterionIds: readonly string[];
      criterionLabels: readonly string[];
    }[];
    if (mode === "reassessment") {
      selected = savedCandidateListingIds.map((candidateListingId) => {
        if (!savedIds.has(candidateListingId)) {
          throw new EvidenceResearchAuthorityError(
            "Historical reassessment may include only saved exact listings",
          );
        }
        const listing = run.listings.find(
          ({ id }) => id === candidateListingId,
        );
        if (listing === undefined) {
          throw new EvidenceResearchAuthorityError(
            "Saved exact listing does not belong to this search run",
          );
        }
        return {
          listing,
          foundAcrossQueryCount: 1,
          criterionIds: brief.items.map(({ criterionId }) => criterionId),
          criterionLabels: brief.items.map(({ conceptLabel }) => conceptLabel),
        };
      });
    } else if (mode === "deepening" || mode === "targeted") {
      const support = await loadCurrentDecisionSupportInTransaction({
        tx,
        taskId,
      });
      const orderedCandidateIds = orderCandidatesByAssessments({
        brief,
        candidates: run.listings.filter(({ id }) => !rejectedIds.has(id)),
        assessments: support.assessments,
      }).map(({ id }) => id);
      const completedCriterionIdsByCandidate = new Map<string, Set<string>>();
      const unavailableCriterionIdsByCandidate = new Map<string, Set<string>>();
      for (const coverage of support.deepResearchCoverage) {
        const unavailable =
          unavailableCriterionIdsByCandidate.get(coverage.candidateListingId) ??
          new Set<string>();
        for (const criterionId of coverage.criterionIds) {
          unavailable.add(criterionId);
        }
        unavailableCriterionIdsByCandidate.set(
          coverage.candidateListingId,
          unavailable,
        );
        if (coverage.runStatus === "running") continue;
        const completed =
          completedCriterionIdsByCandidate.get(coverage.candidateListingId) ??
          new Set<string>();
        for (const criterionId of coverage.criterionIds) {
          completed.add(criterionId);
        }
        completedCriterionIdsByCandidate.set(
          coverage.candidateListingId,
          completed,
        );
      }
      const selectDeep = (
        unavailable: ReadonlyMap<string, ReadonlySet<string>>,
      ) =>
        selectDeepResearchCandidates({
          brief,
          run,
          orderedCandidateIds,
          assessments: support.assessments,
          savedCandidateListingIds: savedIds,
          rejectedCandidateListingIds: rejectedIds,
          completedCriterionIdsByCandidate: unavailable,
          ...(targetCandidateListingId === undefined
            ? {}
            : { targetCandidateListingId }),
          ...(targetCriterionId === undefined ? {} : { targetCriterionId }),
          limit: mode === "targeted" ? 1 : 2,
        }).map((candidate) => ({ ...candidate, foundAcrossQueryCount: 1 }));
      const intendedWithoutActiveReservations = selectDeep(
        completedCriterionIdsByCandidate,
      );
      if (intendedWithoutActiveReservations.length > 0) {
        const intendedPolicyVersion = deepPolicyVersion(
          intendedWithoutActiveReservations,
        );
        const [existingIntended] = await tx
          .select({ id: evidenceResearchRuns.id })
          .from(evidenceResearchRuns)
          .where(
            and(
              eq(evidenceResearchRuns.taskId, taskId),
              eq(evidenceResearchRuns.searchRunId, searchRunId),
              eq(evidenceResearchRuns.taskRevision, brief.revision),
              eq(evidenceResearchRuns.policyVersion, intendedPolicyVersion),
            ),
          )
          .limit(1);
        if (existingIntended !== undefined) {
          const snapshot = await loadResearchSnapshotInTransaction({
            tx,
            taskId,
            researchRunId: evidenceResearchRunIdSchema.parse(
              existingIntended.id,
            ),
          });
          if (snapshot === null) {
            throw new Error("Existing research disappeared");
          }
          return snapshot;
        }
      }
      selected = selectDeep(unavailableCriterionIdsByCandidate);
    } else {
      const selectedBase = selectResearchCandidates({ brief, run });
      selected = selectedBase
        .filter(({ listing }) => !rejectedIds.has(listing.id))
        .map((candidate) => ({
          ...candidate,
          criterionIds: brief.items.map(({ criterionId }) => criterionId),
          criterionLabels: brief.items.map(({ conceptLabel }) => conceptLabel),
        }));
      for (const listing of run.listings) {
        if (
          selected.length >= 4 ||
          !savedIds.has(listing.id) ||
          rejectedIds.has(listing.id) ||
          selected.some(
            ({ listing: selectedListing }) => selectedListing.id === listing.id,
          )
        ) {
          continue;
        }
        selected.push({
          listing,
          foundAcrossQueryCount: 1,
          criterionIds: brief.items.map(({ criterionId }) => criterionId),
          criterionLabels: brief.items.map(({ conceptLabel }) => conceptLabel),
        });
      }
    }
    if (selected.length === 0) {
      if (mode !== "first_pass") throw new EvidenceResearchNotNeededError();
      throw new EvidenceResearchAuthorityError(
        "No candidate survived direct hard-constraint triage",
      );
    }
    const policyIdentity =
      mode === "first_pass"
        ? FIRST_PASS_UNDERSTANDING_POLICY_IDENTITY
        : mode === "reassessment"
          ? `reassess:${createHash("sha256")
              .update(JSON.stringify(savedCandidateListingIds))
              .digest("hex")
              .slice(0, 16)}`
          : null;
    const policyVersion =
      policyIdentity === null
        ? deepPolicyVersion(selected)
        : `${EVIDENCE_POLICY_VERSION}:${policyIdentity}`;
    const [existing] = await tx
      .select({ id: evidenceResearchRuns.id })
      .from(evidenceResearchRuns)
      .where(
        and(
          eq(evidenceResearchRuns.taskId, taskId),
          eq(evidenceResearchRuns.searchRunId, searchRunId),
          eq(evidenceResearchRuns.taskRevision, brief.revision),
          eq(evidenceResearchRuns.policyVersion, policyVersion),
        ),
      )
      .limit(1);
    if (existing !== undefined) {
      const snapshot = await loadResearchSnapshotInTransaction({
        tx,
        taskId,
        researchRunId: evidenceResearchRunIdSchema.parse(existing.id),
      });
      if (snapshot === null) throw new Error("Existing research disappeared");
      return snapshot;
    }
    const researchRunId = evidenceResearchRunIdSchema.parse(randomUUID());
    const searches =
      mode === "reassessment"
        ? []
        : selected.flatMap((candidate) =>
            (mode === "first_pass"
              ? planEvidenceSearches({ brief, candidate })
              : [planDecisionGapSearch({ candidate })]
            ).map((plan) => ({ candidate, plan })),
          );
    const phase =
      mode === "first_pass"
        ? ("first_pass" as const)
        : mode === "reassessment"
          ? ("reassessment" as const)
          : ("deepening" as const);
    await tx.insert(evidenceResearchRuns).values({
      id: researchRunId,
      taskId,
      searchRunId,
      taskRevision: brief.revision,
      policyVersion,
      phase,
      status: "running",
      selectedCandidateCount: selected.length,
      plannedSearchCount: searches.length,
      startedAt: now,
    });
    const attempts = [
      ...searches.map(({ candidate, plan }) => ({
        id: evidenceAcquisitionAttemptIdSchema.parse(randomUUID()),
        taskId,
        researchRunId,
        candidateRunId: searchRunId,
        candidateListingId: candidate.listing.id,
        stage: "organic_search" as const,
        purpose: plan.purpose,
        planKey: plan.planKey,
        query: plan.query,
        status: "planned" as const,
        provider: options.evidenceProvider,
        model: null,
        promptVersion: null,
        targetCriterionIds: plan.criterionIds,
      })),
      ...selected.flatMap(({ listing, criterionIds }) => {
        const batches =
          phase === "first_pass"
            ? planFirstPassUnderstandingBatches(criterionIds)
            : [
                {
                  criterionIds,
                  extractionPlanKey: "observation-extraction-v1",
                  assessmentPlanKey: `criterion-assessment-r${brief.revision}`,
                },
              ];
        return batches.flatMap((batch) => [
          {
            id: evidenceAcquisitionAttemptIdSchema.parse(randomUUID()),
            taskId,
            researchRunId,
            candidateRunId: searchRunId,
            candidateListingId: listing.id,
            stage: "observation_extraction" as const,
            purpose: "combined" as const,
            planKey: batch.extractionPlanKey,
            query: null,
            status: "planned" as const,
            provider: options.modelProvider,
            model: options.model,
            promptVersion: options.promptVersion,
            targetCriterionIds: batch.criterionIds,
          },
          {
            id: evidenceAcquisitionAttemptIdSchema.parse(randomUUID()),
            taskId,
            researchRunId,
            candidateRunId: searchRunId,
            candidateListingId: listing.id,
            stage: "criterion_assessment" as const,
            purpose: "current_brief" as const,
            planKey: batch.assessmentPlanKey,
            query: null,
            status: "planned" as const,
            provider: options.modelProvider,
            model: options.model,
            promptVersion: options.promptVersion,
            targetCriterionIds: batch.criterionIds,
          },
        ]);
      }),
    ];
    await tx.insert(evidenceAcquisitionAttempts).values(
      attempts.map(({ targetCriterionIds, ...attempt }) => {
        void targetCriterionIds;
        return attempt;
      }),
    );
    const targetBindings = attempts.flatMap((attempt) =>
      attempt.targetCriterionIds.map((criterionId) => ({
        taskId,
        researchRunId,
        candidateRunId: searchRunId,
        candidateListingId: attempt.candidateListingId,
        attemptId: attempt.id,
        criterionId: criterionIdSchema.parse(criterionId),
      })),
    );
    if (targetBindings.length > 0) {
      await tx.insert(evidenceAttemptTargetCriteria).values(targetBindings);
    }
    for (const { listing, criterionIds } of selected) {
      const targetCriterionIds = new Set(criterionIds);
      await insertDirectEvidence({
        tx,
        researchRunId,
        listing,
        items: brief.items.filter(({ criterionId }) =>
          targetCriterionIds.has(criterionId),
        ),
        allowCriterionFreeObservations: phase !== "deepening",
      });
    }
    const snapshot = await loadResearchSnapshotInTransaction({
      tx,
      taskId,
      researchRunId,
    });
    if (snapshot === null) throw new Error("Created research was not visible");
    return snapshot;
  });
}

export type CurrentDecisionSupport = Readonly<{
  brief: ReturnType<typeof projectShoppingBrief>;
  researchRuns: readonly EvidenceResearchSnapshot["run"][];
  deepResearchCoverage: readonly Readonly<{
    researchRunId: z.infer<typeof evidenceResearchRunIdSchema>;
    candidateListingId: z.infer<typeof candidateListingIdSchema>;
    runStatus: z.infer<typeof researchStatusSchema>;
    status: "planned" | "succeeded" | "failed";
    criterionIds: readonly z.infer<typeof criterionIdSchema>[];
    checkedSourcesByCriterion: readonly Readonly<{
      criterionId: z.infer<typeof criterionIdSchema>;
      sourceIds: readonly z.infer<typeof evidenceSourceIdSchema>[];
    }>[];
  }>[];
  candidates: readonly PersistedCandidateListing[];
  sources: readonly EvidenceSourceV1[];
  observations: readonly ProductObservationV1[];
  assessments: readonly CriterionAssessmentV1[];
}>;

function currentAssessmentsFromValidatedLineages(
  assessments: readonly CriterionAssessmentV1[],
) {
  const groups = new Map<string, CriterionAssessmentV1[]>();
  for (const assessment of assessments) {
    const identity = `${assessment.taskRevision}:${assessment.candidateRunId}:${assessment.candidateListingId}:${assessment.criterionId}`;
    const group = groups.get(identity) ?? [];
    group.push(assessment);
    groups.set(identity, group);
  }
  const current: CriterionAssessmentV1[] = [];
  for (const group of groups.values()) {
    group.sort(
      (left, right) =>
        left.generation - right.generation || left.id.localeCompare(right.id),
    );
    for (const [index, assessment] of group.entries()) {
      const predecessor = group[index - 1];
      const expectedGeneration = index + 1;
      const isLatest = index === group.length - 1;
      const validPredecessor =
        predecessor === undefined
          ? assessment.supersedesAssessmentId === null
          : assessment.supersedesAssessmentId === predecessor.id;
      const validLifecycle = isLatest
        ? assessment.supersededAt === null
        : assessment.supersededAt !== null &&
          assessment.supersededAt <= group[index + 1]!.createdAt;
      if (
        assessment.generation !== expectedGeneration ||
        !validPredecessor ||
        !validLifecycle
      ) {
        failPersisted(
          "CriterionAssessment",
          assessment.id,
          new Error(
            "Assessment generation lineage is incomplete or incoherent",
          ),
        );
      }
    }
    current.push(group[group.length - 1]!);
  }
  return current;
}

export async function loadCurrentDecisionSupportInTransaction(options: {
  tx: ShoppingTransaction;
  taskId: unknown;
  revision?: bigint;
  assessmentIds?: readonly string[];
}): Promise<CurrentDecisionSupport> {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const tx = options.tx;
  const state =
    options.revision === undefined
      ? await loadCurrentShoppingState(tx, taskId)
      : await loadShoppingStateAtRevision(tx, taskId, options.revision);
  const brief = projectShoppingBrief(state);
  const rows = await tx
    .select({
      id: evidenceResearchRuns.id,
      searchRunId: evidenceResearchRuns.searchRunId,
    })
    .from(evidenceResearchRuns)
    .where(
      and(
        eq(evidenceResearchRuns.taskId, taskId),
        eq(evidenceResearchRuns.taskRevision, brief.revision),
      ),
    )
    .orderBy(asc(evidenceResearchRuns.createdAt));
  const snapshots: EvidenceResearchSnapshot[] = [];
  for (const row of rows) {
    const snapshot = await loadResearchSnapshotInTransaction({
      tx,
      taskId,
      researchRunId: evidenceResearchRunIdSchema.parse(row.id),
    });
    if (snapshot === null) {
      failPersisted(
        "EvidenceResearchRun",
        row.id,
        new Error("Current research run disappeared"),
      );
    }
    snapshots.push(snapshot);
  }
  const candidateMap = new Map<string, PersistedCandidateListing>();
  for (const row of rows) {
    const searchRun = await loadPersistedSearchRunInTransaction({
      tx,
      taskId,
      runId: row.searchRunId,
    });
    if (searchRun === null) {
      failPersisted(
        "SearchRun",
        row.searchRunId,
        new Error("Evidence research search run is missing"),
      );
    }
    const selected = new Set(
      snapshots
        .filter(({ run }) => run.searchRunId === row.searchRunId)
        .flatMap(({ attempts }) =>
          attempts.map(({ candidateListingId }) => candidateListingId),
        ),
    );
    for (const listing of searchRun.listings) {
      if (selected.has(listing.id)) candidateMap.set(listing.id, listing);
    }
  }
  const sourceMap = new Map<string, EvidenceSourceV1>();
  const observationMap = new Map<string, ProductObservationV1>();
  for (const snapshot of snapshots) {
    for (const source of snapshot.sources) sourceMap.set(source.id, source);
    for (const observation of snapshot.observations) {
      observationMap.set(observation.id, observation);
    }
  }
  const allAssessments = snapshots
    .flatMap(({ assessments }) => assessments)
    .filter(({ taskRevision }) => taskRevision === brief.revision);
  const latestAssessments =
    currentAssessmentsFromValidatedLineages(allAssessments);
  const currentAssessments =
    options.assessmentIds === undefined
      ? latestAssessments
      : allAssessments.filter(({ id }) => options.assessmentIds!.includes(id));
  if (
    options.assessmentIds !== undefined &&
    (new Set(options.assessmentIds).size !== options.assessmentIds.length ||
      currentAssessments.length !== options.assessmentIds.length)
  ) {
    throw new Error("Historical decision assessment basis is incomplete");
  }
  return {
    brief,
    researchRuns: snapshots.map(({ run }) => run),
    deepResearchCoverage: snapshots.flatMap((snapshot) => {
      if (snapshot.run.phase !== "deepening") return [];
      const fetchedSourceByAttemptId = new Map(
        snapshot.sources.flatMap((source) =>
          source.sourceKind === "fetched_page" &&
          source.researchRunId === snapshot.run.id &&
          source.acquisitionAttemptId !== null
            ? [[source.acquisitionAttemptId, source.id] as const]
            : [],
        ),
      );
      return snapshot.attempts
        .filter(({ stage }) => stage === "organic_search")
        .map((attempt) => {
          const candidateAttempts = snapshot.attempts.filter(
            ({ candidateListingId }) =>
              candidateListingId === attempt.candidateListingId,
          );
          const checkedSourcesByCriterion = attempt.targetCriterionIds.map(
            (criterionId) => {
              const sourceIds = [
                ...new Set(
                  candidateAttempts.flatMap((candidateAttempt) => {
                    if (
                      candidateAttempt.stage !== "page_fetch" ||
                      candidateAttempt.status !== "succeeded" ||
                      !candidateAttempt.targetCriterionIds.includes(criterionId)
                    ) {
                      return [];
                    }
                    const sourceId = fetchedSourceByAttemptId.get(
                      candidateAttempt.id,
                    );
                    return sourceId === undefined ? [] : [sourceId];
                  }),
                ),
              ];
              if (sourceIds.length > MAX_PAGE_SOURCES_PER_CANDIDATE) {
                failPersisted(
                  "EvidenceResearchRun",
                  snapshot.run.id,
                  new Error(
                    "Checked-page provenance exceeds its candidate bound",
                  ),
                );
              }
              return { criterionId, sourceIds };
            },
          );
          return {
            researchRunId: snapshot.run.id,
            candidateListingId: attempt.candidateListingId,
            runStatus: snapshot.run.status,
            status: candidateAttempts.some(({ status }) => status === "failed")
              ? ("failed" as const)
              : candidateAttempts.some(({ status }) => status === "planned")
                ? ("planned" as const)
                : ("succeeded" as const),
            criterionIds: attempt.targetCriterionIds,
            checkedSourcesByCriterion,
          };
        });
    }),
    candidates: [...candidateMap.values()],
    sources: [...sourceMap.values()],
    observations: [...observationMap.values()],
    assessments: currentAssessments,
  };
}

export async function loadCurrentDecisionSupport(options: {
  db: ShoppingDatabase;
  taskId: unknown;
}): Promise<CurrentDecisionSupport> {
  return options.db.transaction(
    (tx) =>
      loadCurrentDecisionSupportInTransaction({
        tx,
        taskId: options.taskId,
      }),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

const LEASE_DURATION_SECONDS = 90;

async function loadLockedResearchRow(options: {
  tx: ShoppingTransaction;
  taskId: z.infer<typeof shoppingTaskIdSchema>;
  researchRunId: z.infer<typeof evidenceResearchRunIdSchema>;
}) {
  const [row] = await options.tx
    .select()
    .from(evidenceResearchRuns)
    .where(
      and(
        eq(evidenceResearchRuns.taskId, options.taskId),
        eq(evidenceResearchRuns.id, options.researchRunId),
      ),
    )
    .for("update")
    .limit(1);
  if (row === undefined) {
    throw new EvidenceResearchAuthorityError("Evidence research was not found");
  }
  return row;
}

function assertLease(
  row: { id: string; leaseToken: string | null },
  token: string,
) {
  if (row.leaseToken !== token) throw new EvidenceResearchLeaseError(row.id);
}

async function assertCurrentResearchAuthority(options: {
  tx: ShoppingTransaction;
  taskId: z.infer<typeof shoppingTaskIdSchema>;
  run: typeof evidenceResearchRuns.$inferSelect;
}) {
  const [task] = await options.tx
    .select({ currentRevision: shoppingTasks.currentRevision })
    .from(shoppingTasks)
    .where(eq(shoppingTasks.id, options.taskId))
    .for("share")
    .limit(1);
  if (task === undefined) {
    throw new EvidenceResearchAuthorityError("Shopping task was not found");
  }
  if (task.currentRevision !== options.run.taskRevision) {
    throw new StaleTaskRevisionError(
      options.taskId,
      options.run.taskRevision,
      task.currentRevision,
    );
  }
  if (options.run.status !== "running") {
    throw new EvidenceResearchAuthorityError(
      "Evidence research is no longer current work",
    );
  }
}

export async function claimEvidenceResearch(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  researchRunId: unknown;
}) {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const researchRunId = evidenceResearchRunIdSchema.parse(
    options.researchRunId,
  );
  const token = z.uuid().parse(randomUUID());
  return options.db.transaction(async (tx) => {
    const row = await loadLockedResearchRow({ tx, taskId, researchRunId });
    if (row.status !== "running") return null;
    const [claimed] = await tx
      .update(evidenceResearchRuns)
      .set({
        leaseToken: token,
        leaseExpiresAt: sql`clock_timestamp() + (${LEASE_DURATION_SECONDS} * interval '1 second')`,
      })
      .where(
        and(
          eq(evidenceResearchRuns.taskId, taskId),
          eq(evidenceResearchRuns.id, researchRunId),
          sql`(${evidenceResearchRuns.leaseToken} is null or ${evidenceResearchRuns.leaseExpiresAt} <= clock_timestamp())`,
        ),
      )
      .returning({ token: evidenceResearchRuns.leaseToken });
    return claimed?.token === token ? token : null;
  });
}

export async function renewEvidenceResearchLease(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  researchRunId: unknown;
  leaseToken: unknown;
}) {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const researchRunId = evidenceResearchRunIdSchema.parse(
    options.researchRunId,
  );
  const leaseToken = z.uuid().parse(options.leaseToken);
  return options.db.transaction(async (tx) => {
    const row = await loadLockedResearchRow({ tx, taskId, researchRunId });
    assertLease(row, leaseToken);
    const [task] = await tx
      .select({ currentRevision: shoppingTasks.currentRevision })
      .from(shoppingTasks)
      .where(eq(shoppingTasks.id, taskId))
      .for("share")
      .limit(1);
    if (task === undefined)
      throw new EvidenceResearchAuthorityError("Shopping task was not found");
    if (task.currentRevision !== row.taskRevision) {
      throw new StaleTaskRevisionError(
        taskId,
        row.taskRevision,
        task.currentRevision,
      );
    }
    if (row.status !== "running") return false;
    await tx
      .update(evidenceResearchRuns)
      .set({
        leaseExpiresAt: sql`clock_timestamp() + (${LEASE_DURATION_SECONDS} * interval '1 second')`,
      })
      .where(
        and(
          eq(evidenceResearchRuns.taskId, taskId),
          eq(evidenceResearchRuns.id, researchRunId),
          eq(evidenceResearchRuns.leaseToken, leaseToken),
        ),
      );
    return true;
  });
}

export async function releaseEvidenceResearchLease(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  researchRunId: unknown;
  leaseToken: unknown;
}) {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const researchRunId = evidenceResearchRunIdSchema.parse(
    options.researchRunId,
  );
  const leaseToken = z.uuid().parse(options.leaseToken);
  await options.db.transaction(async (tx) => {
    const row = await loadLockedResearchRow({ tx, taskId, researchRunId });
    if (row.status !== "running") return;
    assertLease(row, leaseToken);
    await tx
      .update(evidenceResearchRuns)
      .set({ leaseToken: null, leaseExpiresAt: null })
      .where(
        and(
          eq(evidenceResearchRuns.taskId, taskId),
          eq(evidenceResearchRuns.id, researchRunId),
          eq(evidenceResearchRuns.leaseToken, leaseToken),
        ),
      );
  });
}

async function loadLockedAttempt(options: {
  tx: ShoppingTransaction;
  taskId: z.infer<typeof shoppingTaskIdSchema>;
  researchRunId: z.infer<typeof evidenceResearchRunIdSchema>;
  attemptId: z.infer<typeof evidenceAcquisitionAttemptIdSchema>;
}) {
  const [row] = await options.tx
    .select()
    .from(evidenceAcquisitionAttempts)
    .where(
      and(
        eq(evidenceAcquisitionAttempts.taskId, options.taskId),
        eq(evidenceAcquisitionAttempts.researchRunId, options.researchRunId),
        eq(evidenceAcquisitionAttempts.id, options.attemptId),
      ),
    )
    .for("update")
    .limit(1);
  if (row === undefined)
    throw new EvidenceResearchAuthorityError("Evidence attempt was not found");
  const targetRows = await options.tx
    .select({ criterionId: evidenceAttemptTargetCriteria.criterionId })
    .from(evidenceAttemptTargetCriteria)
    .where(
      and(
        eq(evidenceAttemptTargetCriteria.taskId, options.taskId),
        eq(evidenceAttemptTargetCriteria.attemptId, options.attemptId),
      ),
    );
  return mapAttemptRow(
    row,
    targetRows.map(({ criterionId }) => criterionId),
  );
}

function normalizedPagePlanUrl(raw: string) {
  const url = new URL(raw);
  url.hash = "";
  url.hostname = url.hostname.toLocaleLowerCase("en-GB");
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function pageFetchPlanKey(options: {
  discoveredSourceId: string;
  purpose: PageSourcePurpose;
  targetCriterionIds: readonly string[];
}) {
  return `page-fetch:${fingerprint({
    policyVersion: PAGE_FETCH_POLICY_VERSION,
    discoveredSourceId: options.discoveredSourceId,
    purpose: options.purpose,
    targetCriterionIds: [...options.targetCriterionIds].sort(),
  }).slice(0, 32)}`;
}

/**
 * Plans only URLs that already exist as exact, admitted organic evidence for
 * this candidate generation. The caller cannot supply a URL or criterion.
 */
export async function planEvidencePageFetches(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  researchRunId: unknown;
  candidateListingId: unknown;
  leaseToken: unknown;
  provider: "server_http" | "fixture";
}): Promise<readonly PlannedEvidencePageFetch[]> {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const researchRunId = evidenceResearchRunIdSchema.parse(
    options.researchRunId,
  );
  const candidateListingId = candidateListingIdSchema.parse(
    options.candidateListingId,
  );
  const leaseToken = z.uuid().parse(options.leaseToken);
  const provider = pageAttemptProviderSchema.parse(options.provider);

  return options.db.transaction(async (tx) => {
    const run = await loadLockedResearchRow({ tx, taskId, researchRunId });
    assertLease(run, leaseToken);
    await assertCurrentResearchAuthority({ tx, taskId, run });

    const [rejected] = await tx
      .select({
        candidateListingId: rejectedCandidateListings.candidateListingId,
      })
      .from(rejectedCandidateListings)
      .where(
        and(
          eq(rejectedCandidateListings.taskId, taskId),
          eq(rejectedCandidateListings.candidateListingId, candidateListingId),
        ),
      )
      .limit(1);
    if (rejected !== undefined) {
      throw new EvidenceResearchAuthorityError(
        "A rejected candidate cannot receive fetched-page work",
      );
    }

    const searchRun = await loadPersistedSearchRunInTransaction({
      tx,
      taskId,
      runId: run.searchRunId,
    });
    const listing = searchRun?.listings.find(
      ({ id }) => id === candidateListingId,
    );
    if (listing === undefined) {
      throw new EvidenceResearchAuthorityError(
        "Page candidate is not in the research search run",
      );
    }

    const [attemptRows, targetCriterionRows, pageTargetRows] =
      await Promise.all([
        tx
          .select()
          .from(evidenceAcquisitionAttempts)
          .where(
            and(
              eq(evidenceAcquisitionAttempts.taskId, taskId),
              eq(evidenceAcquisitionAttempts.researchRunId, researchRunId),
              eq(evidenceAcquisitionAttempts.candidateRunId, run.searchRunId),
              eq(
                evidenceAcquisitionAttempts.candidateListingId,
                candidateListingId,
              ),
            ),
          )
          .orderBy(asc(evidenceAcquisitionAttempts.createdAt)),
        tx
          .select()
          .from(evidenceAttemptTargetCriteria)
          .where(
            and(
              eq(evidenceAttemptTargetCriteria.taskId, taskId),
              eq(evidenceAttemptTargetCriteria.researchRunId, researchRunId),
              eq(evidenceAttemptTargetCriteria.candidateRunId, run.searchRunId),
              eq(
                evidenceAttemptTargetCriteria.candidateListingId,
                candidateListingId,
              ),
            ),
          ),
        tx
          .select()
          .from(evidencePageFetchTargets)
          .where(
            and(
              eq(evidencePageFetchTargets.taskId, taskId),
              eq(evidencePageFetchTargets.researchRunId, researchRunId),
              eq(evidencePageFetchTargets.candidateRunId, run.searchRunId),
              eq(
                evidencePageFetchTargets.candidateListingId,
                candidateListingId,
              ),
            ),
          ),
      ]);
    const attempts = attemptRows.map((row) =>
      parsePersisted({
        recordType: "EvidenceAcquisitionAttempt",
        recordId: row.id,
        parse: () =>
          mapAttemptRow(
            row,
            targetCriterionRows
              .filter(({ attemptId }) => attemptId === row.id)
              .map(({ criterionId }) => criterionId),
          ),
      }),
    );
    const organicAttempts = attempts.filter(
      ({ stage }) => stage === "organic_search",
    );
    const extractionAttempts = attempts.filter(
      ({ stage }) => stage === "observation_extraction",
    );
    const assessmentAttempts = attempts.filter(
      ({ stage }) => stage === "criterion_assessment",
    );
    const existingPageAttempts = attempts.filter(
      ({ stage }) => stage === "page_fetch",
    );
    const phase = z
      .enum(["first_pass", "deepening", "reassessment"])
      .parse(run.phase);
    const state = await loadCurrentShoppingState(tx, taskId);
    const brief = projectShoppingBrief(state);
    let exactTargetIds: readonly string[];
    try {
      if (
        phase === "first_pass" &&
        run.policyVersion ===
          `${EVIDENCE_POLICY_VERSION}:${FIRST_PASS_UNDERSTANDING_POLICY_IDENTITY}`
      ) {
        const pairs = pairFirstPassUnderstandingAttempts(attempts);
        assertFirstPassUnderstandingPairsMatchCriteria(
          pairs,
          brief.items.map(({ criterionId }) => criterionId),
        );
        exactTargetIds = pairs.flatMap(
          ({ extraction }) => extraction.targetCriterionIds,
        );
      } else {
        if (
          extractionAttempts.length !== 1 ||
          assessmentAttempts.length !== 1
        ) {
          throw new Error("Understanding attempt pair is unavailable");
        }
        exactTargetIds = extractionAttempts[0]!.targetCriterionIds;
      }
      if (
        !validatePagePlanningTargetCoherence({
          phase,
          organicAttempts,
          extractionAttempt: { targetCriterionIds: exactTargetIds },
          assessmentAttempt: { targetCriterionIds: exactTargetIds },
        })
      ) {
        throw new Error("Page planning targets disagree with model scope");
      }
    } catch {
      throw new EvidenceAttemptConflictError(
        extractionAttempts[0]?.id ?? candidateListingId,
      );
    }
    if (phase === "reassessment") {
      if (existingPageAttempts.length !== 0 || pageTargetRows.length !== 0) {
        throw new EvidenceAttemptConflictError(
          existingPageAttempts[0]?.id ?? candidateListingId,
        );
      }
      return [];
    }
    if (organicAttempts.some(({ status }) => status === "planned")) {
      throw new EvidenceResearchAuthorityError(
        "Organic evidence must be terminal before page planning",
      );
    }
    if (
      existingPageAttempts.length > MAX_PAGE_SOURCES_PER_CANDIDATE ||
      pageTargetRows.length !== existingPageAttempts.length
    ) {
      failPersisted(
        "EvidenceResearchRun",
        researchRunId,
        new Error("Fetched-page plan cardinality is invalid"),
      );
    }

    const targetIdSet = new Set(exactTargetIds);
    const targetCriteria = brief.items.filter(({ criterionId }) =>
      targetIdSet.has(criterionId),
    );
    if (targetCriteria.length !== targetIdSet.size) {
      throw new EvidenceResearchAuthorityError(
        "Page attempt criteria are not current for this task revision",
      );
    }

    const succeededOrganicAttemptIds = new Set(
      organicAttempts
        .filter(({ status }) => status === "succeeded")
        .map(({ id }) => id),
    );
    const organicSourceRows =
      succeededOrganicAttemptIds.size === 0
        ? []
        : await tx
            .select()
            .from(evidenceSources)
            .where(
              and(
                eq(evidenceSources.taskId, taskId),
                eq(evidenceSources.researchRunId, researchRunId),
                eq(evidenceSources.candidateRunId, run.searchRunId),
                eq(evidenceSources.candidateListingId, candidateListingId),
                eq(evidenceSources.sourceKind, "organic_result"),
                isNotNull(evidenceSources.acquisitionAttemptId),
                inArray(evidenceSources.acquisitionAttemptId, [
                  ...succeededOrganicAttemptIds,
                ]),
              ),
            )
            .orderBy(
              asc(evidenceSources.providerResultId),
              asc(evidenceSources.sourceUrl),
              asc(evidenceSources.id),
            );
    const parsedOrganicSources = organicSourceRows.map((row) =>
      parsePersisted({
        recordType: "EvidenceSource",
        recordId: row.id,
        parse: () => mapEvidenceSourceRow(row),
      }),
    );
    const organicSources = parsedOrganicSources.map((source) => {
      if (
        source.sourceKind !== "organic_result" ||
        source.acquisitionAttemptId === null ||
        !succeededOrganicAttemptIds.has(source.acquisitionAttemptId) ||
        source.providerResultId === null ||
        source.sourceRole === "listing" ||
        source.sourceRole === "visual"
      ) {
        failPersisted(
          "EvidenceResearchRun",
          researchRunId,
          new Error("Organic page discovery provenance is incomplete"),
        );
      }
      return source as PlannedOrganicEvidenceSource;
    });
    const selections = selectPageSources({
      candidateTitle: listing.title,
      merchant: listing.merchant,
      targetCriteria,
      organicSources: organicSources.map((source, index) => ({
        providerResultId: source.providerResultId,
        rank: index + 1,
        title: source.sourceTitle,
        url: source.sourceUrl,
        sourceRole: source.sourceRole,
      })),
    });
    if (selections.length > MAX_PAGE_SOURCES_PER_CANDIDATE) {
      throw new Error("Page source selector exceeded its hard bound");
    }
    const selected = selections.flatMap((selection) => {
      const discoveredSource = organicSources.find(
        (source) =>
          source.providerResultId === selection.providerResultId &&
          source.sourceTitle === selection.title &&
          normalizedPagePlanUrl(source.sourceUrl) === selection.url &&
          source.sourceRole === selection.discoveredRole,
      );
      if (discoveredSource === undefined) {
        throw new EvidenceResearchAuthorityError(
          "Selected page source is not exact task-local organic evidence",
        );
      }
      if (
        selection.targetCriterionIds.some(
          (criterionId) => !targetIdSet.has(criterionId),
        )
      ) {
        throw new EvidenceResearchAuthorityError(
          "Selected page criteria are outside the exact candidate generation",
        );
      }
      const discoveryAttempt = organicAttempts.find(
        ({ id }) => id === discoveredSource.acquisitionAttemptId,
      );
      if (discoveryAttempt === undefined) {
        throw new EvidenceResearchAuthorityError(
          "Selected page source has no exact organic discovery attempt",
        );
      }
      const scopedTargetCriterionIds = selection.targetCriterionIds.filter(
        (criterionId) =>
          discoveryAttempt.targetCriterionIds.includes(criterionId),
      );
      // A source may be relevant to the full brief but not to the subset its
      // discovering query owned. Skip that source rather than broadening its
      // authority to an unsearched criterion.
      if (scopedTargetCriterionIds.length === 0) return [];
      const scopedSelection = {
        ...selection,
        targetCriterionIds: scopedTargetCriterionIds,
      };
      return [
        {
          selection: scopedSelection,
          discoveredSource,
          planKey: pageFetchPlanKey({
            discoveredSourceId: discoveredSource.id,
            purpose: selection.purpose,
            targetCriterionIds: scopedTargetCriterionIds,
          }),
        },
      ];
    });

    const existingByPlanKey = new Map(
      existingPageAttempts.map((attempt) => [attempt.planKey, attempt]),
    );
    if (
      existingPageAttempts.length !== 0 &&
      (existingPageAttempts.length !== selected.length ||
        selected.some(({ planKey }) => !existingByPlanKey.has(planKey)))
    ) {
      throw new EvidenceAttemptConflictError(
        existingPageAttempts[0]?.id ?? candidateListingId,
      );
    }

    if (existingPageAttempts.length === 0 && selected.length > 0) {
      const newAttempts = selected.map(({ selection, planKey }) => ({
        id: evidenceAcquisitionAttemptIdSchema.parse(randomUUID()),
        taskId,
        researchRunId,
        candidateRunId: run.searchRunId,
        candidateListingId,
        stage: "page_fetch" as const,
        purpose: "source_depth" as const,
        planKey,
        query: null,
        status: "planned" as const,
        provider,
        model: null,
        promptVersion: null,
        providerRequestId: null,
        receivedResultCount: null,
        failureCode: null,
        startedAt: null,
        finishedAt: null,
        targetCriterionIds: selection.targetCriterionIds,
      }));
      await tx.insert(evidenceAcquisitionAttempts).values(
        newAttempts.map(({ targetCriterionIds, ...attempt }) => {
          void targetCriterionIds;
          return attempt;
        }),
      );
      await tx.insert(evidenceAttemptTargetCriteria).values(
        newAttempts.flatMap((attempt) =>
          attempt.targetCriterionIds.map((criterionId) => ({
            taskId,
            researchRunId,
            candidateRunId: run.searchRunId,
            candidateListingId,
            attemptId: attempt.id,
            criterionId: criterionIdSchema.parse(criterionId),
          })),
        ),
      );
      await tx.insert(evidencePageFetchTargets).values(
        newAttempts.map((attempt, index) => ({
          taskId,
          researchRunId,
          candidateRunId: run.searchRunId,
          candidateListingId,
          attemptId: attempt.id,
          discoveredSourceId: selected[index]!.discoveredSource.id,
          requestedUrl: selected[index]!.selection.url,
          policyVersion: PAGE_FETCH_POLICY_VERSION,
        })),
      );
      return selected.map(({ selection, discoveredSource }, index) => ({
        attempt: persistedAttemptSchema.parse(newAttempts[index]),
        discoveredSource,
        requestedUrl: selection.url,
        policyVersion: PAGE_FETCH_POLICY_VERSION,
        purpose: selection.purpose,
      }));
    }

    return selected.map(
      ({ selection, discoveredSource, planKey }): PlannedEvidencePageFetch => {
        const attempt = existingByPlanKey.get(planKey);
        const target = pageTargetRows.find(
          ({ attemptId }) => attemptId === attempt?.id,
        );
        if (
          attempt === undefined ||
          attempt.provider !== provider ||
          attempt.purpose !== "source_depth" ||
          attempt.query !== null ||
          !hasExactNonEmptyCriterionTargets(
            selection.targetCriterionIds,
            attempt.targetCriterionIds,
          ) ||
          target === undefined ||
          target.discoveredSourceId !== discoveredSource.id ||
          target.requestedUrl !== selection.url ||
          target.policyVersion !== PAGE_FETCH_POLICY_VERSION
        ) {
          throw new EvidenceAttemptConflictError(
            attempt?.id ?? candidateListingId,
          );
        }
        return {
          attempt: {
            ...attempt,
            targetCriterionIds: [...selection.targetCriterionIds],
          },
          discoveredSource,
          requestedUrl: selection.url,
          policyVersion: PAGE_FETCH_POLICY_VERSION,
          purpose: selection.purpose,
        };
      },
    );
  });
}

async function loadOwnedPageAttemptContext(options: {
  tx: ShoppingTransaction;
  taskId: z.infer<typeof shoppingTaskIdSchema>;
  researchRunId: z.infer<typeof evidenceResearchRunIdSchema>;
  run: typeof evidenceResearchRuns.$inferSelect;
  attempt: PersistedEvidenceAttempt;
}) {
  const { attempt } = options;
  if (
    attempt.stage !== "page_fetch" ||
    attempt.purpose !== "source_depth" ||
    (attempt.provider !== "server_http" && attempt.provider !== "fixture") ||
    attempt.query !== null ||
    attempt.model !== null ||
    attempt.promptVersion !== null ||
    attempt.candidateRunId !== options.run.searchRunId
  ) {
    throw new EvidenceAttemptConflictError(attempt.id);
  }
  const targetRows = await options.tx
    .select()
    .from(evidencePageFetchTargets)
    .where(
      and(
        eq(evidencePageFetchTargets.taskId, options.taskId),
        eq(evidencePageFetchTargets.researchRunId, options.researchRunId),
        eq(evidencePageFetchTargets.attemptId, attempt.id),
      ),
    );
  const target = targetRows[0];
  if (targetRows.length !== 1 || target === undefined) {
    failPersisted(
      "EvidenceAcquisitionAttempt",
      attempt.id,
      new Error("Page attempt has no exact discovery binding"),
    );
  }
  const [discoveredRow] = await options.tx
    .select()
    .from(evidenceSources)
    .where(
      and(
        eq(evidenceSources.taskId, options.taskId),
        eq(evidenceSources.id, target.discoveredSourceId),
      ),
    )
    .limit(1);
  if (discoveredRow === undefined) {
    failPersisted(
      "EvidencePageFetchTarget",
      attempt.id,
      new Error("Discovered source is unavailable"),
    );
  }
  const discoveredSource = parsePersisted({
    recordType: "EvidenceSource",
    recordId: discoveredRow.id,
    parse: () => mapEvidenceSourceRow(discoveredRow),
  });
  if (
    target.attemptStage !== "page_fetch" ||
    target.discoveredSourceKind !== "organic_result" ||
    target.policyVersion !== PAGE_FETCH_POLICY_VERSION ||
    target.candidateRunId !== attempt.candidateRunId ||
    target.candidateListingId !== attempt.candidateListingId ||
    discoveredSource.researchRunId !== options.researchRunId ||
    discoveredSource.candidateRunId !== attempt.candidateRunId ||
    discoveredSource.candidateListingId !== attempt.candidateListingId ||
    discoveredSource.sourceKind !== "organic_result" ||
    discoveredSource.acquisitionAttemptId === null ||
    discoveredSource.providerResultId === null ||
    normalizedPagePlanUrl(discoveredSource.sourceUrl) !== target.requestedUrl
  ) {
    failPersisted(
      "EvidencePageFetchTarget",
      attempt.id,
      new Error("Page discovery provenance crosses an owned scope"),
    );
  }

  const [discoveryAttemptRow] = await options.tx
    .select()
    .from(evidenceAcquisitionAttempts)
    .where(
      and(
        eq(evidenceAcquisitionAttempts.taskId, options.taskId),
        eq(evidenceAcquisitionAttempts.researchRunId, options.researchRunId),
        eq(
          evidenceAcquisitionAttempts.id,
          discoveredSource.acquisitionAttemptId,
        ),
      ),
    )
    .limit(1);
  if (discoveryAttemptRow === undefined) {
    failPersisted(
      "EvidenceSource",
      discoveredSource.id,
      new Error("Organic discovery attempt is unavailable"),
    );
  }
  const discoveryCriterionRows = await options.tx
    .select({ criterionId: evidenceAttemptTargetCriteria.criterionId })
    .from(evidenceAttemptTargetCriteria)
    .where(
      and(
        eq(evidenceAttemptTargetCriteria.taskId, options.taskId),
        eq(
          evidenceAttemptTargetCriteria.attemptId,
          discoveredSource.acquisitionAttemptId,
        ),
      ),
    );
  const discoveryAttempt = parsePersisted({
    recordType: "EvidenceAcquisitionAttempt",
    recordId: discoveryAttemptRow.id,
    parse: () =>
      mapAttemptRow(
        discoveryAttemptRow,
        discoveryCriterionRows.map(({ criterionId }) => criterionId),
      ),
  });
  const discoveryTargetIds = new Set(discoveryAttempt.targetCriterionIds);
  if (
    discoveryAttempt.stage !== "organic_search" ||
    discoveryAttempt.status !== "succeeded" ||
    discoveredSource.provider !== discoveryAttempt.provider ||
    discoveryAttempt.candidateRunId !== attempt.candidateRunId ||
    discoveryAttempt.candidateListingId !== attempt.candidateListingId ||
    attempt.targetCriterionIds.length === 0 ||
    attempt.targetCriterionIds.some(
      (criterionId) => !discoveryTargetIds.has(criterionId),
    )
  ) {
    failPersisted(
      "EvidencePageFetchTarget",
      attempt.id,
      new Error("Page attempt is not a subset of its organic discovery"),
    );
  }

  const searchRun = await loadPersistedSearchRunInTransaction({
    tx: options.tx,
    taskId: options.taskId,
    runId: options.run.searchRunId,
  });
  const listing = searchRun?.listings.find(
    ({ id }) => id === attempt.candidateListingId,
  );
  if (listing === undefined) {
    throw new EvidenceResearchAuthorityError(
      "Fetched-page candidate is unavailable",
    );
  }
  const state = await loadShoppingStateAtRevision(
    options.tx,
    options.taskId,
    options.run.taskRevision,
  );
  const brief = projectShoppingBrief(state);
  const pageTargetIds = new Set(attempt.targetCriterionIds);
  const targetCriteria = brief.items.filter(({ criterionId }) =>
    pageTargetIds.has(criterionId),
  );
  if (targetCriteria.length !== pageTargetIds.size) {
    throw new EvidenceResearchAuthorityError(
      "Fetched-page criteria are not authoritative at the owning revision",
    );
  }
  return {
    target,
    discoveredSource,
    discoveryAttempt,
    listing,
    targetCriteria,
  };
}

function expectedFetchedSource(options: {
  id: z.infer<typeof evidenceSourceIdSchema>;
  taskId: z.infer<typeof shoppingTaskIdSchema>;
  researchRunId: z.infer<typeof evidenceResearchRunIdSchema>;
  attempt: PersistedEvidenceAttempt;
  discoveredSource: EvidenceSourceV1;
  targetCriteria: Parameters<
    typeof projectFetchedPageModelExcerpt
  >[0]["targetCriteria"];
  fetch: FetchedPageMetadata;
  document: ExtractedProductPageDocumentV1;
  admission: Extract<PageEvidenceAdmissionV1, { decision: "admit" }>;
}): EvidenceSourceV1 {
  const documentHash = computeExtractedPageDocumentHash(options.document);
  return evidenceSourceV1Schema.parse({
    schemaVersion: 1,
    id: options.id,
    researchRunId: options.researchRunId,
    taskId: options.taskId,
    candidateRunId: options.attempt.candidateRunId,
    candidateListingId: options.attempt.candidateListingId,
    acquisitionAttemptId: options.attempt.id,
    sourceRole: options.admission.admittedRole,
    sourceKind: "fetched_page",
    sourceUrl: options.fetch.finalUrl,
    sourceTitle: options.document.title ?? options.discoveredSource.sourceTitle,
    excerpt: projectFetchedPageModelExcerpt({
      document: options.document,
      targetCriteria: options.targetCriteria,
    }),
    provider: options.attempt.provider === "fixture" ? "fixture" : "page_fetch",
    providerResultId: options.discoveredSource.providerResultId,
    observedAt: options.fetch.fetchedAt,
    fingerprint: fetchedPageFingerprint({
      attemptId: options.attempt.id,
      discoveredSourceId: options.discoveredSource.id,
      requestedUrl: options.fetch.requestedUrl,
      finalUrl: options.fetch.finalUrl,
      canonicalUrl: options.document.canonicalUrlCandidate,
      responseHash: options.fetch.responseHash,
      documentHash,
      admission: options.admission,
    }),
  });
}

function exactFetchedSource(
  actual: EvidenceSourceV1,
  expected: EvidenceSourceV1,
) {
  return exactJson(actual, expected);
}

async function validateStoredFetchedDocument(options: {
  tx: ShoppingTransaction;
  row: typeof fetchedEvidenceDocuments.$inferSelect;
  taskId: z.infer<typeof shoppingTaskIdSchema>;
  researchRunId: z.infer<typeof evidenceResearchRunIdSchema>;
  attempt: PersistedEvidenceAttempt;
  context: Awaited<ReturnType<typeof loadOwnedPageAttemptContext>>;
}) {
  const document = parsePersisted({
    recordType: "FetchedEvidenceDocument",
    recordId: options.row.id,
    parse: () => mapFetchedEvidenceDocumentRow(options.row),
  });
  if (
    document.taskId !== options.taskId ||
    document.researchRunId !== options.researchRunId ||
    document.candidateRunId !== options.attempt.candidateRunId ||
    document.candidateListingId !== options.attempt.candidateListingId ||
    document.attemptId !== options.attempt.id ||
    document.discoveredSourceId !== options.context.discoveredSource.id ||
    document.requestedUrl !== options.context.target.requestedUrl
  ) {
    failPersisted(
      "FetchedEvidenceDocument",
      document.id,
      new Error("Fetched document crosses its exact attempt scope"),
    );
  }
  const [sourceRow] = await options.tx
    .select()
    .from(evidenceSources)
    .where(
      and(
        eq(evidenceSources.taskId, options.taskId),
        eq(evidenceSources.id, document.evidenceSourceId),
      ),
    )
    .limit(1);
  if (sourceRow === undefined) {
    failPersisted(
      "FetchedEvidenceDocument",
      document.id,
      new Error("Admitted fetched source is unavailable"),
    );
  }
  const actualSource = parsePersisted({
    recordType: "EvidenceSource",
    recordId: sourceRow.id,
    parse: () => mapEvidenceSourceRow(sourceRow),
  });
  const metadata = fetchedPageMetadataSchema.parse({
    requestedUrl: document.requestedUrl,
    finalUrl: document.finalUrl,
    contentType: document.contentType,
    encodedBytes: document.encodedBytes,
    decodedBytes: document.decodedBytes,
    fetchedAt: document.fetchedAt,
    responseHash: document.responseHash,
  });
  const recomputedAdmission = admitFetchedPageEvidence({
    candidateTitle: options.context.listing.title,
    merchant: options.context.listing.merchant,
    discovered: {
      sourceRole: options.context.discoveredSource.sourceRole,
      url: options.context.discoveredSource.sourceUrl,
      title: options.context.discoveredSource.sourceTitle,
    },
    page: pageIdentityFromDocument({
      fetch: metadata,
      document: document.document,
    }),
  });
  if (
    recomputedAdmission.decision !== "admit" ||
    !exactJson(recomputedAdmission, document.admission)
  ) {
    failPersisted(
      "FetchedEvidenceDocument",
      document.id,
      new Error("Stored fetched-page admission is not reproducible"),
    );
  }
  const expectedSource = expectedFetchedSource({
    id: document.evidenceSourceId,
    taskId: options.taskId,
    researchRunId: options.researchRunId,
    attempt: options.attempt,
    discoveredSource: options.context.discoveredSource,
    targetCriteria: options.context.targetCriteria,
    fetch: metadata,
    document: document.document,
    admission: recomputedAdmission,
  });
  if (!exactFetchedSource(actualSource, expectedSource)) {
    failPersisted(
      "EvidenceSource",
      actualSource.id,
      new Error("Fetched source and document provenance differ"),
    );
  }
  return document;
}

async function validateSnapshotFetchedPageChildren(options: {
  tx: ShoppingTransaction;
  taskId: z.infer<typeof shoppingTaskIdSchema>;
  researchRunId: z.infer<typeof evidenceResearchRunIdSchema>;
  runRow: typeof evidenceResearchRuns.$inferSelect;
  attempts: readonly PersistedEvidenceAttempt[];
  sourceRows: readonly (typeof evidenceSources.$inferSelect)[];
  documentRows: readonly (typeof fetchedEvidenceDocuments.$inferSelect)[];
}) {
  const pageAttempts = options.attempts.filter(
    (attempt) => attempt.stage === "page_fetch",
  );
  const pageAttemptsById = new Map<string, PersistedEvidenceAttempt>(
    pageAttempts.map((attempt) => [attempt.id, attempt]),
  );
  const pageAttemptCountByCandidate = new Map<string, number>();
  for (const attempt of pageAttempts) {
    const count =
      (pageAttemptCountByCandidate.get(attempt.candidateListingId) ?? 0) + 1;
    if (count > MAX_PAGE_SOURCES_PER_CANDIDATE) {
      failPersisted(
        "EvidenceResearchRun",
        options.researchRunId,
        new Error("Research snapshot contains too many fetched-page attempts"),
      );
    }
    pageAttemptCountByCandidate.set(attempt.candidateListingId, count);
  }

  const touchingSourceRows = options.sourceRows.filter(
    (row) =>
      row.sourceKind === "fetched_page" &&
      (row.researchRunId === options.researchRunId ||
        (row.acquisitionAttemptId !== null &&
          pageAttemptsById.has(row.acquisitionAttemptId))),
  );
  const touchingSourceIds = new Set(touchingSourceRows.map(({ id }) => id));
  const touchingDocumentRows = options.documentRows.filter(
    (row) =>
      row.researchRunId === options.researchRunId ||
      pageAttemptsById.has(row.attemptId) ||
      touchingSourceIds.has(row.evidenceSourceId),
  );
  const sourceRowsById = new Map(
    options.sourceRows.map((row) => [row.id, row]),
  );

  for (const sourceRow of touchingSourceRows) {
    const attempt =
      sourceRow.acquisitionAttemptId === null
        ? undefined
        : pageAttemptsById.get(sourceRow.acquisitionAttemptId);
    if (
      attempt === undefined ||
      sourceRow.researchRunId !== options.researchRunId ||
      sourceRow.candidateRunId !== options.runRow.searchRunId ||
      sourceRow.candidateRunId !== attempt.candidateRunId ||
      sourceRow.candidateListingId !== attempt.candidateListingId
    ) {
      failPersisted(
        "EvidenceSource",
        sourceRow.id,
        new Error("Fetched source crosses its exact page-attempt scope"),
      );
    }
  }

  for (const documentRow of touchingDocumentRows) {
    const attempt = pageAttemptsById.get(documentRow.attemptId);
    const sourceRow = sourceRowsById.get(documentRow.evidenceSourceId);
    if (
      attempt === undefined ||
      sourceRow === undefined ||
      sourceRow.sourceKind !== "fetched_page" ||
      sourceRow.acquisitionAttemptId !== attempt.id ||
      documentRow.researchRunId !== options.researchRunId ||
      documentRow.candidateRunId !== options.runRow.searchRunId ||
      documentRow.candidateRunId !== attempt.candidateRunId ||
      documentRow.candidateListingId !== attempt.candidateListingId
    ) {
      failPersisted(
        "FetchedEvidenceDocument",
        documentRow.id,
        new Error("Fetched document crosses its exact source-attempt scope"),
      );
    }
  }

  for (const attempt of pageAttempts) {
    const context = await loadOwnedPageAttemptContext({
      tx: options.tx,
      taskId: options.taskId,
      researchRunId: options.researchRunId,
      run: options.runRow,
      attempt,
    });
    const sourceChildren = touchingSourceRows.filter(
      ({ acquisitionAttemptId }) => acquisitionAttemptId === attempt.id,
    );
    const documentChildren = touchingDocumentRows.filter(
      ({ attemptId }) => attemptId === attempt.id,
    );
    const expectedChildCount = attempt.status === "succeeded" ? 1 : 0;
    if (
      sourceChildren.length !== expectedChildCount ||
      documentChildren.length !== expectedChildCount
    ) {
      failPersisted(
        "EvidenceAcquisitionAttempt",
        attempt.id,
        new Error(
          "Page attempt does not have its exact terminal source-document aggregate",
        ),
      );
    }
    if (attempt.status !== "succeeded") continue;
    const sourceRow = sourceChildren[0]!;
    const documentRow = documentChildren[0]!;
    if (
      attempt.receivedResultCount !== 1 ||
      attempt.failureCode !== null ||
      documentRow.evidenceSourceId !== sourceRow.id
    ) {
      failPersisted(
        "EvidenceAcquisitionAttempt",
        attempt.id,
        new Error("Page attempt does not contain one coherent success"),
      );
    }
    await validateStoredFetchedDocument({
      tx: options.tx,
      row: documentRow,
      taskId: options.taskId,
      researchRunId: options.researchRunId,
      attempt,
      context,
    });
  }
}

async function finalizeResearchIfComplete(options: {
  tx: ShoppingTransaction;
  taskId: z.infer<typeof shoppingTaskIdSchema>;
  researchRunId: z.infer<typeof evidenceResearchRunIdSchema>;
  leaseToken: string;
  finishedAt: Date;
}) {
  const attempts = await options.tx
    .select({ status: evidenceAcquisitionAttempts.status })
    .from(evidenceAcquisitionAttempts)
    .where(
      and(
        eq(evidenceAcquisitionAttempts.taskId, options.taskId),
        eq(evidenceAcquisitionAttempts.researchRunId, options.researchRunId),
      ),
    );
  if (attempts.some(({ status }) => status === "planned")) return false;
  const succeeded = attempts.filter(
    ({ status }) => status === "succeeded",
  ).length;
  const status =
    succeeded === attempts.length
      ? "succeeded"
      : succeeded === 0
        ? "failed"
        : "partial";
  await options.tx
    .update(evidenceResearchRuns)
    .set({
      status,
      finishedAt: options.finishedAt,
      leaseToken: null,
      leaseExpiresAt: null,
    })
    .where(
      and(
        eq(evidenceResearchRuns.taskId, options.taskId),
        eq(evidenceResearchRuns.id, options.researchRunId),
        eq(evidenceResearchRuns.leaseToken, options.leaseToken),
      ),
    );
  return true;
}

export async function recordEvidenceSearchSuccess(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  researchRunId: unknown;
  attemptId: unknown;
  leaseToken: unknown;
  response: EvidenceSearchResponse;
  startedAt: Date;
  finishedAt: Date;
}) {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const researchRunId = evidenceResearchRunIdSchema.parse(
    options.researchRunId,
  );
  const attemptId = evidenceAcquisitionAttemptIdSchema.parse(options.attemptId);
  const leaseToken = z.uuid().parse(options.leaseToken);
  const startedAt = z.date().parse(options.startedAt);
  const finishedAt = z.date().parse(options.finishedAt);
  return options.db.transaction(async (tx) => {
    const run = await loadLockedResearchRow({ tx, taskId, researchRunId });
    assertLease(run, leaseToken);
    const attempt = await loadLockedAttempt({
      tx,
      taskId,
      researchRunId,
      attemptId,
    });
    if (attempt.stage !== "organic_search") {
      throw new EvidenceAttemptConflictError(attempt.id);
    }
    if (attempt.provider !== "serper" && attempt.provider !== "fixture") {
      throw new EvidenceAttemptConflictError(attempt.id);
    }
    if (attempt.status !== "planned") return false;
    const searchRun = await loadPersistedSearchRunInTransaction({
      tx,
      taskId,
      runId: attempt.candidateRunId,
    });
    const listing = searchRun?.listings.find(
      ({ id }) => id === attempt.candidateListingId,
    );
    if (listing === undefined) {
      throw new EvidenceResearchAuthorityError(
        "Evidence candidate is unavailable",
      );
    }
    for (const result of options.response.results.filter((candidate) =>
      isCandidateEvidenceRelevant({
        candidateTitle: listing.title,
        merchant: listing.merchant,
        result: candidate,
      }),
    )) {
      await insertSourceIdempotently({
        tx,
        value: {
          id: evidenceSourceIdSchema.parse(randomUUID()),
          researchRunId,
          taskId,
          candidateRunId: attempt.candidateRunId,
          candidateListingId: attempt.candidateListingId,
          acquisitionAttemptId: attempt.id,
          sourceRole: result.sourceRole,
          sourceKind: "organic_result",
          sourceUrl: result.url,
          sourceTitle: result.title,
          excerpt: result.snippet,
          provider: attempt.provider,
          providerResultId: result.providerResultId,
          observedAt: finishedAt,
          fingerprint: fingerprint({
            kind: "organic_result",
            researchRunId,
            acquisitionAttemptId: attempt.id,
            url: result.url,
            title: result.title,
            snippet: result.snippet,
            role: result.sourceRole,
          }),
        },
      });
    }
    await tx
      .update(evidenceAcquisitionAttempts)
      .set({
        status: "succeeded",
        providerRequestId: options.response.providerRequestId,
        receivedResultCount: options.response.receivedResultCount,
        startedAt,
        finishedAt,
      })
      .where(
        and(
          eq(evidenceAcquisitionAttempts.taskId, taskId),
          eq(evidenceAcquisitionAttempts.id, attempt.id),
        ),
      );
    await finalizeResearchIfComplete({
      tx,
      taskId,
      researchRunId,
      leaseToken,
      finishedAt,
    });
    return true;
  });
}

export async function recordEvidenceAttemptFailure(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  researchRunId: unknown;
  attemptIds: readonly unknown[];
  leaseToken: unknown;
  failureCode:
    | "provider_failed"
    | "invalid_provider_result"
    | "model_failed"
    | "invalid_model_output";
  startedAt: Date;
  finishedAt: Date;
}) {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const researchRunId = evidenceResearchRunIdSchema.parse(
    options.researchRunId,
  );
  const attemptIds = options.attemptIds.map((id) =>
    evidenceAcquisitionAttemptIdSchema.parse(id),
  );
  const leaseToken = z.uuid().parse(options.leaseToken);
  return options.db.transaction(async (tx) => {
    const run = await loadLockedResearchRow({ tx, taskId, researchRunId });
    assertLease(run, leaseToken);
    for (const attemptId of attemptIds) {
      const attempt = await loadLockedAttempt({
        tx,
        taskId,
        researchRunId,
        attemptId,
      });
      if (attempt.status !== "planned") continue;
      if (attempt.stage === "page_fetch") {
        throw new EvidenceAttemptConflictError(attempt.id);
      }
      const expectedFailure =
        attempt.stage === "organic_search"
          ? ["provider_failed", "invalid_provider_result"]
          : ["model_failed", "invalid_model_output"];
      if (!expectedFailure.includes(options.failureCode)) {
        throw new EvidenceAttemptConflictError(attempt.id);
      }
      await tx
        .update(evidenceAcquisitionAttempts)
        .set({
          status: "failed",
          failureCode: options.failureCode,
          startedAt: options.startedAt,
          finishedAt: options.finishedAt,
        })
        .where(
          and(
            eq(evidenceAcquisitionAttempts.taskId, taskId),
            eq(evidenceAcquisitionAttempts.id, attempt.id),
          ),
        );
    }
    await finalizeResearchIfComplete({
      tx,
      taskId,
      researchRunId,
      leaseToken,
      finishedAt: options.finishedAt,
    });
  });
}

function parseTerminalWindow(startedAt: Date, finishedAt: Date) {
  const parsedStartedAt = z.date().parse(startedAt);
  const parsedFinishedAt = z.date().parse(finishedAt);
  if (parsedFinishedAt.getTime() < parsedStartedAt.getTime()) {
    throw new EvidenceResearchAuthorityError(
      "Evidence completion cannot precede its start",
    );
  }
  return { startedAt: parsedStartedAt, finishedAt: parsedFinishedAt };
}

export async function recordEvidencePageFetchFailure(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  researchRunId: unknown;
  attemptId: unknown;
  leaseToken: unknown;
  failureCode: PageEvidenceFailureCode;
  startedAt: Date;
  finishedAt: Date;
}): Promise<boolean> {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const researchRunId = evidenceResearchRunIdSchema.parse(
    options.researchRunId,
  );
  const attemptId = evidenceAcquisitionAttemptIdSchema.parse(options.attemptId);
  const leaseToken = z.uuid().parse(options.leaseToken);
  const failureCode = pageEvidenceFailureCodeSchema.parse(options.failureCode);
  const { startedAt, finishedAt } = parseTerminalWindow(
    options.startedAt,
    options.finishedAt,
  );

  return options.db.transaction(async (tx) => {
    const run = await loadLockedResearchRow({ tx, taskId, researchRunId });
    assertLease(run, leaseToken);
    await assertCurrentResearchAuthority({ tx, taskId, run });
    const attempt = await loadLockedAttempt({
      tx,
      taskId,
      researchRunId,
      attemptId,
    });
    await loadOwnedPageAttemptContext({
      tx,
      taskId,
      researchRunId,
      run,
      attempt,
    });
    if (attempt.status === "failed") {
      if (
        attempt.failureCode === failureCode &&
        attempt.providerRequestId === null &&
        attempt.receivedResultCount === null &&
        exactDate(attempt.startedAt, startedAt) &&
        exactDate(attempt.finishedAt, finishedAt)
      ) {
        return false;
      }
      throw new EvidenceAttemptConflictError(attempt.id);
    }
    if (attempt.status !== "planned") {
      throw new EvidenceAttemptConflictError(attempt.id);
    }
    const [documents, fetchedSources] = await Promise.all([
      tx
        .select({ id: fetchedEvidenceDocuments.id })
        .from(fetchedEvidenceDocuments)
        .where(
          and(
            eq(fetchedEvidenceDocuments.taskId, taskId),
            eq(fetchedEvidenceDocuments.researchRunId, researchRunId),
            eq(fetchedEvidenceDocuments.attemptId, attempt.id),
          ),
        ),
      tx
        .select({ id: evidenceSources.id })
        .from(evidenceSources)
        .where(
          and(
            eq(evidenceSources.taskId, taskId),
            eq(evidenceSources.researchRunId, researchRunId),
            eq(evidenceSources.acquisitionAttemptId, attempt.id),
            eq(evidenceSources.sourceKind, "fetched_page"),
          ),
        ),
    ]);
    if (documents.length !== 0 || fetchedSources.length !== 0) {
      throw new EvidenceAttemptConflictError(attempt.id);
    }
    const [updated] = await tx
      .update(evidenceAcquisitionAttempts)
      .set({
        status: "failed",
        failureCode,
        startedAt,
        finishedAt,
      })
      .where(
        and(
          eq(evidenceAcquisitionAttempts.taskId, taskId),
          eq(evidenceAcquisitionAttempts.researchRunId, researchRunId),
          eq(evidenceAcquisitionAttempts.id, attempt.id),
          eq(evidenceAcquisitionAttempts.status, "planned"),
        ),
      )
      .returning({ id: evidenceAcquisitionAttempts.id });
    if (updated === undefined) {
      throw new EvidenceAttemptConflictError(attempt.id);
    }
    await finalizeResearchIfComplete({
      tx,
      taskId,
      researchRunId,
      leaseToken,
      finishedAt,
    });
    return true;
  });
}

export async function recordFetchedPageSuccess(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  researchRunId: unknown;
  attemptId: unknown;
  leaseToken: unknown;
  fetch: FetchedPageMetadata;
  document: ExtractedProductPageDocumentV1;
  admission: Extract<PageEvidenceAdmissionV1, { decision: "admit" }>;
  startedAt: Date;
  finishedAt: Date;
}): Promise<PersistedFetchedEvidenceDocument> {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const researchRunId = evidenceResearchRunIdSchema.parse(
    options.researchRunId,
  );
  const attemptId = evidenceAcquisitionAttemptIdSchema.parse(options.attemptId);
  const leaseToken = z.uuid().parse(options.leaseToken);
  const fetch = fetchedPageMetadataSchema.parse(options.fetch);
  const document = extractedProductPageDocumentV1Schema.parse(options.document);
  const admission = admittedPageEvidenceSchema.parse(options.admission);
  const { startedAt, finishedAt } = parseTerminalWindow(
    options.startedAt,
    options.finishedAt,
  );
  const documentHash = computeExtractedPageDocumentHash(document);

  return options.db.transaction(async (tx) => {
    const run = await loadLockedResearchRow({ tx, taskId, researchRunId });
    assertLease(run, leaseToken);
    await assertCurrentResearchAuthority({ tx, taskId, run });
    const attempt = await loadLockedAttempt({
      tx,
      taskId,
      researchRunId,
      attemptId,
    });
    const context = await loadOwnedPageAttemptContext({
      tx,
      taskId,
      researchRunId,
      run,
      attempt,
    });
    const recomputedAdmission = admitFetchedPageEvidence({
      candidateTitle: context.listing.title,
      merchant: context.listing.merchant,
      discovered: {
        sourceRole: context.discoveredSource.sourceRole,
        url: context.discoveredSource.sourceUrl,
        title: context.discoveredSource.sourceTitle,
      },
      page: pageIdentityFromDocument({ fetch, document }),
    });
    if (
      fetch.requestedUrl !== context.target.requestedUrl ||
      document.sourceUrl !== fetch.finalUrl ||
      recomputedAdmission.decision !== "admit" ||
      !exactJson(recomputedAdmission, admission)
    ) {
      throw new EvidenceAttemptConflictError(attempt.id);
    }

    const existingRows = await tx
      .select()
      .from(fetchedEvidenceDocuments)
      .where(
        and(
          eq(fetchedEvidenceDocuments.taskId, taskId),
          eq(fetchedEvidenceDocuments.researchRunId, researchRunId),
          eq(fetchedEvidenceDocuments.attemptId, attempt.id),
        ),
      );
    if (attempt.status === "succeeded") {
      const existing = existingRows[0];
      if (
        existingRows.length !== 1 ||
        existing === undefined ||
        attempt.providerRequestId !== null ||
        attempt.receivedResultCount !== 1 ||
        !exactDate(attempt.startedAt, startedAt) ||
        !exactDate(attempt.finishedAt, finishedAt)
      ) {
        throw new EvidenceAttemptConflictError(attempt.id);
      }
      const stored = await validateStoredFetchedDocument({
        tx,
        row: existing,
        taskId,
        researchRunId,
        attempt,
        context,
      });
      if (
        stored.requestedUrl !== fetch.requestedUrl ||
        stored.finalUrl !== fetch.finalUrl ||
        stored.contentType !== fetch.contentType ||
        stored.encodedBytes !== fetch.encodedBytes ||
        stored.decodedBytes !== fetch.decodedBytes ||
        stored.responseHash !== fetch.responseHash ||
        stored.fetchedAt.getTime() !== fetch.fetchedAt.getTime() ||
        stored.documentHash !== documentHash ||
        !exactJson(stored.document, document) ||
        !exactJson(stored.admission, admission)
      ) {
        throw new EvidenceAttemptConflictError(attempt.id);
      }
      return stored;
    }
    if (attempt.status !== "planned" || existingRows.length !== 0) {
      throw new EvidenceAttemptConflictError(attempt.id);
    }
    const existingFetchedSources = await tx
      .select({ id: evidenceSources.id })
      .from(evidenceSources)
      .where(
        and(
          eq(evidenceSources.taskId, taskId),
          eq(evidenceSources.researchRunId, researchRunId),
          eq(evidenceSources.acquisitionAttemptId, attempt.id),
          eq(evidenceSources.sourceKind, "fetched_page"),
        ),
      );
    if (existingFetchedSources.length !== 0) {
      throw new EvidenceAttemptConflictError(attempt.id);
    }

    const proposedSourceId = evidenceSourceIdSchema.parse(randomUUID());
    const proposedSource = expectedFetchedSource({
      id: proposedSourceId,
      taskId,
      researchRunId,
      attempt,
      discoveredSource: context.discoveredSource,
      targetCriteria: context.targetCriteria,
      fetch,
      document,
      admission,
    });
    const insertedSource = await insertSourceIdempotently({
      tx,
      value: {
        id: proposedSource.id,
        researchRunId: proposedSource.researchRunId,
        taskId: proposedSource.taskId,
        candidateRunId: proposedSource.candidateRunId,
        candidateListingId: proposedSource.candidateListingId,
        acquisitionAttemptId: proposedSource.acquisitionAttemptId,
        sourceRole: proposedSource.sourceRole,
        sourceKind: proposedSource.sourceKind,
        sourceUrl: proposedSource.sourceUrl,
        sourceTitle: proposedSource.sourceTitle,
        excerpt: proposedSource.excerpt,
        provider: proposedSource.provider,
        providerResultId: proposedSource.providerResultId,
        observedAt: proposedSource.observedAt,
        fingerprint: proposedSource.fingerprint,
      },
    });
    if (insertedSource.researchRunId !== researchRunId) {
      throw new EvidenceAttemptConflictError(attempt.id);
    }
    const evidenceSourceId = insertedSource.id;
    const [insertedSourceRow] = await tx
      .select()
      .from(evidenceSources)
      .where(
        and(
          eq(evidenceSources.taskId, taskId),
          eq(evidenceSources.id, evidenceSourceId),
        ),
      )
      .limit(1);
    if (insertedSourceRow === undefined) {
      throw new Error("Inserted fetched source was not visible");
    }
    const actualSource = parsePersisted({
      recordType: "EvidenceSource",
      recordId: insertedSourceRow.id,
      parse: () => mapEvidenceSourceRow(insertedSourceRow),
    });
    const exactExpectedSource = expectedFetchedSource({
      id: evidenceSourceId,
      taskId,
      researchRunId,
      attempt,
      discoveredSource: context.discoveredSource,
      targetCriteria: context.targetCriteria,
      fetch,
      document,
      admission,
    });
    if (!exactFetchedSource(actualSource, exactExpectedSource)) {
      throw new EvidenceAttemptConflictError(attempt.id);
    }

    const documentId = z.uuid().parse(randomUUID());
    const documentValue = {
      id: documentId,
      taskId,
      researchRunId,
      candidateRunId: attempt.candidateRunId,
      candidateListingId: attempt.candidateListingId,
      attemptId: attempt.id,
      discoveredSourceId: context.discoveredSource.id,
      evidenceSourceId,
      requestedUrl: fetch.requestedUrl,
      finalUrl: fetch.finalUrl,
      canonicalUrl: document.canonicalUrlCandidate,
      contentType: fetch.contentType,
      encodedBytes: fetch.encodedBytes,
      decodedBytes: fetch.decodedBytes,
      responseHash: fetch.responseHash,
      documentHash,
      extractionVersion: document.extractionVersion,
      document,
      admission,
      fetchedAt: fetch.fetchedAt,
    };
    await tx.insert(fetchedEvidenceDocuments).values(documentValue);
    const [updated] = await tx
      .update(evidenceAcquisitionAttempts)
      .set({
        status: "succeeded",
        providerRequestId: null,
        receivedResultCount: 1,
        startedAt,
        finishedAt,
      })
      .where(
        and(
          eq(evidenceAcquisitionAttempts.taskId, taskId),
          eq(evidenceAcquisitionAttempts.researchRunId, researchRunId),
          eq(evidenceAcquisitionAttempts.id, attempt.id),
          eq(evidenceAcquisitionAttempts.status, "planned"),
        ),
      )
      .returning({ id: evidenceAcquisitionAttempts.id });
    if (updated === undefined) {
      throw new EvidenceAttemptConflictError(attempt.id);
    }
    await finalizeResearchIfComplete({
      tx,
      taskId,
      researchRunId,
      leaseToken,
      finishedAt,
    });
    return persistedFetchedEvidenceDocumentSchema.parse({
      ...documentValue,
      attemptStage: "page_fetch",
      evidenceSourceKind: "fetched_page",
    });
  });
}

export async function loadFetchedEvidenceDocuments(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  researchRunId: unknown;
  candidateListingId: unknown;
  evidenceSourceIdsInOrder?: readonly unknown[];
  attemptIdsInOrder?: readonly unknown[];
}): Promise<readonly PersistedFetchedEvidenceDocument[]> {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const researchRunId = evidenceResearchRunIdSchema.parse(
    options.researchRunId,
  );
  const candidateListingId = candidateListingIdSchema.parse(
    options.candidateListingId,
  );
  if (
    (options.evidenceSourceIdsInOrder === undefined) ===
    (options.attemptIdsInOrder === undefined)
  ) {
    throw new EvidenceResearchAuthorityError(
      "Select fetched documents by exactly one owned identifier kind",
    );
  }
  const evidenceSourceIds = options.evidenceSourceIdsInOrder?.map((id) =>
    evidenceSourceIdSchema.parse(id),
  );
  const attemptIds = options.attemptIdsInOrder?.map((id) =>
    evidenceAcquisitionAttemptIdSchema.parse(id),
  );
  const orderedIds: readonly string[] = evidenceSourceIds ?? attemptIds ?? [];
  if (
    orderedIds.length > MAX_PAGE_SOURCES_PER_CANDIDATE ||
    new Set(orderedIds).size !== orderedIds.length
  ) {
    throw new EvidenceResearchAuthorityError(
      "Fetched document selection must contain at most two unique IDs",
    );
  }
  if (orderedIds.length === 0) return [];

  return options.db.transaction(
    async (tx) => {
      const [run] = await tx
        .select()
        .from(evidenceResearchRuns)
        .where(
          and(
            eq(evidenceResearchRuns.taskId, taskId),
            eq(evidenceResearchRuns.id, researchRunId),
          ),
        )
        .limit(1);
      if (run === undefined) {
        throw new EvidenceResearchAuthorityError(
          "Evidence research was not found",
        );
      }
      const rows = await tx
        .select()
        .from(fetchedEvidenceDocuments)
        .where(
          and(
            eq(fetchedEvidenceDocuments.taskId, taskId),
            eq(fetchedEvidenceDocuments.researchRunId, researchRunId),
            eq(fetchedEvidenceDocuments.candidateRunId, run.searchRunId),
            eq(fetchedEvidenceDocuments.candidateListingId, candidateListingId),
            evidenceSourceIds !== undefined
              ? inArray(
                  fetchedEvidenceDocuments.evidenceSourceId,
                  evidenceSourceIds,
                )
              : inArray(fetchedEvidenceDocuments.attemptId, attemptIds!),
          ),
        );
      if (rows.length !== orderedIds.length) {
        throw new EvidenceResearchAuthorityError(
          "A requested fetched document is not in the exact candidate scope",
        );
      }
      const rowById = new Map(
        rows.map((row) => [
          evidenceSourceIds !== undefined
            ? row.evidenceSourceId
            : row.attemptId,
          row,
        ]),
      );
      const result: PersistedFetchedEvidenceDocument[] = [];
      for (const selectedId of orderedIds) {
        const row = rowById.get(selectedId);
        if (row === undefined) {
          throw new EvidenceResearchAuthorityError(
            "Fetched document ordering could not be reproduced",
          );
        }
        const [attemptRow] = await tx
          .select()
          .from(evidenceAcquisitionAttempts)
          .where(
            and(
              eq(evidenceAcquisitionAttempts.taskId, taskId),
              eq(evidenceAcquisitionAttempts.researchRunId, researchRunId),
              eq(evidenceAcquisitionAttempts.id, row.attemptId),
            ),
          )
          .limit(1);
        if (attemptRow === undefined) {
          failPersisted(
            "FetchedEvidenceDocument",
            row.id,
            new Error("Fetched-page attempt is unavailable"),
          );
        }
        const criterionRows = await tx
          .select({ criterionId: evidenceAttemptTargetCriteria.criterionId })
          .from(evidenceAttemptTargetCriteria)
          .where(
            and(
              eq(evidenceAttemptTargetCriteria.taskId, taskId),
              eq(evidenceAttemptTargetCriteria.attemptId, row.attemptId),
            ),
          );
        const attempt = parsePersisted({
          recordType: "EvidenceAcquisitionAttempt",
          recordId: attemptRow.id,
          parse: () =>
            mapAttemptRow(
              attemptRow,
              criterionRows.map(({ criterionId }) => criterionId),
            ),
        });
        if (
          attempt.status !== "succeeded" ||
          attempt.receivedResultCount !== 1 ||
          attempt.failureCode !== null ||
          attempt.candidateListingId !== candidateListingId
        ) {
          failPersisted(
            "EvidenceAcquisitionAttempt",
            attempt.id,
            new Error("Fetched document does not have one terminal success"),
          );
        }
        const context = await loadOwnedPageAttemptContext({
          tx,
          taskId,
          researchRunId,
          run,
          attempt,
        });
        result.push(
          await validateStoredFetchedDocument({
            tx,
            row,
            taskId,
            researchRunId,
            attempt,
            context,
          }),
        );
      }
      return result;
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

function observationSourcePairs(options: {
  sources: readonly EvidenceSourceV1[];
  observations: readonly ProductObservationV1[];
  candidateListingId: string;
}) {
  const sources = new Map(options.sources.map((source) => [source.id, source]));
  return options.observations
    .filter(
      (observation) =>
        observation.candidateListingId === options.candidateListingId,
    )
    .map((observation) => {
      const source = sources.get(observation.evidenceSourceId);
      if (source === undefined) {
        failPersisted(
          "ProductObservation",
          observation.id,
          new Error("Observation source is missing"),
        );
      }
      return { observation, source } satisfies ObservationWithSource;
    });
}

async function persistAssessments(options: {
  tx: ShoppingTransaction;
  researchRunId: z.infer<typeof evidenceResearchRunIdSchema>;
  listing: PersistedCandidateListing;
  taskRevision: bigint;
  targetItems: ReturnType<typeof projectShoppingBrief>["items"];
  sources: readonly EvidenceSourceV1[];
  observations: readonly ProductObservationV1[];
  proposals: ProductUnderstandingProviderWireV1["assessments"];
  proposalObservationRefs: ReadonlyMap<string, ProductObservationV1>;
  metadata: ModelCallMetadata | null;
  assessedAt: Date;
  allowSupersede: boolean;
}) {
  const pairs = observationSourcePairs({
    sources: options.sources,
    observations: options.observations,
    candidateListingId: options.listing.id,
  });
  for (const [criterionOrdinal, item] of options.targetItems.entries()) {
    const proposed = options.proposals.find(
      (entry) => entry.criterionOrdinal === criterionOrdinal,
    );
    const proposedPairs =
      proposed === undefined
        ? []
        : proposed.observationRefs.map((ref) => {
            const observation = options.proposalObservationRefs.get(ref);
            if (observation === undefined) {
              throw new EvidenceAttemptConflictError(ref);
            }
            const pair = pairs.find(
              ({ observation: candidate }) => candidate.id === observation.id,
            );
            if (pair === undefined)
              throw new EvidenceAttemptConflictError(observation.id);
            if (pair.observation.conceptId !== item.conceptId) {
              throw new EvidenceAttemptConflictError(observation.id);
            }
            return pair;
          });
    const guarded = guardCriterionAssessment({
      item,
      listing: options.listing,
      observations: pairs,
      proposal:
        proposed === undefined
          ? null
          : {
              status: proposed.status,
              relation: proposed.relation,
              explanation: proposed.explanation,
              observations: proposedPairs,
            },
    });
    const id = criterionAssessmentIdSchema.parse(randomUUID());
    const [existing] = await options.tx
      .select({
        id: criterionAssessments.id,
        generation: criterionAssessments.generation,
        researchRunId: criterionAssessments.researchRunId,
      })
      .from(criterionAssessments)
      .where(
        and(
          eq(criterionAssessments.taskId, options.listing.taskId),
          eq(criterionAssessments.taskRevision, options.taskRevision),
          eq(criterionAssessments.candidateRunId, options.listing.runId),
          eq(criterionAssessments.candidateListingId, options.listing.id),
          eq(criterionAssessments.criterionId, item.criterionId),
          isNull(criterionAssessments.supersededAt),
        ),
      )
      .for("update")
      .limit(1);
    if (existing?.researchRunId === options.researchRunId) continue;
    if (existing !== undefined && !options.allowSupersede) continue;
    if (existing !== undefined) {
      await options.tx
        .update(criterionAssessments)
        .set({ supersededAt: options.assessedAt })
        .where(
          and(
            eq(criterionAssessments.taskId, options.listing.taskId),
            eq(criterionAssessments.id, existing.id),
            isNull(criterionAssessments.supersededAt),
          ),
        );
    }
    await options.tx.insert(criterionAssessments).values({
      id,
      taskId: options.listing.taskId,
      researchRunId: options.researchRunId,
      taskRevision: options.taskRevision,
      candidateRunId: options.listing.runId,
      candidateListingId: options.listing.id,
      criterionId: criterionIdSchema.parse(item.criterionId),
      generation: (existing?.generation ?? 0) + 1,
      supersedesAssessmentId: existing?.id ?? null,
      status: guarded.status,
      relation: guarded.relation,
      explanation: guarded.explanation,
      method: guarded.method,
      model:
        guarded.method === "deterministic"
          ? null
          : (options.metadata?.model ?? "guarded"),
      promptVersion:
        guarded.method === "deterministic"
          ? null
          : (options.metadata?.promptVersion ?? "guarded-v1"),
    });
    if (guarded.observationIds.length > 0) {
      await options.tx.insert(criterionAssessmentObservations).values(
        guarded.observationIds.map((observationId) => ({
          taskId: options.listing.taskId,
          candidateRunId: options.listing.runId,
          candidateListingId: options.listing.id,
          assessmentId: id,
          observationId,
        })),
      );
    }
  }
}

export async function recordCandidateUnderstanding(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  researchRunId: unknown;
  candidateListingId: unknown;
  extractionAttemptId: unknown;
  assessmentAttemptId: unknown;
  leaseToken: unknown;
  sourceIdsInOrder: readonly unknown[];
  result: ProductUnderstandingProviderWireV1 | null;
  metadata: ModelCallMetadata | null;
  failureCode?: "model_failed" | "invalid_model_output";
  startedAt: Date;
  finishedAt: Date;
}) {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const researchRunId = evidenceResearchRunIdSchema.parse(
    options.researchRunId,
  );
  const candidateListingId = candidateListingIdSchema.parse(
    options.candidateListingId,
  );
  const extractionAttemptId = evidenceAcquisitionAttemptIdSchema.parse(
    options.extractionAttemptId,
  );
  const assessmentAttemptId = evidenceAcquisitionAttemptIdSchema.parse(
    options.assessmentAttemptId,
  );
  const sourceIdsInOrder = options.sourceIdsInOrder.map((id) =>
    evidenceSourceIdSchema.parse(id),
  );
  const leaseToken = z.uuid().parse(options.leaseToken);
  const result =
    options.result === null
      ? null
      : productUnderstandingProviderWireV1Schema.parse(options.result);
  return options.db.transaction(async (tx) => {
    const runRow = await loadLockedResearchRow({ tx, taskId, researchRunId });
    assertLease(runRow, leaseToken);
    const strictFirstPassBatch =
      runRow.phase === "first_pass" &&
      runRow.policyVersion ===
        `${EVIDENCE_POLICY_VERSION}:${FIRST_PASS_UNDERSTANDING_POLICY_IDENTITY}`;
    const [task] = await tx
      .select({ currentRevision: shoppingTasks.currentRevision })
      .from(shoppingTasks)
      .where(eq(shoppingTasks.id, taskId))
      .for("share")
      .limit(1);
    if (task === undefined)
      throw new EvidenceResearchAuthorityError("Shopping task was not found");
    if (task.currentRevision !== runRow.taskRevision) {
      throw new StaleTaskRevisionError(
        taskId,
        runRow.taskRevision,
        task.currentRevision,
      );
    }
    const [extractionAttempt, assessmentAttempt] = await Promise.all([
      loadLockedAttempt({
        tx,
        taskId,
        researchRunId,
        attemptId: extractionAttemptId,
      }),
      loadLockedAttempt({
        tx,
        taskId,
        researchRunId,
        attemptId: assessmentAttemptId,
      }),
    ]);
    if (
      extractionAttempt.candidateListingId !== candidateListingId ||
      assessmentAttempt.candidateListingId !== candidateListingId ||
      extractionAttempt.stage !== "observation_extraction" ||
      assessmentAttempt.stage !== "criterion_assessment"
    ) {
      throw new EvidenceAttemptConflictError(extractionAttempt.id);
    }
    if (
      !strictFirstPassBatch &&
      (extractionAttempt.status !== "planned" ||
        assessmentAttempt.status !== "planned")
    ) {
      return false;
    }
    const searchRun = await loadPersistedSearchRunInTransaction({
      tx,
      taskId,
      runId: runRow.searchRunId,
    });
    const listing = searchRun?.listings.find(
      ({ id }) => id === candidateListingId,
    );
    if (listing === undefined) {
      throw new EvidenceResearchAuthorityError(
        "Research candidate is not in its persisted search run",
      );
    }
    const [lockedListing] = await tx
      .select({ id: candidateListings.id })
      .from(candidateListings)
      .where(
        and(
          eq(candidateListings.taskId, taskId),
          eq(candidateListings.runId, listing.runId),
          eq(candidateListings.id, listing.id),
        ),
      )
      .for("update")
      .limit(1);
    if (lockedListing === undefined) {
      throw new EvidenceResearchAuthorityError(
        "Research candidate disappeared before assessment",
      );
    }
    const state = await loadCurrentShoppingState(tx, taskId);
    const brief = projectShoppingBrief(state);
    if (strictFirstPassBatch) {
      const snapshot = await loadResearchSnapshotInTransaction({
        tx,
        taskId,
        researchRunId,
      });
      if (snapshot === null) {
        throw new EvidenceResearchAuthorityError(
          "Research batch reservation is unavailable",
        );
      }
      const candidateAttempts = snapshot.attempts.filter(
        (attempt) => attempt.candidateListingId === candidateListingId,
      );
      const pairs = pairFirstPassUnderstandingAttempts(candidateAttempts);
      assertFirstPassUnderstandingPairsMatchCriteria(
        pairs,
        brief.items.map(({ criterionId }) => criterionId),
      );
      if (
        !pairs.some(
          ({ extraction, assessment }) =>
            extraction.id === extractionAttempt.id &&
            assessment.id === assessmentAttempt.id,
        )
      ) {
        throw new EvidenceAttemptConflictError(extractionAttempt.id);
      }
    }
    if (
      extractionAttempt.status !== "planned" ||
      assessmentAttempt.status !== "planned"
    ) {
      return false;
    }
    const extractionTargetIds = new Set(extractionAttempt.targetCriterionIds);
    const assessmentTargetIds = new Set(assessmentAttempt.targetCriterionIds);
    if (
      extractionTargetIds.size === 0 ||
      extractionTargetIds.size !== assessmentTargetIds.size ||
      [...extractionTargetIds].some(
        (criterionId) => !assessmentTargetIds.has(criterionId),
      )
    ) {
      throw new EvidenceAttemptConflictError(extractionAttempt.id);
    }
    if (runRow.phase === "deepening") {
      const organicAttemptRows = await tx
        .select({ id: evidenceAcquisitionAttempts.id })
        .from(evidenceAcquisitionAttempts)
        .where(
          and(
            eq(evidenceAcquisitionAttempts.taskId, taskId),
            eq(evidenceAcquisitionAttempts.researchRunId, researchRunId),
            eq(
              evidenceAcquisitionAttempts.candidateListingId,
              candidateListingId,
            ),
            eq(evidenceAcquisitionAttempts.stage, "organic_search"),
          ),
        );
      if (organicAttemptRows.length !== 1) {
        throw new EvidenceAttemptConflictError(extractionAttempt.id);
      }
      const organicAttempt = await loadLockedAttempt({
        tx,
        taskId,
        researchRunId,
        attemptId: evidenceAcquisitionAttemptIdSchema.parse(
          organicAttemptRows[0]?.id,
        ),
      });
      if (
        !hasExactNonEmptyCriterionTargets(
          organicAttempt.targetCriterionIds,
          extractionAttempt.targetCriterionIds,
          assessmentAttempt.targetCriterionIds,
        )
      ) {
        throw new EvidenceAttemptConflictError(organicAttempt.id);
      }
    }
    const targetItems = brief.items.filter(({ criterionId }) =>
      extractionTargetIds.has(criterionId),
    );
    if (targetItems.length !== extractionTargetIds.size) {
      throw new EvidenceResearchAuthorityError(
        "Research attempt targets are not current for this task revision",
      );
    }
    if (result !== null) {
      const outOfScopeObservation = result.observations.find(
        ({ criterionOrdinal }) =>
          (runRow.phase === "deepening" && criterionOrdinal === null) ||
          (criterionOrdinal !== null &&
            targetItems[criterionOrdinal] === undefined),
      );
      const outOfScopeAssessment = result.assessments.find(
        ({ criterionOrdinal }) => targetItems[criterionOrdinal] === undefined,
      );
      const assessedOrdinals = new Set(
        result.assessments.map(({ criterionOrdinal }) => criterionOrdinal),
      );
      const missingAssessment = targetItems.some(
        (_, criterionOrdinal) => !assessedOrdinals.has(criterionOrdinal),
      );
      if (
        outOfScopeObservation !== undefined ||
        outOfScopeAssessment !== undefined ||
        result.assessments.length !== targetItems.length ||
        missingAssessment ||
        (strictFirstPassBatch &&
          result.observations.some(
            ({ criterionOrdinal }) => criterionOrdinal === null,
          ))
      ) {
        throw new EvidenceAttemptConflictError(assessmentAttempt.id);
      }
    }
    const sourceRows =
      sourceIdsInOrder.length === 0
        ? []
        : await tx
            .select()
            .from(evidenceSources)
            .where(
              and(
                eq(evidenceSources.taskId, taskId),
                eq(evidenceSources.candidateRunId, listing.runId),
                eq(evidenceSources.candidateListingId, listing.id),
                inArray(evidenceSources.id, sourceIdsInOrder),
              ),
            );
    const bySourceId = new Map(sourceRows.map((row) => [row.id, row]));
    const sources = sourceIdsInOrder.map((sourceId) => {
      const row = bySourceId.get(sourceId);
      if (row === undefined)
        throw new EvidenceResearchAuthorityError(
          "Model source is not task-local",
        );
      return mapEvidenceSourceRow(row);
    });
    const localObservationRefs = new Map<string, ProductObservationV1>();
    if (result !== null) {
      for (const proposed of result.observations) {
        const source = sources[proposed.sourceOrdinal];
        if (source === undefined) {
          throw new EvidenceAttemptConflictError(proposed.localRef);
        }
        if (
          (proposed.derivation === "model_visual") !==
          (source.sourceKind === "listing_image")
        ) {
          throw new EvidenceAttemptConflictError(proposed.localRef);
        }
        const item =
          proposed.criterionOrdinal === null
            ? null
            : targetItems[proposed.criterionOrdinal];
        if (proposed.criterionOrdinal !== null && item === undefined) {
          throw new EvidenceAttemptConflictError(proposed.localRef);
        }
        const observationFingerprint = fingerprint({
          sourceId: source.id,
          conceptId: item?.conceptId ?? null,
          support: proposed.support,
          propertyLabel: proposed.propertyLabel,
          claim: proposed.claim,
          value: proposed.value,
          derivation: proposed.derivation,
        });
        const observationId = await insertObservationIdempotently({
          tx,
          value: {
            id: productObservationIdSchema.parse(randomUUID()),
            researchRunId: source.researchRunId,
            taskId,
            candidateRunId: listing.runId,
            candidateListingId: listing.id,
            evidenceSourceId: source.id,
            conceptId: item?.conceptId ?? null,
            support: proposed.support,
            observationKind: proposed.observationKind,
            propertyLabel: proposed.propertyLabel,
            claim: proposed.claim,
            value: proposed.value,
            derivation: proposed.derivation,
            model: options.metadata?.model ?? "fixture",
            promptVersion: options.metadata?.promptVersion ?? "fixture-v1",
            observedAt: options.finishedAt,
            fingerprint: observationFingerprint,
          },
        });
        const [stored] = await tx
          .select()
          .from(productObservations)
          .where(
            and(
              eq(productObservations.taskId, taskId),
              eq(productObservations.id, observationId),
            ),
          )
          .limit(1);
        if (stored === undefined)
          throw new Error("Stored observation was not visible");
        localObservationRefs.set(proposed.localRef, mapObservationRow(stored));
      }
    }
    const allSourceRows = await tx
      .select()
      .from(evidenceSources)
      .where(
        and(
          eq(evidenceSources.taskId, taskId),
          eq(evidenceSources.candidateRunId, listing.runId),
          eq(evidenceSources.candidateListingId, listing.id),
        ),
      );
    const allObservationRows = await tx
      .select()
      .from(productObservations)
      .where(
        and(
          eq(productObservations.taskId, taskId),
          eq(productObservations.candidateRunId, listing.runId),
          eq(productObservations.candidateListingId, listing.id),
        ),
      );
    await persistAssessments({
      tx,
      researchRunId,
      listing,
      taskRevision: runRow.taskRevision,
      targetItems,
      sources: allSourceRows.map(mapEvidenceSourceRow),
      observations: allObservationRows.map(mapObservationRow),
      proposals: result?.assessments ?? [],
      proposalObservationRefs: localObservationRefs,
      metadata: options.metadata,
      assessedAt: options.finishedAt,
      allowSupersede: result !== null,
    });
    const succeeded = result !== null;
    const failureCode = options.failureCode ?? "model_failed";
    await tx
      .update(evidenceAcquisitionAttempts)
      .set({
        status: succeeded ? "succeeded" : "failed",
        providerRequestId: options.metadata?.providerRequestId ?? null,
        receivedResultCount: result?.observations.length ?? null,
        failureCode: succeeded ? null : failureCode,
        startedAt: options.startedAt,
        finishedAt: options.finishedAt,
      })
      .where(
        and(
          eq(evidenceAcquisitionAttempts.taskId, taskId),
          inArray(evidenceAcquisitionAttempts.id, [
            extractionAttempt.id,
            assessmentAttempt.id,
          ]),
        ),
      );
    await finalizeResearchIfComplete({
      tx,
      taskId,
      researchRunId,
      leaseToken,
      finishedAt: options.finishedAt,
    });
    return true;
  });
}
