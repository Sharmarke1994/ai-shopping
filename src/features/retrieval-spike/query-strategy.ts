import { randomUUID } from "node:crypto";
import type { BriefItemV1 } from "@/domain/shopping-state/brief";
import { formatBriefItem } from "@/domain/shopping-state/brief";
import {
  retrievalContextV1Schema,
  searchHypothesisIdSchema,
  searchQueryIdSchema,
  searchQueryPortfolioSchema,
  searchRunIdSchema,
  type RetrievalContextV1,
  type SearchQueryPortfolio,
} from "./contracts";

const QUERY_LIMIT = 8;
const QUERY_TEXT_LIMIT = 240;
const COMMERCIAL_QUERY_TEXT_LIMIT = 180;
const MAX_QUERY_ADDITIONS = 5;

function compactWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function appendDistinct(base: string, additions: readonly string[]) {
  let query = compactWhitespace(base);
  for (const rawAddition of additions) {
    const addition = compactWhitespace(rawAddition);
    if (
      addition.length === 0 ||
      query
        .toLocaleLowerCase("en-GB")
        .includes(addition.toLocaleLowerCase("en-GB"))
    ) {
      continue;
    }
    const next = `${query} ${addition}`;
    if (next.length > QUERY_TEXT_LIMIT) break;
    query = next;
  }
  return query;
}

function briefSearchPhrase(item: BriefItemV1, context: RetrievalContextV1) {
  if (
    item.semanticValue.kind === "categorical" &&
    item.semanticValue.operator === "exclude"
  ) {
    return item.semanticValue.values
      .map((value) => `-"${compactWhitespace(value).replaceAll('"', "")}"`)
      .join(" ");
  }
  if (
    item.semanticValue.kind === "categorical" &&
    item.semanticValue.operator === "include" &&
    item.semanticValue.values.length === 1
  ) {
    const value = compactWhitespace(item.semanticValue.values[0]!);
    if (value.toLocaleLowerCase("en-GB") === "yes") {
      return compactWhitespace(item.conceptLabel);
    }
    if (value.toLocaleLowerCase("en-GB") === "no") {
      return `-"${compactWhitespace(item.conceptLabel).replaceAll('"', "")}"`;
    }
  }
  if (item.semanticValue.kind === "boolean") {
    const label = compactWhitespace(item.conceptLabel);
    return item.semanticValue.value ? label : `-"${label.replaceAll('"', "")}"`;
  }
  const rendered = formatBriefItem(item, context.market)
    .replace(/^Strong preference:\s*/i, "")
    .replace(/^Prefer\s+/i, "")
    .replace(/^Maximum\s+/i, "under ");
  const compact = compactWhitespace(rendered);
  if (compact.length <= 80) return compact;
  const bounded = compact.slice(0, 80);
  return bounded.slice(0, bounded.lastIndexOf(" "));
}

function decisionPriority(item: BriefItemV1) {
  const strength =
    item.strength === "hard"
      ? 0
      : item.strength === "strong_preference"
        ? 10
        : 20;
  const comparability = ["money", "money_stretch", "categorical"].includes(
    item.semanticValue.kind,
  )
    ? 0
    : 1;
  return strength + comparability;
}

function prioritizedBriefItems(context: RetrievalContextV1) {
  return context.brief.items
    .map((item, ordinal) => ({ item, ordinal }))
    .sort(
      (left, right) =>
        decisionPriority(left.item) - decisionPriority(right.item) ||
        left.ordinal - right.ordinal,
    )
    .map(({ item }) => item);
}

function commercialSubject(subject: string) {
  const firstSentence = subject.split(/[.!?](?:\s|$)/, 1)[0] ?? subject;
  return compactWhitespace(firstSentence).slice(0, 110);
}

function conciseCommercialSubject(subject: string) {
  return commercialSubject(subject)
    .replace(
      /^(?:i\s+(?:need|want|would like)|(?:please\s+)?find me|looking for)\s+(?:an?|some)?\s*/i,
      "",
    )
    .trim();
}

function briefDrivenQuery(
  subject: string,
  items: readonly BriefItemV1[],
  context: RetrievalContextV1,
) {
  let text = conciseCommercialSubject(subject);
  const basisCriterionIds: BriefItemV1["criterionId"][] = [];
  let additionCount = 0;
  for (const item of items) {
    const phrase = briefSearchPhrase(item, context);
    if (
      phrase.length === 0 ||
      text
        .toLocaleLowerCase("en-GB")
        .includes(phrase.toLocaleLowerCase("en-GB"))
    ) {
      continue;
    }
    if (additionCount >= MAX_QUERY_ADDITIONS) break;
    const next = `${text} ${phrase}`;
    if (next.length > COMMERCIAL_QUERY_TEXT_LIMIT) continue;
    text = next;
    basisCriterionIds.push(item.criterionId);
    additionCount += 1;
  }
  return { text, basisCriterionIds };
}

export type QueryStrategyOptions = Readonly<{
  now?: () => Date;
  createId?: () => string;
}>;

export function buildSearchQueryPortfolio(
  input: unknown,
  options: QueryStrategyOptions = {},
): SearchQueryPortfolio {
  const context = retrievalContextV1Schema.parse(input);
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  const runId = searchRunIdSchema.parse(createId());
  const hypotheses: SearchQueryPortfolio["hypotheses"][number][] = [];
  const queries: SearchQueryPortfolio["queries"][number][] = [];
  const seenQueries = new Set<string>();

  const addQuery = (options: {
    kind: SearchQueryPortfolio["hypotheses"][number]["kind"];
    purpose: SearchQueryPortfolio["queries"][number]["purpose"];
    text: string;
    rationale: string;
    sourceTextIsBasis: boolean;
    basisCriterionIds: SearchQueryPortfolio["hypotheses"][number]["basisCriterionIds"];
  }) => {
    const text = compactWhitespace(options.text).slice(0, QUERY_TEXT_LIMIT);
    const identity = text.toLocaleLowerCase("en-GB");
    if (seenQueries.has(identity)) return;
    seenQueries.add(identity);
    const hypothesisId = searchHypothesisIdSchema.parse(createId());
    hypotheses.push({
      id: hypothesisId,
      runId,
      kind: options.kind,
      rationale: options.rationale,
      sourceTextIsBasis: options.sourceTextIsBasis,
      basisCriterionIds: options.basisCriterionIds,
    });
    queries.push({
      id: searchQueryIdSchema.parse(createId()),
      runId,
      taskId: context.taskId,
      taskRevision: context.revision,
      hypothesisId,
      purpose: options.purpose,
      text,
      market: context.market,
      surface: "shopping",
      limit: QUERY_LIMIT,
    });
  };

  const subject = compactWhitespace(context.shoppingSubject.text);
  addQuery({
    kind: "literal",
    purpose: "literal_precision",
    text: commercialSubject(subject),
    rationale: "Preserve the shopper's own wording as the precision baseline.",
    sourceTextIsBasis: true,
    basisCriterionIds: [],
  });

  const prioritized = prioritizedBriefItems(context);
  const directlySearchableHardItems = prioritized.filter(
    (item) =>
      item.strength === "hard" &&
      [
        "money",
        "money_stretch",
        "measurement",
        "measurement_range",
        "categorical",
        "boolean",
      ].includes(item.semanticValue.kind),
  );
  const constraintItems = [
    ...directlySearchableHardItems,
    ...prioritized.filter(({ strength }) => strength === "strong_preference"),
  ];
  const briefQuery = briefDrivenQuery(subject, constraintItems, context);
  addQuery({
    kind: "brief_expansion",
    purpose: "brief_recall",
    text: briefQuery.text,
    rationale:
      "Add hard requirements and strong preferences in decision priority order without rewriting user truth.",
    sourceTextIsBasis: true,
    basisCriterionIds: briefQuery.basisCriterionIds,
  });

  const preferenceItems = prioritized.filter(
    ({ strength }) => strength === "preference",
  );
  if (preferenceItems.length > 0 && context.marketVocabulary.length === 0) {
    const preferenceQuery = briefDrivenQuery(
      subject,
      [...directlySearchableHardItems, ...preferenceItems],
      context,
    );
    addQuery({
      kind: "brief_expansion",
      purpose: "brief_recall",
      text: preferenceQuery.text,
      rationale:
        "Explore explicit product preferences separately while retaining directly searchable must-haves.",
      sourceTextIsBasis: true,
      basisCriterionIds: preferenceQuery.basisCriterionIds,
    });
  }

  if (context.marketVocabulary.length > 0 && queries.length < 3) {
    const basisCriterionIds = [
      ...new Set(
        context.marketVocabulary.flatMap((seed) => seed.basisCriterionIds),
      ),
    ];
    addQuery({
      kind: "market_vocabulary",
      purpose: "market_language",
      text: appendDistinct(
        conciseCommercialSubject(subject),
        context.marketVocabulary.map((seed) => seed.term),
      ),
      rationale: context.marketVocabulary
        .map((seed) => seed.rationale)
        .join(" ")
        .slice(0, 500),
      sourceTextIsBasis: true,
      basisCriterionIds,
    });
  }

  return searchQueryPortfolioSchema.parse({
    run: {
      id: runId,
      taskId: context.taskId,
      taskRevision: context.revision,
      market: context.market,
      queryStrategyVersion: "retrieval-spike-v3",
      startedAt: now(),
    },
    hypotheses,
    queries,
  });
}
