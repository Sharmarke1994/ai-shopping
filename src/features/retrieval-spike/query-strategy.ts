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
  const rendered = formatBriefItem(item, context.market)
    .replace(/^Strong preference:\s*/i, "")
    .replace(/^Prefer\s+/i, "")
    .replace(/^Maximum\s+/i, "under ");
  return compactWhitespace(rendered);
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
    text: subject,
    rationale: "Preserve the shopper's own wording as the precision baseline.",
    sourceTextIsBasis: true,
    basisCriterionIds: [],
  });

  const briefPhrases = context.brief.items
    .slice(0, 4)
    .map((item) => briefSearchPhrase(item, context));
  addQuery({
    kind: "brief_expansion",
    purpose: "brief_recall",
    text: appendDistinct(subject, briefPhrases),
    rationale:
      "Add only active authoritative brief values to improve recall without rewriting user truth.",
    sourceTextIsBasis: true,
    basisCriterionIds: context.brief.items
      .slice(0, 4)
      .map((item) => item.criterionId),
  });

  if (context.marketVocabulary.length > 0) {
    const basisCriterionIds = [
      ...new Set(
        context.marketVocabulary.flatMap((seed) => seed.basisCriterionIds),
      ),
    ];
    addQuery({
      kind: "market_vocabulary",
      purpose: "market_language",
      text: appendDistinct(
        subject,
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
      queryStrategyVersion: "retrieval-spike-v1",
      startedAt: now(),
    },
    hypotheses,
    queries,
  });
}
