import { z } from "zod";
import { httpUrlSchema } from "@/features/retrieval-spike/contracts";
import { evidenceSourceRoleSchema } from "./contracts";

export const evidenceSearchResultSchema = z.strictObject({
  providerResultId: z.string().min(1).max(500),
  rank: z.number().int().positive(),
  title: z.string().min(1).max(500),
  url: httpUrlSchema,
  snippet: z.string().min(1).max(1_000).nullable(),
  sourceRole: evidenceSourceRoleSchema,
});

export const evidenceSearchResponseSchema = z.strictObject({
  providerRequestId: z.string().min(1).max(240).nullable(),
  results: z.array(evidenceSearchResultSchema).max(5),
  receivedResultCount: z.number().int().nonnegative(),
});

export interface EvidenceSearchProvider {
  readonly provider: "serper" | "fixture";
  search(input: {
    query: string;
    candidateTitle: string;
    merchant: string | null;
  }): Promise<z.infer<typeof evidenceSearchResponseSchema>>;
}

export type EvidenceSearchResponse = z.infer<
  typeof evidenceSearchResponseSchema
>;
