import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { acquireShoppingContext } from "../src/features/context-acquisition/coordinator";
import type {
  ContextAcquisitionModel,
  ModelCallMetadata,
} from "../src/features/context-acquisition/model-port";
import type {
  ContextActionProviderWireV1,
  InterpretationProviderWireV1,
} from "../src/features/context-acquisition/provider-wire";
import { loadRetrievalContextFromPersistedState } from "../src/features/retrieval-spike/context-from-persisted-state";
import { executeSearchQueryPortfolio } from "../src/features/retrieval-spike/execution";
import { recordInitialShoppingSubject } from "../src/features/retrieval-spike/persistence/shopping-subjects";
import { buildSearchQueryPortfolio } from "../src/features/retrieval-spike/query-strategy";
import { SerperShoppingAdapter } from "../src/features/retrieval-spike/serper-shopping-adapter";
import { createShoppingTask } from "../src/features/shopping-state/persistence/tasks";
import { requireTestDatabaseEnvironment } from "../src/infrastructure/config/environment";
import { createDatabaseConnection } from "../src/infrastructure/database/clients";
import { migrateDatabase } from "../src/infrastructure/database/migrate";

const disposableDatabasePattern = /^ai_shopping_test_retrieval_[a-f0-9]{32}$/;

const metadata: ModelCallMetadata = {
  provider: "fake",
  model: "deterministic-persisted-retrieval-proof",
  promptVersion: "v0-06-proof-v1",
  providerSchemaVersion: 1,
  providerRequestId: "local-proof",
  durationMs: 0,
  inputTokens: null,
  outputTokens: null,
};

const capInterpretation: InterpretationProviderWireV1 = {
  providerSchemaVersion: 1,
  outcome: "change",
  operations: [
    {
      op: "create_concept",
      localRef: "weight",
      label: "Weight",
      definition: "How light the cap should be",
      valueFamily: "qualitative",
      canonicalUnit: null,
    },
    {
      op: "add_criterion",
      concept: { kind: "created", localRef: "weight" },
      target: {
        strength: "preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative_text",
          text: "lightweight",
        },
      },
    },
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
        strength: "preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative_text",
          text: "breathable",
        },
      },
    },
  ],
  ambiguities: [],
};

const shelvingInterpretation: InterpretationProviderWireV1 = {
  providerSchemaVersion: 1,
  outcome: "change",
  operations: [
    {
      op: "create_concept",
      localRef: "width",
      label: "Maximum width",
      definition: "Maximum overall shelving width",
      valueFamily: "measurement",
      canonicalUnit: "cm",
    },
    {
      op: "add_criterion",
      concept: { kind: "created", localRef: "width" },
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
    {
      op: "create_concept",
      localRef: "depth",
      label: "Maximum depth",
      definition: "Maximum overall shelving depth",
      valueFamily: "measurement",
      canonicalUnit: "cm",
    },
    {
      op: "add_criterion",
      concept: { kind: "created", localRef: "depth" },
      target: {
        strength: "hard",
        targetSemantics: "range",
        semanticValue: {
          schemaVersion: 1,
          kind: "measurement_range",
          lower: null,
          upper: { amount: "30", inclusive: true },
          unit: "cm",
        },
      },
    },
    {
      op: "create_concept",
      localRef: "budget",
      label: "Budget",
      definition: "Preferred purchase price",
      valueFamily: "money",
      canonicalUnit: null,
    },
    {
      op: "add_criterion",
      concept: { kind: "created", localRef: "budget" },
      target: {
        strength: "preference",
        targetSemantics: "around",
        semanticValue: {
          schemaVersion: 1,
          kind: "money",
          mode: "target",
          amountMinor: 3000,
          currency: "GBP",
        },
      },
    },
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
  ambiguities: [],
};

const proofCases = {
  cap: {
    subject: "I need a light breathable cap for running in hot weather.",
    interpretation: capInterpretation,
    marketTerm: "race cap",
    marketRationale: "Explore commercial running-cap language.",
    marketBasisConceptLabel: "Weight",
  },
  shelving: {
    subject:
      "I need a slim shelving unit around £30, max 60cm wide, max 30cm deep, no white.",
    interpretation: shelvingInterpretation,
    marketTerm: "narrow bookcase",
    marketRationale: "Explore the consumer-furniture term for slim shelving.",
    marketBasisConceptLabel: "Maximum width",
  },
} as const;

function readProofCase() {
  const requested =
    process.argv.slice(2).find((argument) => argument !== "--") ?? "cap";
  if (requested !== "cap" && requested !== "shelving") {
    throw new Error("Proof case must be either cap or shelving");
  }
  return { name: requested, fixture: proofCases[requested] };
}

const searchAction: ContextActionProviderWireV1 = {
  providerSchemaVersion: 1,
  action: "search",
  question: null,
  rationale: { summary: "The persisted brief is ready for retrieval." },
};

function completed<T>(value: T) {
  return Promise.resolve({ status: "completed" as const, value, metadata });
}

const proofCase = readProofCase();
const model: ContextAcquisitionModel = {
  interpret: () => completed(proofCase.fixture.interpretation),
  selectAction: () => completed(searchAction),
};

const apiKey = process.env.SERPER_API_KEY;
if (apiKey === undefined || apiKey.trim().length === 0) {
  throw new Error("SERPER_API_KEY is required for the live persisted proof");
}
const { TEST_DATABASE_URL } = requireTestDatabaseEnvironment(process.env);
const baseUrl = new URL(TEST_DATABASE_URL);
const baseDatabaseName = baseUrl.pathname.slice(1);
const databaseName = `ai_shopping_test_retrieval_${randomUUID().replaceAll("-", "")}`;
if (
  !/(?:^|[_-])test(?:[_-]|$)/.test(baseDatabaseName) ||
  !disposableDatabasePattern.test(databaseName)
) {
  throw new Error("Refusing to create an unguarded retrieval-proof database");
}
const disposableUrl = new URL(TEST_DATABASE_URL);
disposableUrl.pathname = `/${databaseName}`;
const admin = postgres(TEST_DATABASE_URL, { max: 1, prepare: false });
let connection: ReturnType<typeof createDatabaseConnection> | null = null;

try {
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  await migrateDatabase({ url: disposableUrl.toString() });
  connection = createDatabaseConnection({
    url: disposableUrl.toString(),
    prepare: false,
  });

  const task = await createShoppingTask(connection.db);
  const source = await recordInitialShoppingSubject({
    db: connection.db,
    taskId: task.id,
    clientActionId: `persisted-retrieval-proof:${proofCase.name}:${randomUUID()}`,
    request: {
      inputSchemaVersion: 1,
      expectedRevision: 0n,
      kind: "message",
      body: proofCase.fixture.subject,
    },
  });
  const acquired = await acquireShoppingContext({
    db: connection.db,
    model,
    taskId: task.id,
    sourceInputId: source.input.id,
  });
  if (acquired.status !== "completed" || acquired.action.action !== "search") {
    throw new Error("The deterministic V0-05 proof did not persist SEARCH");
  }
  const marketBasisCriterionId = acquired.stateApplication.brief.items.find(
    (item) => item.conceptLabel === proofCase.fixture.marketBasisConceptLabel,
  )?.criterionId;
  if (marketBasisCriterionId === undefined) {
    throw new Error(
      "The persisted brief did not contain the market-term basis",
    );
  }

  const retrievalAuthority = await loadRetrievalContextFromPersistedState({
    db: connection.db,
    taskId: task.id,
    contextActionId: acquired.action.id,
    marketVocabulary: [
      {
        term: proofCase.fixture.marketTerm,
        rationale: proofCase.fixture.marketRationale,
        basisCriterionIds: [marketBasisCriterionId],
      },
    ],
  });
  const portfolio = buildSearchQueryPortfolio(retrievalAuthority.context);
  const retrieval = await executeSearchQueryPortfolio({
    portfolio,
    provider: new SerperShoppingAdapter({ apiKey }),
  });

  console.log(
    JSON.stringify(
      {
        proof: {
          case: proofCase.name,
          taskId: task.id,
          sourceInputId: source.input.id,
          stateApplicationId: acquired.stateApplication.application.id,
          contextActionId: acquired.action.id,
          action: acquired.action.action,
        },
        retrievalAuthority,
        portfolio,
        queryExecutions: retrieval.queries,
        listings: retrieval.listings,
      },
      (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      2,
    ),
  );
} finally {
  if (connection !== null) await connection.close();
  if (!disposableDatabasePattern.test(databaseName)) {
    throw new Error("Refusing to drop an unguarded retrieval-proof database");
  }
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  await admin.end({ timeout: 5 });
}
