import { asc, eq } from "drizzle-orm";
import type { z } from "zod";
import { conceptDefinitionSchema } from "../../../domain/shopping-state/concept-definition";
import {
  PersistedDataCorruptionError,
  TaskRevisionBoundsError,
} from "../../../domain/shopping-state/errors";
import { shoppingTaskIdSchema } from "../../../domain/shopping-state/ids";
import type {
  ShoppingDatabaseExecutor,
  ShoppingTransaction,
} from "../../../infrastructure/database/clients";
import {
  conceptDefinitions,
  shoppingTasks,
} from "../../../infrastructure/database/schema";
import { mapConceptDefinition, mapShoppingTask } from "./mappers";

type NewConceptDefinition = Omit<
  z.input<typeof conceptDefinitionSchema>,
  "createdAt"
>;

const validationInstant = new Date(0);

export async function insertConceptDefinitionInTransaction(options: {
  tx: ShoppingTransaction;
  concept: NewConceptDefinition;
}) {
  const concept = conceptDefinitionSchema.parse({
    ...options.concept,
    createdAt: validationInstant,
  });

  const [taskRow] = await options.tx
    .select()
    .from(shoppingTasks)
    .where(eq(shoppingTasks.id, concept.taskId))
    .limit(1);
  if (taskRow === undefined) {
    throw new Error(`Shopping task ${concept.taskId} does not exist`);
  }

  const task = mapShoppingTask(taskRow);
  if (concept.createdRevision > task.currentRevision) {
    throw new TaskRevisionBoundsError({
      taskId: task.id,
      attemptedRevision: concept.createdRevision,
      currentRevision: task.currentRevision,
    });
  }

  const [row] = await options.tx
    .insert(conceptDefinitions)
    .values({
      id: concept.id,
      taskId: concept.taskId,
      label: concept.label,
      definition: concept.definition,
      valueFamily: concept.valueFamily,
      canonicalUnit: concept.canonicalUnit,
      createdRevision: concept.createdRevision,
    })
    .returning();
  if (row === undefined) {
    throw new Error("Concept definition insert returned no row");
  }
  return mapConceptDefinition(row);
}

export async function listConceptDefinitions(
  db: ShoppingDatabaseExecutor,
  taskIdInput: unknown,
) {
  const taskId = shoppingTaskIdSchema.parse(taskIdInput);
  const [taskRow] = await db
    .select()
    .from(shoppingTasks)
    .where(eq(shoppingTasks.id, taskId))
    .limit(1);
  if (taskRow === undefined) {
    return [];
  }
  const task = mapShoppingTask(taskRow);
  const rows = await db
    .select()
    .from(conceptDefinitions)
    .where(eq(conceptDefinitions.taskId, taskId))
    .orderBy(
      asc(conceptDefinitions.createdRevision),
      asc(conceptDefinitions.id),
    );
  return rows.map((row) => {
    const concept = mapConceptDefinition(row);
    if (concept.createdRevision > task.currentRevision) {
      throw new PersistedDataCorruptionError({
        recordType: "ConceptDefinition",
        recordId: concept.id,
        cause: new TaskRevisionBoundsError({
          taskId: task.id,
          attemptedRevision: concept.createdRevision,
          currentRevision: task.currentRevision,
        }),
      });
    }
    return concept;
  });
}
