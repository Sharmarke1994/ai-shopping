import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  formatBriefItem,
  projectShoppingBrief,
} from "@/domain/shopping-state/brief";
import {
  shoppingTaskIdSchema,
  taskInputIdSchema,
} from "@/domain/shopping-state/ids";
import type { ContextAcquisitionModel } from "@/features/context-acquisition/model-port";
import { acquireShoppingContext } from "@/features/context-acquisition/coordinator";
import { recordContextActionAnswer } from "@/features/context-acquisition/persistence/context-action-answers";
import {
  loadContextActionByApplication,
  loadContextActionByIdInTransaction,
  type PersistedContextAction,
} from "@/features/context-acquisition/persistence/context-actions";
import type { ShoppingSearchProvider } from "@/features/retrieval-spike/contracts";
import type { EvidenceResearchDependencies } from "@/features/product-understanding/research-orchestrator";
import { executeOrResumeEvidenceResearch } from "@/features/product-understanding/research-orchestrator";
import { loadCurrentDecisionSupportInTransaction } from "@/features/product-understanding/persistence";
import { buildDecisionSupport } from "@/features/product-understanding/decision-support";
import { loadPersistedSearchRunByTrigger } from "@/features/retrieval-spike/persistence/search-runs";
import {
  loadShoppingSubjectInTransaction,
  recordInitialShoppingSubject,
} from "@/features/retrieval-spike/persistence/shopping-subjects";
import { executeOrResumeRetrieval } from "@/features/retrieval-spike/retrieval-orchestrator";
import { loadCurrentShoppingState } from "@/features/shopping-state/persistence/state-loaders";
import { recordTaskInput } from "@/features/shopping-state/persistence/inputs-and-messages";
import { loadValidatedStateApplicationBySourceInput } from "@/features/shopping-state/persistence/state-transitions";
import { mapTaskInput } from "@/features/shopping-state/persistence/mappers";
import type {
  ShoppingDatabase,
  ShoppingTransaction,
} from "@/infrastructure/database/clients";
import {
  contextActionAnswers,
  candidateListings,
  founderLiveSessions,
  savedCandidateListings,
  shoppingTasks,
  taskInputs,
} from "@/infrastructure/database/schema";
import {
  answerLiveShoppingRequestSchema,
  liveSessionIdSchema,
  liveShoppingViewSchema,
  refineLiveShoppingRequestSchema,
  researchLiveShoppingRequestSchema,
  saveLiveListingRequestSchema,
  startLiveShoppingRequestSchema,
  type LiveShoppingView,
} from "./contracts";
import { triageListingAgainstHardCriteria } from "./hard-constraint-triage";
import { summarizeListingEvidence } from "./listing-evidence";
import {
  loadSavedCandidateListingsInTransaction,
  saveCandidateListing,
  unsaveCandidateListing,
} from "./saved-listings";

const sessionRowSchema = z.strictObject({
  id: liveSessionIdSchema,
  taskId: shoppingTaskIdSchema,
  initialTurnId: z.uuid(),
  initialRequestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  currentContextActionId: z.uuid().nullable(),
  pendingTaskInputId: taskInputIdSchema.nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

type SessionRow = z.infer<typeof sessionRowSchema>;

export type LiveShoppingDependencies = Readonly<{
  db: ShoppingDatabase;
  model: ContextAcquisitionModel;
  provider: ShoppingSearchProvider;
  research?: Omit<EvidenceResearchDependencies, "db">;
}>;

export class LiveShoppingSessionNotFoundError extends Error {
  constructor(readonly sessionId: string) {
    super("This shopping session could not be found");
    this.name = "LiveShoppingSessionNotFoundError";
  }
}

export class LiveShoppingRetryConflictError extends Error {
  constructor() {
    super("This retry does not match the original shopping turn");
    this.name = "LiveShoppingRetryConflictError";
  }
}

export class LiveShoppingQuestionUnavailableError extends Error {
  constructor() {
    super("There is no current question to answer");
    this.name = "LiveShoppingQuestionUnavailableError";
  }
}

export class LiveShoppingSearchUnavailableError extends Error {
  constructor() {
    super("This shopping session is not ready to search");
    this.name = "LiveShoppingSearchUnavailableError";
  }
}

function initialFingerprint(input: { turnId: string; message: string }) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        message: input.message,
        turnId: input.turnId,
      }),
      "utf8",
    )
    .digest("hex");
}

function clientActionId(turnId: string) {
  return `live:${turnId}`;
}

async function loadSessionInTransaction(options: {
  tx: ShoppingTransaction;
  sessionId: unknown;
  forUpdate?: boolean;
}): Promise<SessionRow> {
  const sessionId = liveSessionIdSchema.parse(options.sessionId);
  const query = options.tx
    .select()
    .from(founderLiveSessions)
    .where(eq(founderLiveSessions.id, sessionId))
    .limit(1);
  const rows = options.forUpdate ? await query.for("update") : await query;
  if (rows[0] === undefined) {
    throw new LiveShoppingSessionNotFoundError(sessionId);
  }
  return sessionRowSchema.parse(rows[0]);
}

async function ensureSession(options: {
  db: ShoppingDatabase;
  sessionId: string;
  turnId: string;
  message: string;
}) {
  const fingerprint = initialFingerprint(options);
  return options.db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${options.sessionId}::text, 0))`,
    );
    const [existing] = await tx
      .select()
      .from(founderLiveSessions)
      .where(eq(founderLiveSessions.id, options.sessionId))
      .limit(1);
    if (existing !== undefined) {
      const parsed = sessionRowSchema.parse(existing);
      if (
        parsed.initialTurnId !== options.turnId ||
        parsed.initialRequestFingerprint !== fingerprint
      ) {
        throw new LiveShoppingRetryConflictError();
      }
      return parsed;
    }

    const taskId = shoppingTaskIdSchema.parse(randomUUID());
    await tx.insert(shoppingTasks).values({
      id: taskId,
      marketCountry: "GB",
      languageTag: "en-GB",
      currencyCode: "GBP",
    });
    const [created] = await tx
      .insert(founderLiveSessions)
      .values({
        id: options.sessionId,
        taskId,
        initialTurnId: options.turnId,
        initialRequestFingerprint: fingerprint,
      })
      .returning();
    if (created === undefined)
      throw new Error("Session insert returned no row");
    return sessionRowSchema.parse(created);
  });
}

async function markPendingInput(options: {
  db: ShoppingDatabase;
  sessionId: string;
  taskId: string;
  inputId: string;
}) {
  return options.db.transaction(async (tx) => {
    const session = await loadSessionInTransaction({
      tx,
      sessionId: options.sessionId,
      forUpdate: true,
    });
    if (session.taskId !== options.taskId) {
      throw new LiveShoppingRetryConflictError();
    }
    if (
      session.pendingTaskInputId !== null &&
      session.pendingTaskInputId !== options.inputId
    ) {
      throw new LiveShoppingRetryConflictError();
    }
    await tx
      .update(founderLiveSessions)
      .set({ pendingTaskInputId: options.inputId, updatedAt: new Date() })
      .where(eq(founderLiveSessions.id, session.id));
  });
}

async function persistCurrentAction(options: {
  db: ShoppingDatabase;
  sessionId: string;
  taskId: string;
  sourceInputId: string;
  actionId: string;
}) {
  await options.db.transaction(async (tx) => {
    const session = await loadSessionInTransaction({
      tx,
      sessionId: options.sessionId,
      forUpdate: true,
    });
    if (
      session.taskId !== options.taskId ||
      session.pendingTaskInputId !== options.sourceInputId
    ) {
      throw new LiveShoppingRetryConflictError();
    }
    await tx
      .update(founderLiveSessions)
      .set({
        currentContextActionId: options.actionId,
        pendingTaskInputId: null,
        updatedAt: new Date(),
      })
      .where(eq(founderLiveSessions.id, session.id));
  });
}

async function executeCurrentSearch(options: {
  dependencies: LiveShoppingDependencies;
  session: SessionRow;
}) {
  if (options.session.currentContextActionId === null) {
    throw new LiveShoppingSearchUnavailableError();
  }
  const action = await options.dependencies.db.transaction((tx) =>
    loadContextActionByIdInTransaction({
      tx,
      taskId: options.session.taskId,
      contextActionId: options.session.currentContextActionId!,
    }),
  );
  if (action?.action !== "search") {
    throw new LiveShoppingSearchUnavailableError();
  }
  await executeOrResumeRetrieval({
    db: options.dependencies.db,
    taskId: options.session.taskId,
    contextActionId: action.id,
    provider: options.dependencies.provider,
  });
}

async function completePendingContext(options: {
  dependencies: LiveShoppingDependencies;
  sessionId: string;
}): Promise<LiveShoppingView> {
  const session = await options.dependencies.db.transaction((tx) =>
    loadSessionInTransaction({
      tx,
      sessionId: options.sessionId,
      forUpdate: false,
    }),
  );
  if (session.pendingTaskInputId === null) {
    return loadLiveShoppingSession({
      db: options.dependencies.db,
      sessionId: session.id,
    });
  }
  const acquired = await acquireShoppingContext({
    db: options.dependencies.db,
    model: options.dependencies.model,
    taskId: session.taskId,
    sourceInputId: session.pendingTaskInputId,
  });
  if (acquired.status === "failed") {
    return loadLiveShoppingSession({
      db: options.dependencies.db,
      sessionId: session.id,
    });
  }
  await persistCurrentAction({
    db: options.dependencies.db,
    sessionId: session.id,
    taskId: session.taskId,
    sourceInputId: session.pendingTaskInputId,
    actionId: acquired.action.id,
  });
  const updated = await options.dependencies.db.transaction((tx) =>
    loadSessionInTransaction({ tx, sessionId: session.id }),
  );
  if (acquired.action.action === "search") {
    await executeCurrentSearch({
      dependencies: options.dependencies,
      session: updated,
    });
  }
  return loadLiveShoppingSession({
    db: options.dependencies.db,
    sessionId: session.id,
  });
}

export async function startLiveShopping(options: {
  dependencies: LiveShoppingDependencies;
  input: unknown;
}) {
  const input = startLiveShoppingRequestSchema.parse(options.input);
  const session = await ensureSession({
    db: options.dependencies.db,
    sessionId: input.sessionId,
    turnId: input.turnId,
    message: input.message,
  });
  const subject = await recordInitialShoppingSubject({
    db: options.dependencies.db,
    taskId: session.taskId,
    clientActionId: clientActionId(input.turnId),
    request: {
      inputSchemaVersion: 1,
      expectedRevision: 0n,
      kind: "message",
      body: input.message,
    },
  });

  const latest = await options.dependencies.db.transaction((tx) =>
    loadSessionInTransaction({ tx, sessionId: session.id }),
  );
  if (
    latest.currentContextActionId !== null &&
    latest.pendingTaskInputId === null
  ) {
    return loadLiveShoppingSession({
      db: options.dependencies.db,
      sessionId: session.id,
    });
  }
  await markPendingInput({
    db: options.dependencies.db,
    sessionId: session.id,
    taskId: session.taskId,
    inputId: subject.input.id,
  });
  return completePendingContext({
    dependencies: options.dependencies,
    sessionId: session.id,
  });
}

async function loadExistingTurn(options: {
  tx: ShoppingTransaction;
  taskId: string;
  turnId: string;
}) {
  const [row] = await options.tx
    .select()
    .from(taskInputs)
    .where(
      and(
        eq(taskInputs.taskId, options.taskId),
        eq(taskInputs.clientActionId, clientActionId(options.turnId)),
      ),
    )
    .limit(1);
  return row === undefined ? null : mapTaskInput(row);
}

function answerRequestForAction(
  action: Extract<PersistedContextAction, { action: "ask" }>,
  input: z.infer<typeof answerLiveShoppingRequestSchema>,
) {
  if (input.answer.mode !== action.question.responseMode) {
    throw new LiveShoppingRetryConflictError();
  }
  const answer =
    input.answer.mode === "open_text"
      ? input.answer
      : (() => {
          const option = action.question.options[input.answer.optionOrdinal];
          if (option === undefined) throw new LiveShoppingRetryConflictError();
          return { mode: "single_select" as const, optionId: option.id };
        })();
  return {
    inputSchemaVersion: 2 as const,
    expectedRevision: action.selectedAtRevision,
    kind: "question_answer" as const,
    questionId: action.id,
    answer,
  };
}

export async function answerLiveShoppingQuestion(options: {
  dependencies: LiveShoppingDependencies;
  input: unknown;
}) {
  const input = answerLiveShoppingRequestSchema.parse(options.input);
  const resolved = await options.dependencies.db.transaction(async (tx) => {
    const session = await loadSessionInTransaction({
      tx,
      sessionId: input.sessionId,
      forUpdate: false,
    });
    const existingInput = await loadExistingTurn({
      tx,
      taskId: session.taskId,
      turnId: input.turnId,
    });
    const actionId =
      existingInput?.inputPayload.kind === "question_answer" &&
      existingInput.inputPayload.schemaVersion === 2
        ? existingInput.inputPayload.questionId
        : session.currentContextActionId;
    if (actionId === null) throw new LiveShoppingQuestionUnavailableError();
    const action = await loadContextActionByIdInTransaction({
      tx,
      taskId: session.taskId,
      contextActionId: actionId,
    });
    if (action?.action !== "ask") {
      throw new LiveShoppingQuestionUnavailableError();
    }
    if (existingInput === null && session.pendingTaskInputId !== null) {
      throw new LiveShoppingRetryConflictError();
    }
    return { action, session };
  });

  const recorded = await recordContextActionAnswer({
    db: options.dependencies.db,
    taskId: resolved.session.taskId,
    clientActionId: clientActionId(input.turnId),
    request: answerRequestForAction(resolved.action, input),
  });
  await markPendingInput({
    db: options.dependencies.db,
    sessionId: resolved.session.id,
    taskId: resolved.session.taskId,
    inputId: recorded.input.id,
  });
  return completePendingContext({
    dependencies: options.dependencies,
    sessionId: resolved.session.id,
  });
}

export async function refineLiveShopping(options: {
  dependencies: LiveShoppingDependencies;
  input: unknown;
}) {
  const input = refineLiveShoppingRequestSchema.parse(options.input);
  const current = await options.dependencies.db.transaction(async (tx) => {
    const session = await loadSessionInTransaction({
      tx,
      sessionId: input.sessionId,
    });
    if (session.pendingTaskInputId !== null) {
      throw new LiveShoppingRetryConflictError();
    }
    const action =
      session.currentContextActionId === null
        ? null
        : await loadContextActionByIdInTransaction({
            tx,
            taskId: session.taskId,
            contextActionId: session.currentContextActionId,
          });
    if (action?.action !== "search" && action?.action !== "show_refine") {
      throw new LiveShoppingQuestionUnavailableError();
    }
    const state = await loadCurrentShoppingState(tx, session.taskId);
    const existingTurn = await loadExistingTurn({
      tx,
      taskId: session.taskId,
      turnId: input.turnId,
    });
    return { session, revision: state.task.currentRevision, existingTurn };
  });
  const recorded = await recordTaskInput({
    db: options.dependencies.db,
    taskId: current.session.taskId,
    clientActionId: clientActionId(input.turnId),
    request: {
      inputSchemaVersion: 1,
      expectedRevision:
        current.existingTurn?.expectedRevision ?? current.revision,
      kind: "message",
      body: input.message,
    },
  });
  if (!recorded.created) {
    const application = await loadValidatedStateApplicationBySourceInput(
      options.dependencies.db,
      current.session.taskId,
      recorded.input.id,
    );
    if (application !== null) {
      const action = await loadContextActionByApplication({
        db: options.dependencies.db,
        taskId: current.session.taskId,
        stateChangeApplicationId: application.application.id,
      });
      if (
        action !== null &&
        current.session.currentContextActionId === action.id
      ) {
        return loadLiveShoppingSession({
          db: options.dependencies.db,
          sessionId: current.session.id,
        });
      }
      if (
        action !== null &&
        current.session.currentContextActionId !== null &&
        current.session.updatedAt >= action.createdAt
      ) {
        return loadLiveShoppingSession({
          db: options.dependencies.db,
          sessionId: current.session.id,
        });
      }
    }
  }
  await markPendingInput({
    db: options.dependencies.db,
    sessionId: current.session.id,
    taskId: current.session.taskId,
    inputId: recorded.input.id,
  });
  return completePendingContext({
    dependencies: options.dependencies,
    sessionId: current.session.id,
  });
}

export async function setLiveListingSaved(options: {
  dependencies: Pick<LiveShoppingDependencies, "db">;
  input: unknown;
}) {
  const input = saveLiveListingRequestSchema.parse(options.input);
  const session = await options.dependencies.db.transaction((tx) =>
    loadSessionInTransaction({ tx, sessionId: input.sessionId }),
  );
  if (input.operation === "save_listing") {
    await saveCandidateListing({
      db: options.dependencies.db,
      taskId: session.taskId,
      candidateListingId: input.candidateListingId,
    });
  } else {
    await unsaveCandidateListing({
      db: options.dependencies.db,
      taskId: session.taskId,
      candidateListingId: input.candidateListingId,
    });
  }
  return loadLiveShoppingSession({
    db: options.dependencies.db,
    sessionId: session.id,
  });
}

export async function retryLiveShoppingContext(options: {
  dependencies: LiveShoppingDependencies;
  sessionId: unknown;
}) {
  const sessionId = liveSessionIdSchema.parse(options.sessionId);
  const recovery = await options.dependencies.db.transaction(async (tx) => {
    const session = await loadSessionInTransaction({ tx, sessionId });
    if (session.pendingTaskInputId !== null) {
      return null;
    }
    if (session.currentContextActionId !== null) {
      const action = await loadContextActionByIdInTransaction({
        tx,
        taskId: session.taskId,
        contextActionId: session.currentContextActionId,
      });
      if (action?.action !== "ask") return null;
      const [answer] = await tx
        .select({ inputId: contextActionAnswers.answerTaskInputId })
        .from(contextActionAnswers)
        .where(
          and(
            eq(contextActionAnswers.taskId, session.taskId),
            eq(contextActionAnswers.contextActionId, action.id),
          ),
        )
        .limit(1);
      return answer === undefined
        ? null
        : { taskId: session.taskId, inputId: answer.inputId };
    }
    const subject = await loadShoppingSubjectInTransaction({
      tx,
      taskId: session.taskId,
    });
    if (subject === null) throw new LiveShoppingSessionNotFoundError(sessionId);
    return {
      taskId: session.taskId,
      inputId: subject.sourceInputId,
    };
  });
  if (recovery !== null) {
    await markPendingInput({
      db: options.dependencies.db,
      sessionId,
      taskId: recovery.taskId,
      inputId: recovery.inputId,
    });
  }
  return completePendingContext({
    dependencies: options.dependencies,
    sessionId,
  });
}

export async function resumeLiveShoppingSearch(options: {
  dependencies: LiveShoppingDependencies;
  sessionId: unknown;
}) {
  const sessionId = liveSessionIdSchema.parse(options.sessionId);
  const session = await options.dependencies.db.transaction((tx) =>
    loadSessionInTransaction({ tx, sessionId }),
  );
  if (session.pendingTaskInputId !== null) {
    throw new LiveShoppingSearchUnavailableError();
  }
  await executeCurrentSearch({ dependencies: options.dependencies, session });
  return loadLiveShoppingSession({ db: options.dependencies.db, sessionId });
}

export async function researchLiveShopping(options: {
  dependencies: LiveShoppingDependencies;
  input: unknown;
}) {
  const input = researchLiveShoppingRequestSchema.parse(options.input);
  if (options.dependencies.research === undefined) {
    throw new LiveShoppingSearchUnavailableError();
  }
  const authority = await options.dependencies.db.transaction(async (tx) => {
    const session = await loadSessionInTransaction({
      tx,
      sessionId: input.sessionId,
    });
    if (session.currentContextActionId === null) {
      throw new LiveShoppingSearchUnavailableError();
    }
    const action = await loadContextActionByIdInTransaction({
      tx,
      taskId: session.taskId,
      contextActionId: session.currentContextActionId,
    });
    if (action?.action !== "search") {
      throw new LiveShoppingSearchUnavailableError();
    }
    const savedRuns = await tx
      .select({
        runId: candidateListings.runId,
        candidateListingId: candidateListings.id,
      })
      .from(savedCandidateListings)
      .innerJoin(
        candidateListings,
        and(
          eq(candidateListings.taskId, savedCandidateListings.taskId),
          eq(candidateListings.id, savedCandidateListings.candidateListingId),
        ),
      )
      .where(eq(savedCandidateListings.taskId, session.taskId));
    return {
      session,
      action,
      savedRuns,
    };
  });
  const currentRun = await loadPersistedSearchRunByTrigger({
    db: options.dependencies.db,
    taskId: authority.session.taskId,
    contextActionId: authority.action.id,
  });
  if (currentRun === null || currentRun.status === "running") {
    throw new LiveShoppingSearchUnavailableError();
  }
  const researchDependencies = {
    db: options.dependencies.db,
    ...options.dependencies.research,
  };
  await executeOrResumeEvidenceResearch({
    dependencies: researchDependencies,
    taskId: authority.session.taskId,
    searchRunId: currentRun.portfolio.run.id,
  });
  const historicalSaved = new Map<string, string[]>();
  for (const saved of authority.savedRuns) {
    if (saved.runId === currentRun.portfolio.run.id) continue;
    const ids = historicalSaved.get(saved.runId) ?? [];
    ids.push(saved.candidateListingId);
    historicalSaved.set(saved.runId, ids);
  }
  for (const [searchRunId, savedCandidateListingIds] of historicalSaved) {
    await executeOrResumeEvidenceResearch({
      dependencies: researchDependencies,
      taskId: authority.session.taskId,
      searchRunId,
      savedCandidateListingIds,
    });
  }
  return loadLiveShoppingSession({
    db: options.dependencies.db,
    sessionId: authority.session.id,
  });
}

function briefEmphasis(strength: "hard" | "strong_preference" | "preference") {
  return strength === "hard"
    ? ("must" as const)
    : strength === "strong_preference"
      ? ("strong" as const)
      : ("preference" as const);
}

function liveListingDto(options: {
  listing: NonNullable<
    Awaited<ReturnType<typeof loadPersistedSearchRunByTrigger>>
  >["listings"][number];
  brief: ReturnType<typeof projectShoppingBrief>;
  saved: boolean;
  foundAcrossQueries?: number;
}) {
  const listing = options.listing;
  const evidence = summarizeListingEvidence({
    brief: options.brief,
    listing,
  });
  return {
    candidateListingId: listing.id,
    displayId: createHash("sha256")
      .update(listing.id)
      .digest("hex")
      .slice(0, 16),
    title: listing.title,
    merchant: listing.merchant,
    priceText:
      listing.priceText ??
      (listing.price === null
        ? null
        : new Intl.NumberFormat("en-GB", {
            style: "currency",
            currency: "GBP",
          }).format(listing.price.amountMinor / 100)),
    imageUrl: listing.imageUrl,
    destinationUrl: listing.merchantDestinationUrl ?? listing.url,
    destinationLabel:
      listing.merchantDestinationUrl === null
        ? "View on Google Shopping"
        : `View at ${(listing.merchant ?? "retailer").slice(0, 100)}`,
    sourceUrl:
      listing.merchantDestinationUrl === null ||
      listing.merchantDestinationUrl === listing.url
        ? null
        : listing.url,
    sourceLabel:
      listing.merchantDestinationUrl === null ||
      listing.merchantDestinationUrl === listing.url
        ? null
        : ("View Google Shopping source" as const),
    deliveryText: listing.deliveryText,
    availabilityText: listing.availabilityText,
    foundAcrossQueries: options.foundAcrossQueries ?? 1,
    evidence: {
      sourceFacts: evidence.sourceFacts,
      directlyEvidenced: evidence.directlyEvidenced,
      contradictions: evidence.contradictions,
      unverifiedLabels: evidence.unverifiedLabels,
      additionalUnverifiedCount: evidence.additionalUnverifiedCount,
    },
    saved: options.saved,
  };
}

export function displayListings(
  run: NonNullable<Awaited<ReturnType<typeof loadPersistedSearchRunByTrigger>>>,
  options: {
    brief: ReturnType<typeof projectShoppingBrief>;
    savedListingIds: ReadonlySet<string>;
  },
) {
  const queryOrdinals = new Map(
    run.portfolio.queries.map((query, ordinal) => [query.id, ordinal]),
  );
  const orderedListings = [...run.listings].sort((left, right) => {
    const queryOrder =
      (queryOrdinals.get(left.queryId) ?? Number.MAX_SAFE_INTEGER) -
      (queryOrdinals.get(right.queryId) ?? Number.MAX_SAFE_INTEGER);
    if (queryOrder !== 0) return queryOrder;
    if (left.sourceRank !== right.sourceRank) {
      return left.sourceRank - right.sourceRank;
    }
    return (
      left.providerResultId.localeCompare(right.providerResultId) ||
      (left.merchant ?? "").localeCompare(right.merchant ?? "") ||
      left.canonicalUrl.localeCompare(right.canonicalUrl) ||
      left.id.localeCompare(right.id)
    );
  });
  const directlyConflicting = orderedListings.filter(
    (listing) =>
      triageListingAgainstHardCriteria({
        brief: options.brief,
        listing,
      }).hasDirectConflict,
  );
  const eligibleForPresentation = orderedListings.filter(
    (listing) => !directlyConflicting.includes(listing),
  );
  const grouped = new Map<
    string,
    {
      listing: (typeof run.listings)[number];
      queryIds: Set<string>;
    }
  >();
  for (const listing of eligibleForPresentation) {
    const key = JSON.stringify([
      listing.title.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB"),
      listing.merchant?.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB"),
      listing.priceText,
    ]);
    const existing = grouped.get(key);
    if (existing === undefined) {
      grouped.set(key, { listing, queryIds: new Set([listing.queryId]) });
    } else {
      existing.queryIds.add(listing.queryId);
      if (
        existing.listing.merchantDestinationUrl === null &&
        listing.merchantDestinationUrl !== null
      ) {
        existing.listing = listing;
      }
    }
  }
  const assessedGroups = [...grouped.values()]
    .map((group) => ({
      ...group,
      evidence: summarizeListingEvidence({
        brief: options.brief,
        listing: group.listing,
      }),
    }))
    .sort(
      (left, right) =>
        Number(right.evidence.hasDirectNonPriceSupport) -
          Number(left.evidence.hasDirectNonPriceSupport) ||
        right.queryIds.size - left.queryIds.size,
    );
  return {
    withheldConflictCount: directlyConflicting.length,
    listings: assessedGroups.map(({ listing, queryIds }) =>
      liveListingDto({
        listing,
        brief: options.brief,
        saved: options.savedListingIds.has(listing.id),
        foundAcrossQueries: queryIds.size,
      }),
    ),
  };
}

export async function loadLiveShoppingSession(options: {
  db: ShoppingDatabase;
  sessionId: unknown;
}): Promise<LiveShoppingView> {
  const sessionId = liveSessionIdSchema.parse(options.sessionId);
  const snapshot = await options.db.transaction(
    async (tx) => {
      const session = await loadSessionInTransaction({ tx, sessionId });
      const subject = await loadShoppingSubjectInTransaction({
        tx,
        taskId: session.taskId,
      });
      if (subject === null)
        throw new LiveShoppingSessionNotFoundError(sessionId);
      const state = await loadCurrentShoppingState(tx, session.taskId);
      const saved = await loadSavedCandidateListingsInTransaction({
        tx,
        taskId: session.taskId,
      });
      const action =
        session.currentContextActionId === null
          ? null
          : await loadContextActionByIdInTransaction({
              tx,
              taskId: session.taskId,
              contextActionId: session.currentContextActionId,
            });
      if (session.currentContextActionId !== null && action === null) {
        throw new Error("Live session current action is missing");
      }
      const answeredAskInputId =
        action?.action === "ask"
          ? ((
              await tx
                .select({ inputId: contextActionAnswers.answerTaskInputId })
                .from(contextActionAnswers)
                .where(
                  and(
                    eq(contextActionAnswers.taskId, session.taskId),
                    eq(contextActionAnswers.contextActionId, action.id),
                  ),
                )
                .limit(1)
            )[0]?.inputId ?? null)
          : null;
      const support = await loadCurrentDecisionSupportInTransaction({
        tx,
        taskId: session.taskId,
      });
      return {
        action,
        answeredAskInputId,
        brief: projectShoppingBrief(state),
        session,
        subject,
        support,
        saved,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  const run =
    snapshot.action?.action === "search"
      ? await loadPersistedSearchRunByTrigger({
          db: options.db,
          taskId: snapshot.session.taskId,
          contextActionId: snapshot.action.id,
        })
      : null;
  const savedListingIds = new Set(
    snapshot.saved.map(({ listing }) => listing.id),
  );
  const decision = buildDecisionSupport({
    support: snapshot.support,
    savedListingIds,
  });
  const decisionSupport = {
    researchStatus: decision.researchStatus,
    researchedCandidateCount: decision.researchedCandidateCount,
    topOptions: decision.topOptions.map((option) => ({
      listing: liveListingDto({
        listing: option.listing,
        brief: snapshot.brief,
        saved: savedListingIds.has(option.listing.id),
      }),
      strongestSupported: option.strongestSupported,
      whyItFits: option.whyItFits,
      watchouts: option.watchouts,
      unknowns: option.unknowns,
      evidenceSources: option.evidenceSources,
    })),
    comparison:
      decision.comparison === null
        ? null
        : {
            candidates: decision.comparison.candidates.map((listing) =>
              liveListingDto({
                listing,
                brief: snapshot.brief,
                saved: true,
              }),
            ),
            rows: decision.comparison.rows,
            judgement: decision.comparison.judgement,
          },
  };
  const common = {
    schemaVersion: 1 as const,
    sessionId,
    subject: snapshot.subject.body,
    brief: snapshot.brief.items.map((item) => ({
      label: item.conceptLabel,
      value: formatBriefItem(item, snapshot.brief.market),
      emphasis: briefEmphasis(item.strength),
    })),
    savedListings: snapshot.saved.map(({ listing }) =>
      liveListingDto({
        listing,
        brief: snapshot.brief,
        saved: true,
      }),
    ),
    decisionSupport,
  };
  if (snapshot.session.pendingTaskInputId !== null) {
    return liveShoppingViewSchema.parse({
      ...common,
      action: {
        kind: "understanding_failed",
        notice:
          "We couldn't finish understanding that turn. Your shopping state is safe.",
        retryable: true,
      },
    });
  }
  if (snapshot.answeredAskInputId !== null) {
    return liveShoppingViewSchema.parse({
      ...common,
      action: {
        kind: "understanding_failed",
        notice: "Your answer is saved. Continue to finish updating the brief.",
        retryable: true,
      },
    });
  }
  if (snapshot.action === null) {
    return liveShoppingViewSchema.parse({
      ...common,
      action: {
        kind: "understanding_failed",
        notice:
          "We couldn't finish understanding that turn. Your shopping state is safe.",
        retryable: true,
      },
    });
  }
  if (snapshot.action.action === "ask") {
    return liveShoppingViewSchema.parse({
      ...common,
      action: {
        kind: "ask",
        notice: null,
        prompt: snapshot.action.question.prompt,
        whyNow: snapshot.action.question.whyNow,
        responseMode: snapshot.action.question.responseMode,
        options: snapshot.action.question.options.map(({ ordinal, label }) => ({
          ordinal,
          label,
        })),
      },
    });
  }
  if (snapshot.action.action === "show_refine") {
    return liveShoppingViewSchema.parse({
      ...common,
      action: {
        kind: "show_refine",
        notice:
          "This request needs a little more detail before a useful search.",
      },
    });
  }
  return liveShoppingViewSchema.parse({
    ...common,
    action: {
      kind: "search",
      notice:
        run?.status === "partial"
          ? "Some searches completed. These are the products we could retrieve."
          : run?.status === "failed"
            ? "The shopping search did not return usable products this time."
            : null,
      search:
        run === null
          ? null
          : (() => {
              const presented = displayListings(run, {
                brief: snapshot.brief,
                savedListingIds: new Set(
                  snapshot.saved.map(({ listing }) => listing.id),
                ),
              });
              return {
                status: run.status,
                queryCount: run.portfolio.queries.length,
                completedQueryCount: run.queryExecutions.length,
                withheldConflictCount: presented.withheldConflictCount,
                listings: presented.listings,
              };
            })(),
    },
  });
}
