import { executeSearchQueryPortfolio } from "../src/features/retrieval-spike/execution";
import { FakeShoppingProvider } from "../src/features/retrieval-spike/fake-shopping-provider";
import { buildSearchQueryPortfolio } from "../src/features/retrieval-spike/query-strategy";
import { SerperShoppingAdapter } from "../src/features/retrieval-spike/serper-shopping-adapter";

const args = process.argv.slice(2);

function option(name: string) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

const live = args.includes("--live");
const suppliedSubject = option("--subject");
const marketTerm = option("--market-term");
const taskId = "11111111-1111-4111-8111-111111111111";
const criterionId = "22222222-2222-4222-8222-222222222222";
const market = { country: "GB", language: "en-GB", currency: "GBP" } as const;
const useCapFixture = suppliedSubject === undefined;
const subject =
  suppliedSubject ?? "I need a light breathable cap for running in this heat";

const briefItems = useCapFixture
  ? [
      {
        criterionId,
        lineageId: "33333333-3333-4333-8333-333333333333",
        conceptId: "44444444-4444-4444-8444-444444444444",
        conceptLabel: "Weight",
        conceptDefinition: "How light the cap should feel in use",
        strength: "strong_preference" as const,
        targetSemantics: "qualitative" as const,
        semanticValue: {
          schemaVersion: 1 as const,
          kind: "qualitative" as const,
          mode: "text" as const,
          text: "lightweight",
        },
      },
      {
        criterionId: "55555555-5555-4555-8555-555555555555",
        lineageId: "66666666-6666-4666-8666-666666666666",
        conceptId: "77777777-7777-4777-8777-777777777777",
        conceptLabel: "Breathability",
        conceptDefinition: "Airflow and comfort in hot weather",
        strength: "strong_preference" as const,
        targetSemantics: "qualitative" as const,
        semanticValue: {
          schemaVersion: 1 as const,
          kind: "qualitative" as const,
          mode: "text" as const,
          text: "breathable in hot weather",
        },
      },
    ]
  : [];

const marketVocabulary =
  marketTerm === undefined && !useCapFixture
    ? []
    : [
        {
          term: marketTerm ?? "race cap",
          rationale:
            "Test a commercial phrase as retrieval theory; it is not shopper truth.",
          basisCriterionIds: useCapFixture ? [criterionId] : [],
        },
      ];

const context = {
  schemaVersion: 1 as const,
  taskId,
  revision: 2n,
  market,
  shoppingSubject: {
    text: subject,
    sourceInputId: "88888888-8888-4888-8888-888888888888",
  },
  brief: {
    schemaVersion: 1 as const,
    taskId,
    revision: 2n,
    market,
    items: briefItems,
  },
  marketVocabulary,
};

const provider = (() => {
  if (!live) return new FakeShoppingProvider();
  const apiKey = process.env.SERPER_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new Error(
      "Live retrieval requires SERPER_API_KEY from a Serper development account",
    );
  }
  return new SerperShoppingAdapter({ apiKey });
})();

const portfolio = buildSearchQueryPortfolio(context);
const result = await executeSearchQueryPortfolio({ portfolio, provider });
const report = {
  mode: live ? "live-serper" : "fake",
  input: context,
  portfolio: result.portfolio,
  queryExecutions: result.queries,
  listings: result.listings,
};

console.log(
  JSON.stringify(
    report,
    (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    2,
  ),
);
