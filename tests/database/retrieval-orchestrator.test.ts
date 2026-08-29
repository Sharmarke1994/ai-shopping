import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { persistContextAction } from "../../src/features/context-acquisition/persistence/context-actions";
import type {
  SearchQuery,
  ShoppingSearchProvider,
} from "../../src/features/retrieval-spike/contracts";
import { FakeShoppingProvider } from "../../src/features/retrieval-spike/fake-shopping-provider";
import {
  loadPersistedSearchRun,
  recordSearchQueryExecution,
  SearchRunExecutionLeaseError,
} from "../../src/features/retrieval-spike/persistence/search-runs";
import { recordInitialShoppingSubject } from "../../src/features/retrieval-spike/persistence/shopping-subjects";
import {
  executeOrResumeRetrieval,
  prepareRetrievalRun,
  StaleSearchRunAuthorityError,
} from "../../src/features/retrieval-spike/retrieval-orchestrator";
import { recordTaskInput } from "../../src/features/shopping-state/persistence/inputs-and-messages";
import { applyStatePatch } from "../../src/features/shopping-state/persistence/state-transitions";
import { createShoppingTask } from "../../src/features/shopping-state/persistence/tasks";
import {
  searchRuns,
  shoppingTasks,
} from "../../src/infrastructure/database/schema";
import {
  createTestDatabaseConnection,
  resetShoppingState,
  type TestDatabaseConnection,
  waitForDatabaseLock,
} from "./helpers";

const actionConfig = {
  provider: "fake",
  model: "deterministic-retrieval-orchestrator",
  promptVersion: "test-v1",
  providerSchemaVersion: 1,
} as const;

const baseTime = new Date("2026-08-24T12:00:00.000Z");

const reverseLexicalPortfolioIds = [
  "90000000-0000-4000-8000-000000000001",
  "91000000-0000-4000-8000-000000000002",
  "f0000000-0000-4000-8000-000000000003",
  "92000000-0000-4000-8000-000000000004",
  "b0000000-0000-4000-8000-000000000005",
  "93000000-0000-4000-8000-000000000006",
  "10000000-0000-4000-8000-000000000007",
] as const;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function tickingClock(start = baseTime) {
  let tick = 0;
  return () => new Date(start.getTime() + tick++ * 100);
}

function countingProvider(
  options: {
    beforeSearch?: (query: SearchQuery, callIndex: number) => Promise<void>;
  } = {},
) {
  const fake = new FakeShoppingProvider(
    () => new Date("2026-08-24T12:00:30.000Z"),
  );
  const calls: SearchQuery[] = [];
  const provider: ShoppingSearchProvider = {
    provider: "fixture",
    maxRequestDurationMs: 0,
    search: async (query) => {
      calls.push(query);
      await options.beforeSearch?.(query, calls.length - 1);
      return fake.search(query);
    },
  };
  return { calls, provider };
}

async function waitForPersistedQueryCount(options: {
  connection: TestDatabaseConnection;
  taskId: string;
  runId: string;
  expected: number;
}) {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const run = await loadPersistedSearchRun({
      db: options.connection.db,
      taskId: options.taskId,
      runId: options.runId,
    });
    if (run?.queryExecutions.length === options.expected) return run;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `Timed out waiting for ${options.expected} persisted query receipts`,
  );
}

describe("retrieval orchestration", () => {
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

  async function authority() {
    const task = await createShoppingTask(connection.db);
    const subject = await recordInitialShoppingSubject({
      db: connection.db,
      taskId: task.id,
      clientActionId: `retrieval-subject-${task.id}`,
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 0n,
        kind: "message",
        body: "I need a light breathable cap for running in hot weather",
      },
    });
    const application = await applyStatePatch(connection.db, {
      applicationSchemaVersion: 1,
      applicationKind: "patch",
      taskId: task.id,
      expectedRevision: 0n,
      source: { kind: "user_explicit", inputId: subject.input.id },
      patch: {
        schemaVersion: 1,
        outcome: "change",
        operations: [
          {
            op: "create_concept",
            localRef: "breathability",
            label: "Breathability",
            definition: "How much airflow the cap provides in hot weather",
            valueFamily: "qualitative",
            canonicalUnit: null,
          },
          {
            op: "add_criterion",
            concept: { kind: "created", localRef: "breathability" },
            target: {
              strength: "strong_preference",
              targetSemantics: "qualitative",
              semanticValue: {
                schemaVersion: 1,
                kind: "qualitative",
                mode: "text",
                text: "breathable in hot weather",
              },
            },
          },
          {
            op: "create_concept",
            localRef: "sweat_wicking",
            label: "Sweat wicking",
            definition: "How well the cap manages sweat during a run",
            valueFamily: "qualitative",
            canonicalUnit: null,
          },
          {
            op: "add_criterion",
            concept: { kind: "created", localRef: "sweat_wicking" },
            target: {
              strength: "preference",
              targetSemantics: "qualitative",
              semanticValue: {
                schemaVersion: 1,
                kind: "qualitative",
                mode: "text",
                text: "wick sweat during a run",
              },
            },
          },
        ],
      },
    });
    const action = await persistContextAction({
      db: connection.db,
      taskId: task.id,
      stateChangeApplicationId: application.application.id,
      selectedAtRevision: 1n,
      proposal: {
        schemaVersion: 1,
        action: "search",
        rationale: { summary: "The authoritative brief is ready to search." },
      },
      config: actionConfig,
    });
    return { action: action.action, application, subject, task };
  }

  it("returns the same completed run after a lost caller response without repeating provider calls", async () => {
    const { action, task } = await authority();
    const counted = countingProvider();
    const clock = tickingClock();

    const first = await executeOrResumeRetrieval({
      db: connection.db,
      taskId: task.id,
      contextActionId: action.id,
      provider: counted.provider,
      clock,
    });
    const callsAfterFirstResponse = counted.calls.length;

    const retry = await executeOrResumeRetrieval({
      db: connection.db,
      taskId: task.id,
      contextActionId: action.id,
      provider: counted.provider,
      clock,
    });

    expect(first.state).toBe("completed");
    expect(first.created).toBe(true);
    expect(first.run.status).toBe("succeeded");
    expect(callsAfterFirstResponse).toBe(first.run.portfolio.queries.length);
    expect(first.timings).toMatchObject({
      schemaVersion: 1,
      providerLogicalCallCount: callsAfterFirstResponse,
      transportAttemptCount: null,
      durationSemantics: "non_additive_monotonic_wall_intervals",
      providerCallSemantics:
        "logical_provider_port_invocations_transport_attempts_unobserved",
    });
    expect(first.timings.totalMs).toBeGreaterThanOrEqual(0);
    expect(retry).toMatchObject({
      state: "completed",
      created: false,
      run: { status: "succeeded" },
      timings: { providerLogicalCallCount: 0, transportAttemptCount: null },
    });
    expect(retry.run.portfolio.run.id).toBe(first.run.portfolio.run.id);
    expect(retry.run.queryExecutions).toEqual(first.run.queryExecutions);
    expect(counted.calls).toHaveLength(callsAfterFirstResponse);
  });

  it("fences a concurrent exact retry so each provider query is issued once", async () => {
    const { action, task } = await authority();
    const firstConnection = createTestDatabaseConnection(
      "retrieval_orchestrator_first",
    );
    const retryConnection = createTestDatabaseConnection(
      "retrieval_orchestrator_retry",
    );
    const firstProviderCallStarted = deferred();
    const allowFirstProviderCallToFinish = deferred();
    const counted = countingProvider({
      beforeSearch: async (_query, callIndex) => {
        if (callIndex === 0) firstProviderCallStarted.resolve();
        await allowFirstProviderCallToFinish.promise;
      },
    });
    const clock = tickingClock();

    try {
      const firstAttempt = executeOrResumeRetrieval({
        db: firstConnection.db,
        taskId: task.id,
        contextActionId: action.id,
        provider: counted.provider,
        clock,
      });
      await firstProviderCallStarted.promise;

      const concurrentRetry = await executeOrResumeRetrieval({
        db: retryConnection.db,
        taskId: task.id,
        contextActionId: action.id,
        provider: counted.provider,
        clock,
      });

      expect(concurrentRetry.state).toBe("in_progress");
      expect(concurrentRetry.created).toBe(false);
      expect(counted.calls.length).toBeGreaterThanOrEqual(1);
      expect(counted.calls.length).toBeLessThanOrEqual(3);
      const missingQuery = concurrentRetry.run.portfolio.queries[1];
      if (missingQuery === undefined) throw new Error("Expected another query");
      await expect(
        recordSearchQueryExecution({
          db: retryConnection.db,
          execution: {
            status: "failed",
            query: missingQuery,
            errorCode: "provider_failed",
            error: "Unleased writers must not bypass the active owner",
          },
          startedAt: baseTime,
          finishedAt: new Date(baseTime.getTime() + 1),
        }),
      ).rejects.toBeInstanceOf(SearchRunExecutionLeaseError);

      allowFirstProviderCallToFinish.resolve();
      const completed = await firstAttempt;

      expect(completed.state).toBe("completed");
      expect(completed.run.status).toBe("succeeded");
      expect(concurrentRetry.run.portfolio.run.id).toBe(
        completed.run.portfolio.run.id,
      );
      expect(new Set(counted.calls.map((query) => query.id))).toEqual(
        new Set(completed.run.portfolio.queries.map((query) => query.id)),
      );
      expect(new Set(counted.calls.map((query) => query.id)).size).toBe(
        counted.calls.length,
      );
    } finally {
      allowFirstProviderCallToFinish.resolve();
      await Promise.all([firstConnection.close(), retryConnection.close()]);
    }
  });

  it("runs three missing queries concurrently, persists each completion immediately, and returns portfolio order", async () => {
    const { action, task } = await authority();
    let idCursor = 0;
    const prepared = await prepareRetrievalRun({
      db: connection.db,
      taskId: task.id,
      contextActionId: action.id,
      provider: countingProvider().provider,
      now: tickingClock(),
      createPortfolioId: () => reverseLexicalPortfolioIds[idCursor++]!,
    });
    expect(prepared.run.portfolio.queries).toHaveLength(3);

    const gates = new Map(
      prepared.run.portfolio.queries.map((query) => [query.id, deferred()]),
    );
    const allProviderCallsStarted = deferred();
    let active = 0;
    let maximumActive = 0;
    const counted = countingProvider({
      beforeSearch: async (query) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        if (active === prepared.run.portfolio.queries.length) {
          allProviderCallsStarted.resolve();
        }
        const gate = gates.get(query.id);
        if (gate === undefined) throw new Error("Unexpected provider query");
        await gate.promise;
        active -= 1;
      },
    });
    let orchestrationSettled = false;
    const orchestration = executeOrResumeRetrieval({
      db: connection.db,
      taskId: task.id,
      contextActionId: action.id,
      provider: counted.provider,
      clock: tickingClock(new Date("2026-08-24T12:00:01.000Z")),
    }).finally(() => {
      orchestrationSettled = true;
    });

    try {
      await allProviderCallsStarted.promise;
      expect(maximumActive).toBe(3);
      expect(counted.calls).toHaveLength(3);

      const lastQuery = prepared.run.portfolio.queries[2];
      if (lastQuery === undefined) throw new Error("Expected a third query");
      gates.get(lastQuery.id)?.resolve();
      const firstDurableCompletion = await waitForPersistedQueryCount({
        connection,
        taskId: task.id,
        runId: prepared.run.portfolio.run.id,
        expected: 1,
      });
      expect(orchestrationSettled).toBe(false);
      expect(firstDurableCompletion.status).toBe("running");
      expect(
        firstDurableCompletion.queryExecutions.map(({ queryId }) => queryId),
      ).toEqual([lastQuery.id]);
      expect(
        firstDurableCompletion.listings.map(({ queryId }) => queryId),
      ).toEqual([lastQuery.id]);

      const middleQuery = prepared.run.portfolio.queries[1];
      const firstQuery = prepared.run.portfolio.queries[0];
      if (middleQuery === undefined || firstQuery === undefined) {
        throw new Error("Expected a complete query portfolio");
      }
      gates.get(middleQuery.id)?.resolve();
      await waitForPersistedQueryCount({
        connection,
        taskId: task.id,
        runId: prepared.run.portfolio.run.id,
        expected: 2,
      });
      gates.get(firstQuery.id)?.resolve();
      const completed = await orchestration;

      const portfolioQueryIds = prepared.run.portfolio.queries.map(
        ({ id }) => id,
      );
      expect(completed).toMatchObject({
        state: "completed",
        created: false,
        run: { status: "succeeded" },
      });
      expect(
        completed.run.queryExecutions.map(({ queryId }) => queryId),
      ).toEqual(portfolioQueryIds);
      expect(completed.run.listings.map(({ queryId }) => queryId)).toEqual(
        portfolioQueryIds,
      );
      expect(new Set(counted.calls.map(({ id }) => id))).toEqual(
        new Set(portfolioQueryIds),
      );
    } finally {
      for (const gate of gates.values()) gate.resolve();
    }
  });

  it("elects one trigger-owned plan when concurrent creators generate different IDs", async () => {
    const { action, task } = await authority();
    const blockerConnection = createTestDatabaseConnection(
      "retrieval_plan_creation_blocker",
    );
    const firstConnection = createTestDatabaseConnection(
      "retrieval_plan_creator_first",
    );
    const secondConnection = createTestDatabaseConnection(
      "retrieval_plan_creator_second",
    );
    const taskLocked = deferred();
    const releaseTask = deferred();
    const blocker = blockerConnection.db.transaction(async (tx) => {
      await tx
        .select({ id: shoppingTasks.id })
        .from(shoppingTasks)
        .where(eq(shoppingTasks.id, task.id))
        .for("update");
      taskLocked.resolve();
      await releaseTask.promise;
    });

    try {
      await taskLocked.promise;
      const first = prepareRetrievalRun({
        db: firstConnection.db,
        taskId: task.id,
        contextActionId: action.id,
        provider: countingProvider().provider,
        now: tickingClock(),
        createPortfolioId: randomUUID,
      });
      const second = prepareRetrievalRun({
        db: secondConnection.db,
        taskId: task.id,
        contextActionId: action.id,
        provider: countingProvider().provider,
        now: tickingClock(new Date(baseTime.getTime() + 1_000)),
        createPortfolioId: randomUUID,
      });
      await waitForDatabaseLock({
        observer: connection,
        applicationNames: [
          "retrieval_plan_creator_first",
          "retrieval_plan_creator_second",
        ],
      });
      releaseTask.resolve();
      await blocker;
      const results = await Promise.all([first, second]);

      expect(results.map((result) => result.created).toSorted()).toEqual([
        false,
        true,
      ]);
      expect(results[0]?.run.portfolio.run.id).toBe(
        results[1]?.run.portfolio.run.id,
      );
      expect(results[0]?.run.portfolio).toEqual(results[1]?.run.portfolio);
    } finally {
      releaseTask.resolve();
      await blocker;
      await Promise.all([
        blockerConnection.close(),
        firstConnection.close(),
        secondConnection.close(),
      ]);
    }
  });

  it("resumes a partially receipted running run by calling only missing queries", async () => {
    const { action, task } = await authority();
    const planProvider = countingProvider();
    const prepared = await prepareRetrievalRun({
      db: connection.db,
      taskId: task.id,
      contextActionId: action.id,
      provider: planProvider.provider,
      now: tickingClock(),
    });
    const alreadyReceiptedQuery = prepared.run.portfolio.queries[0];
    if (alreadyReceiptedQuery === undefined) {
      throw new Error("Expected a planned query");
    }
    await recordSearchQueryExecution({
      db: connection.db,
      execution: {
        status: "failed",
        query: alreadyReceiptedQuery,
        errorCode: "provider_failed",
        error: "The first terminal attempt failed",
      },
      startedAt: new Date("2026-08-24T12:00:00.500Z"),
      finishedAt: new Date("2026-08-24T12:00:01.500Z"),
    });

    const counted = countingProvider();
    const resumed = await executeOrResumeRetrieval({
      db: connection.db,
      taskId: task.id,
      contextActionId: action.id,
      provider: counted.provider,
      clock: tickingClock(new Date("2026-08-24T12:00:02.000Z")),
    });
    const missingQueryIds = prepared.run.portfolio.queries
      .slice(1)
      .map((query) => query.id);

    expect(resumed.state).toBe("completed");
    expect(resumed.created).toBe(false);
    expect(resumed.run.status).toBe("partial");
    expect(new Set(counted.calls.map((query) => query.id))).toEqual(
      new Set(missingQueryIds),
    );
    expect(resumed.run.queryExecutions).toHaveLength(
      prepared.run.portfolio.queries.length,
    );
    expect(resumed.run.queryExecutions.map(({ queryId }) => queryId)).toEqual(
      prepared.run.portfolio.queries.map(({ id }) => id),
    );
  });

  it("persists an in-flight result as historical evidence but starts no later stale query", async () => {
    const { action, task } = await authority();
    const writer = createTestDatabaseConnection("retrieval_inflight_writer");
    const providerCallStarted = deferred();
    const allowProviderCallToFinish = deferred();
    const counted = countingProvider({
      beforeSearch: async (_query, callIndex) => {
        if (callIndex !== 0) return;
        providerCallStarted.resolve();
        await allowProviderCallToFinish.promise;
      },
    });
    const attempt = executeOrResumeRetrieval({
      db: connection.db,
      taskId: task.id,
      contextActionId: action.id,
      provider: counted.provider,
      clock: tickingClock(),
      queryConcurrency: 1,
    });

    try {
      await providerCallStarted.promise;
      const laterInput = await recordTaskInput({
        db: writer.db,
        taskId: task.id,
        clientActionId: `inflight-later-truth-${task.id}`,
        request: {
          inputSchemaVersion: 1,
          expectedRevision: 1n,
          kind: "message",
          body: "No white",
        },
      });
      await applyStatePatch(writer.db, {
        applicationSchemaVersion: 1,
        applicationKind: "patch",
        taskId: task.id,
        expectedRevision: 1n,
        source: { kind: "user_explicit", inputId: laterInput.input.id },
        patch: {
          schemaVersion: 1,
          outcome: "change",
          operations: [
            {
              op: "create_concept",
              localRef: "colour",
              label: "Colour",
              definition: "Colours the shopper excludes",
              valueFamily: "categorical",
              canonicalUnit: null,
            },
            {
              op: "add_criterion",
              concept: { kind: "created", localRef: "colour" },
              target: {
                strength: "hard",
                targetSemantics: "categorical",
                semanticValue: {
                  schemaVersion: 1,
                  kind: "categorical",
                  operator: "exclude",
                  values: ["white"],
                },
              },
            },
          ],
        },
      });
      allowProviderCallToFinish.resolve();

      await expect(attempt).rejects.toBeInstanceOf(
        StaleSearchRunAuthorityError,
      );
      expect(counted.calls).toHaveLength(1);
      const [calledQuery] = counted.calls;
      if (calledQuery === undefined) throw new Error("Expected one paid query");
      const stored = await loadPersistedSearchRun({
        db: connection.db,
        taskId: task.id,
        runId: calledQuery.runId,
      });
      expect(stored).toMatchObject({
        status: "running",
        queryExecutions: [{ queryId: calledQuery.id, status: "succeeded" }],
      });
      const [runRow] = await connection.db
        .select({
          leaseToken: searchRuns.leaseToken,
          leaseExpiresAt: searchRuns.leaseExpiresAt,
        })
        .from(searchRuns)
        .where(eq(searchRuns.id, calledQuery.runId));
      expect(runRow).toEqual({ leaseToken: null, leaseExpiresAt: null });
    } finally {
      allowProviderCallToFinish.resolve();
      await writer.close();
    }
  });

  it("rejects stale run authority before making any provider call", async () => {
    const { action, task } = await authority();
    const counted = countingProvider();
    const prepared = await prepareRetrievalRun({
      db: connection.db,
      taskId: task.id,
      contextActionId: action.id,
      provider: counted.provider,
      now: tickingClock(),
    });
    const laterInput = await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: `later-requirement-${task.id}`,
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 1n,
        kind: "message",
        body: "I would also prefer a low-profile shape",
      },
    });
    await applyStatePatch(connection.db, {
      applicationSchemaVersion: 1,
      applicationKind: "patch",
      taskId: task.id,
      expectedRevision: 1n,
      source: { kind: "user_explicit", inputId: laterInput.input.id },
      patch: {
        schemaVersion: 1,
        outcome: "change",
        operations: [
          {
            op: "create_concept",
            localRef: "profile",
            label: "Profile",
            definition: "How low-profile the cap shape should be",
            valueFamily: "qualitative",
            canonicalUnit: null,
          },
          {
            op: "add_criterion",
            concept: { kind: "created", localRef: "profile" },
            target: {
              strength: "preference",
              targetSemantics: "qualitative",
              semanticValue: {
                schemaVersion: 1,
                kind: "qualitative",
                mode: "text",
                text: "low-profile",
              },
            },
          },
        ],
      },
    });

    await expect(
      executeOrResumeRetrieval({
        db: connection.db,
        taskId: task.id,
        contextActionId: action.id,
        provider: counted.provider,
        clock: tickingClock(new Date("2026-08-24T12:01:00.000Z")),
      }),
    ).rejects.toMatchObject({
      name: StaleSearchRunAuthorityError.name,
      runId: prepared.run.portfolio.run.id,
      runRevision: 1n,
      currentRevision: 2n,
    });
    expect(counted.calls).toHaveLength(0);
  });

  it("takes over an expired lease and completes the still-running run", async () => {
    const { action, task } = await authority();
    const takeoverCallStarted = deferred();
    const allowTakeoverCallToFinish = deferred();
    const counted = countingProvider({
      beforeSearch: async (_query, callIndex) => {
        if (callIndex === 0) takeoverCallStarted.resolve();
        await allowTakeoverCallToFinish.promise;
      },
    });
    const prepared = await prepareRetrievalRun({
      db: connection.db,
      taskId: task.id,
      contextActionId: action.id,
      provider: counted.provider,
      now: tickingClock(),
    });
    await connection.db
      .update(searchRuns)
      .set({
        leaseToken: "00000000-0000-4000-8000-000000000001",
        leaseExpiresAt: sql`clock_timestamp() - interval '1 second'`,
      })
      .where(
        and(
          eq(searchRuns.taskId, task.id),
          eq(searchRuns.id, prepared.run.portfolio.run.id),
        ),
      );

    const takeoverAttempt = executeOrResumeRetrieval({
      db: connection.db,
      taskId: task.id,
      contextActionId: action.id,
      provider: counted.provider,
      clock: tickingClock(new Date("2026-08-24T12:00:01.000Z")),
      createLeaseToken: () => "00000000-0000-4000-8000-000000000002",
    });
    await takeoverCallStarted.promise;
    const staleOwnerQuery = prepared.run.portfolio.queries[1];
    if (staleOwnerQuery === undefined)
      throw new Error("Expected another query");
    try {
      await expect(
        recordSearchQueryExecution({
          db: connection.db,
          execution: {
            status: "failed",
            query: staleOwnerQuery,
            errorCode: "provider_failed",
            error: "The expired owner must remain fenced",
          },
          startedAt: baseTime,
          finishedAt: new Date(baseTime.getTime() + 1),
          expectedLeaseToken: "00000000-0000-4000-8000-000000000001",
        }),
      ).rejects.toBeInstanceOf(SearchRunExecutionLeaseError);
    } finally {
      allowTakeoverCallToFinish.resolve();
    }
    const takeover = await takeoverAttempt;

    expect(takeover.state).toBe("completed");
    expect(takeover.run.status).toBe("succeeded");
    expect(takeover.run.portfolio.run.id).toBe(prepared.run.portfolio.run.id);
    expect(counted.calls).toHaveLength(prepared.run.portfolio.queries.length);
    const [runRow] = await connection.db
      .select({
        leaseToken: searchRuns.leaseToken,
        leaseExpiresAt: searchRuns.leaseExpiresAt,
        currentRevision: shoppingTasks.currentRevision,
      })
      .from(searchRuns)
      .innerJoin(shoppingTasks, eq(shoppingTasks.id, searchRuns.taskId))
      .where(eq(searchRuns.id, prepared.run.portfolio.run.id));
    expect(runRow).toMatchObject({
      leaseToken: null,
      leaseExpiresAt: null,
      currentRevision: 1n,
    });
  });
});
