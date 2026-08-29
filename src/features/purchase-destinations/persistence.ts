import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { PersistedDataCorruptionError } from "@/domain/shopping-state/errors";
import {
  candidateListingIdSchema,
  shoppingTaskIdSchema,
} from "@/domain/shopping-state/ids";
import {
  searchRunIdSchema,
  shoppingProviderSchema,
} from "@/features/retrieval-spike/contracts";
import type {
  ShoppingDatabase,
  ShoppingTransaction,
} from "@/infrastructure/database/clients";
import {
  candidateListings,
  contextActions,
  founderLiveSessions,
  merchantDestinationResolutions,
  rejectedCandidateListings,
  savedCandidateListings,
  searchRuns,
  shoppingTasks,
} from "@/infrastructure/database/schema";
import {
  merchantDestinationFailureCodeSchema,
  merchantDestinationLeaseTokenSchema,
  merchantDestinationRejectionCodeSchema,
  merchantDestinationResolutionIdSchema,
  merchantDestinationTopAuthoritySchema,
  type MerchantDestinationTopAuthority,
} from "./contracts";
import {
  buildExactOfferMerchantQuery,
  evaluateExactOfferMerchantDestination,
  isGoogleShoppingFallbackUrl,
} from "./exact-offer-policy";

export const MERCHANT_DESTINATION_POLICY_VERSION =
  "exact-offer-merchant-v1" as const;

const resolutionBaseSchema = {
  id: merchantDestinationResolutionIdSchema,
  taskId: shoppingTaskIdSchema,
  searchRunId: searchRunIdSchema,
  candidateListingId: candidateListingIdSchema,
  policyVersion: z.string().min(1).max(120),
  provider: shoppingProviderSchema,
  queryText: z.string().min(1).max(500),
  startedAt: z.date(),
  createdAt: z.date(),
};

const httpsUrlSchema = z
  .url()
  .max(4_000)
  .refine((value) => new URL(value).protocol === "https:");

export const persistedMerchantDestinationResolutionSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      ...resolutionBaseSchema,
      status: z.literal("running"),
      destinationUrl: z.null(),
      acceptedResultTitle: z.null(),
      observedResultUrl: z.null(),
      outcomeCode: z.null(),
      consideredResultCount: z.null(),
      leaseToken: merchantDestinationLeaseTokenSchema,
      leaseExpiresAt: z.date(),
      finishedAt: z.null(),
    }),
    z.strictObject({
      ...resolutionBaseSchema,
      status: z.literal("resolved"),
      destinationUrl: httpsUrlSchema,
      acceptedResultTitle: z.string().min(1).max(1_000),
      observedResultUrl: httpsUrlSchema.nullable(),
      outcomeCode: z.null(),
      consideredResultCount: z.number().int().positive(),
      leaseToken: z.null(),
      leaseExpiresAt: z.null(),
      finishedAt: z.date(),
    }),
    z.strictObject({
      ...resolutionBaseSchema,
      status: z.literal("rejected"),
      destinationUrl: z.null(),
      acceptedResultTitle: z.null(),
      observedResultUrl: z.null(),
      outcomeCode: merchantDestinationRejectionCodeSchema,
      consideredResultCount: z.number().int().nonnegative(),
      leaseToken: z.null(),
      leaseExpiresAt: z.null(),
      finishedAt: z.date(),
    }),
    z.strictObject({
      ...resolutionBaseSchema,
      status: z.literal("failed"),
      destinationUrl: z.null(),
      acceptedResultTitle: z.null(),
      observedResultUrl: z.null(),
      outcomeCode: merchantDestinationFailureCodeSchema,
      consideredResultCount: z.null(),
      leaseToken: z.null(),
      leaseExpiresAt: z.null(),
      finishedAt: z.date(),
    }),
  ]);

export type PersistedMerchantDestinationResolution = z.infer<
  typeof persistedMerchantDestinationResolutionSchema
>;

export type MerchantDestinationResolutionMap = ReadonlyMap<
  z.infer<typeof candidateListingIdSchema>,
  PersistedMerchantDestinationResolution
>;

export class MerchantDestinationResolutionConflictError extends Error {
  constructor(readonly resolutionId: string) {
    super(
      `Merchant destination resolution ${resolutionId} already has different terminal content`,
    );
    this.name = "MerchantDestinationResolutionConflictError";
  }
}

export class MerchantDestinationResolutionLeaseError extends Error {
  constructor(readonly resolutionId: string) {
    super(
      `Merchant destination resolution ${resolutionId} is owned by another lease`,
    );
    this.name = "MerchantDestinationResolutionLeaseError";
  }
}

function corrupt(recordId: string, cause: string) {
  return new PersistedDataCorruptionError({
    recordType: "MerchantDestinationResolution",
    recordId,
    cause: new Error(cause),
  });
}

const candidateScopeColumns = {
  id: candidateListings.id,
  taskId: candidateListings.taskId,
  searchRunId: candidateListings.runId,
  provider: candidateListings.provider,
  title: candidateListings.title,
  url: candidateListings.url,
  merchantDestinationUrl: candidateListings.merchantDestinationUrl,
  merchant: candidateListings.merchant,
};

function parseResolutionLifecycle(row: unknown) {
  const parsed = persistedMerchantDestinationResolutionSchema.safeParse(row);
  if (!parsed.success) {
    const id =
      typeof row === "object" &&
      row !== null &&
      "id" in row &&
      typeof row.id === "string"
        ? row.id
        : "unknown";
    throw corrupt(id, "Resolution receipt has an invalid lifecycle shape");
  }
  if (
    parsed.data.finishedAt !== null &&
    parsed.data.finishedAt < parsed.data.startedAt
  ) {
    throw corrupt(parsed.data.id, "Resolution finished before it started");
  }
  return parsed.data;
}

async function loadCandidateScopeInTransaction(options: {
  tx: ShoppingTransaction;
  taskId: z.infer<typeof shoppingTaskIdSchema>;
  candidateListingId: z.infer<typeof candidateListingIdSchema>;
  forUpdate?: boolean;
}) {
  const query = options.tx
    .select(candidateScopeColumns)
    .from(candidateListings)
    .where(
      and(
        eq(candidateListings.taskId, options.taskId),
        eq(candidateListings.id, options.candidateListingId),
      ),
    )
    .limit(1);
  const rows = options.forUpdate ? await query.for("update") : await query;
  return rows[0] ?? null;
}

type CandidateResolutionScope = NonNullable<
  Awaited<ReturnType<typeof loadCandidateScopeInTransaction>>
>;

function validateResolutionAgainstCandidate(
  resolution: PersistedMerchantDestinationResolution,
  candidate: CandidateResolutionScope,
) {
  if (
    candidate.id !== resolution.candidateListingId ||
    candidate.taskId !== resolution.taskId ||
    candidate.searchRunId !== resolution.searchRunId ||
    candidate.provider !== resolution.provider
  ) {
    throw corrupt(
      resolution.id,
      "Resolution candidate, run, task, or provider scope changed",
    );
  }
  if (
    candidate.merchant === null ||
    candidate.merchantDestinationUrl !== null ||
    !isGoogleShoppingFallbackUrl(candidate.url)
  ) {
    throw corrupt(
      resolution.id,
      "Resolution candidate is no longer an eligible Google merchant offer",
    );
  }
  const expectedQuery = buildExactOfferMerchantQuery({
    title: candidate.title,
    merchant: candidate.merchant,
  });
  if (resolution.queryText !== expectedQuery) {
    throw corrupt(
      resolution.id,
      "Resolution query no longer matches its immutable candidate",
    );
  }
  if (resolution.status !== "resolved") return resolution;
  if (
    resolution.observedResultUrl !== null &&
    resolution.observedResultUrl === resolution.destinationUrl
  ) {
    throw corrupt(
      resolution.id,
      "Resolution redundantly persisted its canonical URL as an observation",
    );
  }
  const decision = evaluateExactOfferMerchantDestination({
    candidateTitle: candidate.title,
    merchant: candidate.merchant,
    resultTitle: resolution.acceptedResultTitle,
    resultUrl: resolution.observedResultUrl ?? resolution.destinationUrl,
  });
  if (
    !decision.accepted ||
    decision.destinationUrl !== resolution.destinationUrl
  ) {
    throw corrupt(
      resolution.id,
      "Resolved destination cannot be reproduced from its accepted organic result",
    );
  }
  return resolution;
}

async function databaseNow(tx: ShoppingTransaction) {
  const rows = await tx.execute(
    sql<{ now: Date }>`select clock_timestamp() as now`,
  );
  const [row] = rows;
  if (row === undefined) throw new Error("Database clock returned no value");
  return z.coerce.date().parse(row.now);
}

async function loadResolutionWithCandidateByIdInTransaction(options: {
  tx: ShoppingTransaction;
  taskId: z.infer<typeof shoppingTaskIdSchema>;
  resolutionId: z.infer<typeof merchantDestinationResolutionIdSchema>;
  forUpdate?: boolean;
}) {
  const query = options.tx
    .select()
    .from(merchantDestinationResolutions)
    .where(
      and(
        eq(merchantDestinationResolutions.taskId, options.taskId),
        eq(merchantDestinationResolutions.id, options.resolutionId),
      ),
    )
    .limit(1);
  const rows = options.forUpdate ? await query.for("update") : await query;
  if (rows[0] === undefined) return null;
  const resolution = parseResolutionLifecycle(rows[0]);
  const candidate = await loadCandidateScopeInTransaction({
    tx: options.tx,
    taskId: options.taskId,
    candidateListingId: resolution.candidateListingId,
  });
  if (candidate === null) {
    throw corrupt(resolution.id, "Resolution candidate is missing");
  }
  return {
    resolution: validateResolutionAgainstCandidate(resolution, candidate),
    candidate,
  };
}

async function loadResolutionByIdInTransaction(options: {
  tx: ShoppingTransaction;
  taskId: z.infer<typeof shoppingTaskIdSchema>;
  resolutionId: z.infer<typeof merchantDestinationResolutionIdSchema>;
  forUpdate?: boolean;
}) {
  return (
    (await loadResolutionWithCandidateByIdInTransaction(options))?.resolution ??
    null
  );
}

export async function loadMerchantDestinationResolutionMapInTransaction(options: {
  tx: ShoppingTransaction;
  taskId: unknown;
  candidateListingIds: readonly unknown[];
  policyVersion?: unknown;
}): Promise<MerchantDestinationResolutionMap> {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const candidateListingIds = z
    .array(candidateListingIdSchema)
    .max(100)
    .parse([...new Set(options.candidateListingIds)]);
  const policyVersion = z
    .string()
    .min(1)
    .max(120)
    .parse(options.policyVersion ?? MERCHANT_DESTINATION_POLICY_VERSION);
  if (candidateListingIds.length === 0) return new Map();

  const rows = await options.tx
    .select()
    .from(merchantDestinationResolutions)
    .where(
      and(
        eq(merchantDestinationResolutions.taskId, taskId),
        eq(merchantDestinationResolutions.policyVersion, policyVersion),
        inArray(
          merchantDestinationResolutions.candidateListingId,
          candidateListingIds,
        ),
      ),
    );
  const candidateRows = await options.tx
    .select(candidateScopeColumns)
    .from(candidateListings)
    .where(
      and(
        eq(candidateListings.taskId, taskId),
        inArray(candidateListings.id, candidateListingIds),
      ),
    );
  const candidatesById = new Map(
    candidateRows.map((candidate) => [candidate.id, candidate]),
  );
  const resolutions = new Map<
    z.infer<typeof candidateListingIdSchema>,
    PersistedMerchantDestinationResolution
  >();
  for (const row of rows) {
    const parsed = parseResolutionLifecycle(row);
    const candidate = candidatesById.get(parsed.candidateListingId);
    if (candidate === undefined) {
      throw corrupt(parsed.id, "Resolution candidate is missing");
    }
    const resolution = validateResolutionAgainstCandidate(parsed, candidate);
    if (resolutions.has(resolution.candidateListingId)) {
      throw corrupt(
        resolution.id,
        "Current policy has duplicate receipts for one listing",
      );
    }
    resolutions.set(resolution.candidateListingId, resolution);
  }
  return resolutions;
}

export async function loadMerchantDestinationResolutionMap(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  candidateListingIds: readonly unknown[];
  policyVersion?: unknown;
}) {
  return options.db.transaction(
    (tx) =>
      loadMerchantDestinationResolutionMapInTransaction({
        tx,
        taskId: options.taskId,
        candidateListingIds: options.candidateListingIds,
        ...(options.policyVersion === undefined
          ? {}
          : { policyVersion: options.policyVersion }),
      }),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

async function candidateHasExecutionAuthorityInTransaction(options: {
  tx: ShoppingTransaction;
  taskId: z.infer<typeof shoppingTaskIdSchema>;
  candidate: CandidateResolutionScope;
  provider: z.infer<typeof shoppingProviderSchema>;
  topAuthority: MerchantDestinationTopAuthority | null;
}) {
  const [rejected] = await options.tx
    .select({ id: rejectedCandidateListings.candidateListingId })
    .from(rejectedCandidateListings)
    .where(
      and(
        eq(rejectedCandidateListings.taskId, options.taskId),
        eq(rejectedCandidateListings.candidateListingId, options.candidate.id),
      ),
    )
    .limit(1);
  if (
    rejected !== undefined ||
    options.candidate.provider !== options.provider ||
    options.candidate.merchantDestinationUrl !== null ||
    options.candidate.merchant === null ||
    !isGoogleShoppingFallbackUrl(options.candidate.url)
  ) {
    return false;
  }

  const [saved] = await options.tx
    .select({ id: savedCandidateListings.candidateListingId })
    .from(savedCandidateListings)
    .where(
      and(
        eq(savedCandidateListings.taskId, options.taskId),
        eq(savedCandidateListings.candidateListingId, options.candidate.id),
      ),
    )
    .limit(1);
  if (saved !== undefined) return true;

  const authority = options.topAuthority;
  if (
    authority === null ||
    options.candidate.searchRunId !== authority.searchRunId
  ) {
    return false;
  }
  const [session] = await options.tx
    .select({
      currentContextActionId: founderLiveSessions.currentContextActionId,
    })
    .from(founderLiveSessions)
    .where(
      and(
        eq(founderLiveSessions.id, authority.sessionId),
        eq(founderLiveSessions.taskId, options.taskId),
      ),
    )
    .limit(1)
    .for("key share");
  if (session?.currentContextActionId !== authority.contextActionId) {
    return false;
  }
  const [[task], [action], [run]] = await Promise.all([
    options.tx
      .select({ currentRevision: shoppingTasks.currentRevision })
      .from(shoppingTasks)
      .where(eq(shoppingTasks.id, options.taskId))
      .limit(1),
    options.tx
      .select({
        actionKind: contextActions.actionKind,
        selectedAtRevision: contextActions.selectedAtRevision,
      })
      .from(contextActions)
      .where(
        and(
          eq(contextActions.taskId, options.taskId),
          eq(contextActions.id, authority.contextActionId),
        ),
      )
      .limit(1),
    options.tx
      .select({
        contextActionId: searchRuns.contextActionId,
        provider: searchRuns.provider,
        status: searchRuns.status,
        taskRevision: searchRuns.taskRevision,
      })
      .from(searchRuns)
      .where(
        and(
          eq(searchRuns.taskId, options.taskId),
          eq(searchRuns.id, authority.searchRunId),
        ),
      )
      .limit(1),
  ]);
  return (
    task?.currentRevision === authority.taskRevision &&
    action?.actionKind === "search" &&
    action.selectedAtRevision === authority.taskRevision &&
    run?.contextActionId === authority.contextActionId &&
    run.taskRevision === authority.taskRevision &&
    run.provider === options.provider &&
    run.status !== "running"
  );
}

type ClaimResult =
  | Readonly<{
      state: "acquired";
      created: boolean;
      resolution: Extract<
        PersistedMerchantDestinationResolution,
        { status: "running" }
      >;
    }>
  | Readonly<{
      state: "in_progress";
      created: false;
      resolution: Extract<
        PersistedMerchantDestinationResolution,
        { status: "running" }
      >;
    }>
  | Readonly<{
      state: "completed";
      created: false;
      resolution: Exclude<
        PersistedMerchantDestinationResolution,
        { status: "running" }
      >;
    }>
  | Readonly<{ state: "not_eligible"; created: false; resolution: null }>;

export async function claimMerchantDestinationResolution(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  candidateListingId: unknown;
  provider: unknown;
  policyVersion?: unknown;
  leaseDurationMs: unknown;
  topAuthority: unknown;
  createResolutionId?: () => string;
  createLeaseToken?: () => string;
}): Promise<ClaimResult> {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const candidateListingId = candidateListingIdSchema.parse(
    options.candidateListingId,
  );
  const provider = shoppingProviderSchema.parse(options.provider);
  const policyVersion = z
    .string()
    .min(1)
    .max(120)
    .parse(options.policyVersion ?? MERCHANT_DESTINATION_POLICY_VERSION);
  const leaseDurationMs = z
    .number()
    .int()
    .min(1_000)
    .max(5 * 60_000)
    .parse(options.leaseDurationMs);
  const createResolutionId = options.createResolutionId ?? randomUUID;
  const createLeaseToken = options.createLeaseToken ?? randomUUID;
  const topAuthority = merchantDestinationTopAuthoritySchema
    .nullable()
    .parse(options.topAuthority);

  return options.db.transaction(async (tx) => {
    const candidate = await loadCandidateScopeInTransaction({
      tx,
      taskId,
      candidateListingId,
      forUpdate: true,
    });
    if (candidate === null) {
      return { state: "not_eligible", created: false, resolution: null };
    }
    if (
      !(await candidateHasExecutionAuthorityInTransaction({
        tx,
        taskId,
        candidate,
        provider,
        topAuthority,
      }))
    ) {
      return { state: "not_eligible", created: false, resolution: null };
    }
    if (candidate.merchant === null) {
      return { state: "not_eligible", created: false, resolution: null };
    }

    const queryText = buildExactOfferMerchantQuery({
      title: candidate.title,
      merchant: candidate.merchant,
    });
    const [existingRow] = await tx
      .select()
      .from(merchantDestinationResolutions)
      .where(
        and(
          eq(merchantDestinationResolutions.taskId, taskId),
          eq(merchantDestinationResolutions.searchRunId, candidate.searchRunId),
          eq(
            merchantDestinationResolutions.candidateListingId,
            candidateListingId,
          ),
          eq(merchantDestinationResolutions.policyVersion, policyVersion),
        ),
      )
      .for("update")
      .limit(1);
    const now = await databaseNow(tx);
    if (existingRow !== undefined) {
      const existing = validateResolutionAgainstCandidate(
        parseResolutionLifecycle(existingRow),
        candidate,
      );
      if (
        existing.provider !== provider ||
        existing.queryText !== queryText ||
        existing.searchRunId !== candidate.searchRunId
      ) {
        throw corrupt(
          existing.id,
          "Resolution scope no longer matches its immutable request",
        );
      }
      if (existing.status !== "running") {
        return {
          state: "completed",
          created: false,
          resolution: existing,
        };
      }
      if (existing.leaseExpiresAt > now) {
        return {
          state: "in_progress",
          created: false,
          resolution: existing,
        };
      }
      const leaseToken =
        merchantDestinationLeaseTokenSchema.parse(createLeaseToken());
      await tx
        .update(merchantDestinationResolutions)
        .set({
          leaseToken,
          leaseExpiresAt: new Date(now.getTime() + leaseDurationMs),
        })
        .where(
          and(
            eq(merchantDestinationResolutions.taskId, taskId),
            eq(merchantDestinationResolutions.id, existing.id),
          ),
        );
      const claimed = await loadResolutionByIdInTransaction({
        tx,
        taskId,
        resolutionId: existing.id,
      });
      if (claimed?.status !== "running") {
        throw new Error("Claimed resolution was not visible");
      }
      return { state: "acquired", created: false, resolution: claimed };
    }

    const resolutionId =
      merchantDestinationResolutionIdSchema.parse(createResolutionId());
    const leaseToken =
      merchantDestinationLeaseTokenSchema.parse(createLeaseToken());
    await tx.insert(merchantDestinationResolutions).values({
      id: resolutionId,
      taskId,
      searchRunId: candidate.searchRunId,
      candidateListingId,
      policyVersion,
      provider,
      queryText,
      status: "running",
      destinationUrl: null,
      acceptedResultTitle: null,
      observedResultUrl: null,
      outcomeCode: null,
      consideredResultCount: null,
      leaseToken,
      leaseExpiresAt: new Date(now.getTime() + leaseDurationMs),
      startedAt: now,
      finishedAt: null,
    });
    const created = await loadResolutionByIdInTransaction({
      tx,
      taskId,
      resolutionId,
    });
    if (created?.status !== "running") {
      throw new Error("Created resolution was not visible");
    }
    return { state: "acquired", created: true, resolution: created };
  });
}

export async function validateMerchantDestinationResolutionExecution(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  resolutionId: unknown;
  leaseToken: unknown;
  topAuthority: unknown;
}) {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const resolutionId = merchantDestinationResolutionIdSchema.parse(
    options.resolutionId,
  );
  const leaseToken = merchantDestinationLeaseTokenSchema.parse(
    options.leaseToken,
  );
  const topAuthority = merchantDestinationTopAuthoritySchema
    .nullable()
    .parse(options.topAuthority);
  return options.db.transaction(async (tx) => {
    const loaded = await loadResolutionWithCandidateByIdInTransaction({
      tx,
      taskId,
      resolutionId,
      forUpdate: true,
    });
    if (loaded === null) {
      throw new MerchantDestinationResolutionConflictError(resolutionId);
    }
    const { candidate, resolution } = loaded;
    if (resolution.status !== "running") {
      return { state: "completed" as const, resolution };
    }
    if (resolution.leaseToken !== leaseToken) {
      throw new MerchantDestinationResolutionLeaseError(resolutionId);
    }
    const now = await databaseNow(tx);
    if (resolution.leaseExpiresAt <= now) {
      throw new MerchantDestinationResolutionLeaseError(resolutionId);
    }
    if (
      !(await candidateHasExecutionAuthorityInTransaction({
        tx,
        taskId,
        candidate,
        provider: resolution.provider,
        topAuthority,
      }))
    ) {
      return { state: "not_eligible" as const, resolution };
    }
    if (candidate.merchant === null) {
      throw corrupt(
        resolution.id,
        "Eligible merchant destination candidate has no merchant",
      );
    }
    return {
      state: "ready" as const,
      resolution,
      request: {
        requestId: resolution.id,
        taskId: resolution.taskId,
        searchRunId: resolution.searchRunId,
        candidateListingId: resolution.candidateListingId,
        title: candidate.title,
        merchant: candidate.merchant,
        googleShoppingUrl: candidate.url,
        queryText: resolution.queryText,
      },
    };
  });
}

export async function abandonMerchantDestinationResolutionExecution(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  resolutionId: unknown;
  leaseToken: unknown;
  deleteFreshPlaceholder: boolean;
}) {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const resolutionId = merchantDestinationResolutionIdSchema.parse(
    options.resolutionId,
  );
  const leaseToken = merchantDestinationLeaseTokenSchema.parse(
    options.leaseToken,
  );
  return options.db.transaction(async (tx) => {
    const existing = await loadResolutionByIdInTransaction({
      tx,
      taskId,
      resolutionId,
      forUpdate: true,
    });
    if (existing === null) {
      return { state: "absent" as const, resolution: null };
    }
    if (existing.status !== "running") {
      return { state: "completed" as const, resolution: existing };
    }
    if (existing.leaseToken !== leaseToken) {
      throw new MerchantDestinationResolutionLeaseError(resolutionId);
    }
    if (options.deleteFreshPlaceholder) {
      const deleted = await tx
        .delete(merchantDestinationResolutions)
        .where(
          and(
            eq(merchantDestinationResolutions.taskId, taskId),
            eq(merchantDestinationResolutions.id, resolutionId),
            eq(merchantDestinationResolutions.status, "running"),
            eq(merchantDestinationResolutions.leaseToken, leaseToken),
          ),
        )
        .returning({ id: merchantDestinationResolutions.id });
      if (deleted.length !== 1) {
        throw new MerchantDestinationResolutionLeaseError(resolutionId);
      }
      return { state: "deleted" as const, resolution: null };
    }

    const releasedAt = await databaseNow(tx);
    if (releasedAt <= existing.startedAt) {
      throw corrupt(
        existing.id,
        "A resumed resolution lease cannot be released before it started",
      );
    }
    const updated = await tx
      .update(merchantDestinationResolutions)
      .set({ leaseExpiresAt: releasedAt })
      .where(
        and(
          eq(merchantDestinationResolutions.taskId, taskId),
          eq(merchantDestinationResolutions.id, resolutionId),
          eq(merchantDestinationResolutions.status, "running"),
          eq(merchantDestinationResolutions.leaseToken, leaseToken),
        ),
      )
      .returning({ id: merchantDestinationResolutions.id });
    if (updated.length !== 1) {
      throw new MerchantDestinationResolutionLeaseError(resolutionId);
    }
    const released = await loadResolutionByIdInTransaction({
      tx,
      taskId,
      resolutionId,
    });
    if (released?.status !== "running") {
      throw new Error("Released resolution lease was not visible");
    }
    return { state: "released" as const, resolution: released };
  });
}

const terminalResolutionInputSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("resolved"),
    destinationUrl: httpsUrlSchema,
    acceptedResultTitle: z.string().min(1).max(1_000),
    observedResultUrl: httpsUrlSchema.nullable(),
    consideredResultCount: z.number().int().positive(),
  }),
  z.strictObject({
    status: z.literal("rejected"),
    outcomeCode: merchantDestinationRejectionCodeSchema,
    consideredResultCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    status: z.literal("failed"),
    outcomeCode: merchantDestinationFailureCodeSchema,
  }),
]);

type TerminalResolutionInput = z.infer<typeof terminalResolutionInputSchema>;

function terminalMatches(
  existing: Exclude<
    PersistedMerchantDestinationResolution,
    { status: "running" }
  >,
  intended: TerminalResolutionInput,
) {
  if (existing.status !== intended.status) return false;
  if (intended.status === "resolved" && existing.status === "resolved") {
    return (
      existing.destinationUrl === intended.destinationUrl &&
      existing.acceptedResultTitle === intended.acceptedResultTitle &&
      existing.observedResultUrl === intended.observedResultUrl &&
      existing.consideredResultCount === intended.consideredResultCount
    );
  }
  if (intended.status === "rejected" && existing.status === "rejected") {
    return (
      existing.outcomeCode === intended.outcomeCode &&
      existing.consideredResultCount === intended.consideredResultCount
    );
  }
  return (
    intended.status === "failed" &&
    existing.status === "failed" &&
    existing.outcomeCode === intended.outcomeCode
  );
}

export async function recordMerchantDestinationResolution(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  resolutionId: unknown;
  leaseToken: unknown;
  terminal: unknown;
}) {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const resolutionId = merchantDestinationResolutionIdSchema.parse(
    options.resolutionId,
  );
  const leaseToken = merchantDestinationLeaseTokenSchema.parse(
    options.leaseToken,
  );
  let terminal: TerminalResolutionInput = terminalResolutionInputSchema.parse(
    options.terminal,
  );
  return options.db.transaction(async (tx) => {
    const loaded = await loadResolutionWithCandidateByIdInTransaction({
      tx,
      taskId,
      resolutionId,
      forUpdate: true,
    });
    if (loaded === null) {
      throw new MerchantDestinationResolutionConflictError(resolutionId);
    }
    const { candidate, resolution: existing } = loaded;
    if (terminal.status === "resolved") {
      const decision =
        candidate.merchant === null ||
        (terminal.observedResultUrl !== null &&
          terminal.observedResultUrl === terminal.destinationUrl)
          ? null
          : evaluateExactOfferMerchantDestination({
              candidateTitle: candidate.title,
              merchant: candidate.merchant,
              resultTitle: terminal.acceptedResultTitle,
              resultUrl: terminal.observedResultUrl ?? terminal.destinationUrl,
            });
      if (
        decision === null ||
        !decision.accepted ||
        decision.destinationUrl !== terminal.destinationUrl
      ) {
        terminal = {
          status: "failed",
          outcomeCode: "invalid_provider_result",
        };
      }
    }
    if (existing.status !== "running") {
      if (!terminalMatches(existing, terminal)) {
        throw new MerchantDestinationResolutionConflictError(resolutionId);
      }
      return { created: false, resolution: existing };
    }
    if (existing.leaseToken !== leaseToken) {
      throw new MerchantDestinationResolutionLeaseError(resolutionId);
    }
    const finishedAt = await databaseNow(tx);
    const values =
      terminal.status === "resolved"
        ? {
            status: "resolved",
            destinationUrl: terminal.destinationUrl,
            acceptedResultTitle: terminal.acceptedResultTitle,
            observedResultUrl: terminal.observedResultUrl,
            outcomeCode: null,
            consideredResultCount: terminal.consideredResultCount,
          }
        : terminal.status === "rejected"
          ? {
              status: "rejected",
              destinationUrl: null,
              acceptedResultTitle: null,
              observedResultUrl: null,
              outcomeCode: terminal.outcomeCode,
              consideredResultCount: terminal.consideredResultCount,
            }
          : {
              status: "failed",
              destinationUrl: null,
              acceptedResultTitle: null,
              observedResultUrl: null,
              outcomeCode: terminal.outcomeCode,
              consideredResultCount: null,
            };
    const updated = await tx
      .update(merchantDestinationResolutions)
      .set({
        ...values,
        leaseToken: null,
        leaseExpiresAt: null,
        finishedAt,
      })
      .where(
        and(
          eq(merchantDestinationResolutions.taskId, taskId),
          eq(merchantDestinationResolutions.id, resolutionId),
          eq(merchantDestinationResolutions.status, "running"),
          eq(merchantDestinationResolutions.leaseToken, leaseToken),
        ),
      )
      .returning({ id: merchantDestinationResolutions.id });
    if (updated.length !== 1) {
      throw new MerchantDestinationResolutionLeaseError(resolutionId);
    }
    const stored = await loadResolutionByIdInTransaction({
      tx,
      taskId,
      resolutionId,
    });
    if (stored === null || stored.status === "running") {
      throw new Error("Terminal resolution was not visible");
    }
    return { created: true, resolution: stored };
  });
}
