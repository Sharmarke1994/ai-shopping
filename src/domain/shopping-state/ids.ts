import { z } from "zod";

export const shoppingTaskIdSchema = z.uuid().brand<"ShoppingTaskId">();
export const taskInputIdSchema = z.uuid().brand<"TaskInputId">();
export const userMessageIdSchema = z.uuid().brand<"UserMessageId">();
export const conceptDefinitionIdSchema = z
  .uuid()
  .brand<"ConceptDefinitionId">();
export const criterionIdSchema = z.uuid().brand<"CriterionId">();
export const criterionLineageIdSchema = z.uuid().brand<"CriterionLineageId">();
export const criterionSourceIdSchema = z.uuid().brand<"CriterionSourceId">();
export const candidateListingIdSchema = z.uuid().brand<"CandidateListingId">();

export type ShoppingTaskId = z.infer<typeof shoppingTaskIdSchema>;
export type TaskInputId = z.infer<typeof taskInputIdSchema>;
export type UserMessageId = z.infer<typeof userMessageIdSchema>;
export type ConceptDefinitionId = z.infer<typeof conceptDefinitionIdSchema>;
export type CriterionId = z.infer<typeof criterionIdSchema>;
export type CriterionLineageId = z.infer<typeof criterionLineageIdSchema>;
export type CriterionSourceId = z.infer<typeof criterionSourceIdSchema>;
export type CandidateListingId = z.infer<typeof candidateListingIdSchema>;
