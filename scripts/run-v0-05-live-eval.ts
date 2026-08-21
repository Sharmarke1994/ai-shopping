import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { and, asc, eq } from "drizzle-orm";
import postgres from "postgres";
import { projectShoppingBrief } from "../src/domain/shopping-state/brief";
import { acquireShoppingContext } from "../src/features/context-acquisition/coordinator";
import {
  createV005LiveEvalReport,
  evaluateGoldenCase,
  renderV005LiveEvalMarkdown,
  V0_05_GOLDEN_CASES,
  type V005GoldenCase,
  type V005LiveEvalRunResult,
} from "../src/features/context-acquisition/evals/golden-cases";
import {
  createOpenAIContextAcquisitionModel,
  V0_05_OPENAI_DEFAULT_CONFIG,
} from "../src/features/context-acquisition/openai-adapter";
import { withMinimumCompletedCallInterval } from "../src/features/context-acquisition/evals/live-pacing";
import {
  CONTEXT_ACTION_PROMPT_VERSION,
  INTERPRETATION_PROMPT_VERSION,
} from "../src/features/context-acquisition/prompts";
import { listDecisionCriteria } from "../src/features/shopping-state/persistence/criteria";
import { recordTaskInput } from "../src/features/shopping-state/persistence/inputs-and-messages";
import { loadCurrentShoppingState } from "../src/features/shopping-state/persistence/state-loaders";
import { applyStatePatch } from "../src/features/shopping-state/persistence/state-transitions";
import { createShoppingTask } from "../src/features/shopping-state/persistence/tasks";
import { requireTestDatabaseEnvironment } from "../src/infrastructure/config/environment";
import { createDatabaseConnection } from "../src/infrastructure/database/clients";
import { migrateDatabase } from "../src/infrastructure/database/migrate";
import { contextAcquisitionAttempts } from "../src/infrastructure/database/schema";

const RUNS_PER_CASE = 3;
const MINIMUM_MODEL_CALL_INTERVAL_MS = 35_000;
const disposableDatabasePattern = /^ai_shopping_test_[a-f0-9]{32}$/;
const disposable = await createDisposableEvalDatabase();
const connection = disposable.connection;
const results: V005LiveEvalRunResult[] = [];

try {
  const model = withMinimumCompletedCallInterval(
    createOpenAIContextAcquisitionModel(),
    MINIMUM_MODEL_CALL_INTERVAL_MS,
  );
  for (const testCase of V0_05_GOLDEN_CASES) {
    for (let run = 1; run <= RUNS_PER_CASE; run += 1) {
      const task = await createShoppingTask(connection.db);
      const revision = await seed(testCase, task.id);
      const baselineState = await loadCurrentShoppingState(
        connection.db,
        task.id,
      );
      const input = await recordTaskInput({
        db: connection.db,
        taskId: task.id,
        clientActionId: `eval:${testCase.name}:${run}:${randomUUID()}`,
        request: {
          inputSchemaVersion: 1,
          expectedRevision: revision,
          kind: "message",
          body: testCase.input,
        },
      });
      const acquired = await acquireShoppingContext({
        db: connection.db,
        model,
        taskId: task.id,
        sourceInputId: input.input.id,
      });
      const attempts = await loadSanitizedAttempts(task.id, input.input.id);
      const state = await loadCurrentShoppingState(connection.db, task.id);
      const brief = projectShoppingBrief(state);
      const criterionHistory = (
        await listDecisionCriteria(connection.db, task.id)
      ).map(({ criterion }) => criterion);
      const evaluation = evaluateGoldenCase({
        testCase,
        state,
        baselineState,
        criterionHistory,
        brief,
        action: acquired.status === "completed" ? acquired.action : null,
      });
      const sanitizedBrief = brief.items.map((item) => ({
        conceptLabel: item.conceptLabel,
        strength: item.strength,
        targetSemantics: item.targetSemantics,
        semanticValue: item.semanticValue,
      }));
      if (acquired.status === "failed") {
        const failure = `${acquired.stage}:${acquired.errorCode}`;
        results.push({
          case: testCase.name,
          run,
          passed: false,
          failures: [`[execution] ${failure}`, ...evaluation.failures],
          measures: [
            { measure: "execution", passed: false, failures: [failure] },
            ...evaluation.measures,
          ],
          brief: sanitizedBrief,
          attempts,
        });
        continue;
      }
      results.push({
        case: testCase.name,
        run,
        action: acquired.action.action,
        brief: sanitizedBrief,
        attempts,
        ...evaluation,
      });
    }
  }
} finally {
  await disposable.close();
}

const generatedAt = new Date().toISOString();
const report = createV005LiveEvalReport({
  generatedAt,
  runsPerCase: RUNS_PER_CASE,
  configuration: {
    provider: "openai",
    model:
      process.env.OPENAI_CONTEXT_MODEL ?? V0_05_OPENAI_DEFAULT_CONFIG.model,
    reasoningEffort: V0_05_OPENAI_DEFAULT_CONFIG.reasoningEffort,
    timeoutMs: V0_05_OPENAI_DEFAULT_CONFIG.timeoutMs,
    maxOutputTokens: V0_05_OPENAI_DEFAULT_CONFIG.maxOutputTokens,
    minimumModelCallIntervalMs: MINIMUM_MODEL_CALL_INTERVAL_MS,
    interpretationPromptVersion: INTERPRETATION_PROMPT_VERSION,
    contextActionPromptVersion: CONTEXT_ACTION_PROMPT_VERSION,
    providerSchemaVersion: 1,
  },
  results,
});
const directory = resolve("artifacts/evals/v0-05");
await mkdir(directory, { recursive: true });
const basename = generatedAt.replaceAll(":", "-");
const jsonFile = resolve(directory, `${basename}.json`);
const markdownFile = resolve(directory, `${basename}.md`);
await Promise.all([
  writeFile(
    jsonFile,
    JSON.stringify(
      report,
      (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      2,
    ),
    "utf8",
  ),
  writeFile(markdownFile, renderV005LiveEvalMarkdown(report), "utf8"),
]);
process.stdout.write(
  `${report.releaseGatePassed ? "PASS" : "FAIL"}: ${results.length - report.protectedInvariantViolations}/${results.length} protected runs; ${jsonFile}; ${markdownFile}\n`,
);
if (!report.releaseGatePassed) process.exitCode = 1;

async function loadSanitizedAttempts(taskId: string, inputId: string) {
  return connection.db
    .select({
      stage: contextAcquisitionAttempts.stage,
      attemptOrdinal: contextAcquisitionAttempts.attemptOrdinal,
      status: contextAcquisitionAttempts.status,
      provider: contextAcquisitionAttempts.provider,
      model: contextAcquisitionAttempts.model,
      promptVersion: contextAcquisitionAttempts.promptVersion,
      providerSchemaVersion: contextAcquisitionAttempts.providerSchemaVersion,
      durationMs: contextAcquisitionAttempts.durationMs,
      inputTokens: contextAcquisitionAttempts.inputTokens,
      outputTokens: contextAcquisitionAttempts.outputTokens,
      errorCode: contextAcquisitionAttempts.errorCode,
    })
    .from(contextAcquisitionAttempts)
    .where(
      and(
        eq(contextAcquisitionAttempts.taskId, taskId),
        eq(contextAcquisitionAttempts.sourceTaskInputId, inputId),
      ),
    )
    .orderBy(
      asc(contextAcquisitionAttempts.stage),
      asc(contextAcquisitionAttempts.attemptOrdinal),
    );
}

async function seed(testCase: V005GoldenCase, taskId: string) {
  if (testCase.seed === "none") return 0n;
  const input = await recordTaskInput({
    db: connection.db,
    taskId,
    clientActionId: `seed:${randomUUID()}`,
    request: {
      inputSchemaVersion: 1,
      expectedRevision: 0n,
      kind: "direct_brief_action",
      controlId: "seed-maximum-width",
      submittedText: "Maximum width 60 cm",
    },
  });
  await applyStatePatch(connection.db, {
    applicationSchemaVersion: 1,
    applicationKind: "patch",
    taskId,
    expectedRevision: 0n,
    source: { kind: "user_explicit", inputId: input.input.id },
    patch: {
      schemaVersion: 1,
      outcome: "change",
      operations: [
        {
          op: "create_concept",
          localRef: "maximum_width",
          label: "Maximum width",
          definition: "Maximum product width",
          valueFamily: "measurement",
          canonicalUnit: "cm",
        },
        {
          op: "add_criterion",
          concept: { kind: "created", localRef: "maximum_width" },
          target: {
            strength: "hard",
            targetSemantics: "range",
            semanticValue: {
              schemaVersion: 1,
              kind: "measurement_range",
              upper: { amount: "60", inclusive: true },
              unit: "cm",
            },
          },
        },
      ],
    },
  });
  return 1n;
}

async function createDisposableEvalDatabase() {
  const { TEST_DATABASE_URL } = requireTestDatabaseEnvironment(process.env);
  const baseUrl = new URL(TEST_DATABASE_URL);
  const databaseName = `ai_shopping_test_${randomUUID().replaceAll("-", "")}`;
  if (!disposableDatabasePattern.test(databaseName))
    throw new Error(
      "Refusing to create a database outside the eval test guard",
    );
  const disposableUrl = new URL(baseUrl);
  disposableUrl.pathname = `/${databaseName}`;
  const admin = postgres(TEST_DATABASE_URL, { max: 1, prepare: false });
  try {
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    await admin.unsafe(`
      DO $roles$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated NOLOGIN;
        END IF;
      END
      $roles$
    `);
    await migrateDatabase({ url: disposableUrl.toString() });
  } catch (error) {
    await admin.unsafe(
      `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
    );
    await admin.end({ timeout: 5 });
    throw error;
  }
  const evalConnection = createDatabaseConnection({
    url: disposableUrl.toString(),
    prepare: false,
  });
  return {
    connection: evalConnection,
    close: async () => {
      await evalConnection.close();
      if (!disposableDatabasePattern.test(databaseName))
        throw new Error(
          "Refusing to drop a database outside the eval test guard",
        );
      await admin.unsafe(
        `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
      );
      await admin.end({ timeout: 5 });
    },
  } as const;
}
