import { z } from "zod";
import { decisionTransitionSchema } from "@/features/product-understanding/decision-transition";
import {
  candidateListingIdSchema,
  criterionIdSchema,
} from "@/domain/shopping-state/ids";

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

export const researchLiveShoppingRequestSchema = z.strictObject({
  operation: z.literal("research"),
  sessionId: liveSessionIdSchema,
});

export const deepenLiveShoppingRequestSchema = z.strictObject({
  operation: z.literal("deepen_research"),
  sessionId: liveSessionIdSchema,
});

export const resolveLiveDestinationsRequestSchema = z.strictObject({
  operation: z.literal("resolve_destinations"),
  sessionId: liveSessionIdSchema,
});

export const researchLiveCandidateRequestSchema = z.strictObject({
  operation: z.literal("research_candidate"),
  sessionId: liveSessionIdSchema,
  candidateListingId: candidateListingIdSchema,
  criterionId: criterionIdSchema.optional(),
});

export const rejectLiveListingRequestSchema = z.strictObject({
  operation: z.enum(["reject_listing", "undo_reject_listing"]),
  sessionId: liveSessionIdSchema,
  candidateListingId: candidateListingIdSchema,
});

export const liveShoppingMutationSchema = z.discriminatedUnion("operation", [
  startLiveShoppingRequestSchema,
  answerLiveShoppingRequestSchema,
  refineLiveShoppingRequestSchema,
  saveLiveListingRequestSchema,
  retryLiveContextRequestSchema,
  resumeLiveSearchRequestSchema,
  researchLiveShoppingRequestSchema,
  deepenLiveShoppingRequestSchema,
  resolveLiveDestinationsRequestSchema,
  researchLiveCandidateRequestSchema,
  rejectLiveListingRequestSchema,
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
  purchaseState: z.enum(["direct", "checking", "fallback"]),
  sourceUrl: z.url().nullable(),
  sourceLabel: z.literal("View Google Shopping source").nullable(),
  deliveryText: z.string().nullable(),
  availabilityText: z.string().nullable(),
  foundAcrossQueries: z.number().int().positive(),
  evidence: z.strictObject({
    sourceFacts: z.array(z.string().min(1).max(160)).max(3),
    directlyEvidenced: z.array(z.string().min(1).max(160)).max(6),
    contradictions: z.array(z.string().min(1).max(160)).max(6),
    unverifiedLabels: z.array(z.string().min(1).max(120)).max(3),
    additionalUnverifiedCount: z.number().int().nonnegative(),
  }),
  saved: z.boolean(),
  rejected: z.boolean(),
});

const liveSearchSchema = z.strictObject({
  status: z.enum(["running", "succeeded", "partial", "failed"]),
  queryCount: z.number().int().positive(),
  completedQueryCount: z.number().int().nonnegative(),
  withheldConflictCount: z.number().int().nonnegative(),
  listings: z.array(liveListingSchema),
});

const evidenceSourceLinkSchema = z.strictObject({
  title: z.string().min(1).max(500),
  url: z.url(),
  role: z.enum([
    "listing",
    "retailer",
    "manufacturer",
    "independent_review",
    "retailer_review_aggregate",
    "visual",
    "other",
  ]),
  depth: z.enum([
    "listing_field",
    "organic_result",
    "fetched_page",
    "listing_image",
  ]),
});

const decisionSupportCandidateSchema = z.strictObject({
  listing: liveListingSchema,
  readiness: z.enum([
    "qualified",
    "needs_verification",
    "trade_off",
    "ineligible",
  ]),
  researchState: z.enum(["available", "researching", "complete", "failed"]),
  strongestSupported: z.boolean(),
  supportedMustHaveCount: z.number().int().nonnegative(),
  mustHaveCount: z.number().int().nonnegative(),
  unresolvedMustHaves: z.array(
    z.strictObject({
      criterionId: z.uuid(),
      label: z.string().min(1).max(200),
      explanation: z.string().min(1).max(500),
    }),
  ),
  whyItFits: z.array(z.string().min(1).max(500)).max(4),
  watchouts: z.array(z.string().min(1).max(500)).max(3),
  unknowns: z
    .array(
      z.strictObject({
        criterionId: z.uuid(),
        label: z.string().min(1).max(200),
        reason: z.enum([
          "not_checked",
          "checked_no_answer",
          "source_disagreement",
          "check_failed",
          "personal_fit",
        ]),
        explanation: z.string().min(1).max(500),
      }),
    )
    .max(3),
  evidenceSources: z.array(evidenceSourceLinkSchema).max(5),
});

const savedComparisonSchema = z.strictObject({
  candidates: z.array(liveListingSchema).min(2).max(4),
  researchStates: z.array(
    z.strictObject({
      candidateListingId: candidateListingIdSchema,
      state: z.enum(["available", "researching", "complete", "failed"]),
    }),
  ),
  purchaseSummaries: z.array(
    z.strictObject({
      candidateListingId: candidateListingIdSchema,
      priceRelationship: z.string().min(1).max(500),
    }),
  ),
  rows: z.array(
    z.strictObject({
      criterionId: z.uuid(),
      label: z.string().min(1).max(200),
      strength: z.enum(["hard", "strong_preference", "preference"]),
      cells: z.array(
        z.strictObject({
          candidateListingId: candidateListingIdSchema,
          status: z.enum(["meets", "conflicts", "uncertain", "not_applicable"]),
          explanation: z.string().min(1).max(500),
          sources: z.array(
            z.strictObject({
              title: z.string().min(1).max(500),
              url: z.url(),
              role: evidenceSourceLinkSchema.shape.role,
              depth: evidenceSourceLinkSchema.shape.depth,
            }),
          ),
        }),
      ),
    }),
  ),
  judgement: z.string().min(1).max(1_500),
  decisionGaps: z.array(
    z.strictObject({
      criterionId: z.uuid(),
      label: z.string().min(1).max(200),
      strength: z.enum(["hard", "strong_preference", "preference"]),
      candidateListingIds: z.array(candidateListingIdSchema).min(1).max(4),
      candidateTitles: z.array(z.string().min(1).max(500)).min(1).max(4),
      explanation: z.string().min(1).max(500),
    }),
  ),
});

const decisionGapSchema = z.strictObject({
  criterionId: z.uuid(),
  label: z.string().min(1).max(200),
  strength: z.enum(["hard", "strong_preference", "preference"]),
  candidateListingIds: z.array(candidateListingIdSchema).min(1).max(5),
  candidateTitles: z.array(z.string().min(1).max(500)).min(1).max(5),
  explanation: z.string().min(1).max(500),
});

const currentDecisionReasonSchema = z.strictObject({
  criterionId: z.uuid(),
  label: z.string().min(1).max(200),
  strength: z.enum(["hard", "strong_preference", "preference"]),
  explanation: z.string().min(1).max(500),
});

const currentDecisionSchema = z.strictObject({
  state: z.enum([
    "researching",
    "leader_needs_verification",
    "leader_with_tradeoff",
    "ready_to_choose",
    "no_clear_winner",
    "insufficient_evidence",
    "no_eligible_option",
  ]),
  recommendationLevel: z.enum(["none", "provisional", "ready"]),
  leadingCandidateListingId: candidateListingIdSchema.nullable(),
  alternativeCandidateListingId: candidateListingIdSchema.nullable(),
  headline: z.string().min(1).max(700),
  explanation: z.string().min(1).max(1_500),
  keyReasons: z.array(currentDecisionReasonSchema).max(3),
  keyTradeoff: currentDecisionReasonSchema.nullable(),
  blockingGap: decisionGapSchema.nullable(),
  whatCouldChangeDecision: decisionGapSchema.nullable(),
  alternativeReason: z.string().min(1).max(1_500).nullable(),
  recommendationBasis: z.enum([
    "evidence_still_developing",
    "meaningful_criterion_separation",
    "sole_eligible_option",
    "unresolved_hard_requirement",
    "equivalent_evidence",
    "insufficient_grounded_evidence",
    "no_eligible_candidate",
  ]),
  purchase: z
    .strictObject({
      candidateListingId: candidateListingIdSchema,
      state: z.enum(["direct", "checking", "fallback"]),
      destinationUrl: z.url(),
      label: z.string().min(1).max(120),
      priceText: z.string().nullable(),
      merchant: z.string().nullable(),
    })
    .nullable(),
});

const liveDecisionSupportSchema = z.strictObject({
  transition: decisionTransitionSchema.nullable().default(null),
  researchStatus: z.enum([
    "not_started",
    "researching",
    "partial",
    "failed",
    "ready",
  ]),
  deepResearchStatus: z.enum([
    "available",
    "researching",
    "complete",
    "partial",
    "failed",
    "not_needed",
  ]),
  researchActivity: z.strictObject({
    firstPassEvidenceCalls: z.number().int().nonnegative(),
    deepeningEvidenceCalls: z.number().int().nonnegative(),
    productUnderstandingCalls: z.number().int().nonnegative(),
  }),
  researchedCandidateCount: z.number().int().nonnegative(),
  sectionMode: z.enum(["qualified_options", "verification_needed"]),
  excludedCandidateCount: z.number().int().nonnegative(),
  decisionGaps: z.array(decisionGapSchema).max(3),
  topOptions: z.array(decisionSupportCandidateSchema).max(5),
  currentDecision: currentDecisionSchema,
  comparison: savedComparisonSchema.nullable(),
});

const actionBase = {
  notice: z.string().nullable(),
};

export const liveShoppingViewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sessionId: liveSessionIdSchema,
  viewEpoch: z.string().regex(/^[a-f0-9]{24}$/),
  subject: z.string(),
  brief: z.array(liveBriefItemSchema),
  savedListings: z.array(liveListingSchema),
  rejectedListings: z.array(liveListingSchema),
  decisionSupport: liveDecisionSupportSchema.nullable(),
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
