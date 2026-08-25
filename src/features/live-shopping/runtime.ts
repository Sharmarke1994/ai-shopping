import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  ContextAcquisitionModel,
  ModelCallMetadata,
} from "@/features/context-acquisition/model-port";
import type {
  ContextActionProviderWireV1,
  InterpretationProviderWireV1,
} from "@/features/context-acquisition/provider-wire";
import { createOpenAIContextAcquisitionModel } from "@/features/context-acquisition/openai-adapter";
import { FakeShoppingProvider } from "@/features/retrieval-spike/fake-shopping-provider";
import { SerperShoppingAdapter } from "@/features/retrieval-spike/serper-shopping-adapter";
import {
  createDatabaseConnection,
  type DatabaseConnection,
} from "@/infrastructure/database/clients";
import type { LiveShoppingDependencies } from "./application";

const executeFile = promisify(execFile);

declare global {
  var __considerLiveDatabase: DatabaseConnection | undefined;
}

async function readLocalSecret(options: {
  environmentName: string;
  keychainService: string;
}) {
  const environmentValue = process.env[options.environmentName]?.trim();
  if (environmentValue) return environmentValue;
  if (process.platform !== "darwin") {
    throw new Error(`${options.environmentName} is not configured`);
  }
  try {
    const { stdout } = await executeFile("security", [
      "find-generic-password",
      "-s",
      options.keychainService,
      "-w",
    ]);
    const secret = stdout.trim();
    if (secret.length === 0) throw new Error("Empty Keychain value");
    return secret;
  } catch {
    throw new Error(`${options.environmentName} is not configured`);
  }
}

export function createLiveShoppingDatabase() {
  if (globalThis.__considerLiveDatabase !== undefined) {
    return globalThis.__considerLiveDatabase;
  }
  const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (url === undefined) {
    throw new Error("DATABASE_URL is not configured");
  }
  const connection = createDatabaseConnection({ url, prepare: false });
  globalThis.__considerLiveDatabase = connection;
  return connection;
}

const fixtureMetadata: ModelCallMetadata = {
  provider: "fixture",
  model: "live-browser-fixture",
  promptVersion: "live-browser-v1",
  providerSchemaVersion: 1,
  providerRequestId: "fixture-response",
  durationMs: 0,
  inputTokens: null,
  outputTokens: null,
};

function completed<T>(value: T) {
  return Promise.resolve({
    status: "completed" as const,
    value,
    metadata: fixtureMetadata,
  });
}

function fixtureModel(): ContextAcquisitionModel {
  return {
    interpret: (input) => {
      const source = input.payload.source as
        { kind?: string; body?: string } | undefined;
      if (source?.kind === "question_answer") {
        return completed<InterpretationProviderWireV1>({
          providerSchemaVersion: 1,
          outcome: "change",
          operations: [
            {
              op: "create_concept",
              localRef: "maximum_width",
              label: "Maximum width",
              definition: "Maximum overall width that fits the shopper's space",
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
                  lower: null,
                  upper: { amount: "60", inclusive: true },
                  unit: "cm",
                },
              },
            },
          ],
          ambiguities: [],
        });
      }
      if (source?.body?.toLocaleLowerCase("en-GB").includes("cap")) {
        return completed<InterpretationProviderWireV1>({
          providerSchemaVersion: 1,
          outcome: "change",
          operations: [
            {
              op: "create_concept",
              localRef: "breathability",
              label: "Breathability",
              definition: "Airflow in hot weather",
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
                  kind: "qualitative_text",
                  text: "breathable in hot weather",
                },
              },
            },
          ],
          ambiguities: [],
        });
      }
      return completed<InterpretationProviderWireV1>({
        providerSchemaVersion: 1,
        outcome: "no_change",
        operations: [],
        ambiguities: [],
      });
    },
    selectAction: (input) => {
      const source = input.payload.source as { kind?: string } | undefined;
      if (source?.kind === "question_answer") {
        return completed<ContextActionProviderWireV1>({
          providerSchemaVersion: 1,
          action: "search",
          question: null,
          rationale: { summary: "The explicit answer makes search useful." },
        });
      }
      const subject = input.payload.source as { body?: string } | undefined;
      if (subject?.body?.toLocaleLowerCase("en-GB").includes("shel")) {
        return completed<ContextActionProviderWireV1>({
          providerSchemaVersion: 1,
          action: "ask",
          question: {
            prompt: "What is the maximum width that will fit?",
            responseMode: "single_select",
            options: ["Up to 60 cm", "Up to 80 cm", "I'm flexible"],
            expectedImpact: "eligibility",
            whyNow: "Width will remove shelving that cannot fit the space.",
            canSearchWithoutAnswer: true,
          },
          rationale: null,
        });
      }
      return completed<ContextActionProviderWireV1>({
        providerSchemaVersion: 1,
        action: "search",
        question: null,
        rationale: { summary: "The request is ready for product search." },
      });
    },
  };
}

export async function createLiveShoppingDependencies(): Promise<LiveShoppingDependencies> {
  const connection = createLiveShoppingDatabase();
  if (process.env.LIVE_SHOPPING_TEST_MODE === "fixture") {
    return {
      db: connection.db,
      model: fixtureModel(),
      provider: new FakeShoppingProvider(),
    };
  }
  const [openAIKey, serperKey] = await Promise.all([
    readLocalSecret({
      environmentName: "OPENAI_API_KEY",
      keychainService: "ai-shopping-openai",
    }),
    readLocalSecret({
      environmentName: "SERPER_API_KEY",
      keychainService: "ai-shopping-serper",
    }),
  ]);
  return {
    db: connection.db,
    model: createOpenAIContextAcquisitionModel({
      environment: { ...process.env, OPENAI_API_KEY: openAIKey },
    }),
    provider: new SerperShoppingAdapter({ apiKey: serperKey }),
  };
}
