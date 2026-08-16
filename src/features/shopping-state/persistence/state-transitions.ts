import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  conceptDefinitionSchema,
  type ConceptDefinition,
} from "../../../domain/shopping-state/concept-definition";
import {
  assertCriterionPersistable,
  parseDecisionCriterionForContext,
  type CriterionSource,
  type DecisionCriterion,
} from "../../../domain/shopping-state/decision-criterion";
import {
  ConceptNotFoundError,
  ConceptTaskMismatchError,
  CriterionNotActiveError,
  CriterionNotFoundError,
  CriterionTaskMismatchError,
  DuplicateLineageOperationError,
  IndifferenceConflictError,
  InvalidPatchReferenceError,
  PersistedDataCorruptionError,
  SourceInputNotFoundError,
  SourceInputTaskMismatchError,
  SourceRevisionNotAdmissibleError,
  StaleTaskRevisionError,
  StateApplicationIdempotencyConflictError,
  TaskNotFoundError,
  UndoTargetUnavailableError,
} from "../../../domain/shopping-state/errors";
import {
  conceptDefinitionIdSchema,
  criterionIdSchema,
  criterionLineageIdSchema,
  criterionSourceIdSchema,
  stateChangeApplicationIdSchema,
} from "../../../domain/shopping-state/ids";
import {
  projectShoppingBrief,
  type ShoppingBriefV1,
} from "../../../domain/shopping-state/brief";
import {
  parseStateApplicationCommand,
  STATE_APPLICATION_FINGERPRINT_VERSION,
  type AuthoritySourcePlanV1,
  type CanonicalPatchOperationV1,
} from "../../../domain/shopping-state/state-patch";
import {
  APPLIED_STATE_DELTA_SCHEMA_VERSION,
  appliedStateDeltaV1Schema,
  immutableSnapshotMatchesCriterion,
  snapshotCriterion,
  type AppliedDeltaEntryV1,
  type AppliedStateDeltaV1,
  type StateChangeApplication,
} from "../../../domain/shopping-state/state-change";
import { assertTransitionIntent } from "../../../domain/shopping-state/transition-direction";
import type { TaskInput } from "../../../domain/shopping-state/task-input";
import type {
  ShoppingDatabase,
  ShoppingTransaction,
} from "../../../infrastructure/database/clients";
import {
  conceptDefinitions,
  criterionSources,
  decisionCriteria,
  shoppingTasks,
  stateChangeApplications,
  taskInputs,
  userMessages,
} from "../../../infrastructure/database/schema";
import { insertConceptDefinitionInTransaction } from "./concepts";
import {
  insertCriterionWithSourcesInTransaction,
  listDecisionCriteria,
} from "./criteria";
import {
  mapShoppingTask,
  mapStateChangeApplication,
  mapTaskInput,
} from "./mappers";
import {
  loadCurrentShoppingState,
  loadShoppingStateAtRevision,
} from "./state-loaders";

type Tx = Parameters<Parameters<ShoppingDatabase["transaction"]>[0]>[0];
type ResolvedInput = Readonly<{ input: TaskInput; messageId: string | null }>;
type NewSource = Omit<CriterionSource, "createdAt">;

export type StateApplicationResult = Readonly<{
  application: StateChangeApplication;
  brief: ShoppingBriefV1;
}>;

function sourceInputIds(source: AuthoritySourcePlanV1) {
  return source.kind === "user_explicit"
    ? [source.inputId]
    : [source.originInputId, source.confirmationInputId];
}

async function findReceipt(tx: Tx, taskId: string, causalInputId: string) {
  const [row] = await tx
    .select()
    .from(stateChangeApplications)
    .where(
      and(
        eq(stateChangeApplications.taskId, taskId),
        eq(stateChangeApplications.sourceTaskInputId, causalInputId),
      ),
    )
    .limit(1);
  return row === undefined ? null : mapStateChangeApplication(row);
}

async function lockSourceInputs(options: {
  tx: Tx;
  taskId: string;
  inputIds: readonly string[];
}) {
  const ids = [...new Set(options.inputIds)].sort();
  const rows = await options.tx
    .select()
    .from(taskInputs)
    .where(
      and(eq(taskInputs.taskId, options.taskId), inArray(taskInputs.id, ids)),
    )
    .orderBy(asc(taskInputs.id))
    .for("update");
  return new Map(rows.map((row) => [row.id, mapTaskInput(row)] as const));
}

async function resolveLockedInputs(options: {
  tx: Tx;
  taskId: string;
  inputIds: readonly string[];
  expectedRevision: bigint;
  locked: ReadonlyMap<string, TaskInput>;
}) {
  const ids = [...new Set(options.inputIds)].sort();
  for (const id of ids) {
    if (options.locked.has(id)) continue;
    const [foreign] = await options.tx
      .select({ taskId: taskInputs.taskId })
      .from(taskInputs)
      .where(eq(taskInputs.id, id))
      .limit(1);
    if (foreign !== undefined) throw new SourceInputTaskMismatchError(id);
    throw new SourceInputNotFoundError(id);
  }
  const resolved = new Map<string, ResolvedInput>();
  for (const id of ids) {
    const input = options.locked.get(id)!;
    if (input.expectedRevision > options.expectedRevision)
      throw new SourceRevisionNotAdmissibleError(id);
    let messageId: string | null = null;
    if (input.inputPayload.kind === "message") {
      const [message] = await options.tx
        .select()
        .from(userMessages)
        .where(
          and(
            eq(userMessages.taskId, options.taskId),
            eq(userMessages.taskInputId, input.id),
          ),
        )
        .limit(1);
      if (
        message === undefined ||
        message.receivedAtRevision !== input.expectedRevision
      ) {
        throw new PersistedDataCorruptionError({
          recordType: "TaskInput",
          recordId: input.id,
          cause: new Error(
            "Message source is missing or has the wrong revision",
          ),
        });
      }
      messageId = message.id;
    }
    resolved.set(id, { input, messageId });
  }
  return resolved;
}

function makeSource(
  criterionId: string,
  taskId: string,
  role: NewSource["sourceRole"],
  resolved: ResolvedInput,
): NewSource {
  return {
    id: criterionSourceIdSchema.parse(randomUUID()),
    taskId: taskId as NewSource["taskId"],
    criterionId: criterionId as NewSource["criterionId"],
    sourceRole: role,
    sourceKind: resolved.input.inputPayload.kind,
    taskInputId: resolved.input.id,
    messageId: resolved.messageId as NewSource["messageId"],
  };
}

function sourcesForNewCriterion(options: {
  criterionId: string;
  taskId: string;
  source: AuthoritySourcePlanV1;
  inputs: ReadonlyMap<string, ResolvedInput>;
  includeChange: boolean;
}) {
  const entries: NewSource[] = [];
  if (options.source.kind === "user_explicit") {
    entries.push(
      makeSource(
        options.criterionId,
        options.taskId,
        "origin",
        options.inputs.get(options.source.inputId)!,
      ),
    );
    if (options.includeChange)
      entries.push(
        makeSource(
          options.criterionId,
          options.taskId,
          "change",
          options.inputs.get(options.source.inputId)!,
        ),
      );
  } else {
    entries.push(
      makeSource(
        options.criterionId,
        options.taskId,
        "origin",
        options.inputs.get(options.source.originInputId)!,
      ),
    );
    entries.push(
      makeSource(
        options.criterionId,
        options.taskId,
        "confirmation",
        options.inputs.get(options.source.confirmationInputId)!,
      ),
    );
    if (options.includeChange)
      entries.push(
        makeSource(
          options.criterionId,
          options.taskId,
          "change",
          options.inputs.get(options.source.confirmationInputId)!,
        ),
      );
  }
  return entries;
}

function authorityFor(
  source: AuthoritySourcePlanV1,
): DecisionCriterion["authority"] {
  return source.kind === "user_explicit" ? "user_explicit" : "user_confirmed";
}

function canonicalCriterion(options: {
  task: Awaited<ReturnType<typeof loadCurrentShoppingState>>["task"];
  concept: ConceptDefinition;
  source: AuthoritySourcePlanV1;
  target:
    | Extract<CanonicalPatchOperationV1, { op: "add_criterion" }>["target"]
    | Extract<CanonicalPatchOperationV1, { op: "replace_target" }>["result"];
  id: string;
  lineageId: string;
  revision: bigint;
}) {
  const parsed = parseDecisionCriterionForContext({
    task: options.task,
    concept: options.concept,
    criterion: {
      id: options.id,
      taskId: options.task.id,
      lineageId: options.lineageId,
      conceptId: options.concept.id,
      authority: authorityFor(options.source),
      strength: options.target.strength,
      targetSemantics: options.target.targetSemantics,
      valueSchemaVersion: 1,
      valueKind: options.target.semanticValue.kind,
      semanticValue: options.target.semanticValue,
      lifecycle: "active",
      createdRevision: options.revision,
      endedRevision: null,
      supersededById: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
  }).criterion;
  assertCriterionPersistable(parsed);
  return parsed;
}

type CompiledStep =
  | { kind: "concept"; concept: ConceptDefinition }
  | { kind: "add"; criterion: DecisionCriterion; sources: NewSource[] }
  | {
      kind: "replace";
      before: DecisionCriterion;
      ended: DecisionCriterion;
      after: DecisionCriterion;
      sources: NewSource[];
      deltaKind:
        "criterion_replaced" | "criterion_relaxed" | "criterion_tightened";
    }
  | {
      kind: "remove";
      before: DecisionCriterion;
      ended: DecisionCriterion;
      source: NewSource;
    }
  | {
      kind: "indifferent";
      before: DecisionCriterion[];
      ended: DecisionCriterion[];
      after: DecisionCriterion;
      sources: NewSource[];
      changeSources: NewSource[];
    };

function compilePatch(options: {
  command: Extract<
    ReturnType<typeof parseStateApplicationCommand>["command"],
    { applicationKind: "patch" }
  >;
  state: Awaited<ReturnType<typeof loadCurrentShoppingState>>;
  inputs: ReadonlyMap<string, ResolvedInput>;
}) {
  if (options.command.patch.outcome === "no_change")
    return {
      steps: [] as CompiledStep[],
      delta: appliedStateDeltaV1Schema.parse({ schemaVersion: 1, entries: [] }),
    };
  const nextRevision = options.command.expectedRevision + 1n;
  const concepts = new Map(
    options.state.concepts.map((concept) => [concept.id, concept] as const),
  );
  const localConcepts = new Map<string, ConceptDefinition>();
  const active = new Map(
    options.state.activeCriteria.map(
      ({ criterion }) => [criterion.id, criterion] as const,
    ),
  );
  const allCriteria = new Map(
    options.state.activeCriteria.map(
      ({ criterion }) => [criterion.id, criterion] as const,
    ),
  );
  const consumedLineages = new Set<string>();
  const steps: CompiledStep[] = [];
  const entries: AppliedDeltaEntryV1[] = [];

  const resolveConcept = (
    ref: Extract<CanonicalPatchOperationV1, { op: "add_criterion" }>["concept"],
  ) => {
    if (ref.kind === "created") return localConcepts.get(ref.localRef)!;
    const concept = concepts.get(ref.conceptId);
    if (concept === undefined) throw new ConceptNotFoundError(ref.conceptId);
    return concept;
  };
  const consume = (criterion: DecisionCriterion) => {
    if (consumedLineages.has(criterion.lineageId))
      throw new DuplicateLineageOperationError(criterion.lineageId);
    consumedLineages.add(criterion.lineageId);
  };
  const exactActive = (
    criterionId: ReturnType<typeof criterionIdSchema.parse>,
  ) => {
    const criterion = active.get(criterionId);
    if (criterion !== undefined) return criterion;
    const initial = allCriteria.get(criterionId);
    if (initial !== undefined && consumedLineages.has(initial.lineageId))
      throw new DuplicateLineageOperationError(initial.lineageId);
    if (initial !== undefined) throw new CriterionNotActiveError(criterionId);
    throw new CriterionNotFoundError(criterionId);
  };

  for (const operation of options.command.patch.operations) {
    if (operation.op === "create_concept") {
      const conceptId = conceptDefinitionIdSchema.parse(randomUUID());
      const concept = conceptDefinitionSchema.parse({
        id: conceptId,
        taskId: options.state.task.id,
        label: operation.label,
        definition: operation.definition,
        valueFamily: operation.valueFamily,
        canonicalUnit: operation.canonicalUnit,
        createdRevision: nextRevision,
        createdAt: new Date(0),
      });
      localConcepts.set(operation.localRef, concept);
      concepts.set(concept.id, concept);
      steps.push({ kind: "concept", concept });
      entries.push({
        kind: "concept_created",
        concept: {
          id: concept.id,
          label: concept.label,
          definition: concept.definition,
          valueFamily: concept.valueFamily,
          canonicalUnit: concept.canonicalUnit,
          createdRevision: nextRevision.toString(),
        },
      });
      continue;
    }
    if (operation.op === "add_criterion") {
      const concept = resolveConcept(operation.concept);
      const criterion = canonicalCriterion({
        task: options.state.task,
        concept,
        source: options.command.source,
        target: operation.target,
        id: criterionIdSchema.parse(randomUUID()),
        lineageId: criterionLineageIdSchema.parse(randomUUID()),
        revision: nextRevision,
      });
      const sources = sourcesForNewCriterion({
        criterionId: criterion.id,
        taskId: options.state.task.id,
        source: options.command.source,
        inputs: options.inputs,
        includeChange: false,
      });
      steps.push({ kind: "add", criterion, sources });
      active.set(criterion.id, criterion);
      entries.push({
        kind: "criterion_added",
        after: snapshotCriterion(criterion),
      });
      continue;
    }
    if (
      operation.op === "replace_target" ||
      operation.op === "relax" ||
      operation.op === "tighten"
    ) {
      const before = exactActive(operation.targetCriterionId);
      consume(before);
      const concept = concepts.get(before.conceptId);
      if (concept === undefined)
        throw new ConceptNotFoundError(before.conceptId);
      const after = canonicalCriterion({
        task: options.state.task,
        concept,
        source: options.command.source,
        target: operation.result,
        id: criterionIdSchema.parse(randomUUID()),
        lineageId: before.lineageId,
        revision: nextRevision,
      });
      if (
        isDeepStrictEqual(
          {
            strength: before.strength,
            targetSemantics: before.targetSemantics,
            semanticValue: before.semanticValue,
          },
          {
            strength: after.strength,
            targetSemantics: after.targetSemantics,
            semanticValue: after.semanticValue,
          },
        )
      ) {
        throw new InvalidPatchReferenceError(
          "A change operation cannot preserve an identical canonical target",
        );
      }
      if (operation.op === "relax" || operation.op === "tighten")
        assertTransitionIntent(operation.op, before, after);
      const ended: DecisionCriterion = {
        ...before,
        lifecycle: "superseded",
        endedRevision: nextRevision,
        supersededById: after.id,
        updatedAt: before.updatedAt,
      };
      const deltaKind =
        operation.op === "replace_target"
          ? "criterion_replaced"
          : operation.op === "relax"
            ? "criterion_relaxed"
            : "criterion_tightened";
      const sources = sourcesForNewCriterion({
        criterionId: after.id,
        taskId: options.state.task.id,
        source: options.command.source,
        inputs: options.inputs,
        includeChange: true,
      });
      steps.push({ kind: "replace", before, ended, after, sources, deltaKind });
      active.delete(before.id);
      active.set(after.id, after);
      entries.push({
        kind: deltaKind,
        before: snapshotCriterion(before),
        ended: snapshotCriterion(ended),
        after: snapshotCriterion(after),
      });
      continue;
    }
    if (operation.op === "remove") {
      const before = exactActive(operation.targetCriterionId);
      consume(before);
      const ended: DecisionCriterion = {
        ...before,
        lifecycle: "removed",
        endedRevision: nextRevision,
        supersededById: null,
        updatedAt: before.updatedAt,
      };
      const causal =
        options.command.source.kind === "user_explicit"
          ? options.command.source.inputId
          : options.command.source.confirmationInputId;
      const source = makeSource(
        before.id,
        options.state.task.id,
        "change",
        options.inputs.get(causal)!,
      );
      steps.push({ kind: "remove", before, ended, source });
      active.delete(before.id);
      entries.push({
        kind: "criterion_removed",
        before: snapshotCriterion(before),
        after: snapshotCriterion(ended),
      });
      continue;
    }
    const concept = resolveConcept(operation.concept);
    const conceptActive = [...active.values()].filter(
      (criterion) => criterion.conceptId === concept.id,
    );
    for (const criterionId of operation.replacesCriterionIds) {
      const initial = allCriteria.get(criterionId);
      if (initial !== undefined && consumedLineages.has(initial.lineageId))
        throw new DuplicateLineageOperationError(initial.lineageId);
    }
    const actualIds = conceptActive.map((criterion) => criterion.id).sort();
    if (!isDeepStrictEqual(actualIds, operation.replacesCriterionIds))
      throw new IndifferenceConflictError(concept.id);
    if (
      conceptActive.length === 1 &&
      conceptActive[0]?.semanticValue.kind === "indifferent"
    ) {
      throw new InvalidPatchReferenceError(
        "Already-active indifference requires an explicit no_change proposal",
      );
    }
    for (const criterion of conceptActive) consume(criterion);
    const ended = conceptActive.map((criterion) => ({
      ...criterion,
      lifecycle: "removed" as const,
      endedRevision: nextRevision,
      supersededById: null,
      updatedAt: criterion.updatedAt,
    }));
    const after = parseDecisionCriterionForContext({
      task: options.state.task,
      concept,
      criterion: {
        id: criterionIdSchema.parse(randomUUID()),
        taskId: options.state.task.id,
        lineageId: criterionLineageIdSchema.parse(randomUUID()),
        conceptId: concept.id,
        authority: authorityFor(options.command.source),
        strength: null,
        targetSemantics: "indifferent",
        valueSchemaVersion: 1,
        valueKind: "indifferent",
        semanticValue: { schemaVersion: 1, kind: "indifferent" },
        lifecycle: "active",
        createdRevision: nextRevision,
        endedRevision: null,
        supersededById: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    }).criterion;
    const sources = sourcesForNewCriterion({
      criterionId: after.id,
      taskId: options.state.task.id,
      source: options.command.source,
      inputs: options.inputs,
      includeChange: false,
    });
    const causal =
      options.command.source.kind === "user_explicit"
        ? options.command.source.inputId
        : options.command.source.confirmationInputId;
    const changeSources = ended.map((criterion) =>
      makeSource(
        criterion.id,
        options.state.task.id,
        "change",
        options.inputs.get(causal)!,
      ),
    );
    steps.push({
      kind: "indifferent",
      before: conceptActive,
      ended,
      after,
      sources,
      changeSources,
    });
    conceptActive.forEach((criterion) => active.delete(criterion.id));
    active.set(after.id, after);
    entries.push({
      kind: "concept_marked_indifferent",
      conceptId: concept.id,
      before: conceptActive.map(snapshotCriterion),
      ended: ended.map(snapshotCriterion),
      after: snapshotCriterion(after),
    });
  }
  const byConcept = new Map<string, DecisionCriterion[]>();
  for (const criterion of active.values()) {
    const values = byConcept.get(criterion.conceptId) ?? [];
    values.push(criterion);
    byConcept.set(criterion.conceptId, values);
  }
  for (const [conceptId, criteria] of byConcept) {
    if (
      criteria.some(
        (criterion) => criterion.semanticValue.kind === "indifferent",
      ) &&
      criteria.length > 1
    )
      throw new IndifferenceConflictError(conceptId);
  }
  return {
    steps,
    delta: appliedStateDeltaV1Schema.parse({ schemaVersion: 1, entries }),
  };
}

async function insertSources(
  tx: ShoppingTransaction,
  sources: readonly NewSource[],
) {
  if (sources.length === 0) return;
  await tx.insert(criterionSources).values(
    sources.map((source) => ({
      id: source.id,
      taskId: source.taskId,
      criterionId: source.criterionId,
      sourceRole: source.sourceRole,
      sourceKind: source.sourceKind,
      taskInputId: source.taskInputId,
      messageId: source.messageId,
    })),
  );
}

async function executeSteps(
  tx: ShoppingTransaction,
  steps: readonly CompiledStep[],
) {
  for (const step of steps) {
    if (step.kind === "concept") {
      await insertConceptDefinitionInTransaction({ tx, concept: step.concept });
    } else if (step.kind === "add") {
      await insertCriterionWithSourcesInTransaction({
        tx,
        criterion: step.criterion,
        sources: step.sources,
      });
    } else if (step.kind === "replace") {
      await tx
        .update(decisionCriteria)
        .set({
          lifecycle: "superseded",
          endedRevision: step.ended.endedRevision,
          supersededById: step.after.id,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(decisionCriteria.taskId, step.before.taskId),
            eq(decisionCriteria.id, step.before.id),
          ),
        );
      await insertCriterionWithSourcesInTransaction({
        tx,
        criterion: step.after,
        sources: step.sources,
      });
    } else if (step.kind === "remove") {
      await tx
        .update(decisionCriteria)
        .set({
          lifecycle: "removed",
          endedRevision: step.ended.endedRevision,
          supersededById: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(decisionCriteria.taskId, step.before.taskId),
            eq(decisionCriteria.id, step.before.id),
          ),
        );
      await insertSources(tx, [step.source]);
    } else {
      for (const ended of step.ended) {
        await tx
          .update(decisionCriteria)
          .set({
            lifecycle: "removed",
            endedRevision: ended.endedRevision,
            supersededById: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(decisionCriteria.taskId, ended.taskId),
              eq(decisionCriteria.id, ended.id),
            ),
          );
      }
      await insertSources(tx, step.changeSources);
      await insertCriterionWithSourcesInTransaction({
        tx,
        criterion: step.after,
        sources: step.sources,
      });
    }
  }
}

async function insertReceipt(options: {
  tx: Tx;
  taskId: string;
  sourceInputId: string;
  requestFingerprint: string;
  baseRevision: bigint;
  outcome: "applied" | "no_change";
  delta: AppliedStateDeltaV1;
}) {
  const [row] = await options.tx
    .insert(stateChangeApplications)
    .values({
      id: stateChangeApplicationIdSchema.parse(randomUUID()),
      taskId: options.taskId,
      sourceTaskInputId: options.sourceInputId,
      applicationKind: "patch",
      requestSchemaVersion: 1,
      fingerprintVersion: STATE_APPLICATION_FINGERPRINT_VERSION,
      requestFingerprint: options.requestFingerprint,
      baseRevision: options.baseRevision,
      resultingRevision:
        options.outcome === "applied"
          ? options.baseRevision + 1n
          : options.baseRevision,
      outcome: options.outcome,
      deltaSchemaVersion: APPLIED_STATE_DELTA_SCHEMA_VERSION,
      appliedDelta: options.delta,
      undoesApplicationId: null,
    })
    .returning();
  if (row === undefined)
    throw new Error("State application receipt insert returned no row");
  return mapStateChangeApplication(row);
}

async function validateOperationScopes(
  tx: Tx,
  command: Extract<
    ReturnType<typeof parseStateApplicationCommand>["command"],
    { applicationKind: "patch" }
  >,
) {
  if (command.patch.outcome === "no_change") return;
  const conceptIds = command.patch.operations.flatMap((operation) =>
    (operation.op === "add_criterion" || operation.op === "mark_indifferent") &&
    operation.concept.kind === "existing"
      ? [operation.concept.conceptId]
      : [],
  );
  const criterionIds = command.patch.operations.flatMap((operation) => {
    if (
      operation.op === "replace_target" ||
      operation.op === "relax" ||
      operation.op === "tighten" ||
      operation.op === "remove"
    )
      return [operation.targetCriterionId];
    return operation.op === "mark_indifferent"
      ? operation.replacesCriterionIds
      : [];
  });
  if (conceptIds.length > 0) {
    const rows = await tx
      .select({ id: conceptDefinitions.id, taskId: conceptDefinitions.taskId })
      .from(conceptDefinitions)
      .where(inArray(conceptDefinitions.id, [...new Set(conceptIds)]));
    const found = new Map(rows.map((row) => [row.id, row.taskId] as const));
    for (const id of conceptIds) {
      const owner = found.get(id);
      if (owner === undefined) throw new ConceptNotFoundError(id);
      if (owner !== command.taskId) throw new ConceptTaskMismatchError(id);
    }
  }
  if (criterionIds.length > 0) {
    const rows = await tx
      .select({
        id: decisionCriteria.id,
        taskId: decisionCriteria.taskId,
        lifecycle: decisionCriteria.lifecycle,
      })
      .from(decisionCriteria)
      .where(inArray(decisionCriteria.id, [...new Set(criterionIds)]));
    const found = new Map(rows.map((row) => [row.id, row] as const));
    for (const id of criterionIds) {
      const row = found.get(id);
      if (row === undefined) throw new CriterionNotFoundError(id);
      if (row.taskId !== command.taskId)
        throw new CriterionTaskMismatchError(id);
      if (row.lifecycle !== "active") throw new CriterionNotActiveError(id);
    }
  }
}

function snapshotExpectations(entry: AppliedDeltaEntryV1): readonly {
  snapshot: ReturnType<typeof snapshotCriterion>;
  state: "base" | "result" | "terminal" | "immutable";
}[] {
  switch (entry.kind) {
    case "concept_created":
      return [];
    case "criterion_added":
      return [{ snapshot: entry.after, state: "result" }];
    case "criterion_replaced":
    case "criterion_relaxed":
    case "criterion_tightened":
      return [
        { snapshot: entry.before, state: "base" },
        { snapshot: entry.ended, state: "terminal" },
        { snapshot: entry.after, state: "result" },
      ];
    case "criterion_removed":
      return [
        { snapshot: entry.before, state: "base" },
        { snapshot: entry.after, state: "terminal" },
      ];
    case "concept_marked_indifferent":
      return [
        ...entry.before.map((snapshot) => ({
          snapshot,
          state: "base" as const,
        })),
        ...entry.ended.map((snapshot) => ({
          snapshot,
          state: "terminal" as const,
        })),
        { snapshot: entry.after, state: "result" },
      ];
    case "criterion_restored_by_undo":
      return [
        { snapshot: entry.restoredFrom, state: "immutable" },
        { snapshot: entry.after, state: "result" },
      ];
    case "criterion_ended_by_undo":
      return [
        { snapshot: entry.before, state: "base" },
        { snapshot: entry.after, state: "terminal" },
      ];
  }
}

function entryRevisionsAreCoherent(
  entry: AppliedDeltaEntryV1,
  receipt: StateChangeApplication,
) {
  const result = receipt.resultingRevision.toString();
  switch (entry.kind) {
    case "concept_created":
      return entry.concept.createdRevision === result;
    case "criterion_added":
      return entry.after.createdRevision === result;
    case "criterion_replaced":
    case "criterion_relaxed":
    case "criterion_tightened":
      return (
        entry.ended.endedRevision === result &&
        entry.after.createdRevision === result
      );
    case "criterion_removed":
      return entry.after.endedRevision === result;
    case "concept_marked_indifferent":
      return (
        entry.ended.every((snapshot) => snapshot.endedRevision === result) &&
        entry.after.createdRevision === result
      );
    case "criterion_restored_by_undo":
      return entry.after.createdRevision === result;
    case "criterion_ended_by_undo":
      return entry.after.endedRevision === result;
  }
}

function claimedMutationFootprint(delta: AppliedStateDeltaV1) {
  const conceptIds: string[] = [];
  const createdCriterionIds: string[] = [];
  const endedCriterionIds: string[] = [];
  for (const entry of delta.entries) {
    switch (entry.kind) {
      case "concept_created":
        conceptIds.push(entry.concept.id);
        break;
      case "criterion_added":
        createdCriterionIds.push(entry.after.id);
        break;
      case "criterion_replaced":
      case "criterion_relaxed":
      case "criterion_tightened":
        endedCriterionIds.push(entry.ended.id);
        createdCriterionIds.push(entry.after.id);
        break;
      case "criterion_removed":
        endedCriterionIds.push(entry.after.id);
        break;
      case "concept_marked_indifferent":
        endedCriterionIds.push(...entry.ended.map((snapshot) => snapshot.id));
        createdCriterionIds.push(entry.after.id);
        break;
      case "criterion_restored_by_undo":
        createdCriterionIds.push(entry.after.id);
        break;
      case "criterion_ended_by_undo":
        endedCriterionIds.push(entry.after.id);
        break;
    }
  }
  return {
    conceptIds: conceptIds.sort(),
    createdCriterionIds: createdCriterionIds.sort(),
    endedCriterionIds: endedCriterionIds.sort(),
  };
}

async function validateUndoReceiptTarget(
  tx: Tx,
  receipt: StateChangeApplication,
) {
  if (receipt.applicationKind !== "undo") return;
  const [row] = await tx
    .select()
    .from(stateChangeApplications)
    .where(
      and(
        eq(stateChangeApplications.taskId, receipt.taskId),
        eq(stateChangeApplications.id, receipt.undoesApplicationId!),
      ),
    )
    .limit(1);
  if (row === undefined) {
    throw new PersistedDataCorruptionError({
      recordType: "StateChangeApplication",
      recordId: receipt.id,
      cause: new Error("Undo receipt target is missing from its task"),
    });
  }
  const target = mapStateChangeApplication(row);
  if (
    target.applicationKind !== "patch" ||
    target.outcome !== "applied" ||
    target.resultingRevision !== receipt.baseRevision
  ) {
    throw new PersistedDataCorruptionError({
      recordType: "StateChangeApplication",
      recordId: receipt.id,
      cause: new Error(
        "Undo receipt target must be the applied forward patch at its base revision",
      ),
    });
  }
  await validateHistoricalReceipt(tx, target);
}

async function validateHistoricalReceipt(
  tx: Tx,
  receipt: StateChangeApplication,
) {
  await validateUndoReceiptTarget(tx, receipt);
  const history = await loadShoppingStateAtRevision(
    tx,
    receipt.taskId,
    receipt.resultingRevision,
  );
  const all = await listDecisionCriteria(tx, receipt.taskId);
  const criteria = new Map(
    all.map(({ criterion }) => [criterion.id, criterion] as const),
  );
  if (receipt.outcome === "applied") {
    const revision = receipt.resultingRevision;
    const materialized = {
      conceptIds: history.concepts
        .filter((concept) => concept.createdRevision === revision)
        .map((concept) => concept.id)
        .sort(),
      createdCriterionIds: all
        .filter(({ criterion }) => criterion.createdRevision === revision)
        .map(({ criterion }) => criterion.id)
        .sort(),
      endedCriterionIds: all
        .filter(({ criterion }) => criterion.endedRevision === revision)
        .map(({ criterion }) => criterion.id)
        .sort(),
    };
    if (
      !isDeepStrictEqual(
        claimedMutationFootprint(receipt.appliedDelta),
        materialized,
      )
    ) {
      throw new PersistedDataCorruptionError({
        recordType: "StateChangeApplication",
        recordId: receipt.id,
        cause: new Error(
          "Applied delta does not exactly describe the materialized revision footprint",
        ),
      });
    }
  }
  for (const entry of receipt.appliedDelta.entries) {
    if (!entryRevisionsAreCoherent(entry, receipt)) {
      throw new PersistedDataCorruptionError({
        recordType: "StateChangeApplication",
        recordId: receipt.id,
        cause: new Error("Delta entry revisions do not match the receipt"),
      });
    }
    if (
      entry.kind === "concept_created" &&
      !history.concepts.some(
        (concept) =>
          concept.id === entry.concept.id &&
          concept.label === entry.concept.label &&
          concept.definition === entry.concept.definition &&
          concept.valueFamily === entry.concept.valueFamily &&
          concept.canonicalUnit === entry.concept.canonicalUnit &&
          concept.createdRevision.toString() === entry.concept.createdRevision,
      )
    ) {
      throw new PersistedDataCorruptionError({
        recordType: "StateChangeApplication",
        recordId: receipt.id,
        cause: new Error(
          "Created concept snapshot does not match materialized state",
        ),
      });
    }
    for (const { snapshot, state } of snapshotExpectations(entry)) {
      const criterion = criteria.get(snapshot.id);
      if (
        criterion === undefined ||
        !immutableSnapshotMatchesCriterion(snapshot, criterion)
      ) {
        throw new PersistedDataCorruptionError({
          recordType: "StateChangeApplication",
          recordId: receipt.id,
          cause: new Error(
            `Criterion snapshot ${snapshot.id} has immutable semantic drift`,
          ),
        });
      }
      if (state === "base" || state === "result") {
        const revision =
          state === "base" ? receipt.baseRevision : receipt.resultingRevision;
        if (!(
          criterion.createdRevision <= revision &&
          (criterion.endedRevision === null ||
            revision < criterion.endedRevision)
        )) {
          throw new PersistedDataCorruptionError({
            recordType: "StateChangeApplication",
            recordId: receipt.id,
            cause: new Error(
              `Criterion ${snapshot.id} was not effective at the receipt revision`,
            ),
          });
        }
      } else if (
        state === "terminal" &&
        (criterion.endedRevision?.toString() !== snapshot.endedRevision ||
          criterion.supersededById !== snapshot.supersededById)
      ) {
        throw new PersistedDataCorruptionError({
          recordType: "StateChangeApplication",
          recordId: receipt.id,
          cause: new Error(
            `Terminal criterion snapshot ${snapshot.id} does not match history`,
          ),
        });
      }
    }
  }
  return projectShoppingBrief(history);
}

async function returnExisting(
  tx: Tx,
  receipt: StateChangeApplication,
  requestFingerprint: string,
): Promise<StateApplicationResult> {
  const brief = await validateHistoricalReceipt(tx, receipt);
  if (
    receipt.fingerprintVersion !== STATE_APPLICATION_FINGERPRINT_VERSION ||
    receipt.requestFingerprint !== requestFingerprint
  ) {
    throw new StateApplicationIdempotencyConflictError(
      receipt.sourceTaskInputId,
    );
  }
  return {
    application: receipt,
    brief,
  };
}

export async function applyStatePatch(
  db: ShoppingDatabase,
  commandInput: unknown,
): Promise<StateApplicationResult> {
  const parsed = parseStateApplicationCommand(commandInput);
  if (parsed.command.applicationKind !== "patch")
    throw new TypeError("applyStatePatch requires a patch command");
  const command = parsed.command;
  return db.transaction(async (tx) => {
    const existing = await findReceipt(
      tx,
      command.taskId,
      parsed.causalInputId,
    );
    if (existing !== null)
      return returnExisting(tx, existing, parsed.fingerprint);

    const inputIds = sourceInputIds(command.source);
    const lockedInputs = await lockSourceInputs({
      tx,
      taskId: command.taskId,
      inputIds,
    });
    const afterLock = await findReceipt(
      tx,
      command.taskId,
      parsed.causalInputId,
    );
    if (afterLock !== null)
      return returnExisting(tx, afterLock, parsed.fingerprint);
    const inputs = await resolveLockedInputs({
      tx,
      taskId: command.taskId,
      inputIds,
      expectedRevision: command.expectedRevision,
      locked: lockedInputs,
    });

    const [taskRow] = await tx
      .select()
      .from(shoppingTasks)
      .where(eq(shoppingTasks.id, command.taskId))
      .for("update")
      .limit(1);
    if (taskRow === undefined) throw new TaskNotFoundError(command.taskId);
    const task = mapShoppingTask(taskRow);
    if (task.currentRevision !== command.expectedRevision)
      throw new StaleTaskRevisionError(
        task.id,
        command.expectedRevision,
        task.currentRevision,
      );
    await validateOperationScopes(tx, command);
    const state = await loadCurrentShoppingState(tx, command.taskId);
    const compiled = compilePatch({ command, state, inputs });
    const outcome =
      command.patch.outcome === "no_change" ? "no_change" : "applied";
    if (outcome === "applied") {
      const [updated] = await tx
        .update(shoppingTasks)
        .set({
          currentRevision: command.expectedRevision + 1n,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(shoppingTasks.id, command.taskId),
            eq(shoppingTasks.currentRevision, command.expectedRevision),
          ),
        )
        .returning({ revision: shoppingTasks.currentRevision });
      if (updated === undefined)
        throw new StaleTaskRevisionError(
          task.id,
          command.expectedRevision,
          task.currentRevision,
        );
      await executeSteps(tx, compiled.steps);
    }
    const application = await insertReceipt({
      tx,
      taskId: command.taskId,
      sourceInputId: parsed.causalInputId,
      requestFingerprint: parsed.fingerprint,
      baseRevision: command.expectedRevision,
      outcome,
      delta: compiled.delta,
    });
    const resultState = await loadShoppingStateAtRevision(
      tx,
      command.taskId,
      application.resultingRevision,
    );
    return { application, brief: projectShoppingBrief(resultState) };
  });
}

function exactSnapshotMatches(
  snapshot: ReturnType<typeof snapshotCriterion>,
  criterion: DecisionCriterion | undefined,
) {
  return (
    criterion !== undefined &&
    isDeepStrictEqual(snapshotCriterion(criterion), snapshot)
  );
}

function requiredCurrentSnapshots(entry: AppliedDeltaEntryV1) {
  switch (entry.kind) {
    case "concept_created":
      return [];
    case "criterion_added":
      return [entry.after];
    case "criterion_replaced":
    case "criterion_relaxed":
    case "criterion_tightened":
      return [entry.ended, entry.after];
    case "criterion_removed":
      return [entry.after];
    case "concept_marked_indifferent":
      return [...entry.ended, entry.after];
    case "criterion_restored_by_undo":
    case "criterion_ended_by_undo":
      return [];
  }
}

async function loadUndoTarget(options: {
  tx: Tx;
  taskId: string;
  targetApplicationId: string;
  currentRevision: bigint;
}) {
  const [row] = await options.tx
    .select()
    .from(stateChangeApplications)
    .where(
      and(
        eq(stateChangeApplications.taskId, options.taskId),
        eq(stateChangeApplications.id, options.targetApplicationId),
      ),
    )
    .limit(1);
  if (row === undefined) {
    throw new UndoTargetUnavailableError(
      options.targetApplicationId,
      "Undo target is missing from this task",
    );
  }
  const target = mapStateChangeApplication(row);
  await validateHistoricalReceipt(options.tx, target);
  if (
    target.applicationKind !== "patch" ||
    target.outcome !== "applied" ||
    target.resultingRevision !== options.currentRevision
  ) {
    throw new UndoTargetUnavailableError(
      target.id,
      "Undo target is not the latest meaningful forward change",
    );
  }
  const [existingUndo] = await options.tx
    .select({ id: stateChangeApplications.id })
    .from(stateChangeApplications)
    .where(
      and(
        eq(stateChangeApplications.taskId, options.taskId),
        eq(stateChangeApplications.undoesApplicationId, target.id),
      ),
    )
    .limit(1);
  if (existingUndo !== undefined) {
    throw new UndoTargetUnavailableError(
      target.id,
      "State change was already undone",
    );
  }
  const [latestMeaningful] = await options.tx
    .select({ id: stateChangeApplications.id })
    .from(stateChangeApplications)
    .where(
      and(
        eq(stateChangeApplications.taskId, options.taskId),
        eq(stateChangeApplications.outcome, "applied"),
      ),
    )
    .orderBy(desc(stateChangeApplications.resultingRevision))
    .limit(1);
  if (latestMeaningful?.id !== target.id) {
    throw new UndoTargetUnavailableError(
      target.id,
      "A later meaningful state change prevents this undo",
    );
  }
  const all = await listDecisionCriteria(options.tx, options.taskId);
  const criteria = new Map(
    all.map(({ criterion }) => [criterion.id, criterion] as const),
  );
  for (const entry of target.appliedDelta.entries) {
    for (const snapshot of requiredCurrentSnapshots(entry)) {
      if (!exactSnapshotMatches(snapshot, criteria.get(snapshot.id))) {
        throw new PersistedDataCorruptionError({
          recordType: "StateChangeApplication",
          recordId: target.id,
          cause: new Error(
            `Undo target after-state ${snapshot.id} does not match current materialized state`,
          ),
        });
      }
    }
  }
  return { target, allCriteria: all };
}

function restoredCriterion(options: {
  snapshot: ReturnType<typeof snapshotCriterion>;
  task: Awaited<ReturnType<typeof loadCurrentShoppingState>>["task"];
  concept: ConceptDefinition;
  revision: bigint;
}) {
  return parseDecisionCriterionForContext({
    task: options.task,
    concept: options.concept,
    criterion: {
      id: criterionIdSchema.parse(randomUUID()),
      taskId: options.task.id,
      lineageId: options.snapshot.lineageId,
      conceptId: options.snapshot.conceptId,
      authority: "user_explicit",
      strength: options.snapshot.strength,
      targetSemantics: options.snapshot.targetSemantics,
      valueSchemaVersion: options.snapshot.valueSchemaVersion,
      valueKind: options.snapshot.valueKind,
      semanticValue: options.snapshot.semanticValue,
      lifecycle: "active",
      createdRevision: options.revision,
      endedRevision: null,
      supersededById: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
  }).criterion;
}

function preservedRestoreSources(options: {
  oldSources: readonly CriterionSource[];
  criterion: DecisionCriterion;
  undoInput: ResolvedInput;
}) {
  const preserved = options.oldSources
    .filter(
      (source) =>
        source.sourceRole === "origin" || source.sourceRole === "confirmation",
    )
    .map((source): NewSource => ({
      id: criterionSourceIdSchema.parse(randomUUID()),
      taskId: options.criterion.taskId,
      criterionId: options.criterion.id,
      sourceRole: source.sourceRole,
      sourceKind: source.sourceKind,
      taskInputId: source.taskInputId,
      messageId: source.messageId,
    }));
  preserved.push(
    makeSource(
      options.criterion.id,
      options.criterion.taskId,
      "change",
      options.undoInput,
    ),
  );
  return preserved;
}

function compileUndo(options: {
  target: StateChangeApplication;
  state: Awaited<ReturnType<typeof loadCurrentShoppingState>>;
  allCriteria: Awaited<ReturnType<typeof listDecisionCriteria>>;
  undoInput: ResolvedInput;
}) {
  const nextRevision = options.state.task.currentRevision + 1n;
  const concepts = new Map(
    options.state.concepts.map((concept) => [concept.id, concept] as const),
  );
  const criteria = new Map(
    options.allCriteria.map(
      ({ criterion, sources }) =>
        [criterion.id, { criterion, sources }] as const,
    ),
  );
  const steps: CompiledStep[] = [];
  const entries: AppliedDeltaEntryV1[] = [];

  const endActive = (snapshot: ReturnType<typeof snapshotCriterion>) => {
    const current = criteria.get(snapshot.id)?.criterion;
    if (current === undefined || current.lifecycle !== "active") {
      throw new PersistedDataCorruptionError({
        recordType: "StateChangeApplication",
        recordId: options.target.id,
        cause: new Error(`Undo expected active criterion ${snapshot.id}`),
      });
    }
    const ended: DecisionCriterion = {
      ...current,
      lifecycle: "removed",
      endedRevision: nextRevision,
      supersededById: null,
      updatedAt: current.updatedAt,
    };
    const source = makeSource(
      current.id,
      current.taskId,
      "change",
      options.undoInput,
    );
    steps.push({ kind: "remove", before: current, ended, source });
    entries.push({
      kind: "criterion_ended_by_undo",
      targetApplicationId: options.target.id,
      before: snapshotCriterion(current),
      after: snapshotCriterion(ended),
    });
  };

  const restore = (snapshot: ReturnType<typeof snapshotCriterion>) => {
    const concept = concepts.get(snapshot.conceptId);
    const historical = criteria.get(snapshot.id);
    if (concept === undefined || historical === undefined) {
      throw new PersistedDataCorruptionError({
        recordType: "StateChangeApplication",
        recordId: options.target.id,
        cause: new Error(`Undo restore history ${snapshot.id} is missing`),
      });
    }
    const criterion = restoredCriterion({
      snapshot,
      task: options.state.task,
      concept,
      revision: nextRevision,
    });
    const sources = preservedRestoreSources({
      oldSources: historical.sources,
      criterion,
      undoInput: options.undoInput,
    });
    steps.push({ kind: "add", criterion, sources });
    entries.push({
      kind: "criterion_restored_by_undo",
      targetApplicationId: options.target.id,
      restoredFrom: snapshot,
      after: snapshotCriterion(criterion),
    });
  };

  const supersedeAndRestore = (
    activeSnapshot: ReturnType<typeof snapshotCriterion>,
    restoreSnapshot: ReturnType<typeof snapshotCriterion>,
  ) => {
    const current = criteria.get(activeSnapshot.id)?.criterion;
    const concept = concepts.get(restoreSnapshot.conceptId);
    const historical = criteria.get(restoreSnapshot.id);
    if (
      current === undefined ||
      current.lifecycle !== "active" ||
      concept === undefined ||
      historical === undefined
    ) {
      throw new PersistedDataCorruptionError({
        recordType: "StateChangeApplication",
        recordId: options.target.id,
        cause: new Error("Undo replacement history is incomplete"),
      });
    }
    const restored = restoredCriterion({
      snapshot: restoreSnapshot,
      task: options.state.task,
      concept,
      revision: nextRevision,
    });
    const ended: DecisionCriterion = {
      ...current,
      lifecycle: "superseded",
      endedRevision: nextRevision,
      supersededById: restored.id,
      updatedAt: current.updatedAt,
    };
    const sources = preservedRestoreSources({
      oldSources: historical.sources,
      criterion: restored,
      undoInput: options.undoInput,
    });
    steps.push({
      kind: "replace",
      before: current,
      ended,
      after: restored,
      sources,
      deltaKind: "criterion_replaced",
    });
    entries.push({
      kind: "criterion_ended_by_undo",
      targetApplicationId: options.target.id,
      before: snapshotCriterion(current),
      after: snapshotCriterion(ended),
    });
    entries.push({
      kind: "criterion_restored_by_undo",
      targetApplicationId: options.target.id,
      restoredFrom: restoreSnapshot,
      after: snapshotCriterion(restored),
    });
  };

  for (const entry of [...options.target.appliedDelta.entries].reverse()) {
    switch (entry.kind) {
      case "concept_created":
        break;
      case "criterion_added":
        endActive(entry.after);
        break;
      case "criterion_replaced":
      case "criterion_relaxed":
      case "criterion_tightened":
        supersedeAndRestore(entry.after, entry.before);
        break;
      case "criterion_removed":
        restore(entry.before);
        break;
      case "concept_marked_indifferent":
        endActive(entry.after);
        for (const snapshot of entry.before) restore(snapshot);
        break;
      case "criterion_restored_by_undo":
      case "criterion_ended_by_undo":
        throw new UndoTargetUnavailableError(
          options.target.id,
          "Undo-of-undo is unavailable",
        );
    }
  }
  return {
    steps,
    delta: appliedStateDeltaV1Schema.parse({ schemaVersion: 1, entries }),
  };
}

async function insertUndoReceipt(options: {
  tx: Tx;
  taskId: string;
  sourceInputId: string;
  targetApplicationId: string;
  requestFingerprint: string;
  baseRevision: bigint;
  delta: AppliedStateDeltaV1;
}) {
  const [row] = await options.tx
    .insert(stateChangeApplications)
    .values({
      id: stateChangeApplicationIdSchema.parse(randomUUID()),
      taskId: options.taskId,
      sourceTaskInputId: options.sourceInputId,
      applicationKind: "undo",
      requestSchemaVersion: 1,
      fingerprintVersion: STATE_APPLICATION_FINGERPRINT_VERSION,
      requestFingerprint: options.requestFingerprint,
      baseRevision: options.baseRevision,
      resultingRevision: options.baseRevision + 1n,
      outcome: "applied",
      deltaSchemaVersion: APPLIED_STATE_DELTA_SCHEMA_VERSION,
      appliedDelta: options.delta,
      undoesApplicationId: options.targetApplicationId,
    })
    .returning();
  if (row === undefined) throw new Error("Undo receipt insert returned no row");
  return mapStateChangeApplication(row);
}

export async function undoStateChange(
  db: ShoppingDatabase,
  commandInput: unknown,
): Promise<StateApplicationResult> {
  const parsed = parseStateApplicationCommand(commandInput);
  if (parsed.command.applicationKind !== "undo")
    throw new TypeError("undoStateChange requires an undo command");
  const command = parsed.command;
  return db.transaction(async (tx) => {
    const existing = await findReceipt(
      tx,
      command.taskId,
      parsed.causalInputId,
    );
    if (existing !== null)
      return returnExisting(tx, existing, parsed.fingerprint);
    const lockedInputs = await lockSourceInputs({
      tx,
      taskId: command.taskId,
      inputIds: [command.source.inputId],
    });
    const afterLock = await findReceipt(
      tx,
      command.taskId,
      parsed.causalInputId,
    );
    if (afterLock !== null)
      return returnExisting(tx, afterLock, parsed.fingerprint);
    const inputs = await resolveLockedInputs({
      tx,
      taskId: command.taskId,
      inputIds: [command.source.inputId],
      expectedRevision: command.expectedRevision,
      locked: lockedInputs,
    });
    const [taskRow] = await tx
      .select()
      .from(shoppingTasks)
      .where(eq(shoppingTasks.id, command.taskId))
      .for("update")
      .limit(1);
    if (taskRow === undefined) throw new TaskNotFoundError(command.taskId);
    const task = mapShoppingTask(taskRow);
    if (task.currentRevision !== command.expectedRevision)
      throw new StaleTaskRevisionError(
        task.id,
        command.expectedRevision,
        task.currentRevision,
      );
    const targetData = await loadUndoTarget({
      tx,
      taskId: command.taskId,
      targetApplicationId: command.targetApplicationId,
      currentRevision: task.currentRevision,
    });
    const state = await loadCurrentShoppingState(tx, command.taskId);
    const undoInput = inputs.get(command.source.inputId)!;
    const compiled = compileUndo({
      target: targetData.target,
      state,
      allCriteria: targetData.allCriteria,
      undoInput,
    });
    const [updated] = await tx
      .update(shoppingTasks)
      .set({
        currentRevision: command.expectedRevision + 1n,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(shoppingTasks.id, command.taskId),
          eq(shoppingTasks.currentRevision, command.expectedRevision),
        ),
      )
      .returning({ revision: shoppingTasks.currentRevision });
    if (updated === undefined)
      throw new StaleTaskRevisionError(
        task.id,
        command.expectedRevision,
        task.currentRevision,
      );
    await executeSteps(tx, compiled.steps);
    const application = await insertUndoReceipt({
      tx,
      taskId: command.taskId,
      sourceInputId: command.source.inputId,
      targetApplicationId: targetData.target.id,
      requestFingerprint: parsed.fingerprint,
      baseRevision: command.expectedRevision,
      delta: compiled.delta,
    });
    const resultState = await loadShoppingStateAtRevision(
      tx,
      command.taskId,
      application.resultingRevision,
    );
    return { application, brief: projectShoppingBrief(resultState) };
  });
}
