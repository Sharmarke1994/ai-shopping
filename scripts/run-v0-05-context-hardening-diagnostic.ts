import { randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import postgres from "postgres";
import { projectShoppingBrief } from "../src/domain/shopping-state/brief";
import { acquireShoppingContext } from "../src/features/context-acquisition/coordinator";
import {
  createOpenAIContextAcquisitionModel,
  V0_05_OPENAI_DEFAULT_CONFIG,
} from "../src/features/context-acquisition/openai-adapter";
import type { ContextAcquisitionModel } from "../src/features/context-acquisition/model-port";
import { recordTaskInput } from "../src/features/shopping-state/persistence/inputs-and-messages";
import { loadCurrentShoppingState } from "../src/features/shopping-state/persistence/state-loaders";
import { createShoppingTask } from "../src/features/shopping-state/persistence/tasks";
import {
  createDatabaseConnection,
  type DatabaseConnection,
} from "../src/infrastructure/database/clients";
import { requireTestDatabaseEnvironment } from "../src/infrastructure/config/environment";
import { migrateDatabase } from "../src/infrastructure/database/migrate";

const execFile = promisify(execFileCallback);
const outputBase = new URL(
  "../docs/evals/v0-05-context-hardening-diagnostic",
  import.meta.url,
);
const jsonOutput = new URL(`${outputBase.pathname}.json`, import.meta.url);
const markdownOutput = new URL(`${outputBase.pathname}.md`, import.meta.url);
const attemptOutput = new URL(
  `${outputBase.pathname}-attempt.json`,
  import.meta.url,
);
const disposableDatabasePattern = /^ai_shopping_test_[a-f0-9]{32}$/;

const cases = [
  {
    name: "conditional-wireless-battery",
    request: "I'd prefer wireless, but only if the battery life is very good.",
    check: (items: readonly DiagnosticItem[]) =>
      items.some((item) => /battery/i.test(item.label)) &&
      !items.some(
        (item) => /battery/i.test(item.label) && item.strength === "hard",
      )
        ? []
        : ["Battery life was missing or was elevated to hard"],
  },
  {
    name: "conditional-monitor-fit",
    request:
      "I'd prefer the larger monitor, but only if it still fits on the desk.",
    check: (items: readonly DiagnosticItem[]) =>
      items.some(
        (item) => /fit|desk/i.test(item.label) && item.strength === "hard",
      )
        ? ["Desk fit became an independent hard requirement"]
        : [],
  },
  {
    name: "conditional-delivery-cost",
    request:
      "I'd prefer faster delivery, but only if it isn't much more expensive.",
    check: (items: readonly DiagnosticItem[]) =>
      items.some(
        (item) =>
          /cost|price|delivery/i.test(item.label) && item.strength === "hard",
      )
        ? ["Delivery cost became a hard requirement"]
        : [],
  },
  {
    name: "explicit-hard-battery",
    request: "Battery life must be at least 40 minutes. I'd prefer wireless.",
    check: (items: readonly DiagnosticItem[]) =>
      items.some(
        (item) => /battery/i.test(item.label) && item.strength === "hard",
      )
        ? []
        : ["Explicit hard battery requirement was not preserved"],
  },
  {
    name: "explicit-hard-width",
    request: "It must be no more than 25 cm wide.",
    check: (items: readonly DiagnosticItem[]) =>
      items.some(
        (item) => /width|wide/i.test(item.label) && item.strength === "hard",
      )
        ? []
        : ["Explicit hard width bound was not preserved"],
  },
  {
    name: "hard-exclusion",
    request: "No Amazon Basics.",
    check: (items: readonly DiagnosticItem[]) =>
      items.some(
        (item) =>
          item.strength === "hard" &&
          item.targetSemantics === "categorical" &&
          item.summary.toLowerCase().includes("amazon basics"),
      )
        ? []
        : ["Explicit hard exclusion was not preserved"],
  },
  {
    name: "cap-golden",
    request: "I need a light breathable cap for running in hot weather.",
    check: () => [],
  },
  {
    name: "shelving-golden",
    request:
      "I need a slim shelving unit around £30, maximum 60 cm wide and 30 cm deep, no white, and visually light.",
    check: () => [],
  },
  {
    name: "headphones-golden",
    request:
      "I need wireless over-ear headphones around £150 where glasses comfort and noise cancellation matter.",
    check: () => [],
  },
  {
    name: "conditional-money-stretch",
    request:
      "I want a shelving unit around £30, but I can stretch to £45 if it looks visually light.",
    check: (items: readonly DiagnosticItem[]) =>
      items.some((item) => item.semanticKind === "money_stretch")
        ? []
        : ["Conditional money stretch was not represented as a stretch target"],
  },
  {
    name: "comfort-vs-anc-question",
    request:
      "I care about comfort and strong noise cancellation for train travel, but I don't know which should matter more.",
    check: (_items: readonly DiagnosticItem[], action: string | null) =>
      action === "ask"
        ? []
        : ["Unresolved comfort-versus-ANC priority did not ask a question"],
  },
] as const;

type DiagnosticItem = Readonly<{
  label: string;
  strength: string;
  targetSemantics: string;
  semanticKind: string;
  summary: string;
}>;

type CaseResult = Readonly<{
  name: string;
  status: string;
  action: string | null;
  revision: string | null;
  items: readonly DiagnosticItem[];
  violations: readonly string[];
}>;

async function readSecret(environmentName: string, service: string) {
  const value = process.env[environmentName]?.trim();
  if (value) return value;
  if (process.platform !== "darwin")
    throw new Error(`${environmentName} is not configured`);
  const { stdout } = await execFile("security", [
    "find-generic-password",
    "-s",
    service,
    "-w",
  ]);
  const secret = stdout.trim();
  if (!secret) throw new Error(`${environmentName} is empty`);
  return secret;
}

function databaseUrlWithName(url: string, databaseName: string) {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function createDisposableDatabase() {
  const { TEST_DATABASE_URL } = requireTestDatabaseEnvironment(process.env);
  const databaseName = `ai_shopping_test_${randomUUID().replaceAll("-", "")}`;
  if (!disposableDatabasePattern.test(databaseName))
    throw new Error("Unsafe diagnostic database name");
  const admin = postgres(TEST_DATABASE_URL, { max: 1, prepare: false });
  const disposableUrl = databaseUrlWithName(TEST_DATABASE_URL, databaseName);
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
    await migrateDatabase({ url: disposableUrl });
  } catch (error) {
    await admin.unsafe(
      `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
    );
    await admin.end({ timeout: 5 });
    throw error;
  }
  const connection = createDatabaseConnection({
    url: disposableUrl,
    prepare: false,
  });
  return {
    connection,
    close: async () => {
      await connection.close();
      await admin.unsafe(
        `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
      );
      await admin.end({ timeout: 5 });
    },
  } as const;
}

function summarizeItems(
  state: Awaited<ReturnType<typeof loadCurrentShoppingState>>,
) {
  const brief = projectShoppingBrief(state);
  return brief.items.map((item) => ({
    label: item.conceptLabel,
    strength: item.strength,
    targetSemantics: item.targetSemantics,
    semanticKind: item.semanticValue.kind,
    summary: summarizeValue(item.semanticValue),
  }));
}

function summarizeValue(value: { kind: string; [key: string]: unknown }) {
  if (value.kind === "qualitative")
    return String(value.text ?? value.anchor ?? "");
  if (value.kind === "categorical")
    return String((value.values as string[]).join(", "));
  if (value.kind === "money_stretch")
    return `${String(value.targetMinor)} -> ${String(value.stretchCeilingMinor)} ${String(value.currency)}`;
  if (value.kind === "measurement_range")
    return JSON.stringify({
      lower: value.lower,
      upper: value.upper,
      unit: value.unit,
    });
  if (value.kind === "measurement")
    return `${String(value.amount)} ${String(value.unit)}`;
  if (value.kind === "money")
    return `${String(value.amountMinor)} ${String(value.currency)}`;
  if (value.kind === "boolean") return String(value.value);
  return value.kind;
}

async function runCase(
  connection: DatabaseConnection,
  model: ContextAcquisitionModel,
  inputCase: (typeof cases)[number],
  index: number,
): Promise<CaseResult> {
  const task = await createShoppingTask(connection.db);
  const input = await recordTaskInput({
    db: connection.db,
    taskId: task.id,
    clientActionId: `context-hardening:${index}:initial`,
    request: {
      inputSchemaVersion: 1,
      expectedRevision: 0n,
      kind: "message",
      body: inputCase.request,
    },
  });
  const result = await acquireShoppingContext({
    db: connection.db,
    model,
    taskId: task.id,
    sourceInputId: input.input.id,
  });
  const state = await loadCurrentShoppingState(connection.db, task.id);
  const items = summarizeItems(state);
  const action = result.status === "completed" ? result.action.action : null;
  const violations = inputCase.check(items, action);
  return {
    name: inputCase.name,
    status: result.status,
    action,
    revision:
      result.status === "completed"
        ? state.task.currentRevision.toString()
        : null,
    items,
    violations,
  };
}

if (existsSync(jsonOutput) || existsSync(attemptOutput)) {
  throw new Error(
    "Context diagnostic already has an artifact; refusing a second batch",
  );
}

const startedAt = new Date().toISOString();
const counts = {
  logicalInterpretationCalls: 0,
  logicalActionCalls: 0,
  completed: 0,
  failed: 0,
};
let database: Awaited<ReturnType<typeof createDisposableDatabase>> | null =
  null;
const results: CaseResult[] = [];

try {
  const [openAIKey] = await Promise.all([
    readSecret("OPENAI_API_KEY", "ai-shopping-openai"),
  ]);
  database = await createDisposableDatabase();
  const baseModel = createOpenAIContextAcquisitionModel({
    environment: { ...process.env, OPENAI_API_KEY: openAIKey },
    config: {
      ...V0_05_OPENAI_DEFAULT_CONFIG,
      model: "gpt-5.6-terra",
      reasoningEffort: "low",
    },
  });
  const model: ContextAcquisitionModel = {
    interpret: async (input) => {
      counts.logicalInterpretationCalls += 1;
      return baseModel.interpret(input);
    },
    selectAction: async (input) => {
      counts.logicalActionCalls += 1;
      return baseModel.selectAction(input);
    },
  };
  for (const [index, inputCase] of cases.entries()) {
    const result = await runCase(database.connection, model, inputCase, index);
    results.push(result);
    if (result.status === "completed") counts.completed += 1;
    else counts.failed += 1;
  }
  const violationCount = results.reduce(
    (count, result) => count + result.violations.length,
    0,
  );
  const artifact = {
    schemaVersion: 1,
    diagnostic: "v0-05-context-hardening",
    releaseAccepted: false,
    model: "gpt-5.6-terra",
    reasoningEffort: "low",
    startedAt,
    finishedAt: new Date().toISOString(),
    counts: { ...counts, caseCount: results.length, violationCount },
    results,
  };
  await writeFile(jsonOutput, JSON.stringify(artifact, null, 2));
  await writeFile(
    markdownOutput,
    [
      "# V0-05 context-hardening diagnostic",
      "",
      "This is one bounded Terra diagnostic batch, not V0-05 release acceptance.",
      "",
      `- Model: ${artifact.model} (reasoning ${artifact.reasoningEffort})`,
      `- Logical interpretation calls: ${counts.logicalInterpretationCalls}`,
      `- Logical action calls: ${counts.logicalActionCalls}`,
      `- Cases: ${results.length}; completed: ${counts.completed}; failed: ${counts.failed}`,
      `- Protected semantic violations: ${violationCount}`,
      "",
      ...results.map(
        (result) =>
          `## ${result.name}\n\n- status: ${result.status}\n- action: ${result.action ?? "none"}\n- violations: ${result.violations.length ? result.violations.join("; ") : "none"}\n- criteria: ${result.items.map((item) => `${item.label} [${item.strength}]`).join(", ") || "none"}`,
      ),
      "",
      "Raw provider output and credentials are intentionally not persisted.",
    ].join("\n"),
  );
  await writeFile(
    attemptOutput,
    JSON.stringify(
      {
        schemaVersion: 1,
        startedAt,
        finishedAt: artifact.finishedAt,
        releaseAccepted: false,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await writeFile(
    attemptOutput,
    JSON.stringify(
      {
        schemaVersion: 1,
        diagnostic: "v0-05-context-hardening",
        releaseAccepted: false,
        startedAt,
        finishedAt: new Date().toISOString(),
        counts,
        completedCases: results,
        error: error instanceof Error ? error.message : "diagnostic_failed",
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await database?.close();
}
