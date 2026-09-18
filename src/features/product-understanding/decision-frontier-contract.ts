import { z } from "zod";

const frontierBasisSchema = z.strictObject({
  criterionId: z.uuid(),
  label: z.string().min(1).max(200),
  strength: z.enum(["hard", "strong_preference", "preference"]),
  candidateListingId: z.uuid(),
  assessmentId: z.uuid(),
  observationIds: z.array(z.uuid()).min(1).max(50),
  explanation: z.string().min(1).max(500),
});

/** Current assessment projection only; never stored as shopper or product truth. */
export const decisionFrontierSchema = z.strictObject({
  kind: z.literal("eligible_alternative"),
  candidateListingId: z.uuid(),
  title: z.string().min(1).max(1000),
  summary: z.string().min(1).max(1500),
  giveUp: z.string().min(1).max(1500),
  leaderAdvantages: z.array(frontierBasisSchema).min(1).max(2),
  alternativeAdvantages: z.array(frontierBasisSchema).min(1).max(2),
  money: z
    .strictObject({
      currency: z.string().regex(/^[A-Z]{3}$/),
      targetMinor: z.number().int().nonnegative().safe(),
      leaderAmountMinor: z.number().int().nonnegative().safe(),
      alternativeAmountMinor: z.number().int().nonnegative().safe(),
      savingMinor: z.number().int().positive().safe(),
      belowTargetMinor: z.number().int().nonnegative().safe(),
    })
    .nullable(),
});

export type DecisionFrontier = z.infer<typeof decisionFrontierSchema>;
export type FrontierBasis = DecisionFrontier["leaderAdvantages"][number];
