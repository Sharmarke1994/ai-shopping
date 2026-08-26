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
  savedCandidateListings,
} from "@/infrastructure/database/schema";

export class SavedListingNotAvailableError extends Error {
  constructor(readonly candidateListingId: string) {
    super("That product listing is not available in this shopping task");
    this.name = "SavedListingNotAvailableError";
  }
}

export async function saveCandidateListing(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  candidateListingId: unknown;
}) {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const candidateListingId = candidateListingIdSchema.parse(
    options.candidateListingId,
  );
  return options.db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ id: candidateListings.id })
      .from(candidateListings)
      .where(
        and(
          eq(candidateListings.taskId, taskId),
          eq(candidateListings.id, candidateListingId),
        ),
      )
      .limit(1);
    if (candidate === undefined) {
      throw new SavedListingNotAvailableError(candidateListingId);
    }
    const [created] = await tx
      .insert(savedCandidateListings)
      .values({ taskId, candidateListingId })
      .onConflictDoNothing({
        target: [
          savedCandidateListings.taskId,
          savedCandidateListings.candidateListingId,
        ],
      })
      .returning({ savedAt: savedCandidateListings.savedAt });
    if (created !== undefined)
      return { created: true, savedAt: created.savedAt };
    const [existing] = await tx
      .select({ savedAt: savedCandidateListings.savedAt })
      .from(savedCandidateListings)
      .where(
        and(
          eq(savedCandidateListings.taskId, taskId),
          eq(savedCandidateListings.candidateListingId, candidateListingId),
        ),
      )
      .limit(1);
    if (existing === undefined) {
      throw new Error("Saved-listing retry winner was not visible");
    }
    return { created: false, savedAt: existing.savedAt };
  });
}

export async function unsaveCandidateListing(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  candidateListingId: unknown;
}) {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const candidateListingId = candidateListingIdSchema.parse(
    options.candidateListingId,
  );
  const deleted = await options.db
    .delete(savedCandidateListings)
    .where(
      and(
        eq(savedCandidateListings.taskId, taskId),
        eq(savedCandidateListings.candidateListingId, candidateListingId),
      ),
    )
    .returning({
      candidateListingId: savedCandidateListings.candidateListingId,
    });
  return { removed: deleted.length === 1 };
}

export async function loadSavedCandidateListingsInTransaction(options: {
  tx: ShoppingTransaction;
  taskId: unknown;
}) {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const bindings = await options.tx
    .select({
      candidateListingId: savedCandidateListings.candidateListingId,
      runId: candidateListings.runId,
      savedAt: savedCandidateListings.savedAt,
    })
    .from(savedCandidateListings)
    .innerJoin(
      candidateListings,
      and(
        eq(candidateListings.taskId, savedCandidateListings.taskId),
        eq(candidateListings.id, savedCandidateListings.candidateListingId),
      ),
    )
    .where(eq(savedCandidateListings.taskId, taskId))
    .orderBy(asc(savedCandidateListings.savedAt));

  const runs = new Map<string, PersistedSearchRun>();
  const saved: { listing: PersistedCandidateListing; savedAt: Date }[] = [];
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
          recordType: "SavedCandidateListing",
          recordId: binding.candidateListingId,
          cause: new Error("Saved listing references a missing SearchRun"),
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
        recordType: "SavedCandidateListing",
        recordId: binding.candidateListingId,
        cause: new Error(
          "Saved listing is absent from its validated SearchRun",
        ),
      });
    }
    saved.push({ listing, savedAt: binding.savedAt });
  }
  return saved;
}
