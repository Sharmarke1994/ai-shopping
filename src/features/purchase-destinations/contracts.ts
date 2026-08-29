import { z } from "zod";
import {
  candidateListingIdSchema,
  contextActionIdSchema,
  shoppingTaskIdSchema,
} from "@/domain/shopping-state/ids";
import { taskRevisionSchema } from "@/domain/shopping-state/task";
import {
  httpUrlSchema,
  searchRunIdSchema,
  shoppingProviderSchema,
} from "@/features/retrieval-spike/contracts";

export const merchantDestinationResolutionIdSchema = z
  .uuid()
  .brand<"MerchantDestinationResolutionId">();

export const merchantDestinationLeaseTokenSchema = z
  .uuid()
  .brand<"MerchantDestinationLeaseToken">();

export const merchantDestinationRejectionCodeSchema = z.enum([
  "no_results",
  "invalid_result",
  "unsafe_url",
  "intermediary",
  "comparison_or_content",
  "merchant_mismatch",
  "merchant_brand_ambiguity",
  "non_product_page",
  "ambiguous_identity",
  "title_mismatch",
  "variant_mismatch",
]);

export const merchantDestinationFailureCodeSchema = z.enum([
  "provider_failed",
  "invalid_provider_result",
]);

export const merchantDestinationTopAuthoritySchema = z.strictObject({
  sessionId: z.uuid(),
  contextActionId: contextActionIdSchema,
  searchRunId: searchRunIdSchema,
  taskRevision: taskRevisionSchema,
});

export const merchantDestinationResolutionRequestSchema = z.strictObject({
  requestId: merchantDestinationResolutionIdSchema,
  taskId: shoppingTaskIdSchema,
  searchRunId: searchRunIdSchema,
  candidateListingId: candidateListingIdSchema,
  title: z.string().min(1).max(1_000),
  merchant: z.string().min(1).max(500),
  googleShoppingUrl: httpUrlSchema,
  queryText: z.string().min(1).max(500),
});

export const merchantDestinationResolutionResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z.strictObject({
      outcome: z.literal("resolved"),
      destinationUrl: httpUrlSchema.refine(
        (value) => new URL(value).protocol === "https:",
        { message: "A resolved merchant destination must use HTTPS" },
      ),
      acceptedResultTitle: z.string().min(1).max(1_000),
      observedResultUrl: httpUrlSchema
        .refine((value) => new URL(value).protocol === "https:", {
          message: "An observed merchant result must use HTTPS",
        })
        .nullable(),
      consideredResultCount: z.number().int().positive(),
    }),
    z.strictObject({
      outcome: z.literal("rejected"),
      rejectionCode: merchantDestinationRejectionCodeSchema,
      consideredResultCount: z.number().int().nonnegative(),
    }),
  ],
);

export type MerchantDestinationResolutionRequest = z.infer<
  typeof merchantDestinationResolutionRequestSchema
>;
export type MerchantDestinationRejectionCode = z.infer<
  typeof merchantDestinationRejectionCodeSchema
>;
export type MerchantDestinationResolutionResult = z.infer<
  typeof merchantDestinationResolutionResultSchema
>;
export type MerchantDestinationTopAuthority = z.infer<
  typeof merchantDestinationTopAuthoritySchema
>;

export class MerchantDestinationResolverError extends Error {
  constructor(
    message: string,
    readonly code: z.infer<typeof merchantDestinationFailureCodeSchema>,
  ) {
    super(message);
    this.name = "MerchantDestinationResolverError";
  }
}

export interface MerchantDestinationResolver {
  readonly provider: z.infer<typeof shoppingProviderSchema>;
  /** Hard upper bound enforced by the adapter for one provider request. */
  readonly maxRequestDurationMs: number;
  resolve(
    request: MerchantDestinationResolutionRequest,
  ): Promise<MerchantDestinationResolutionResult>;
}
