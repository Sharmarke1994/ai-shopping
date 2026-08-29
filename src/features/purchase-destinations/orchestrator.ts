import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  candidateListingIdSchema,
  shoppingTaskIdSchema,
} from "@/domain/shopping-state/ids";
import type { ShoppingDatabase } from "@/infrastructure/database/clients";
import {
  candidateListings,
  rejectedCandidateListings,
  savedCandidateListings,
} from "@/infrastructure/database/schema";
import {
  MerchantDestinationResolverError,
  merchantDestinationResolutionResultSchema,
  merchantDestinationTopAuthoritySchema,
  type MerchantDestinationResolver,
  type MerchantDestinationTopAuthority,
} from "./contracts";
import {
  abandonMerchantDestinationResolutionExecution,
  claimMerchantDestinationResolution,
  MERCHANT_DESTINATION_POLICY_VERSION,
  recordMerchantDestinationResolution,
  type PersistedMerchantDestinationResolution,
  validateMerchantDestinationResolutionExecution,
} from "./persistence";

const DEFAULT_LEASE_DURATION_MS = 60_000;
const MINIMUM_LEASE_MARGIN_MS = 5_000;
const MAX_VISIBLE_TOP_OPTIONS = 5;
const MAX_SAVED_OPTIONS = 4;
const MAX_CONCURRENT_RESOLUTIONS = 2;

function resolutionLeaseDuration(options: {
  requested: number | undefined;
  providerMaximum: number;
}) {
  const providerMaximum = z
    .number()
    .int()
    .nonnegative()
    .max(4 * 60_000)
    .parse(options.providerMaximum);
  return z
    .number()
    .int()
    .min(Math.max(1_000, providerMaximum + MINIMUM_LEASE_MARGIN_MS))
    .max(5 * 60_000)
    .parse(options.requested ?? DEFAULT_LEASE_DURATION_MS);
}

async function loadCandidateQueue(options: {
  db: ShoppingDatabase;
  taskId: z.infer<typeof shoppingTaskIdSchema>;
  visibleTopCandidateListingIds: readonly z.infer<
    typeof candidateListingIdSchema
  >[];
}) {
  return options.db.transaction(
    async (tx) => {
      const saved = await tx
        .select({
          candidateListingId: savedCandidateListings.candidateListingId,
        })
        .from(savedCandidateListings)
        .where(eq(savedCandidateListings.taskId, options.taskId))
        .orderBy(
          asc(savedCandidateListings.savedAt),
          asc(savedCandidateListings.candidateListingId),
        )
        .limit(MAX_SAVED_OPTIONS);
      const orderedIds = [
        ...new Set([
          ...saved.map(({ candidateListingId }) => candidateListingId),
          ...options.visibleTopCandidateListingIds,
        ]),
      ];
      if (orderedIds.length === 0) return [];

      const [candidates, rejected] = await Promise.all([
        tx
          .select({
            id: candidateListings.id,
            taskId: candidateListings.taskId,
            searchRunId: candidateListings.runId,
            provider: candidateListings.provider,
            title: candidateListings.title,
            url: candidateListings.url,
            merchant: candidateListings.merchant,
          })
          .from(candidateListings)
          .where(
            and(
              eq(candidateListings.taskId, options.taskId),
              inArray(candidateListings.id, orderedIds),
            ),
          ),
        tx
          .select({
            candidateListingId: rejectedCandidateListings.candidateListingId,
          })
          .from(rejectedCandidateListings)
          .where(
            and(
              eq(rejectedCandidateListings.taskId, options.taskId),
              inArray(rejectedCandidateListings.candidateListingId, orderedIds),
            ),
          ),
      ]);
      const byId = new Map(
        candidates.map((candidate) => [
          candidate.id,
          { ...candidate, id: candidateListingIdSchema.parse(candidate.id) },
        ]),
      );
      const rejectedIds = new Set(
        rejected.map(({ candidateListingId }) => candidateListingId),
      );
      return orderedIds.flatMap((candidateListingId) => {
        const candidate = byId.get(candidateListingId);
        return candidate === undefined || rejectedIds.has(candidateListingId)
          ? []
          : [candidate];
      });
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

type CandidateExecutionResult = Readonly<{
  candidateListingId: z.infer<typeof candidateListingIdSchema>;
  state: "completed" | "in_progress" | "not_eligible";
  created: boolean;
  resolution: PersistedMerchantDestinationResolution | null;
}>;

async function executeCandidate(options: {
  db: ShoppingDatabase;
  taskId: z.infer<typeof shoppingTaskIdSchema>;
  candidate: Awaited<ReturnType<typeof loadCandidateQueue>>[number];
  resolver: MerchantDestinationResolver;
  topAuthority: MerchantDestinationTopAuthority | null;
  policyVersion: string;
  leaseDurationMs: number;
  createResolutionId?: () => string;
  createLeaseToken?: () => string;
}): Promise<CandidateExecutionResult> {
  const claimed = await claimMerchantDestinationResolution({
    db: options.db,
    taskId: options.taskId,
    candidateListingId: options.candidate.id,
    provider: options.resolver.provider,
    policyVersion: options.policyVersion,
    leaseDurationMs: options.leaseDurationMs,
    topAuthority: options.topAuthority,
    ...(options.createResolutionId === undefined
      ? {}
      : { createResolutionId: options.createResolutionId }),
    ...(options.createLeaseToken === undefined
      ? {}
      : { createLeaseToken: options.createLeaseToken }),
  });
  if (claimed.state === "not_eligible") {
    return {
      candidateListingId: options.candidate.id,
      state: "not_eligible",
      created: false,
      resolution: null,
    };
  }
  if (claimed.state === "in_progress") {
    return {
      candidateListingId: options.candidate.id,
      state: "in_progress",
      created: false,
      resolution: claimed.resolution,
    };
  }
  if (claimed.state === "completed") {
    return {
      candidateListingId: options.candidate.id,
      state: "completed",
      created: false,
      resolution: claimed.resolution,
    };
  }

  const validated = await validateMerchantDestinationResolutionExecution({
    db: options.db,
    taskId: options.taskId,
    resolutionId: claimed.resolution.id,
    leaseToken: claimed.resolution.leaseToken,
    topAuthority: options.topAuthority,
  });
  if (validated.state === "completed") {
    return {
      candidateListingId: options.candidate.id,
      state: "completed",
      created: false,
      resolution: validated.resolution,
    };
  }
  if (validated.state === "not_eligible") {
    await abandonMerchantDestinationResolutionExecution({
      db: options.db,
      taskId: options.taskId,
      resolutionId: claimed.resolution.id,
      leaseToken: claimed.resolution.leaseToken,
      deleteFreshPlaceholder: claimed.created,
    });
    return {
      candidateListingId: options.candidate.id,
      state: "not_eligible",
      created: false,
      resolution: null,
    };
  }

  let terminal:
    | Readonly<{
        status: "resolved";
        destinationUrl: string;
        acceptedResultTitle: string;
        observedResultUrl: string | null;
        consideredResultCount: number;
      }>
    | Readonly<{
        status: "rejected";
        outcomeCode: string;
        consideredResultCount: number;
      }>
    | Readonly<{ status: "failed"; outcomeCode: string }>;
  try {
    const raw = await options.resolver.resolve(validated.request);
    const parsed = merchantDestinationResolutionResultSchema.safeParse(raw);
    terminal = !parsed.success
      ? { status: "failed", outcomeCode: "invalid_provider_result" }
      : parsed.data.outcome === "resolved"
        ? {
            status: "resolved",
            destinationUrl: parsed.data.destinationUrl,
            acceptedResultTitle: parsed.data.acceptedResultTitle,
            observedResultUrl: parsed.data.observedResultUrl,
            consideredResultCount: parsed.data.consideredResultCount,
          }
        : {
            status: "rejected",
            outcomeCode: parsed.data.rejectionCode,
            consideredResultCount: parsed.data.consideredResultCount,
          };
  } catch (error) {
    terminal = {
      status: "failed",
      outcomeCode:
        error instanceof MerchantDestinationResolverError
          ? error.code
          : "provider_failed",
    };
  }
  const recorded = await recordMerchantDestinationResolution({
    db: options.db,
    taskId: options.taskId,
    resolutionId: claimed.resolution.id,
    leaseToken: claimed.resolution.leaseToken,
    terminal,
  });
  return {
    candidateListingId: options.candidate.id,
    state: "completed",
    created: claimed.created && recorded.created,
    resolution: recorded.resolution,
  };
}

export async function executeOrResumeMerchantDestinationResolution(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  visibleTopCandidateListingIds: readonly unknown[];
  visibleTopAuthority?: unknown;
  resolver: MerchantDestinationResolver;
  policyVersion?: unknown;
  leaseDurationMs?: number;
  createResolutionId?: () => string;
  createLeaseToken?: () => string;
}) {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const visibleTopCandidateListingIds = z
    .array(candidateListingIdSchema)
    .max(MAX_VISIBLE_TOP_OPTIONS)
    .parse([...new Set(options.visibleTopCandidateListingIds)]);
  const policyVersion = z
    .string()
    .min(1)
    .max(120)
    .parse(options.policyVersion ?? MERCHANT_DESTINATION_POLICY_VERSION);
  const topAuthority = merchantDestinationTopAuthoritySchema
    .nullable()
    .parse(options.visibleTopAuthority ?? null);
  const leaseDurationMs = resolutionLeaseDuration({
    requested: options.leaseDurationMs,
    providerMaximum: options.resolver.maxRequestDurationMs,
  });
  const candidates = await loadCandidateQueue({
    db: options.db,
    taskId,
    visibleTopCandidateListingIds,
  });
  const results = new Array<CandidateExecutionResult>(candidates.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < candidates.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await executeCandidate({
        db: options.db,
        taskId,
        candidate: candidates[index]!,
        resolver: options.resolver,
        topAuthority,
        policyVersion,
        leaseDurationMs,
        ...(options.createResolutionId === undefined
          ? {}
          : { createResolutionId: options.createResolutionId }),
        ...(options.createLeaseToken === undefined
          ? {}
          : { createLeaseToken: options.createLeaseToken }),
      });
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(MAX_CONCURRENT_RESOLUTIONS, candidates.length) },
      () => worker(),
    ),
  );
  return { results };
}
