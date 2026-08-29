import { and, asc, eq } from "drizzle-orm";
import { PersistedDataCorruptionError } from "@/domain/shopping-state/errors";
import {
  candidateListingIdSchema,
  shoppingTaskIdSchema,
} from "@/domain/shopping-state/ids";
import { loadPersistedSearchRunInTransaction } from "@/features/retrieval-spike/persistence/search-runs";
import type {
  PersistedCandidateListing,
  PersistedSearchRun,
} from "@/features/retrieval-spike/persistence/contracts";
import type {
  ShoppingDatabase,
  ShoppingTransaction,
} from "@/infrastructure/database/clients";
import {
  candidateListings,
  rejectedCandidateListings,
  savedCandidateListings,
} from "@/infrastructure/database/schema";
import { SavedListingNotAvailableError } from "./saved-listings";

async function lockCandidate(options: {
  tx: ShoppingTransaction;
  taskId: string;
  candidateListingId: string;
}) {
  const [candidate] = await options.tx
    .select({ id: candidateListings.id })
    .from(candidateListings)
    .where(
      and(
        eq(candidateListings.taskId, options.taskId),
        eq(candidateListings.id, options.candidateListingId),
      ),
    )
    .for("update")
    .limit(1);
  if (candidate === undefined) {
    throw new SavedListingNotAvailableError(options.candidateListingId);
  }
}

export async function rejectCandidateListing(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  candidateListingId: unknown;
}) {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const candidateListingId = candidateListingIdSchema.parse(
    options.candidateListingId,
  );
  return options.db.transaction(async (tx) => {
    await lockCandidate({ tx, taskId, candidateListingId });
    const [created] = await tx
      .insert(rejectedCandidateListings)
      .values({ taskId, candidateListingId })
      .onConflictDoNothing({
        target: [
          rejectedCandidateListings.taskId,
          rejectedCandidateListings.candidateListingId,
        ],
      })
      .returning({ rejectedAt: rejectedCandidateListings.rejectedAt });
    const removedSaved = await tx
      .delete(savedCandidateListings)
      .where(
        and(
          eq(savedCandidateListings.taskId, taskId),
          eq(savedCandidateListings.candidateListingId, candidateListingId),
        ),
      )
      .returning({ id: savedCandidateListings.candidateListingId });
    if (created !== undefined) {
      return {
        created: true,
        removedFromSaved: removedSaved.length === 1,
        rejectedAt: created.rejectedAt,
      };
    }
    const [existing] = await tx
      .select({ rejectedAt: rejectedCandidateListings.rejectedAt })
      .from(rejectedCandidateListings)
      .where(
        and(
          eq(rejectedCandidateListings.taskId, taskId),
          eq(rejectedCandidateListings.candidateListingId, candidateListingId),
        ),
      )
      .limit(1);
    if (existing === undefined) {
      throw new Error("Rejected-listing retry winner was not visible");
    }
    return {
      created: false,
      removedFromSaved: false,
      rejectedAt: existing.rejectedAt,
    };
  });
}

export async function undoRejectedCandidateListing(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  candidateListingId: unknown;
}) {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const candidateListingId = candidateListingIdSchema.parse(
    options.candidateListingId,
  );
  return options.db.transaction(async (tx) => {
    await lockCandidate({ tx, taskId, candidateListingId });
    const deleted = await tx
      .delete(rejectedCandidateListings)
      .where(
        and(
          eq(rejectedCandidateListings.taskId, taskId),
          eq(rejectedCandidateListings.candidateListingId, candidateListingId),
        ),
      )
      .returning({ id: rejectedCandidateListings.candidateListingId });
    return { restored: deleted.length === 1 };
  });
}

export async function loadRejectedCandidateListingsInTransaction(options: {
  tx: ShoppingTransaction;
  taskId: unknown;
}) {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const bindings = await options.tx
    .select({
      candidateListingId: rejectedCandidateListings.candidateListingId,
      runId: candidateListings.runId,
      rejectedAt: rejectedCandidateListings.rejectedAt,
    })
    .from(rejectedCandidateListings)
    .innerJoin(
      candidateListings,
      and(
        eq(candidateListings.taskId, rejectedCandidateListings.taskId),
        eq(candidateListings.id, rejectedCandidateListings.candidateListingId),
      ),
    )
    .where(eq(rejectedCandidateListings.taskId, taskId))
    .orderBy(asc(rejectedCandidateListings.rejectedAt));

  const runs = new Map<string, PersistedSearchRun>();
  const rejected: {
    listing: PersistedCandidateListing;
    rejectedAt: Date;
  }[] = [];
  for (const binding of bindings) {
    let run = runs.get(binding.runId);
    if (run === undefined) {
      const loaded = await loadPersistedSearchRunInTransaction({
        tx: options.tx,
        taskId,
        runId: binding.runId,
      });
      if (loaded === null) {
        throw new PersistedDataCorruptionError({
          recordType: "RejectedCandidateListing",
          recordId: binding.candidateListingId,
          cause: new Error("Rejected listing references a missing SearchRun"),
        });
      }
      run = loaded;
      runs.set(binding.runId, run);
    }
    const listing = run.listings.find(
      ({ id }) => id === binding.candidateListingId,
    );
    if (listing === undefined) {
      throw new PersistedDataCorruptionError({
        recordType: "RejectedCandidateListing",
        recordId: binding.candidateListingId,
        cause: new Error("Rejected listing is absent from its SearchRun"),
      });
    }
    rejected.push({ listing, rejectedAt: binding.rejectedAt });
  }
  return rejected;
}
