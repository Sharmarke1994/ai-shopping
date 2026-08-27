import { z } from "zod";
import {
  candidateListingIdSchema,
  contextActionIdSchema,
} from "@/domain/shopping-state/ids";
import {
  candidateListingSchema,
  searchQueryIdSchema,
  searchQueryPortfolioSchema,
  shoppingProviderSchema,
} from "../contracts";

export const searchQueryExecutionIdSchema = z
  .uuid()
  .brand<"SearchQueryExecutionId">();

const executionBase = {
  id: searchQueryExecutionIdSchema,
  queryId: searchQueryIdSchema,
  providerRequestId: z.string().min(1).max(240).nullable(),
  startedAt: z.date(),
  finishedAt: z.date(),
};

export const persistedSearchQueryExecutionSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      ...executionBase,
      status: z.literal("succeeded"),
      receivedResultCount: z.number().int().nonnegative(),
      rejectedResultCount: z.number().int().nonnegative(),
      failureCode: z.null(),
    }),
    z.strictObject({
      ...executionBase,
      status: z.literal("failed"),
      receivedResultCount: z.null(),
      rejectedResultCount: z.null(),
      failureCode: z.enum(["provider_failed", "invalid_provider_result"]),
    }),
  ],
);

export const persistedCandidateListingSchema =
  candidateListingSchema.safeExtend({
    id: candidateListingIdSchema,
    queryExecutionId: searchQueryExecutionIdSchema,
  });

export const persistedSearchRunSchema = z.strictObject({
  contextActionId: contextActionIdSchema,
  provider: shoppingProviderSchema,
  status: z.enum(["running", "succeeded", "partial", "failed"]),
  finishedAt: z.date().nullable(),
  portfolio: searchQueryPortfolioSchema,
  queryExecutions: z
    .array(persistedSearchQueryExecutionSchema)
    .max(3)
    .readonly(),
  listings: z.array(persistedCandidateListingSchema).readonly(),
});

export type PersistedSearchQueryExecution = z.infer<
  typeof persistedSearchQueryExecutionSchema
>;
export type PersistedCandidateListing = z.infer<
  typeof persistedCandidateListingSchema
>;
export type PersistedSearchRun = z.infer<typeof persistedSearchRunSchema>;
