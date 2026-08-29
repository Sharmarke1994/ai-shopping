import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ContextAcquisitionModel } from "../../src/features/context-acquisition/model-port";
import type {
  ContextActionProviderWireV1,
  InterpretationProviderWireV1,
} from "../../src/features/context-acquisition/provider-wire";
import {
  loadLiveShoppingSession,
  researchLiveCandidate,
  setLiveListingRejected,
  setLiveListingSaved,
  startLiveShopping,
  type LiveShoppingDependencies,
} from "../../src/features/live-shopping/application";
import {
  RejectedListingCannotBeSavedError,
  saveCandidateListing,
  SavedListingLimitReachedError,
  SavedListingNotAvailableError,
} from "../../src/features/live-shopping/saved-listings";
import {
  FakeEvidenceSearchProvider,
  FakeProductUnderstandingModel,
} from "../../src/features/product-understanding/fakes";
import { FakeShoppingProvider } from "../../src/features/retrieval-spike/fake-shopping-provider";
import {
  candidateListings,
  founderLiveSessions,
  rejectedCandidateListings,
  savedCandidateListings,
  shoppingTasks,
} from "../../src/infrastructure/database/schema";
import {
  createTestDatabaseConnection,
  resetShoppingState,
  type TestDatabaseConnection,
} from "./helpers";

const metadata = {
  provider: "fixture" as const,
  model: "rejection-test",
  promptVersion: "rejection-test-v1",
  providerSchemaVersion: 1 as const,
  providerRequestId: "fixture",
  durationMs: 0,
  inputTokens: null,
  outputTokens: null,
};

function model(): ContextAcquisitionModel {
  const interpretation: InterpretationProviderWireV1 = {
    providerSchemaVersion: 1,
    outcome: "no_change",
    operations: [],
    ambiguities: [],
  };
  const action: ContextActionProviderWireV1 = {
    providerSchemaVersion: 1,
    action: "search",
    question: null,
    rationale: { summary: "Ready for fixture search." },
  };
  return {
    interpret: vi.fn(() =>
      Promise.resolve({
        status: "completed" as const,
        value: interpretation,
        metadata,
      }),
    ),
    selectAction: vi.fn(() =>
      Promise.resolve({
        status: "completed" as const,
        value: action,
        metadata,
      }),
    ),
  };
}

describe("task-local exact listing rejection", () => {
  let connection: TestDatabaseConnection;

  beforeAll(() => {
    connection = createTestDatabaseConnection();
  });
  beforeEach(async () => {
    await resetShoppingState(connection);
  });
  afterAll(async () => {
    await connection.close();
  });

  async function createSession() {
    const sessionId = randomUUID();
    const evidenceProvider = new FakeEvidenceSearchProvider();
    const dependencies: LiveShoppingDependencies = {
      db: connection.db,
      model: model(),
      provider: new FakeShoppingProvider(),
      research: {
        evidenceProvider,
        model: new FakeProductUnderstandingModel(),
        modelIdentity: {
          provider: "fixture",
          model: "fixture-product-understanding",
          promptVersion: "product-understanding-v1",
        },
      },
    };
    const view = await startLiveShopping({
      dependencies,
      input: {
        operation: "start",
        sessionId,
        turnId: randomUUID(),
        message: "A practical product for this rejection test",
      },
    });
    const listing =
      view.action.kind === "search"
        ? view.action.search?.listings[0]
        : undefined;
    if (listing === undefined) throw new Error("Expected a fixture listing");
    const [session] = await connection.db
      .select()
      .from(founderLiveSessions)
      .where(eq(founderLiveSessions.id, sessionId));
    if (session === undefined) throw new Error("Expected a founder session");
    return {
      dependencies,
      evidenceProvider,
      listing,
      session,
      sessionId,
      view,
    };
  }

  it("rejects idempotently, atomically unsaves, survives refresh and undoes without re-saving", async () => {
    const {
      dependencies,
      evidenceProvider,
      listing,
      session,
      sessionId,
      view,
    } = await createSession();
    await setLiveListingSaved({
      dependencies,
      input: {
        operation: "save_listing",
        sessionId,
        candidateListingId: listing.candidateListingId,
      },
    });
    const beforeTask = await connection.db
      .select({ revision: shoppingTasks.currentRevision })
      .from(shoppingTasks)
      .where(eq(shoppingTasks.id, session.taskId));
    const rejected = await setLiveListingRejected({
      dependencies,
      input: {
        operation: "reject_listing",
        sessionId,
        candidateListingId: listing.candidateListingId,
      },
    });
    expect(rejected.savedListings).toHaveLength(0);
    expect(
      rejected.rejectedListings.map(
        ({ candidateListingId }) => candidateListingId,
      ),
    ).toContain(listing.candidateListingId);
    expect(
      rejected.action.kind === "search"
        ? rejected.action.search?.listings.map(
            ({ candidateListingId }) => candidateListingId,
          )
        : [],
    ).not.toContain(listing.candidateListingId);
    expect(rejected.brief).toEqual(view.brief);
    expect(evidenceProvider.calls).toHaveLength(0);
    await expect(
      setLiveListingSaved({
        dependencies,
        input: {
          operation: "save_listing",
          sessionId,
          candidateListingId: listing.candidateListingId,
        },
      }),
    ).rejects.toBeInstanceOf(RejectedListingCannotBeSavedError);

    await setLiveListingRejected({
      dependencies,
      input: {
        operation: "reject_listing",
        sessionId,
        candidateListingId: listing.candidateListingId,
      },
    });
    expect(
      await connection.db
        .select()
        .from(rejectedCandidateListings)
        .where(
          and(
            eq(rejectedCandidateListings.taskId, session.taskId),
            eq(
              rejectedCandidateListings.candidateListingId,
              listing.candidateListingId,
            ),
          ),
        ),
    ).toHaveLength(1);
    expect(
      await connection.db
        .select()
        .from(savedCandidateListings)
        .where(eq(savedCandidateListings.taskId, session.taskId)),
    ).toHaveLength(0);
    const refreshed = await loadLiveShoppingSession({
      db: connection.db,
      sessionId,
    });
    expect(refreshed.rejectedListings).toHaveLength(1);

    const restored = await setLiveListingRejected({
      dependencies,
      input: {
        operation: "undo_reject_listing",
        sessionId,
        candidateListingId: listing.candidateListingId,
      },
    });
    expect(restored.rejectedListings).toHaveLength(0);
    expect(restored.savedListings).toHaveLength(0);
    expect(
      restored.action.kind === "search"
        ? restored.action.search?.listings.map(
            ({ candidateListingId }) => candidateListingId,
          )
        : [],
    ).toContain(listing.candidateListingId);
    const afterTask = await connection.db
      .select({ revision: shoppingTasks.currentRevision })
      .from(shoppingTasks)
      .where(eq(shoppingTasks.id, session.taskId));
    expect(afterTask).toEqual(beforeTask);
  });

  it("cannot reject a listing from another shopping task", async () => {
    const first = await createSession();
    const second = await createSession();
    await expect(
      setLiveListingRejected({
        dependencies: second.dependencies,
        input: {
          operation: "reject_listing",
          sessionId: second.sessionId,
          candidateListingId: first.listing.candidateListingId,
        },
      }),
    ).rejects.toBeInstanceOf(SavedListingNotAvailableError);
    await expect(
      researchLiveCandidate({
        dependencies: second.dependencies,
        input: {
          operation: "research_candidate",
          sessionId: second.sessionId,
          candidateListingId: first.listing.candidateListingId,
        },
      }),
    ).rejects.toBeInstanceOf(SavedListingNotAvailableError);
    expect(second.evidenceProvider.calls).toHaveLength(0);
  });

  it("caps one task at four saved listings while keeping exact retries idempotent", async () => {
    const current = await createSession();
    const rows = await connection.db
      .select()
      .from(candidateListings)
      .where(eq(candidateListings.taskId, current.session.taskId));
    const seed = rows[0];
    if (seed === undefined) throw new Error("Expected a candidate seed row");
    const extraIds = Array.from({ length: 4 }, () => randomUUID());
    await connection.db.insert(candidateListings).values(
      extraIds.map((id, index) => ({
        ...seed,
        id,
        providerResultId: `save-limit-${index}`,
        sourceRank: seed.sourceRank + index + 10,
        title: `Save-limit candidate ${index + 1}`,
        url: `https://example.test/save-limit-${index + 1}`,
        canonicalUrl: `https://example.test/save-limit-${index + 1}`,
        merchantDestinationUrl: `https://example.test/save-limit-${index + 1}`,
      })),
    );
    const initiallySavedIds = [
      current.listing.candidateListingId,
      ...extraIds.slice(0, 2),
    ];
    for (const candidateListingId of initiallySavedIds) {
      await saveCandidateListing({
        db: connection.db,
        taskId: current.session.taskId,
        candidateListingId,
      });
    }
    const writer = createTestDatabaseConnection("saved-limit-writer");
    try {
      const contenders = extraIds.slice(2, 4);
      const results = await Promise.allSettled([
        saveCandidateListing({
          db: connection.db,
          taskId: current.session.taskId,
          candidateListingId: contenders[0],
        }),
        saveCandidateListing({
          db: writer.db,
          taskId: current.session.taskId,
          candidateListingId: contenders[1],
        }),
      ]);
      expect(
        results.filter(({ status }) => status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = results.find(({ status }) => status === "rejected");
      expect(rejected).toMatchObject({
        status: "rejected",
        reason: expect.any(SavedListingLimitReachedError),
      });
      const winnerIndex = results.findIndex(
        ({ status }) => status === "fulfilled",
      );
      await expect(
        saveCandidateListing({
          db: connection.db,
          taskId: current.session.taskId,
          candidateListingId: contenders[winnerIndex],
        }),
      ).resolves.toMatchObject({ created: false });
    } finally {
      await writer.close();
    }
    expect(
      await connection.db
        .select()
        .from(savedCandidateListings)
        .where(eq(savedCandidateListings.taskId, current.session.taskId)),
    ).toHaveLength(4);
  });
});
