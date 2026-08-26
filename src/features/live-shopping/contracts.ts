import { z } from "zod";
import { candidateListingIdSchema } from "@/domain/shopping-state/ids";

export const liveSessionIdSchema = z.uuid().brand<"LiveSessionId">();
export const liveTurnIdSchema = z.uuid().brand<"LiveTurnId">();

const shopperTextSchema = z
  .string()
  .min(1)
  .max(10_000)
  .refine((value) => value.trim().length > 0, "Tell us what you need");

export const startLiveShoppingRequestSchema = z.strictObject({
  operation: z.literal("start"),
  sessionId: liveSessionIdSchema,
  turnId: liveTurnIdSchema,
  message: shopperTextSchema,
});

export const answerLiveShoppingRequestSchema = z.strictObject({
  operation: z.literal("answer"),
  sessionId: liveSessionIdSchema,
  turnId: liveTurnIdSchema,
  answer: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("open_text"), text: shopperTextSchema }),
    z.strictObject({
      mode: z.literal("single_select"),
      optionOrdinal: z.number().int().min(0).max(3),
    }),
  ]),
});

export const refineLiveShoppingRequestSchema = z.strictObject({
  operation: z.literal("refine"),
  sessionId: liveSessionIdSchema,
  turnId: liveTurnIdSchema,
  message: shopperTextSchema,
});

export const saveLiveListingRequestSchema = z.strictObject({
  operation: z.enum(["save_listing", "unsave_listing"]),
  sessionId: liveSessionIdSchema,
  candidateListingId: candidateListingIdSchema,
});

export const retryLiveContextRequestSchema = z.strictObject({
  operation: z.literal("retry_context"),
  sessionId: liveSessionIdSchema,
});

export const resumeLiveSearchRequestSchema = z.strictObject({
  operation: z.literal("resume_search"),
  sessionId: liveSessionIdSchema,
});

export const liveShoppingMutationSchema = z.discriminatedUnion("operation", [
  startLiveShoppingRequestSchema,
  answerLiveShoppingRequestSchema,
  refineLiveShoppingRequestSchema,
  saveLiveListingRequestSchema,
  retryLiveContextRequestSchema,
  resumeLiveSearchRequestSchema,
]);

const liveBriefItemSchema = z.strictObject({
  label: z.string(),
  value: z.string(),
  emphasis: z.enum(["must", "strong", "preference"]),
});

const liveListingSchema = z.strictObject({
  candidateListingId: candidateListingIdSchema,
  displayId: z.string(),
  title: z.string(),
  merchant: z.string().nullable(),
  priceText: z.string().nullable(),
  imageUrl: z.url().nullable(),
  destinationUrl: z.url(),
  destinationLabel: z.string().min(1).max(120),
  sourceUrl: z.url().nullable(),
  sourceLabel: z.literal("View Google Shopping source").nullable(),
  deliveryText: z.string().nullable(),
  availabilityText: z.string().nullable(),
  foundAcrossQueries: z.number().int().positive(),
  evidence: z.strictObject({
    directlyEvidenced: z.array(z.string().min(1).max(160)).max(6),
    contradictions: z.array(z.string().min(1).max(160)).max(6),
    unverifiedLabels: z.array(z.string().min(1).max(120)).max(3),
    additionalUnverifiedCount: z.number().int().nonnegative(),
  }),
  saved: z.boolean(),
});

const liveSearchSchema = z.strictObject({
  status: z.enum(["running", "succeeded", "partial", "failed"]),
  queryCount: z.number().int().positive(),
  completedQueryCount: z.number().int().nonnegative(),
  withheldConflictCount: z.number().int().nonnegative(),
  listings: z.array(liveListingSchema),
});

const actionBase = {
  notice: z.string().nullable(),
};

export const liveShoppingViewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sessionId: liveSessionIdSchema,
  subject: z.string(),
  brief: z.array(liveBriefItemSchema),
  savedListings: z.array(liveListingSchema),
  action: z.discriminatedUnion("kind", [
    z.strictObject({
      ...actionBase,
      kind: z.literal("understanding"),
    }),
    z.strictObject({
      ...actionBase,
      kind: z.literal("understanding_failed"),
      retryable: z.literal(true),
    }),
    z.strictObject({
      ...actionBase,
      kind: z.literal("ask"),
      prompt: z.string(),
      whyNow: z.string(),
      responseMode: z.enum(["open_text", "single_select"]),
      options: z.array(
        z.strictObject({
          ordinal: z.number().int().nonnegative(),
          label: z.string(),
        }),
      ),
    }),
    z.strictObject({
      ...actionBase,
      kind: z.literal("search"),
      search: liveSearchSchema.nullable(),
    }),
    z.strictObject({
      ...actionBase,
      kind: z.literal("show_refine"),
    }),
  ]),
});

export const liveShoppingErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    message: z.string(),
  }),
});

export type LiveShoppingMutation = z.infer<typeof liveShoppingMutationSchema>;
export type LiveShoppingView = z.infer<typeof liveShoppingViewSchema>;
