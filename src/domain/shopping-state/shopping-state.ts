import { z } from "zod";
import { conceptDefinitionSchema } from "./concept-definition";
import {
  criterionSourceSchema,
  decisionCriterionSchema,
} from "./decision-criterion";
import { taskRevisionSchema, shoppingTaskSchema } from "./task";

const criterionWithSourcesSchema = z.strictObject({
  criterion: decisionCriterionSchema,
  sources: z.array(criterionSourceSchema).readonly(),
});

export const currentShoppingStateSchema = z.strictObject({
  task: shoppingTaskSchema,
  concepts: z.array(conceptDefinitionSchema).readonly(),
  activeCriteria: z.array(criterionWithSourcesSchema).readonly(),
});

export const historicalShoppingStateSchema = z.strictObject({
  task: shoppingTaskSchema,
  revision: taskRevisionSchema,
  concepts: z.array(conceptDefinitionSchema).readonly(),
  effectiveCriteria: z.array(criterionWithSourcesSchema).readonly(),
});

export type CurrentShoppingState = z.infer<typeof currentShoppingStateSchema>;
export type HistoricalShoppingState = z.infer<
  typeof historicalShoppingStateSchema
>;
