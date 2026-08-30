import { randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { and, asc, eq } from "drizzle-orm";
import postgres from "postgres";
import { projectShoppingBrief } from "../src/domain/shopping-state/brief";
import type { SemanticValue } from "../src/domain/shopping-state/semantic-value";
import { acquireShoppingContext } from "../src/features/context-acquisition/coordinator";
import {
  createOpenAIContextAcquisitionModel,
  V0_05_OPENAI_DEFAULT_CONFIG,
} from "../src/features/context-acquisition/openai-adapter";
import type { ContextAcquisitionModel } from "../src/features/context-acquisition/model-port";
import { recordTaskInput } from "../src/features/shopping-state/persistence/inputs-and-messages";
import { loadCurrentShoppingState } from "../src/features/shopping-state/persistence/state-loaders";
import { applyStatePatch } from "../src/features/shopping-state/persistence/state-transitions";
import { createShoppingTask } from "../src/features/shopping-state/persistence/tasks";
import { contextAcquisitionAttempts } from "../src/infrastructure/database/schema";
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

type DiagnosticItem = Readonly<{
  criterionId: string;
  conceptId: string;
  lifecycle: string;
  authority: string;
  label: string;
  definition: string;
  strength: string;
  targetSemantics: string;
  semanticKind: string;
  summary: string;
  semanticValue: SemanticValue;
}>;

type DiagnosticConcept = Readonly<{
  id: string;
  label: string;
  definition: string;
  valueFamily: string;
}>;

type DiagnosticAttempt = Readonly<{
  stage: string;
  attemptOrdinal: number;
  status: string;
  providerRequestId: string | null;
  promptVersion: string;
  providerSchemaVersion: number;
  errorCode: string | null;
  ambiguities: readonly string[];
}>;

type DiagnosticContext = Readonly<{
  items: readonly DiagnosticItem[];
  fullItems: readonly DiagnosticItem[];
  briefItems: readonly DiagnosticItem[];
  concepts: readonly DiagnosticConcept[];
  status: string;
  action: string | null;
  question: Readonly<{
    prompt: string;
    whyNow: string;
    options: readonly string[];
  }> | null;
  ambiguities: readonly string[];
  attempts: readonly DiagnosticAttempt[];
}>;

type DiagnosticCase = Readonly<{
  name: string;
  request: string;
  seed?: "maximum_width_60";
  twoTurn?: boolean;
  check: (context: DiagnosticContext) => readonly string[];
}>;

function normalized(context: DiagnosticContext) {
  return context.briefItems
    .map((item) => `${item.label} ${item.definition} ${item.summary}`)
    .join(" ")
    .toLowerCase();
}

function hasItem(context: DiagnosticContext, pattern: RegExp) {
  return context.items.some((item) =>
    pattern.test(`${item.label} ${item.definition} ${item.summary}`),
  );
}

function hasMeaning(context: DiagnosticContext, pattern: RegExp) {
  return pattern.test(
    `${normalized(context)} ${context.fullItems.map((item) => `${item.label} ${item.definition} ${item.summary}`).join(" ")} ${context.ambiguities.join(" ")} ${context.question?.prompt ?? ""} ${context.question?.whyNow ?? ""}`,
  );
}

function hasFullItem(context: DiagnosticContext, pattern: RegExp) {
  return context.fullItems.some((item) =>
    pattern.test(`${item.label} ${item.definition} ${item.summary}`),
  );
}

function attemptInvariantFailures(context: DiagnosticContext) {
  const failures: string[] = [];
  if (context.attempts.some((attempt) => attempt.status === "invalid_patch"))
    failures.push("invalid_patch was emitted instead of a graceful outcome");
  if (
    context.attempts.some(
      (attempt) =>
        attempt.status === "malformed" &&
        (attempt.errorCode === "provider_lowering_failed" ||
          attempt.errorCode === "provider_schema_validation_failed"),
    )
  )
    failures.push("provider structured-output validation failed");
  return failures;
}

function actionCoherenceFailures(context: DiagnosticContext) {
  const unresolvedHardAmbiguity = context.ambiguities.some((summary) =>
    /\bmust\b|\brequired\b|\bat least\b|\bat most\b|\bmaximum\b|\bno more than\b|hard requirement/i.test(
      summary,
    ),
  );
  if (
    unresolvedHardAmbiguity &&
    context.action === "search" &&
    !context.fullItems.some((item) => item.strength === "hard")
  )
    return [
      "SEARCH was selected while an unresolved hard requirement was absent from authoritative state",
    ];
  return [];
}

function requireSoftCondition(
  context: DiagnosticContext,
  parent: RegExp,
  condition: RegExp,
) {
  const failures: string[] = [];
  if (!hasItem(context, parent)) failures.push("parent preference was lost");
  const conditionItems = context.items.filter((item) =>
    condition.test(`${item.label} ${item.definition} ${item.summary}`),
  );
  if (conditionItems.some((item) => item.strength === "hard"))
    failures.push("subordinate condition became hard");
  if (conditionItems.length === 0 && !hasMeaning(context, condition))
    failures.push(
      "subordinate condition silently disappeared from state, ambiguity, and question",
    );
  return failures;
}

function requireCategorical(
  context: DiagnosticContext,
  value: RegExp,
  operator: "include" | "prefer" | "exclude",
  strength: string,
) {
  return context.items.some(
    (item) =>
      item.strength === strength &&
      item.targetSemantics === "categorical" &&
      item.semanticValue.kind === "categorical" &&
      item.semanticValue.operator === operator &&
      item.semanticValue.values.some((entry) => value.test(entry)),
  )
    ? []
    : [`categorical ${operator} ${value} at ${strength} was not preserved`];
}

const cases: readonly DiagnosticCase[] = [
  {
    name: "conditional-wireless-battery",
    request: "I'd prefer wireless, but only if the battery life is very good.",
    check: (context) => requireSoftCondition(context, /wireless/i, /battery/i),
  },
  {
    name: "conditional-monitor-fit",
    request:
      "I'd prefer the larger monitor, but only if it still fits on the desk.",
    check: (context) =>
      requireSoftCondition(context, /larger|monitor size/i, /fit|desk/i),
  },
  {
    name: "conditional-delivery-cost",
    request:
      "I'd prefer faster delivery, but only if it isn't much more expensive.",
    check: (context) =>
      requireSoftCondition(
        context,
        /delivery|faster/i,
        /cost|price|expensive/i,
      ),
  },
  {
    name: "explicit-hard-battery",
    request: "Battery life must be at least 40 minutes. I'd prefer wireless.",
    check: (context) => {
      const battery = context.fullItems.filter((item) =>
        /battery/i.test(`${item.label} ${item.definition}`),
      );
      const failures: string[] = [];
      const ordinalBattery = battery.some(
        (item) =>
          item.strength === "hard" &&
          item.targetSemantics === "qualitative" &&
          item.semanticValue.kind === "qualitative" &&
          item.semanticValue.mode === "ordinal" &&
          item.semanticValue.relation === "at_least" &&
          /40\s*minutes?/i.test(item.semanticValue.anchor ?? ""),
      );
      if (!ordinalBattery) {
        if (context.action === "search")
          failures.push(
            "search was selected while the explicit hard time requirement was absent",
          );
        if (!hasMeaning(context, /battery|40|minute/i))
          failures.push(
            "hard time condition was neither represented nor surfaced as ambiguity/ASK",
          );
      }
      if (
        battery.some(
          (item) =>
            item.strength === "hard" &&
            (item.semanticKind === "measurement" ||
              item.semanticKind === "measurement_range"),
        )
      )
        failures.push(
          "time quantity used a length/mass unit unsupported by this domain",
        );
      if (
        battery.some(
          (item) =>
            item.semanticValue.kind === "qualitative" &&
            item.semanticValue.mode === "text" &&
            /40|minute/i.test(item.summary),
        )
      )
        failures.push("40 minutes degraded to generic qualitative text");
      return failures;
    },
  },
  {
    name: "explicit-hard-width",
    request: "It must be no more than 25 cm wide.",
    check: (context) =>
      context.items.some(
        (item) =>
          item.strength === "hard" &&
          /width|wide/i.test(`${item.label} ${item.definition}`) &&
          item.semanticKind === "measurement_range" &&
          /25/.test(item.summary) &&
          /cm/.test(item.summary),
      )
        ? []
        : ["explicit hard width <=25 cm was not preserved"],
  },
  {
    name: "hard-exclusion",
    request: "No Amazon Basics.",
    check: (context) =>
      requireCategorical(context, /amazon basics/i, "exclude", "hard"),
  },
  {
    name: "hard-only-black",
    request: "I only want black.",
    check: (context) =>
      requireCategorical(context, /^black$/i, "include", "hard"),
  },
  {
    name: "contextless-lighter",
    request: "I'd prefer something lighter.",
    check: (context) => {
      const failures: string[] = [];
      if (hasFullItem(context, /light|weight/i))
        failures.push("contextless lighter invented a criterion");
      if (!hasMeaning(context, /light|lighter|weight/i))
        failures.push("contextless lighter meaning was not preserved");
      if (context.action !== "ask")
        failures.push(
          "contextless lighter did not ask for missing subject context",
        );
      return failures;
    },
  },
  {
    name: "contextual-soft-lighter",
    request: "I need a backpack and I'd prefer something lighter.",
    check: (context) => {
      const failures: string[] = [];
      const lightPreference = context.fullItems.some(
        (item) =>
          item.strength === "preference" &&
          /light|weight/i.test(`${item.label} ${item.definition}`) &&
          item.semanticValue.kind === "qualitative" &&
          ((item.semanticValue.mode === "ordinal" &&
            item.semanticValue.relation === "less" &&
            /weight|heavy|light/i.test(item.semanticValue.anchor ?? "")) ||
            (item.semanticValue.mode === "text" &&
              /light|lighter/i.test(item.semanticValue.text ?? ""))),
      );
      if (!lightPreference)
        failures.push(
          "contextual lighter preference/direction was not preserved",
        );
      if (context.fullItems.some((item) => /backpack/i.test(item.label)))
        failures.push("backpack usage context became an invented criterion");
      if (context.fullItems.some((item) => /heavy/i.test(item.summary)))
        failures.push("lighter direction was reversed to heavy");
      if (
        context.fullItems.some(
          (item) =>
            item.strength === "hard" &&
            /light|weight/i.test(`${item.label} ${item.definition}`),
        )
      )
        failures.push("ordinary lighter preference became hard");
      return failures;
    },
  },
  {
    name: "contextless-comfort",
    request: "Comfort matters a lot.",
    check: (context) => {
      const failures: string[] = [];
      if (hasFullItem(context, /comfort/i))
        failures.push("contextless comfort invented a criterion");
      if (!hasMeaning(context, /comfort/i))
        failures.push("contextless comfort meaning was contradicted or lost");
      if (context.action !== "ask")
        failures.push(
          "contextless comfort did not ask for missing subject context",
        );
      if (
        context.fullItems.some(
          (item) =>
            item.strength === "hard" &&
            /comfort/i.test(`${item.label} ${item.definition}`),
        )
      )
        failures.push("contextless comfort became a hard requirement");
      return failures;
    },
  },
  {
    name: "contextual-strong-comfort",
    request: "I need an office chair. Comfort matters a lot.",
    check: (context) => {
      const comfort = context.fullItems.filter((item) =>
        /comfort/i.test(`${item.label} ${item.definition}`),
      );
      const failures: string[] = [];
      if (
        !comfort.some(
          (item) =>
            item.strength === "strong_preference" &&
            item.targetSemantics === "qualitative" &&
            item.semanticValue.kind === "qualitative" &&
            /comfort|comfortable/i.test(item.summary) &&
            !/uncomfortable|poor/i.test(item.summary),
        )
      )
        failures.push(
          "contextual comfort was not preserved as strong_preference",
        );
      if (comfort.some((item) => item.strength === "hard"))
        failures.push("comfort importance became a hard requirement");
      if (context.fullItems.some((item) => /office chair/i.test(item.label)))
        failures.push("office-chair subject became an invented criterion");
      return failures;
    },
  },
  {
    name: "cap-golden",
    request: "I need a light breathable cap for running in hot weather.",
    check: (context) => {
      const failures: string[] = [];
      if (!hasItem(context, /light|weight/i))
        failures.push("light/low-weight direction missing");
      if (!hasItem(context, /breath/i))
        failures.push("breathable meaning missing");
      if (context.items.some((item) => /heavy/i.test(item.summary)))
        failures.push("light became heavy");
      if (hasItem(context, /minimal|brand|colour|color|budget|uv/i))
        failures.push("cap introduced unsupported meaning");
      return failures;
    },
  },
  {
    name: "shelving-golden",
    request:
      "I need a slim shelving unit around £30, maximum 60 cm wide and 30 cm deep, no white, and visually light.",
    check: (context) => {
      const failures: string[] = [];
      if (
        !context.items.some(
          (item) =>
            item.semanticKind === "money" && /3000|30/.test(item.summary),
        )
      )
        failures.push("around £30 target missing");
      if (
        !context.items.some(
          (item) =>
            /width|wide/i.test(item.label) &&
            /60/.test(item.summary) &&
            item.strength === "hard",
        )
      )
        failures.push("maximum width 60 cm missing");
      if (
        !context.items.some(
          (item) =>
            /depth|deep/i.test(item.label) &&
            /30/.test(item.summary) &&
            item.strength === "hard",
        )
      )
        failures.push("maximum depth 30 cm missing");
      failures.push(
        ...requireCategorical(context, /^white$/i, "exclude", "hard"),
      );
      if (!hasItem(context, /visually light|visual|airy/i))
        failures.push("visually light preference missing");
      if (hasItem(context, /height/i)) failures.push("height was invented");
      return failures;
    },
  },
  {
    name: "headphones-golden",
    request:
      "I need wireless over-ear headphones around £150 where glasses comfort and noise cancellation matter.",
    check: (context) => {
      const failures: string[] = [];
      failures.push(
        ...requireCategorical(context, /^wireless$/i, "include", "hard"),
      );
      if (!hasItem(context, /over-ear/i))
        failures.push("over-ear form factor missing");
      if (!hasItem(context, /comfort|glasses/i))
        failures.push("glasses comfort missing");
      if (!hasItem(context, /noise cancellation|anc/i))
        failures.push("noise cancellation missing");
      if (
        !context.items.some(
          (item) =>
            item.semanticKind === "money" && /15000|150/.test(item.summary),
        )
      )
        failures.push("around £150 target missing");
      if (hasItem(context, /battery|microphone|codec|colour|color/i))
        failures.push("unsupported headphone meaning introduced");
      return failures;
    },
  },
  {
    name: "conditional-money-stretch",
    request:
      "I want a shelving unit around £30, but I can stretch to £45 if it looks visually light.",
    check: (context) =>
      context.items.some(
        (item) =>
          item.semanticKind === "money_stretch" &&
          /3000/.test(item.summary) &&
          /4500/.test(item.summary),
      )
        ? []
        : [
            "conditional money stretch was not represented with target and ceiling",
          ],
  },
  {
    name: "comfort-vs-anc-question",
    request:
      "I care about comfort and strong noise cancellation for train travel, but I don't know which should matter more.",
    check: (context) => {
      const failures: string[] = [];
      if (context.action !== "ask")
        failures.push("unresolved comfort-versus-ANC priority did not ask");
      if (
        !hasMeaning(context, /comfort/i) ||
        !hasMeaning(context, /noise cancellation|anc/i) ||
        !hasMeaning(context, /priority|matter more|lead/i)
      )
        failures.push("ASK did not resolve which preference leads");
      if (
        context.items.some(
          (item) =>
            /noise cancellation|anc/i.test(
              `${item.label} ${item.definition}`,
            ) && item.strength === "strong_preference",
        )
      )
        failures.push(
          "strong ANC quality was mistaken for strong preference authority",
        );
      return failures;
    },
  },
  {
    name: "explicit-indifference",
    seed: "maximum_width_60",
    request: "Actually the width does not matter to me anymore.",
    check: (context) => {
      const failures: string[] = [];
      const fullWidth = context.fullItems.filter((item) =>
        /width|wide/i.test(`${item.label} ${item.definition}`),
      );
      if (!fullWidth.some((item) => item.semanticKind === "indifferent"))
        failures.push(
          "authoritative full state did not mark the seeded width concept indifferent",
        );
      if (
        fullWidth.some(
          (item) =>
            item.semanticKind !== "indifferent" && item.strength !== "none",
        )
      )
        failures.push(
          "the prior active width criterion remained effective after indifference",
        );
      if (context.briefItems.some((item) => /width|wide/i.test(item.label)))
        failures.push(
          "visible ShoppingBrief exposed an indifferent width item",
        );
      if (
        context.fullItems.some(
          (item) =>
            item.semanticKind === "indifferent" &&
            item.authority !== "user_explicit",
        )
      )
        failures.push("indifference provenance was not user-explicit");
      return failures;
    },
  },
  {
    name: "change-of-mind-relaxation",
    seed: "maximum_width_60",
    request: "The width can be up to 80 cm now.",
    check: (context) =>
      context.items.some(
        (item) =>
          /width|wide/i.test(`${item.label} ${item.definition}`) &&
          /80/.test(item.summary) &&
          item.strength === "hard",
      )
        ? []
        : ["width relaxation did not preserve the new 80 cm ceiling"],
  },
  {
    name: "two-turn-conditional-refinement",
    twoTurn: true,
    request:
      "I'd prefer wireless, but only if battery life is very good. Reviews matter a lot.",
    check: (context) => {
      const failures = requireSoftCondition(context, /wireless/i, /battery/i);
      if (
        !context.items.some(
          (item) =>
            /review/i.test(`${item.label} ${item.definition}`) &&
            item.strength === "preference",
        )
      )
        failures.push("reviews did not weaken to a soft preference");
      if (
        !context.items.some(
          (item) =>
            /comfort/i.test(`${item.label} ${item.definition}`) &&
            item.strength === "strong_preference",
        )
      )
        failures.push("comfort did not become the stronger preference");
      return failures;
    },
  },
];

type CaseResult = Readonly<{
  name: string;
  status: string;
  action: string | null;
  revision: string | null;
  items: readonly DiagnosticItem[];
  fullItems: readonly DiagnosticItem[];
  concepts: readonly DiagnosticConcept[];
  question: DiagnosticContext["question"];
  actionRationale: string | null;
  ambiguities: readonly string[];
  attempts: readonly DiagnosticAttempt[];
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
  return brief.items.map((item) => {
    const concept = state.concepts.find((entry) => entry.id === item.conceptId);
    return {
      criterionId: item.criterionId,
      conceptId: item.conceptId,
      lifecycle: "active",
      authority: "unknown",
      label: item.conceptLabel,
      definition: concept?.definition ?? item.conceptDefinition,
      strength: item.strength,
      targetSemantics: item.targetSemantics,
      semanticKind: item.semanticValue.kind,
      summary: summarizeValue(item.semanticValue),
      semanticValue: item.semanticValue,
    } satisfies DiagnosticItem;
  });
}

function summarizeFullItems(
  state: Awaited<ReturnType<typeof loadCurrentShoppingState>>,
) {
  const concepts = new Map(
    state.concepts.map((concept) => [concept.id, concept]),
  );
  return state.activeCriteria.map(({ criterion }) => {
    const concept = concepts.get(criterion.conceptId);
    if (concept === undefined) throw new Error("Criterion concept missing");
    return {
      criterionId: criterion.id,
      conceptId: criterion.conceptId,
      lifecycle: criterion.lifecycle,
      authority: criterion.authority,
      label: concept.label,
      definition: concept.definition,
      strength: criterion.strength ?? "none",
      targetSemantics: criterion.targetSemantics,
      semanticKind: criterion.semanticValue.kind,
      summary: summarizeValue(criterion.semanticValue),
      semanticValue: criterion.semanticValue,
    } satisfies DiagnosticItem;
  });
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

async function loadSanitizedAttempts(taskId: string, inputId: string) {
  const rows = await currentConnection!.db
    .select({
      stage: contextAcquisitionAttempts.stage,
      attemptOrdinal: contextAcquisitionAttempts.attemptOrdinal,
      status: contextAcquisitionAttempts.status,
      providerRequestId: contextAcquisitionAttempts.providerRequestId,
      promptVersion: contextAcquisitionAttempts.promptVersion,
      providerSchemaVersion: contextAcquisitionAttempts.providerSchemaVersion,
      errorCode: contextAcquisitionAttempts.errorCode,
      interpretationProposal: contextAcquisitionAttempts.interpretationProposal,
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
  return rows.map((row) => ({
    stage: row.stage,
    attemptOrdinal: row.attemptOrdinal,
    status: row.status,
    providerRequestId: row.providerRequestId,
    promptVersion: row.promptVersion,
    providerSchemaVersion: row.providerSchemaVersion,
    errorCode: row.errorCode,
    ambiguities: extractAmbiguitySummaries(row.interpretationProposal),
  }));
}

function extractAmbiguitySummaries(value: unknown): readonly string[] {
  if (typeof value !== "object" || value === null || !("ambiguities" in value))
    return [];
  const ambiguities = (value as { ambiguities?: unknown }).ambiguities;
  if (!Array.isArray(ambiguities)) return [];
  return ambiguities.flatMap((entry) => {
    if (
      typeof entry === "object" &&
      entry !== null &&
      "summary" in entry &&
      typeof entry.summary === "string"
    )
      return [entry.summary];
    return [];
  });
}

let currentConnection: DatabaseConnection | null = null;

async function seedTask(connection: DatabaseConnection, taskId: string) {
  const input = await recordTaskInput({
    db: connection.db,
    taskId,
    clientActionId: `context-hardening:seed:${randomUUID()}`,
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
}

async function runCase(
  connection: DatabaseConnection,
  model: ContextAcquisitionModel,
  inputCase: (typeof cases)[number],
  index: number,
): Promise<CaseResult> {
  const task = await createShoppingTask(connection.db);
  if (inputCase.seed !== undefined) await seedTask(connection, task.id);
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
  const briefItems = summarizeItems(state);
  const fullItems = summarizeFullItems(state);
  const action = result.status === "completed" ? result.action.action : null;
  const question =
    result.status === "completed" && result.action.action === "ask"
      ? {
          prompt: result.action.question.prompt,
          whyNow: result.action.question.whyNow,
          options: result.action.question.options.map((option) => option.label),
        }
      : null;
  const actionRationale =
    result.status === "completed" && result.action.action !== "ask"
      ? result.action.rationale
      : null;
  const attempts = await loadSanitizedAttempts(task.id, input.input.id);
  const ambiguities = attempts.flatMap((attempt) => attempt.ambiguities);
  const context = {
    items: briefItems,
    briefItems,
    fullItems,
    concepts: state.concepts.map((concept) => ({
      id: concept.id,
      label: concept.label,
      definition: concept.definition,
      valueFamily: concept.valueFamily,
    })),
    status: result.status,
    action,
    question,
    ambiguities,
    attempts,
  } satisfies DiagnosticContext;
  const concepts = context.concepts;
  const violations = [
    ...inputCase.check(context),
    ...attemptInvariantFailures(context),
    ...actionCoherenceFailures(context),
  ];
  return {
    name: inputCase.name,
    status: result.status,
    action,
    revision:
      result.status === "completed"
        ? state.task.currentRevision.toString()
        : null,
    items: briefItems,
    fullItems,
    concepts,
    question,
    actionRationale,
    ambiguities,
    attempts,
    violations,
  };
}

async function runTwoTurnCase(
  connection: DatabaseConnection,
  model: ContextAcquisitionModel,
  inputCase: DiagnosticCase,
  index: number,
): Promise<CaseResult> {
  const task = await createShoppingTask(connection.db);
  const firstInput = await recordTaskInput({
    db: connection.db,
    taskId: task.id,
    clientActionId: `context-hardening:${index}:turn-1`,
    request: {
      inputSchemaVersion: 1,
      expectedRevision: 0n,
      kind: "message",
      body: inputCase.request,
    },
  });
  const firstResult = await acquireShoppingContext({
    db: connection.db,
    model,
    taskId: task.id,
    sourceInputId: firstInput.input.id,
  });
  const firstState = await loadCurrentShoppingState(connection.db, task.id);
  const firstBriefItems = summarizeItems(firstState);
  const firstFullItems = summarizeFullItems(firstState);
  const firstAction =
    firstResult.status === "completed" ? firstResult.action.action : null;
  const firstQuestion =
    firstResult.status === "completed" && firstResult.action.action === "ask"
      ? {
          prompt: firstResult.action.question.prompt,
          whyNow: firstResult.action.question.whyNow,
          options: firstResult.action.question.options.map(
            (option) => option.label,
          ),
        }
      : null;
  const firstAttempts = await loadSanitizedAttempts(
    task.id,
    firstInput.input.id,
  );
  const firstContext = {
    items: firstBriefItems,
    briefItems: firstBriefItems,
    fullItems: firstFullItems,
    concepts: firstState.concepts.map((concept) => ({
      id: concept.id,
      label: concept.label,
      definition: concept.definition,
      valueFamily: concept.valueFamily,
    })),
    status: firstResult.status,
    action: firstAction,
    question: firstQuestion,
    ambiguities: firstAttempts.flatMap((attempt) => attempt.ambiguities),
    attempts: firstAttempts,
  } satisfies DiagnosticContext;
  const firstViolations = requireSoftCondition(
    firstContext,
    /wireless/i,
    /battery/i,
  );
  if (
    !firstBriefItems.some((item) =>
      /review/i.test(`${item.label} ${item.definition}`),
    )
  )
    firstViolations.push("reviews preference was not preserved on turn one");

  const secondInput = await recordTaskInput({
    db: connection.db,
    taskId: task.id,
    clientActionId: `context-hardening:${index}:turn-2`,
    request: {
      inputSchemaVersion: 1,
      expectedRevision: firstState.task.currentRevision,
      kind: "message",
      body: "Reviews matter less now. Comfort for long workdays matters most.",
    },
  });
  const secondResult = await acquireShoppingContext({
    db: connection.db,
    model,
    taskId: task.id,
    sourceInputId: secondInput.input.id,
  });
  const state = await loadCurrentShoppingState(connection.db, task.id);
  const briefItems = summarizeItems(state);
  const fullItems = summarizeFullItems(state);
  const action =
    secondResult.status === "completed" ? secondResult.action.action : null;
  const question =
    secondResult.status === "completed" && secondResult.action.action === "ask"
      ? {
          prompt: secondResult.action.question.prompt,
          whyNow: secondResult.action.question.whyNow,
          options: secondResult.action.question.options.map(
            (option) => option.label,
          ),
        }
      : null;
  const attempts = [
    ...(await loadSanitizedAttempts(task.id, firstInput.input.id)),
    ...(await loadSanitizedAttempts(task.id, secondInput.input.id)),
  ];
  const ambiguities = attempts.flatMap((attempt) => attempt.ambiguities);
  const context = {
    items: briefItems,
    briefItems,
    fullItems,
    concepts: state.concepts.map((concept) => ({
      id: concept.id,
      label: concept.label,
      definition: concept.definition,
      valueFamily: concept.valueFamily,
    })),
    status:
      firstResult.status === "completed" && secondResult.status === "completed"
        ? "completed"
        : "failed",
    action,
    question,
    ambiguities,
    attempts,
  } satisfies DiagnosticContext;
  const concepts = context.concepts;
  const violations = [
    ...firstViolations,
    ...inputCase.check(context),
    ...attemptInvariantFailures(firstContext),
    ...attemptInvariantFailures(context),
    ...actionCoherenceFailures(firstContext),
    ...actionCoherenceFailures(context),
  ];
  return {
    name: inputCase.name,
    status:
      firstResult.status === "completed" && secondResult.status === "completed"
        ? "completed"
        : "failed",
    action,
    revision:
      secondResult.status === "completed"
        ? state.task.currentRevision.toString()
        : null,
    items: briefItems,
    fullItems,
    concepts,
    question,
    actionRationale:
      secondResult.status === "completed" &&
      secondResult.action.action !== "ask"
        ? secondResult.action.rationale
        : null,
    ambiguities,
    attempts,
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
  currentConnection = database.connection;
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
    const result = inputCase.twoTurn
      ? await runTwoTurnCase(database.connection, model, inputCase, index)
      : await runCase(database.connection, model, inputCase, index);
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
  currentConnection = null;
}
