import { and, asc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import { conceptDefinitionIdSchema } from "../../../domain/shopping-state/ids";
import {
  criterionSourceSchema,
  decisionCriterionSchema,
  assertCriterionPersistable,
  parseDecisionCriterionForContext,
  validateCriterionSources,
} from "../../../domain/shopping-state/decision-criterion";
import {
  PersistedDataCorruptionError,
  SourceInputMismatchError,
  TaskRevisionBoundsError,
} from "../../../domain/shopping-state/errors";
import { shoppingTaskIdSchema } from "../../../domain/shopping-state/ids";
import type {
  ShoppingDatabaseExecutor,
  ShoppingTransaction,
} from "../../../infrastructure/database/clients";
import {
  conceptDefinitions,
  criterionSources,
  decisionCriteria,
  shoppingTasks,
  taskInputs,
} from "../../../infrastructure/database/schema";
import {
  mapConceptDefinition,
  mapCriterionSource,
  mapDecisionCriterion,
  mapShoppingTask,
} from "./mappers";

type NewDecisionCriterion = Omit<
  z.input<typeof decisionCriterionSchema>,
  "createdAt" | "updatedAt"
>;
type NewCriterionSource = Omit<
  z.input<typeof criterionSourceSchema>,
  "createdAt"
>;

const validationInstant = new Date(0);

async function loadCriterionContext(options: {
  db: ShoppingDatabaseExecutor;
  taskId: ReturnType<typeof shoppingTaskIdSchema.parse>;
  conceptId: ReturnType<typeof conceptDefinitionIdSchema.parse>;
}) {
  const [taskRow] = await options.db
    .select()
    .from(shoppingTasks)
    .where(eq(shoppingTasks.id, options.taskId))
    .limit(1);
  const [conceptRow] = await options.db
    .select()
    .from(conceptDefinitions)
    .where(
      and(
        eq(conceptDefinitions.taskId, options.taskId),
        eq(conceptDefinitions.id, options.conceptId),
      ),
    )
    .limit(1);

  if (taskRow === undefined || conceptRow === undefined) {
    throw new Error("Criterion task or concept does not exist in one task");
  }
  return {
    task: mapShoppingTask(taskRow),
    concept: mapConceptDefinition(conceptRow),
  };
}

export async function insertCriterionWithSourcesInTransaction(options: {
  tx: ShoppingTransaction;
  criterion: NewDecisionCriterion;
  sources: readonly NewCriterionSource[];
}) {
  const { task, concept } = await loadCriterionContext({
    db: options.tx,
    taskId: shoppingTaskIdSchema.parse(options.criterion.taskId),
    conceptId: conceptDefinitionIdSchema.parse(options.criterion.conceptId),
  });
  const parsed = parseDecisionCriterionForContext({
    criterion: {
      ...options.criterion,
      createdAt: validationInstant,
      updatedAt: validationInstant,
    },
    concept,
    task,
  }).criterion;
  assertCriterionPersistable(parsed);

  const revisions = [parsed.createdRevision, parsed.endedRevision].filter(
    (revision): revision is bigint => revision !== null,
  );
  const highestRevision = revisions.reduce(
    (highest, revision) => (revision > highest ? revision : highest),
    0n,
  );
  if (highestRevision > task.currentRevision) {
    throw new TaskRevisionBoundsError({
      taskId: task.id,
      attemptedRevision: highestRevision,
      currentRevision: task.currentRevision,
    });
  }

  const parsedSources = validateCriterionSources({
    criterion: parsed,
    sources: options.sources.map((source) => ({
      ...source,
      createdAt: validationInstant,
    })),
  });
  const sourceInputIds = [
    ...new Set(parsedSources.map((source) => source.taskInputId)),
  ];
  const inputRows = await options.tx
    .select({ id: taskInputs.id, inputKind: taskInputs.inputKind })
    .from(taskInputs)
    .where(
      and(
        eq(taskInputs.taskId, task.id),
        inArray(taskInputs.id, sourceInputIds),
      ),
    );
  const inputKinds = new Map(
    inputRows.map((row) => [row.id, row.inputKind] as const),
  );
  for (const source of parsedSources) {
    if (inputKinds.get(source.taskInputId) !== source.sourceKind) {
      throw new SourceInputMismatchError(
        `Source ${source.id} kind does not match its exact task input`,
      );
    }
  }

  const [criterionRow] = await options.tx
    .insert(decisionCriteria)
    .values({
      id: parsed.id,
      taskId: parsed.taskId,
      lineageId: parsed.lineageId,
      conceptId: parsed.conceptId,
      authority: parsed.authority,
      strength: parsed.strength,
      targetSemantics: parsed.targetSemantics,
      valueSchemaVersion: parsed.valueSchemaVersion,
      valueKind: parsed.valueKind,
      semanticValue: parsed.semanticValue,
      lifecycle: parsed.lifecycle,
      createdRevision: parsed.createdRevision,
      endedRevision: parsed.endedRevision,
      supersededById: parsed.supersededById,
    })
    .returning();
  if (criterionRow === undefined) {
    throw new Error("Decision criterion insert returned no row");
  }

  const sourceRows = await options.tx
    .insert(criterionSources)
    .values(
      parsedSources.map((source) => ({
        id: source.id,
        taskId: source.taskId,
        criterionId: source.criterionId,
        sourceRole: source.sourceRole,
        sourceKind: source.sourceKind,
        taskInputId: source.taskInputId,
        messageId: source.messageId,
      })),
    )
    .returning();

  const criterion = mapDecisionCriterion(criterionRow);
  const sources = sourceRows.map(mapCriterionSource);
  validateCriterionSources({ criterion, sources });
  return { criterion, sources } as const;
}

export async function listDecisionCriteria(
  db: ShoppingDatabaseExecutor,
  taskIdInput: unknown,
) {
  const taskId = shoppingTaskIdSchema.parse(taskIdInput);
  const taskRow = await db
    .select()
    .from(shoppingTasks)
    .where(eq(shoppingTasks.id, taskId))
    .limit(1);
  const conceptRows = await db
    .select()
    .from(conceptDefinitions)
    .where(eq(conceptDefinitions.taskId, taskId));
  const criterionRows = await db
    .select()
    .from(decisionCriteria)
    .where(eq(decisionCriteria.taskId, taskId))
    .orderBy(asc(decisionCriteria.createdRevision), asc(decisionCriteria.id));
  const sourceRows = await db
    .select()
    .from(criterionSources)
    .where(eq(criterionSources.taskId, taskId))
    .orderBy(asc(criterionSources.id));
  const inputRows = await db
    .select({ id: taskInputs.id, inputKind: taskInputs.inputKind })
    .from(taskInputs)
    .where(eq(taskInputs.taskId, taskId));
  const rawTask = taskRow[0];
  if (rawTask === undefined) {
    return [];
  }

  const task = mapShoppingTask(rawTask);
  const concepts = new Map(
    conceptRows.map((row) => {
      const concept = mapConceptDefinition(row);
      return [concept.id, concept] as const;
    }),
  );
  const sourcesByCriterion = new Map<
    string,
    ReturnType<typeof mapCriterionSource>[]
  >();
  const persistedInputKinds = new Map(
    inputRows.map((row) => [row.id, row.inputKind] as const),
  );
  for (const sourceRow of sourceRows) {
    const source = mapCriterionSource(sourceRow);
    const entries = sourcesByCriterion.get(source.criterionId) ?? [];
    entries.push(source);
    sourcesByCriterion.set(source.criterionId, entries);
  }

  return criterionRows.map((row) => {
    const criterion = mapDecisionCriterion(row);
    const concept = concepts.get(criterion.conceptId);
    const sources = sourcesByCriterion.get(criterion.id) ?? [];
    if (concept === undefined) {
      throw new PersistedDataCorruptionError({
        recordType: "DecisionCriterion",
        recordId: criterion.id,
        cause: new Error("Criterion concept is missing"),
      });
    }
    try {
      parseDecisionCriterionForContext({ criterion, concept, task });
      validateCriterionSources({ criterion, sources });
      const revisions = [
        criterion.createdRevision,
        criterion.endedRevision,
      ].filter((revision): revision is bigint => revision !== null);
      if (revisions.some((revision) => revision > task.currentRevision)) {
        throw new TaskRevisionBoundsError({
          taskId: task.id,
          attemptedRevision: revisions.reduce(
            (highest, revision) => (revision > highest ? revision : highest),
            0n,
          ),
          currentRevision: task.currentRevision,
        });
      }
      for (const source of sources) {
        if (persistedInputKinds.get(source.taskInputId) !== source.sourceKind) {
          throw new SourceInputMismatchError(
            `Persisted source ${source.id} kind does not match its task input`,
          );
        }
      }
    } catch (cause) {
      throw new PersistedDataCorruptionError({
        recordType: "DecisionCriterion",
        recordId: criterion.id,
        cause,
      });
    }
    return { criterion, sources } as const;
  });
}
