import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  contextActionIdSchema,
  shoppingTaskIdSchema,
} from "@/domain/shopping-state/ids";
import type {
  ShoppingDatabase,
  ShoppingTransaction,
} from "@/infrastructure/database/clients";
import { searchRuns, shoppingTasks } from "@/infrastructure/database/schema";
import { loadRetrievalContextFromPersistedState } from "./context-from-persisted-state";
import {
  shoppingProviderSchema,
  type ShoppingSearchProvider,
} from "./contracts";
import { executeSearchQuery } from "./execution";
import {
  loadPersistedSearchRunByTrigger,
  loadPersistedSearchRunInTransaction,
  persistSearchPlan,
  recordSearchQueryExecutionInTransaction,
  SearchRunNotFoundError,
  SearchTriggerConflictError,
} from "./persistence/search-runs";
import type { PersistedSearchRun } from "./persistence/contracts";
import { buildSearchQueryPortfolio } from "./query-strategy";

const DEFAULT_LEASE_DURATION_MS = 60_000;
const MINIMUM_LEASE_MARGIN_MS = 5_000;
const leaseTokenSchema = z.uuid().brand<"SearchRunLeaseToken">();

export class StaleSearchRunAuthorityError extends Error {
  constructor(
    readonly runId: string,
    readonly runRevision: bigint,
    readonly currentRevision: bigint,
  ) {
    super(
      `Search run ${runId} belongs to revision ${runRevision}, but the task is at revision ${currentRevision}`,
    );
    this.name = "StaleSearchRunAuthorityError";
  }
}

export class SearchRunLeaseLostError extends Error {
  constructor(readonly runId: string) {
    super(`The execution lease for search run ${runId} is no longer owned`);
    this.name = "SearchRunLeaseLostError";
  }
}

type RetrievalRunResult = Readonly<{
  state: "completed" | "in_progress";
  created: boolean;
  run: PersistedSearchRun;
}>;

type LeaseResult =
  | Readonly<{
      state: "acquired";
      token: ReturnType<typeof leaseTokenSchema.parse>;
      run: PersistedSearchRun;
    }>
  | Readonly<{ state: "in_progress" | "completed"; run: PersistedSearchRun }>;

function leaseDuration(
  value: number | undefined,
  providerMaxRequestDurationMs: number,
) {
  const providerMaximum = z
    .number()
    .int()
    .nonnegative()
    .max(4 * 60_000)
    .parse(providerMaxRequestDurationMs);
  return z
    .number()
    .int()
    .min(Math.max(1_000, providerMaximum + MINIMUM_LEASE_MARGIN_MS))
    .max(5 * 60_000)
    .parse(value ?? DEFAULT_LEASE_DURATION_MS);
}

async function databaseNow(tx: ShoppingTransaction) {
  const rows = await tx.execute(
    sql<{ now: Date }>`select clock_timestamp() as now`,
  );
  const [row] = rows;
  if (row === undefined) throw new Error("Database clock returned no value");
  return z.coerce.date().parse(row.now);
}

function assertCurrentRunAuthority(options: {
  run: PersistedSearchRun;
  currentRevision: bigint;
}) {
  const runRevision = options.run.portfolio.run.taskRevision;
  if (runRevision !== options.currentRevision) {
    throw new StaleSearchRunAuthorityError(
      options.run.portfolio.run.id,
      runRevision,
      options.currentRevision,
    );
  }
}

async function lockTaskAndRun(options: {
  tx: ShoppingTransaction;
  taskId: ReturnType<typeof shoppingTaskIdSchema.parse>;
  runId: string;
}) {
  const [task] = await options.tx
    .select({ currentRevision: shoppingTasks.currentRevision })
    .from(shoppingTasks)
    .where(eq(shoppingTasks.id, options.taskId))
    .for("share")
    .limit(1);
  if (task === undefined) throw new SearchRunNotFoundError(options.runId);

  const [runRow] = await options.tx
    .select({
      status: searchRuns.status,
      leaseToken: searchRuns.leaseToken,
      leaseExpiresAt: searchRuns.leaseExpiresAt,
    })
    .from(searchRuns)
    .where(
      and(
        eq(searchRuns.taskId, options.taskId),
        eq(searchRuns.id, options.runId),
      ),
    )
    .for("update")
    .limit(1);
  if (runRow === undefined) throw new SearchRunNotFoundError(options.runId);

  const run = await loadPersistedSearchRunInTransaction({
    tx: options.tx,
    taskId: options.taskId,
    runId: options.runId,
  });
  if (run === null) throw new SearchRunNotFoundError(options.runId);
  return { task, runRow, run };
}

async function claimSearchRun(options: {
  db: ShoppingDatabase;
  taskId: ReturnType<typeof shoppingTaskIdSchema.parse>;
  runId: string;
  durationMs: number;
  createToken: () => string;
}): Promise<LeaseResult> {
  return options.db.transaction(async (tx) => {
    const locked = await lockTaskAndRun({
      tx,
      taskId: options.taskId,
      runId: options.runId,
    });
    if (locked.run.status !== "running") {
      return { state: "completed", run: locked.run };
    }
    assertCurrentRunAuthority({
      run: locked.run,
      currentRevision: locked.task.currentRevision,
    });
    const now = await databaseNow(tx);
    if (
      locked.runRow.leaseToken !== null &&
      locked.runRow.leaseExpiresAt !== null &&
      locked.runRow.leaseExpiresAt > now
    ) {
      return { state: "in_progress", run: locked.run };
    }

    const token = leaseTokenSchema.parse(options.createToken());
    await tx
      .update(searchRuns)
      .set({
        leaseToken: token,
        leaseExpiresAt: new Date(now.getTime() + options.durationMs),
      })
      .where(
        and(
          eq(searchRuns.taskId, options.taskId),
          eq(searchRuns.id, options.runId),
        ),
      );
    return { state: "acquired", token, run: locked.run };
  });
}

async function renewSearchRunLease(options: {
  db: ShoppingDatabase;
  taskId: ReturnType<typeof shoppingTaskIdSchema.parse>;
  runId: string;
  token: ReturnType<typeof leaseTokenSchema.parse>;
  durationMs: number;
}) {
  return options.db.transaction(async (tx) => {
    const locked = await lockTaskAndRun({
      tx,
      taskId: options.taskId,
      runId: options.runId,
    });
    if (locked.runRow.leaseToken !== options.token) {
      throw new SearchRunLeaseLostError(options.runId);
    }
    if (locked.run.status !== "running") return locked.run;
    assertCurrentRunAuthority({
      run: locked.run,
      currentRevision: locked.task.currentRevision,
    });
    const now = await databaseNow(tx);
    await tx
      .update(searchRuns)
      .set({ leaseExpiresAt: new Date(now.getTime() + options.durationMs) })
      .where(
        and(
          eq(searchRuns.taskId, options.taskId),
          eq(searchRuns.id, options.runId),
        ),
      );
    return locked.run;
  });
}

async function recordLeasedQueryResult(options: {
  db: ShoppingDatabase;
  taskId: ReturnType<typeof shoppingTaskIdSchema.parse>;
  runId: string;
  token: ReturnType<typeof leaseTokenSchema.parse>;
  execution: Awaited<ReturnType<typeof executeSearchQuery>>;
  startedAt: Date;
  finishedAt: Date;
}) {
  return options.db.transaction(async (tx) => {
    const locked = await lockTaskAndRun({
      tx,
      taskId: options.taskId,
      runId: options.runId,
    });
    if (locked.runRow.leaseToken !== options.token) {
      throw new SearchRunLeaseLostError(options.runId);
    }
    if (locked.run.status !== "running") return locked.run;
    return (
      await recordSearchQueryExecutionInTransaction({
        tx,
        execution: options.execution,
        startedAt: options.startedAt,
        finishedAt: options.finishedAt,
        expectedLeaseToken: options.token,
      })
    ).run;
  });
}

async function releaseSearchRunLease(options: {
  db: ShoppingDatabase;
  taskId: ReturnType<typeof shoppingTaskIdSchema.parse>;
  runId: string;
  token: ReturnType<typeof leaseTokenSchema.parse>;
}) {
  await options.db
    .update(searchRuns)
    .set({ leaseToken: null, leaseExpiresAt: null })
    .where(
      and(
        eq(searchRuns.taskId, options.taskId),
        eq(searchRuns.id, options.runId),
        eq(searchRuns.status, "running"),
        eq(searchRuns.leaseToken, options.token),
      ),
    );
}

export async function prepareRetrievalRun(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  contextActionId: unknown;
  provider: ShoppingSearchProvider;
  now?: () => Date;
  createPortfolioId?: () => string;
}): Promise<{ created: boolean; run: PersistedSearchRun }> {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const contextActionId = contextActionIdSchema.parse(options.contextActionId);
  const provider = shoppingProviderSchema.parse(options.provider.provider);
  const existing = await loadPersistedSearchRunByTrigger({
    db: options.db,
    taskId,
    contextActionId,
  });
  if (existing !== null) {
    if (existing.status === "running" && existing.provider !== provider) {
      throw new SearchTriggerConflictError(contextActionId);
    }
    return { created: false, run: existing };
  }

  const authority = await loadRetrievalContextFromPersistedState({
    db: options.db,
    taskId,
    contextActionId,
  });
  const portfolio = buildSearchQueryPortfolio(authority.context, {
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.createPortfolioId === undefined
      ? {}
      : { createId: options.createPortfolioId }),
  });
  return persistSearchPlan({
    db: options.db,
    contextActionId,
    provider,
    portfolio,
  });
}

/**
 * Executes or resumes the one logical run owned by a persisted SEARCH action.
 * The lease fences healthy concurrent retries without holding a transaction
 * across provider I/O. After a process crash, expiry permits takeover and only
 * queries without terminal receipts are called again.
 */
export async function executeOrResumeRetrieval(options: {
  db: ShoppingDatabase;
  taskId: unknown;
  contextActionId: unknown;
  provider: ShoppingSearchProvider;
  clock?: () => Date;
  createPortfolioId?: () => string;
  createLeaseToken?: () => string;
  leaseDurationMs?: number;
}): Promise<RetrievalRunResult> {
  const taskId = shoppingTaskIdSchema.parse(options.taskId);
  const contextActionId = contextActionIdSchema.parse(options.contextActionId);
  const clock = options.clock ?? (() => new Date());
  const durationMs = leaseDuration(
    options.leaseDurationMs,
    options.provider.maxRequestDurationMs,
  );
  const prepared = await prepareRetrievalRun({
    db: options.db,
    taskId,
    contextActionId,
    provider: options.provider,
    now: clock,
    ...(options.createPortfolioId === undefined
      ? {}
      : { createPortfolioId: options.createPortfolioId }),
  });
  if (prepared.run.status !== "running") {
    return { state: "completed", created: prepared.created, run: prepared.run };
  }

  const claim = await claimSearchRun({
    db: options.db,
    taskId,
    runId: prepared.run.portfolio.run.id,
    durationMs,
    createToken: options.createLeaseToken ?? randomUUID,
  });
  if (claim.state !== "acquired") {
    return {
      state: claim.state,
      created: prepared.created,
      run: claim.run,
    };
  }

  let currentRun = claim.run;
  let providerCallMayBeUnrecorded = false;
  try {
    for (const query of currentRun.portfolio.queries) {
      currentRun = await renewSearchRunLease({
        db: options.db,
        taskId,
        runId: currentRun.portfolio.run.id,
        token: claim.token,
        durationMs,
      });
      if (currentRun.status !== "running") break;
      if (
        currentRun.queryExecutions.some(
          (execution) => execution.queryId === query.id,
        )
      ) {
        continue;
      }

      const startedAt = clock();
      providerCallMayBeUnrecorded = true;
      const execution = await executeSearchQuery({
        query,
        provider: options.provider,
      });
      currentRun = await recordLeasedQueryResult({
        db: options.db,
        taskId,
        runId: currentRun.portfolio.run.id,
        token: claim.token,
        execution,
        startedAt,
        finishedAt: clock(),
      });
      providerCallMayBeUnrecorded = false;
    }
  } catch (error) {
    if (!providerCallMayBeUnrecorded) {
      await releaseSearchRunLease({
        db: options.db,
        taskId,
        runId: currentRun.portfolio.run.id,
        token: claim.token,
      });
    }
    throw error;
  }

  if (currentRun.status === "running") {
    await releaseSearchRunLease({
      db: options.db,
      taskId,
      runId: currentRun.portfolio.run.id,
      token: claim.token,
    });
  }
  return {
    state: currentRun.status === "running" ? "in_progress" : "completed",
    created: prepared.created,
    run: currentRun,
  };
}
