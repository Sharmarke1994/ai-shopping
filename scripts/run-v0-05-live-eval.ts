import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { and, asc, eq } from "drizzle-orm";
import { projectShoppingBrief } from "../src/domain/shopping-state/brief";
import { acquireShoppingContext } from "../src/features/context-acquisition/coordinator";
import {
  evaluateGoldenCase,
  V0_05_GOLDEN_CASES,
  type V005GoldenCase,
} from "../src/features/context-acquisition/evals/golden-cases";
import {
  createOpenAIContextAcquisitionModel,
  V0_05_OPENAI_DEFAULT_CONFIG,
} from "../src/features/context-acquisition/openai-adapter";
import {
  CONTEXT_ACTION_PROMPT_VERSION,
  INTERPRETATION_PROMPT_VERSION,
} from "../src/features/context-acquisition/prompts";
import { recordTaskInput } from "../src/features/shopping-state/persistence/inputs-and-messages";
import { loadCurrentShoppingState } from "../src/features/shopping-state/persistence/state-loaders";
import { applyStatePatch } from "../src/features/shopping-state/persistence/state-transitions";
import { createShoppingTask } from "../src/features/shopping-state/persistence/tasks";
import { createRuntimeDatabaseConnection } from "../src/infrastructure/database/clients";
import { contextAcquisitionAttempts } from "../src/infrastructure/database/schema";

const RUNS_PER_CASE = 3;
const connection = createRuntimeDatabaseConnection();
const model = createOpenAIContextAcquisitionModel();
const results: unknown[] = [];

try {
  for (const testCase of V0_05_GOLDEN_CASES) {
    for (let run = 1; run <= RUNS_PER_CASE; run += 1) {
      const task = await createShoppingTask(connection.db);
      const revision = await seed(testCase, task.id);
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
      const attempts = await connection.db
        .select({
          stage: contextAcquisitionAttempts.stage,
          attemptOrdinal: contextAcquisitionAttempts.attemptOrdinal,
          status: contextAcquisitionAttempts.status,
          provider: contextAcquisitionAttempts.provider,
          model: contextAcquisitionAttempts.model,
          promptVersion: contextAcquisitionAttempts.promptVersion,
          providerSchemaVersion:
            contextAcquisitionAttempts.providerSchemaVersion,
          durationMs: contextAcquisitionAttempts.durationMs,
          inputTokens: contextAcquisitionAttempts.inputTokens,
          outputTokens: contextAcquisitionAttempts.outputTokens,
          errorCode: contextAcquisitionAttempts.errorCode,
        })
        .from(contextAcquisitionAttempts)
        .where(
          and(
            eq(contextAcquisitionAttempts.taskId, task.id),
            eq(contextAcquisitionAttempts.sourceTaskInputId, input.input.id),
          ),
        )
        .orderBy(
          asc(contextAcquisitionAttempts.stage),
          asc(contextAcquisitionAttempts.attemptOrdinal),
        );
      if (acquired.status === "failed") {
        results.push({
          case: testCase.name,
          run,
          passed: false,
          failures: [`${acquired.stage}:${acquired.errorCode}`],
          attempts,
        });
        continue;
      }
      const state = await loadCurrentShoppingState(connection.db, task.id);
      const brief = projectShoppingBrief(state);
      const evaluation = evaluateGoldenCase({
        testCase,
        brief,
        action: acquired.action.action,
      });
      results.push({
        case: testCase.name,
        run,
        action: acquired.action.action,
        brief: brief.items.map((item) => ({
          conceptLabel: item.conceptLabel,
          strength: item.strength,
          targetSemantics: item.targetSemantics,
          semanticValue: item.semanticValue,
        })),
        attempts,
        ...evaluation,
      });
    }
  }
} finally {
  await connection.close();
}

const failed = results.filter(
  (result) => !(result as { passed?: boolean }).passed,
);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  runsPerCase: RUNS_PER_CASE,
  totalRuns: results.length,
  protectedInvariantViolations: failed.length,
  releaseGatePassed: failed.length === 0,
  configuration: {
    provider: "openai",
    model:
      process.env.OPENAI_CONTEXT_MODEL ?? V0_05_OPENAI_DEFAULT_CONFIG.model,
    reasoningEffort: V0_05_OPENAI_DEFAULT_CONFIG.reasoningEffort,
    timeoutMs: V0_05_OPENAI_DEFAULT_CONFIG.timeoutMs,
    maxOutputTokens: V0_05_OPENAI_DEFAULT_CONFIG.maxOutputTokens,
    interpretationPromptVersion: INTERPRETATION_PROMPT_VERSION,
    contextActionPromptVersion: CONTEXT_ACTION_PROMPT_VERSION,
    providerSchemaVersion: 1,
  },
  results,
};
const directory = resolve("artifacts/evals/v0-05");
await mkdir(directory, { recursive: true });
const file = resolve(
  directory,
  `${report.generatedAt.replaceAll(":", "-")}.json`,
);
await writeFile(
  file,
  JSON.stringify(
    report,
    (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    2,
  ),
  "utf8",
);
process.stdout.write(
  `${report.releaseGatePassed ? "PASS" : "FAIL"}: ${results.length - failed.length}/${results.length} protected runs; ${file}\n`,
);
if (!report.releaseGatePassed) process.exitCode = 1;

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
