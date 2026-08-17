import {
  PersistedDataCorruptionError,
  TaskNotFoundError,
  TaskRevisionBoundsError,
} from "../../../domain/shopping-state/errors";
import { shoppingTaskIdSchema } from "../../../domain/shopping-state/ids";
import {
  currentShoppingStateSchema,
  historicalShoppingStateSchema,
} from "../../../domain/shopping-state/shopping-state";
import { taskRevisionSchema } from "../../../domain/shopping-state/task";
import type { ShoppingDatabaseExecutor } from "../../../infrastructure/database/clients";
import { listConceptDefinitions } from "./concepts";
import { listDecisionCriteria } from "./criteria";
import { findShoppingTask } from "./tasks";

function validateActiveState(options: {
  taskId: string;
  criteria: Awaited<ReturnType<typeof listDecisionCriteria>>;
}) {
  const byId = new Map(
    options.criteria.map(({ criterion }) => [criterion.id, criterion] as const),
  );
  for (const { criterion } of options.criteria) {
    if (criterion.lifecycle !== "superseded") continue;
    const visited = new Set<string>([criterion.id]);
    let cursor = criterion;
    while (cursor.lifecycle === "superseded") {
      if (
        cursor.supersededById === null ||
        visited.has(cursor.supersededById)
      ) {
        throw new PersistedDataCorruptionError({
          recordType: "DecisionCriterion",
          recordId: criterion.id,
          cause: new Error("Criterion lineage contains a successor cycle"),
        });
      }
      visited.add(cursor.supersededById);
      const successor = byId.get(cursor.supersededById);
      if (
        successor === undefined ||
        successor.taskId !== cursor.taskId ||
        successor.lineageId !== cursor.lineageId ||
        successor.conceptId !== cursor.conceptId ||
        successor.createdRevision !== cursor.endedRevision ||
        successor.createdRevision <= cursor.createdRevision
      ) {
        throw new PersistedDataCorruptionError({
          recordType: "DecisionCriterion",
          recordId: criterion.id,
          cause: new Error(
            "Criterion successor history is not forward and task-local",
          ),
        });
      }
      cursor = successor;
    }
  }
  const activeLineages = new Set<string>();
  const conceptKinds = new Map<
    string,
    { indifferent: number; ordinary: number }
  >();
  for (const { criterion } of options.criteria) {
    if (criterion.lifecycle !== "active") continue;
    if (activeLineages.has(criterion.lineageId)) {
      throw new PersistedDataCorruptionError({
        recordType: "ShoppingTask",
        recordId: options.taskId,
        cause: new Error(
          `Lineage ${criterion.lineageId} has more than one active criterion`,
        ),
      });
    }
    activeLineages.add(criterion.lineageId);
    const counts = conceptKinds.get(criterion.conceptId) ?? {
      indifferent: 0,
      ordinary: 0,
    };
    if (criterion.semanticValue.kind === "indifferent") counts.indifferent += 1;
    else counts.ordinary += 1;
    conceptKinds.set(criterion.conceptId, counts);
  }
  for (const [conceptId, counts] of conceptKinds) {
    if (
      counts.indifferent > 1 ||
      (counts.indifferent > 0 && counts.ordinary > 0)
    ) {
      throw new PersistedDataCorruptionError({
        recordType: "ConceptDefinition",
        recordId: conceptId,
        cause: new Error(
          "Active indifference must be exclusive for its concept",
        ),
      });
    }
  }
}

function validateEffectiveState(options: {
  taskId: string;
  criteria: Awaited<ReturnType<typeof listDecisionCriteria>>;
}) {
  const lineages = new Set<string>();
  const concepts = new Map<string, { indifferent: number; ordinary: number }>();
  for (const { criterion } of options.criteria) {
    if (lineages.has(criterion.lineageId)) {
      throw new PersistedDataCorruptionError({
        recordType: "ShoppingTask",
        recordId: options.taskId,
        cause: new Error(
          "Historical validity intervals overlap within a lineage",
        ),
      });
    }
    lineages.add(criterion.lineageId);
    const counts = concepts.get(criterion.conceptId) ?? {
      indifferent: 0,
      ordinary: 0,
    };
    if (criterion.semanticValue.kind === "indifferent") counts.indifferent += 1;
    else counts.ordinary += 1;
    concepts.set(criterion.conceptId, counts);
  }
  for (const [conceptId, counts] of concepts) {
    if (
      counts.indifferent > 1 ||
      (counts.indifferent > 0 && counts.ordinary > 0)
    ) {
      throw new PersistedDataCorruptionError({
        recordType: "ConceptDefinition",
        recordId: conceptId,
        cause: new Error("Historical indifference is not exclusive"),
      });
    }
  }
}

export async function loadCurrentShoppingState(
  db: ShoppingDatabaseExecutor,
  taskIdInput: unknown,
) {
  const taskId = shoppingTaskIdSchema.parse(taskIdInput);
  const task = await findShoppingTask(db, taskId);
  if (task === null) throw new TaskNotFoundError(taskId);
  const [concepts, allCriteria] = await Promise.all([
    listConceptDefinitions(db, taskId),
    listDecisionCriteria(db, taskId),
  ]);
  validateActiveState({ taskId, criteria: allCriteria });
  return currentShoppingStateSchema.parse({
    task,
    concepts,
    activeCriteria: allCriteria.filter(
      ({ criterion }) => criterion.lifecycle === "active",
    ),
  });
}

export async function loadShoppingStateAtRevision(
  db: ShoppingDatabaseExecutor,
  taskIdInput: unknown,
  revisionInput: unknown,
) {
  const taskId = shoppingTaskIdSchema.parse(taskIdInput);
  const revision = taskRevisionSchema.parse(revisionInput);
  const task = await findShoppingTask(db, taskId);
  if (task === null) throw new TaskNotFoundError(taskId);
  if (revision > task.currentRevision) {
    throw new TaskRevisionBoundsError({
      taskId,
      attemptedRevision: revision,
      currentRevision: task.currentRevision,
    });
  }
  const [allConcepts, allCriteria] = await Promise.all([
    listConceptDefinitions(db, taskId),
    listDecisionCriteria(db, taskId),
  ]);
  const effectiveCriteria = allCriteria.filter(
    ({ criterion }) =>
      criterion.createdRevision <= revision &&
      (criterion.endedRevision === null || revision < criterion.endedRevision),
  );
  validateEffectiveState({ taskId, criteria: effectiveCriteria });
  return historicalShoppingStateSchema.parse({
    task,
    revision,
    concepts: allConcepts.filter(
      (concept) => concept.createdRevision <= revision,
    ),
    effectiveCriteria,
  });
}
