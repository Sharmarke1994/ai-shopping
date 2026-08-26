import { describe, expect, it } from "vitest";
import { searchQueryPortfolioSchema } from "./contracts";
import { buildSearchQueryPortfolio } from "./query-strategy";

const ids = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
  "10000000-0000-4000-8000-000000000004",
  "10000000-0000-4000-8000-000000000005",
  "10000000-0000-4000-8000-000000000006",
  "10000000-0000-4000-8000-000000000007",
] as const;

function context() {
  const taskId = "11111111-1111-4111-8111-111111111111";
  const criterionId = "22222222-2222-4222-8222-222222222222";
  return {
    schemaVersion: 1 as const,
    taskId,
    revision: 2n,
    market: { country: "GB", language: "en-GB", currency: "GBP" },
    shoppingSubject: {
      text: "light breathable running cap",
      sourceInputId: "33333333-3333-4333-8333-333333333333",
    },
    brief: {
      schemaVersion: 1 as const,
      taskId,
      revision: 2n,
      market: { country: "GB", language: "en-GB", currency: "GBP" },
      items: [
        {
          criterionId,
          lineageId: "44444444-4444-4444-8444-444444444444",
          conceptId: "55555555-5555-4555-8555-555555555555",
          conceptLabel: "Weight",
          conceptDefinition: "How light the cap should feel in use",
          strength: "strong_preference" as const,
          targetSemantics: "qualitative" as const,
          semanticValue: {
            schemaVersion: 1 as const,
            kind: "qualitative" as const,
            mode: "text" as const,
            text: "very lightweight",
          },
        },
      ],
    },
    marketVocabulary: [
      {
        term: "race cap",
        rationale:
          "Test market language that may surface low-bulk running caps.",
        basisCriterionIds: [criterionId],
      },
    ],
  };
}

describe("retrieval-spike query strategy", () => {
  it("creates a small purpose-labelled portfolio with explicit hypothesis lineage", () => {
    let cursor = 0;
    const input = context();
    const untouched = structuredClone(input);
    const portfolio = buildSearchQueryPortfolio(input, {
      now: () => new Date("2026-08-23T12:00:00.000Z"),
      createId: () => ids[cursor++]!,
    });

    expect(portfolio.queries).toHaveLength(3);
    expect(portfolio.queries.map((query) => query.purpose)).toEqual([
      "literal_precision",
      "brief_recall",
      "market_language",
    ]);
    expect(portfolio.queries[2]?.text).toContain("race cap");
    expect(portfolio.hypotheses[2]).toMatchObject({
      kind: "market_vocabulary",
      sourceTextIsBasis: true,
      basisCriterionIds: [input.brief.items[0]!.criterionId],
    });
    expect(input).toEqual(untouched);
    expect(input.brief.items[0]?.semanticValue).toEqual({
      schemaVersion: 1,
      kind: "qualitative",
      mode: "text",
      text: "very lightweight",
    });
  });

  it("omits duplicate expansions rather than spending duplicate calls", () => {
    let cursor = 0;
    const input = context();
    input.shoppingSubject.text =
      "light breathable running cap very lightweight race cap";
    const portfolio = buildSearchQueryPortfolio(input, {
      createId: () => ids[cursor++]!,
    });

    expect(portfolio.queries).toHaveLength(1);
    expect(portfolio.hypotheses).toHaveLength(1);
  });

  it("rejects a speculative term that claims lineage to another task's criterion", () => {
    const input = context();
    input.marketVocabulary[0]!.basisCriterionIds = [
      "99999999-9999-4999-8999-999999999999",
    ];

    expect(() => buildSearchQueryPortfolio(input)).toThrow(
      "Market-vocabulary basis must reference an active brief item",
    );
  });

  it("rejects query lineage that diverges from its run snapshot", () => {
    let cursor = 0;
    const portfolio = buildSearchQueryPortfolio(context(), {
      createId: () => ids[cursor++]!,
    });
    const broken = {
      ...portfolio,
      queries: portfolio.queries.map((query, index) =>
        index === 0 ? { ...query, taskRevision: 3n } : query,
      ),
    };

    expect(searchQueryPortfolioSchema.safeParse(broken).success).toBe(false);
  });

  it("spends the bounded query on hard constraints before weaker preferences", () => {
    let cursor = 0;
    const base = context();
    const input = {
      ...base,
      shoppingSubject: {
        ...base.shoppingSubject,
        text: "I need a computer mouse for long work days. I have tried several ordinary mice and would like sensible options without wasting time on generic marketplace noise.",
      },
      brief: {
        ...base.brief,
        items: [
          ...Array.from({ length: 4 }, (_, index) => ({
            ...base.brief.items[0]!,
            criterionId: `22222222-2222-4222-8222-22222222222${index + 2}`,
            lineageId: `44444444-4444-4444-8444-44444444444${index + 2}`,
            conceptId: `55555555-5555-4555-8555-55555555555${index + 2}`,
            conceptLabel: `Weak preference ${index + 1}`,
            strength: "preference" as const,
            semanticValue: {
              schemaVersion: 1 as const,
              kind: "qualitative" as const,
              mode: "text" as const,
              text: `optional comfort detail ${index + 1}`,
            },
          })),
          {
            ...base.brief.items[0]!,
            criterionId: "22222222-2222-4222-8222-222222222230",
            lineageId: "44444444-4444-4444-8444-444444444430",
            conceptId: "55555555-5555-4555-8555-555555555530",
            conceptLabel: "Budget",
            strength: "hard" as const,
            targetSemantics: "range" as const,
            semanticValue: {
              schemaVersion: 1 as const,
              kind: "money" as const,
              mode: "ceiling" as const,
              amountMinor: 5000,
              currency: "GBP" as const,
            },
          },
          {
            ...base.brief.items[0]!,
            criterionId: "22222222-2222-4222-8222-222222222231",
            lineageId: "44444444-4444-4444-8444-444444444431",
            conceptId: "55555555-5555-4555-8555-555555555531",
            conceptLabel: "Brand exclusion",
            strength: "hard" as const,
            targetSemantics: "categorical" as const,
            semanticValue: {
              schemaVersion: 1 as const,
              kind: "categorical" as const,
              operator: "exclude" as const,
              values: ["Amazon Basics"],
            },
          },
          {
            ...base.brief.items[0]!,
            criterionId: "22222222-2222-4222-8222-222222222232",
            lineageId: "44444444-4444-4444-8444-444444444432",
            conceptId: "55555555-5555-4555-8555-555555555532",
            conceptLabel: "Wireless connectivity",
            strength: "hard" as const,
            targetSemantics: "categorical" as const,
            semanticValue: {
              schemaVersion: 1 as const,
              kind: "boolean" as const,
              value: true,
            },
          },
        ],
      },
    };
    const untouched = structuredClone(input);

    const portfolio = buildSearchQueryPortfolio(input, {
      createId: () => ids[cursor++]!,
    });
    const expanded = portfolio.queries.find(
      ({ purpose }) => purpose === "brief_recall",
    );

    expect(portfolio.run.queryStrategyVersion).toBe("retrieval-spike-v3");
    expect(expanded?.text).toContain("under £50");
    expect(expanded?.text).toContain('-"Amazon Basics"');
    expect(expanded?.text).toContain("Wireless connectivity");
    expect(expanded?.text).not.toContain("Wireless connectivity: yes");
    expect(portfolio.hypotheses[1]?.basisCriterionIds).toEqual(
      expect.arrayContaining([
        "22222222-2222-4222-8222-222222222230",
        "22222222-2222-4222-8222-222222222231",
      ]),
    );
    expect(input).toEqual(untouched);
  });
});
