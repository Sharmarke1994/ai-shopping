import { z } from "zod";
import { shoppingBriefV1Schema } from "@/domain/shopping-state/brief";
import {
  criterionIdSchema,
  shoppingTaskIdSchema,
  taskInputIdSchema,
} from "@/domain/shopping-state/ids";
import { marketContextSchema } from "@/domain/shopping-state/market-context";
import { taskRevisionSchema } from "@/domain/shopping-state/task";

export const searchRunIdSchema = z.uuid().brand<"SearchRunId">();
export const searchHypothesisIdSchema = z.uuid().brand<"SearchHypothesisId">();
export const searchQueryIdSchema = z.uuid().brand<"SearchQueryId">();

const exactShopperTextSchema = z
  .string()
  .min(1)
  .max(10_000)
  .refine((value) => value.trim().length > 0, "Expected shopper text");

export const marketVocabularySeedSchema = z.strictObject({
  term: z.string().min(1).max(120),
  rationale: z.string().min(1).max(500),
  basisCriterionIds: z.array(criterionIdSchema).max(20).readonly(),
});

export const retrievalContextV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    taskId: shoppingTaskIdSchema,
    revision: taskRevisionSchema,
    market: marketContextSchema,
    shoppingSubject: z.strictObject({
      text: exactShopperTextSchema,
      sourceInputId: taskInputIdSchema,
    }),
    brief: shoppingBriefV1Schema,
    marketVocabulary: z.array(marketVocabularySeedSchema).max(3).readonly(),
  })
  .superRefine((context, refinement) => {
    if (context.brief.taskId !== context.taskId) {
      refinement.addIssue({
        code: "custom",
        path: ["brief", "taskId"],
        message: "Brief and retrieval context must belong to the same task",
      });
    }
    if (context.brief.revision !== context.revision) {
      refinement.addIssue({
        code: "custom",
        path: ["brief", "revision"],
        message: "Brief and retrieval context must use the same revision",
      });
    }
    if (
      context.brief.market.country !== context.market.country ||
      context.brief.market.language !== context.market.language ||
      context.brief.market.currency !== context.market.currency
    ) {
      refinement.addIssue({
        code: "custom",
        path: ["brief", "market"],
        message: "Brief and retrieval context must use the same market",
      });
    }
    const criterionIds = new Set(
      context.brief.items.map((item) => item.criterionId),
    );
    for (const [seedIndex, seed] of context.marketVocabulary.entries()) {
      for (const criterionId of seed.basisCriterionIds) {
        if (!criterionIds.has(criterionId)) {
          refinement.addIssue({
            code: "custom",
            path: ["marketVocabulary", seedIndex, "basisCriterionIds"],
            message:
              "Market-vocabulary basis must reference an active brief item",
          });
        }
      }
    }
  });

export const searchRunSchema = z.strictObject({
  id: searchRunIdSchema,
  taskId: shoppingTaskIdSchema,
  taskRevision: taskRevisionSchema,
  market: marketContextSchema,
  queryStrategyVersion: z.literal("retrieval-spike-v1"),
  startedAt: z.date(),
});

export const searchHypothesisSchema = z.strictObject({
  id: searchHypothesisIdSchema,
  runId: searchRunIdSchema,
  kind: z.enum(["literal", "brief_expansion", "market_vocabulary"]),
  rationale: z.string().min(1).max(500),
  sourceTextIsBasis: z.boolean(),
  basisCriterionIds: z.array(criterionIdSchema).max(20).readonly(),
});

export const searchQuerySchema = z.strictObject({
  id: searchQueryIdSchema,
  runId: searchRunIdSchema,
  taskId: shoppingTaskIdSchema,
  taskRevision: taskRevisionSchema,
  hypothesisId: searchHypothesisIdSchema,
  purpose: z.enum(["literal_precision", "brief_recall", "market_language"]),
  text: z.string().min(1).max(240),
  market: marketContextSchema,
  surface: z.literal("shopping"),
  limit: z.number().int().min(1).max(20),
});

export const searchQueryPortfolioSchema = z.strictObject({
  run: searchRunSchema,
  hypotheses: z.array(searchHypothesisSchema).min(1).max(3).readonly(),
  queries: z.array(searchQuerySchema).min(1).max(3).readonly(),
});

const observedMoneySchema = z.strictObject({
  amountMinor: z.number().int().nonnegative(),
  currency: z.literal("GBP"),
});

export const candidateListingSchema = z.strictObject({
  taskId: shoppingTaskIdSchema,
  runId: searchRunIdSchema,
  queryId: searchQueryIdSchema,
  provider: z.enum(["serper", "fixture"]),
  providerResultId: z.string().min(1).max(500),
  sourceRank: z.number().int().positive(),
  surface: z.literal("shopping"),
  title: z.string().min(1).max(1_000),
  url: z.url(),
  canonicalUrl: z.url(),
  merchant: z.string().min(1).max(500).nullable(),
  price: observedMoneySchema.nullable(),
  priceText: z.string().min(1).max(120).nullable(),
  imageUrl: z.url().nullable(),
  deliveryText: z.string().min(1).max(500).nullable(),
  availabilityText: z.string().min(1).max(500).nullable(),
  retrievedAt: z.date(),
});

export const providerSearchDiagnosticsSchema = z.strictObject({
  receivedResultCount: z.number().int().nonnegative(),
  rejectedResultCount: z.number().int().nonnegative(),
});

export const providerSearchResultSchema = z.strictObject({
  listings: z.array(candidateListingSchema).readonly(),
  diagnostics: providerSearchDiagnosticsSchema,
});

export type RetrievalContextV1 = z.infer<typeof retrievalContextV1Schema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type SearchQueryPortfolio = z.infer<typeof searchQueryPortfolioSchema>;
export type CandidateListing = z.infer<typeof candidateListingSchema>;
export type ProviderSearchResult = z.infer<typeof providerSearchResultSchema>;

export interface ShoppingSearchProvider {
  search(query: SearchQuery): Promise<ProviderSearchResult>;
}
