import { z } from "zod";
import { conceptDefinitionIdSchema, shoppingTaskIdSchema } from "./ids";
import { measurementUnitSchema } from "./semantic-value";
import { taskRevisionSchema } from "./task";

export const conceptValueFamilySchema = z.enum([
  "boolean",
  "qualitative",
  "measurement",
  "money",
  "categorical",
]);

export type ConceptValueFamily = z.infer<typeof conceptValueFamilySchema>;

export const conceptDefinitionSchema = z
  .strictObject({
    id: conceptDefinitionIdSchema,
    taskId: shoppingTaskIdSchema,
    label: z.string().trim().min(1).max(120),
    definition: z.string().trim().min(1).max(500),
    valueFamily: conceptValueFamilySchema,
    canonicalUnit: measurementUnitSchema.nullable(),
    createdRevision: taskRevisionSchema,
    createdAt: z.date(),
  })
  .superRefine((concept, context) => {
    if (
      (concept.valueFamily === "measurement") !==
      (concept.canonicalUnit !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Only measurement concepts require exactly one canonical unit",
        path: ["canonicalUnit"],
      });
    }
  });

export type ConceptDefinition = z.infer<typeof conceptDefinitionSchema>;
