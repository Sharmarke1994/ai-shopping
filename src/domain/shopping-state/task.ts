import { z } from "zod";
import { shoppingTaskIdSchema } from "./ids";
import { marketContextSchema } from "./market-context";

export const taskRevisionSchema = z.bigint().nonnegative();

export const shoppingTaskSchema = z
  .strictObject({
    id: shoppingTaskIdSchema,
    currentRevision: taskRevisionSchema,
    market: marketContextSchema,
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .superRefine((task, context) => {
    if (task.updatedAt < task.createdAt) {
      context.addIssue({
        code: "custom",
        message: "Task updatedAt cannot precede createdAt",
        path: ["updatedAt"],
      });
    }
  });

export type ShoppingTask = z.infer<typeof shoppingTaskSchema>;
