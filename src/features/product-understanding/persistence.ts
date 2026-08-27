import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
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
import { loadCurrentShoppingState } from "@/features/shopping-state/persistence/state-loaders";
import type {
  ShoppingDatabase,
  ShoppingTransaction,
} from "@/infrastructure/database/clients";
import {
  criterionAssessmentObservations,
  criterionAssessments,
  evidenceAcquisitionAttempts,
  evidenceResearchRuns,
  evidenceSources,
  productObservations,
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
import type { ProductUnderstandingProviderWireV1 } from "./provider-wire";
import type { EvidenceSearchResponse } from "./evidence-search";
import {
  guardCriterionAssessment,
  type ObservationWithSource,
} from "./assessment-policy";
import {
  EVIDENCE_POLICY_VERSION,
  planEvidenceSearches,
  selectResearchCandidates,
} from "./selection";

const attemptStageSchema = z.enum([
  "organic_search",
  "observation_extraction",
  "criterion_assessment",
]);
const attemptPurposeSchema = z.enum([
  "specifications",
  "experience",
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

const persistedAttemptSchema = z.strictObject({
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
  provider: z.enum(["serper", "openai", "fixture"]),
  model: z.string().min(1).max(160).nullable(),
  promptVersion: z.string().min(1).max(120).nullable(),
  providerRequestId: z.string().min(1).max(240).nullable(),
  receivedResultCount: z.number().int().nonnegative().nullable(),
  failureCode: z
    .enum([
      "provider_failed",
      "invalid_provider_result",
      "model_failed",
      "invalid_model_output",
    ])
    .nullable(),
  startedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
});

export type PersistedEvidenceAttempt = z.infer<typeof persistedAttemptSchema>;

export type EvidenceResearchSnapshot = Readonly<{
  run: Readonly<{
    id: z.infer<typeof evidenceResearchRunIdSchema>;
    taskId: z.infer<typeof shoppingTaskIdSchema>;
    searchRunId: z.infer<typeof searchRunIdSchema>;
    taskRevision: z.infer<typeof taskRevisionSchema>;
    policyVersion: string;
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
): PersistedEvidenceAttempt {
  const { createdAt, ...value } = row;
  void createdAt;
  return persistedAttemptSchema.parse(value);
}

function mapEvidenceSourceRow(
  row: typeof evidenceSources.$inferSelect,
): EvidenceSourceV1 {
  const { createdAt, ...value } = row;
  void createdAt;
  return evidenceSourceV1Schema.parse({ schemaVersion: 1, ...value });
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

  const [attemptRows, sourceRows, observationRows, assessmentRows, linkRows] =
    await Promise.all([
      options.tx
        .select()
        .from(evidenceAcquisitionAttempts)
        .where(
          and(
            eq(evidenceAcquisitionAttempts.taskId, options.taskId),
            eq(
              evidenceAcquisitionAttempts.researchRunId,
              options.researchRunId,
            ),
          ),
        )
        .orderBy(asc(evidenceAcquisitionAttempts.createdAt)),
      options.tx
        .select()
        .from(evidenceSources)
        .where(eq(evidenceSources.taskId, options.taskId)),
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
      parse: () => mapAttemptRow(row),
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
  const [existing] = await options.tx
    .select({ id: evidenceSources.id })
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
  if (existing !== undefined) return evidenceSourceIdSchema.parse(existing.id);
  await options.tx.insert(evidenceSources).values(options.value);
  return options.value.id;
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
  brief: ReturnType<typeof projectShoppingBrief>;
}) {
  const listingFingerprint = fingerprint({
    kind: "listing_field",
    url: options.listing.url,
    title: options.listing.title,
    merchant: options.listing.merchant,
    price: options.listing.price,
    reviewEvidence: options.listing.reviewEvidence,
  });
  const listingSourceId = await insertSourceIdempotently({
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
  if (options.listing.price !== null) {
    await insertObservationIdempotently({
      tx: options.tx,
      value: {
        id: productObservationIdSchema.parse(randomUUID()),
        researchRunId: options.researchRunId,
        taskId: options.listing.taskId,
        candidateRunId: options.listing.runId,
        candidateListingId: options.listing.id,
        evidenceSourceId: listingSourceId,
        conceptId:
          options.brief.items.find(
            ({ semanticValue }) =>
              semanticValue.kind === "money" ||
              semanticValue.kind === "money_stretch",
          )?.conceptId ?? null,
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
  if (options.listing.reviewEvidence !== null) {
    const review = options.listing.reviewEvidence;
    const reviewSourceId = await insertSourceIdempotently({
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
        researchRunId: options.researchRunId,
        taskId: options.listing.taskId,
        candidateRunId: options.listing.runId,
        candidateListingId: options.listing.id,
        evidenceSourceId: reviewSourceId,
        conceptId:
          options.brief.items.find(({ conceptLabel, conceptDefinition }) =>
            /review|customer sentiment/i.test(
              `${conceptLabel} ${conceptDefinition}`,
            ),
          )?.conceptId ?? null,
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
  const wirelessItem = options.brief.items.find(({ conceptLabel }) =>
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
        researchRunId: options.researchRunId,
        taskId: options.listing.taskId,
        candidateRunId: options.listing.runId,
        candidateListingId: options.listing.id,
        evidenceSourceId: listingSourceId,
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
  now?: Date;
}): Promise<EvidenceResearchSnapshot> {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const searchRunId = searchRunIdSchema.parse(options.searchRunId);
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
    const [existing] = await tx
      .select({ id: evidenceResearchRuns.id })
      .from(evidenceResearchRuns)
      .where(
        and(
          eq(evidenceResearchRuns.taskId, taskId),
          eq(evidenceResearchRuns.searchRunId, searchRunId),
          eq(evidenceResearchRuns.taskRevision, brief.revision),
          eq(evidenceResearchRuns.policyVersion, EVIDENCE_POLICY_VERSION),
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
    const selected = selectResearchCandidates({ brief, run });
    if (selected.length === 0) {
      throw new EvidenceResearchAuthorityError(
        "No candidate survived direct hard-constraint triage",
      );
    }
    const researchRunId = evidenceResearchRunIdSchema.parse(randomUUID());
    const searches = selected.flatMap((candidate) =>
      planEvidenceSearches({ brief, candidate }).map((plan) => ({
        candidate,
        plan,
      })),
    );
    await tx.insert(evidenceResearchRuns).values({
      id: researchRunId,
      taskId,
      searchRunId,
      taskRevision: brief.revision,
      policyVersion: EVIDENCE_POLICY_VERSION,
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
      })),
      ...selected.flatMap(({ listing }) => [
        {
          id: evidenceAcquisitionAttemptIdSchema.parse(randomUUID()),
          taskId,
          researchRunId,
          candidateRunId: searchRunId,
          candidateListingId: listing.id,
          stage: "observation_extraction" as const,
          purpose: "combined" as const,
          planKey: "observation-extraction-v1",
          query: null,
          status: "planned" as const,
          provider: options.modelProvider,
          model: options.model,
          promptVersion: options.promptVersion,
        },
        {
          id: evidenceAcquisitionAttemptIdSchema.parse(randomUUID()),
          taskId,
          researchRunId,
          candidateRunId: searchRunId,
          candidateListingId: listing.id,
          stage: "criterion_assessment" as const,
          purpose: "current_brief" as const,
          planKey: `criterion-assessment-r${brief.revision}`,
          query: null,
          status: "planned" as const,
          provider: options.modelProvider,
          model: options.model,
          promptVersion: options.promptVersion,
        },
      ]),
    ];
    await tx.insert(evidenceAcquisitionAttempts).values(attempts);
    for (const { listing } of selected) {
      await insertDirectEvidence({ tx, researchRunId, listing, brief });
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
  return mapAttemptRow(row);
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
    for (const result of options.response.results) {
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
  brief: ReturnType<typeof projectShoppingBrief>;
  sources: readonly EvidenceSourceV1[];
  observations: readonly ProductObservationV1[];
  proposals: ProductUnderstandingProviderWireV1["assessments"];
  proposalObservationRefs: ReadonlyMap<string, ProductObservationV1>;
  metadata: ModelCallMetadata | null;
}) {
  const pairs = observationSourcePairs({
    sources: options.sources,
    observations: options.observations,
    candidateListingId: options.listing.id,
  });
  for (const [criterionOrdinal, item] of options.brief.items.entries()) {
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
      .select({ id: criterionAssessments.id })
      .from(criterionAssessments)
      .where(
        and(
          eq(criterionAssessments.taskId, options.listing.taskId),
          eq(criterionAssessments.taskRevision, options.taskRevision),
          eq(criterionAssessments.candidateRunId, options.listing.runId),
          eq(criterionAssessments.candidateListingId, options.listing.id),
          eq(criterionAssessments.criterionId, item.criterionId),
        ),
      )
      .limit(1);
    if (existing !== undefined) continue;
    await options.tx.insert(criterionAssessments).values({
      id,
      taskId: options.listing.taskId,
      researchRunId: options.researchRunId,
      taskRevision: options.taskRevision,
      candidateRunId: options.listing.runId,
      candidateListingId: options.listing.id,
      criterionId: criterionIdSchema.parse(item.criterionId),
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
  return options.db.transaction(async (tx) => {
    const runRow = await loadLockedResearchRow({ tx, taskId, researchRunId });
    assertLease(runRow, leaseToken);
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
      extractionAttempt.status !== "planned" ||
      assessmentAttempt.status !== "planned"
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
    const state = await loadCurrentShoppingState(tx, taskId);
    const brief = projectShoppingBrief(state);
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
    if (options.result !== null) {
      for (const proposed of options.result.observations) {
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
            : brief.items[proposed.criterionOrdinal];
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
      brief,
      sources: allSourceRows.map(mapEvidenceSourceRow),
      observations: allObservationRows.map(mapObservationRow),
      proposals: options.result?.assessments ?? [],
      proposalObservationRefs: localObservationRefs,
      metadata: options.metadata,
    });
    const result = options.result;
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
