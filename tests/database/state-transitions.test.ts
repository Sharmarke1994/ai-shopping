import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ConceptTaskMismatchError,
  CriterionTaskMismatchError,
  PersistedDataCorruptionError,
  SourceInputTaskMismatchError,
  StaleTaskRevisionError,
  StateApplicationIdempotencyConflictError,
  UndoTargetUnavailableError,
} from "../../src/domain/shopping-state/errors";
import { recordTaskInput } from "../../src/features/shopping-state/persistence/inputs-and-messages";
import { loadCurrentShoppingState } from "../../src/features/shopping-state/persistence/state-loaders";
import {
  applyStatePatch,
  undoStateChange,
} from "../../src/features/shopping-state/persistence/state-transitions";
import { createShoppingTask } from "../../src/features/shopping-state/persistence/tasks";
import {
  snapshotCriterion,
  type StateChangeApplication,
} from "../../src/domain/shopping-state/state-change";
import {
  decisionCriteria,
  shoppingTasks,
  stateChangeApplications,
  taskInputs,
} from "../../src/infrastructure/database/schema";
import {
  createTestDatabaseConnection,
  resetShoppingState,
  type TestDatabaseConnection,
  waitForDatabaseLock,
} from "./helpers";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function input(
  connection: TestDatabaseConnection,
  taskId: string,
  key: string,
  revision: bigint,
) {
  return recordTaskInput({
    db: connection.db,
    taskId,
    clientActionId: key,
    request: {
      inputSchemaVersion: 1,
      expectedRevision: revision,
      kind: "direct_brief_action",
      controlId: key,
      submittedText: key,
    },
  });
}

function explicitCommand(options: {
  taskId: string;
  inputId: string;
  expectedRevision: bigint;
  patch: unknown;
}) {
  return {
    applicationSchemaVersion: 1,
    applicationKind: "patch",
    taskId: options.taskId,
    expectedRevision: options.expectedRevision,
    source: { kind: "user_explicit", inputId: options.inputId },
    patch: options.patch,
  };
}

function createAndAddPatch(label = "Brand", value = "Nike") {
  return {
    schemaVersion: 1,
    outcome: "change",
    operations: [
      {
        op: "create_concept",
        localRef: "concept_brand",
        label,
        definition: "Preferred manufacturer",
        valueFamily: "categorical",
        canonicalUnit: null,
      },
      {
        op: "add_criterion",
        concept: { kind: "created", localRef: "concept_brand" },
        target: {
          strength: "preference",
          targetSemantics: "categorical",
          semanticValue: {
            schemaVersion: 1,
            kind: "categorical",
            operator: "prefer",
            values: [value],
          },
        },
      },
    ],
  };
}

function createTwoCriteriaPatch() {
  return {
    schemaVersion: 1,
    outcome: "change",
    operations: [
      ...createAndAddPatch("Brand", "Nike").operations,
      {
        op: "create_concept",
        localRef: "concept_colour",
        label: "Colour",
        definition: "Preferred colour",
        valueFamily: "categorical",
        canonicalUnit: null,
      },
      {
        op: "add_criterion",
        concept: { kind: "created", localRef: "concept_colour" },
        target: {
          strength: "preference",
          targetSemantics: "categorical",
          semanticValue: {
            schemaVersion: 1,
            kind: "categorical",
            operator: "prefer",
            values: ["Black"],
          },
        },
      },
    ],
  };
}

describe("V0-04 deterministic state transitions", () => {
  let connection: TestDatabaseConnection;
  beforeAll(() => {
    connection = createTestDatabaseConnection();
  });
  beforeEach(async () => {
    await resetShoppingState(connection);
  });
  afterAll(async () => {
    await connection.close();
  });

  it("applies one atomic revision and returns the same generated result on retry", async () => {
    const task = await createShoppingTask(connection.db);
    const source = await input(connection, task.id, "add-brand", 0n);
    const command = explicitCommand({
      taskId: task.id,
      inputId: source.input.id,
      expectedRevision: 0n,
      patch: createAndAddPatch(),
    });
    const first = await applyStatePatch(connection.db, command);
    const retry = await applyStatePatch(connection.db, command);
    expect(first.application).toEqual(retry.application);
    expect(first.application.resultingRevision).toBe(1n);
    expect(first.brief.items).toHaveLength(1);
    expect(first.brief.items[0]?.semanticValue).toMatchObject({
      kind: "categorical",
      values: ["Nike"],
    });
    const state = await loadCurrentShoppingState(connection.db, task.id);
    expect(state.task.currentRevision).toBe(1n);
    expect(state.concepts).toHaveLength(1);
    expect(state.activeCriteria).toHaveLength(1);
  });

  it("rechecks the receipt after deterministic same-source lock contention", async () => {
    const task = await createShoppingTask(connection.db);
    const source = await input(connection, task.id, "same-source-race", 0n);
    const command = explicitCommand({
      taskId: task.id,
      inputId: source.input.id,
      expectedRevision: 0n,
      patch: createAndAddPatch(),
    });
    const leftConnection = createTestDatabaseConnection("same_source_left");
    const rightConnection = createTestDatabaseConnection("same_source_right");
    const locked = deferred();
    const release = deferred();
    const blocker = connection.db.transaction(async (tx) => {
      await tx
        .select()
        .from(taskInputs)
        .where(eq(taskInputs.id, source.input.id))
        .for("update");
      locked.resolve();
      await release.promise;
    });
    try {
      await locked.promise;
      const leftPromise = applyStatePatch(leftConnection.db, command);
      const rightPromise = applyStatePatch(rightConnection.db, command);
      await waitForDatabaseLock({
        observer: connection,
        applicationNames: ["same_source_left", "same_source_right"],
      });
      release.resolve();
      await blocker;
      const [left, right] = await Promise.all([leftPromise, rightPromise]);
      expect(left).toEqual(right);
      expect(
        await connection.db.select().from(stateChangeApplications),
      ).toHaveLength(1);
      expect(
        (await loadCurrentShoppingState(connection.db, task.id)).task
          .currentRevision,
      ).toBe(1n);
    } finally {
      release.resolve();
      await blocker;
      await Promise.all([leftConnection.close(), rightConnection.close()]);
    }
  });

  it("stores no-change once without advancing and conflicts on identity reuse", async () => {
    const task = await createShoppingTask(connection.db);
    const source = await input(connection, task.id, "nothing", 0n);
    const command = explicitCommand({
      taskId: task.id,
      inputId: source.input.id,
      expectedRevision: 0n,
      patch: { schemaVersion: 1, outcome: "no_change" },
    });
    const result = await applyStatePatch(connection.db, command);
    expect(result.application.outcome).toBe("no_change");
    expect(result.application.baseRevision).toBe(0n);
    expect(result.application.resultingRevision).toBe(0n);
    await expect(
      applyStatePatch(connection.db, {
        ...command,
        patch: createAndAddPatch(),
      }),
    ).rejects.toBeInstanceOf(StateApplicationIdempotencyConflictError);
    expect(
      (await loadCurrentShoppingState(connection.db, task.id)).task
        .currentRevision,
    ).toBe(0n);
  });

  it("compiles all operations before writes and rolls back a later invalid operation", async () => {
    const task = await createShoppingTask(connection.db);
    const source = await input(connection, task.id, "atomic-invalid", 0n);
    const patch = createAndAddPatch();
    patch.operations.push({
      op: "remove",
      targetCriterionId: randomUUID(),
    } as never);
    await expect(
      applyStatePatch(
        connection.db,
        explicitCommand({
          taskId: task.id,
          inputId: source.input.id,
          expectedRevision: 0n,
          patch,
        }),
      ),
    ).rejects.toThrow();
    const state = await loadCurrentShoppingState(connection.db, task.id);
    expect(state.task.currentRevision).toBe(0n);
    expect(state.concepts).toEqual([]);
    expect(await connection.db.select().from(stateChangeApplications)).toEqual(
      [],
    );
  });

  it("allows one task-CAS winner after deterministic different-source contention", async () => {
    const task = await createShoppingTask(connection.db);
    const left = await input(connection, task.id, "left", 0n);
    const right = await input(connection, task.id, "right", 0n);
    const leftConnection = createTestDatabaseConnection("task_cas_left");
    const rightConnection = createTestDatabaseConnection("task_cas_right");
    const locked = deferred();
    const release = deferred();
    const blocker = connection.db.transaction(async (tx) => {
      await tx
        .select()
        .from(shoppingTasks)
        .where(eq(shoppingTasks.id, task.id))
        .for("update");
      locked.resolve();
      await release.promise;
    });
    try {
      await locked.promise;
      const leftPromise = applyStatePatch(
        leftConnection.db,
        explicitCommand({
          taskId: task.id,
          inputId: left.input.id,
          expectedRevision: 0n,
          patch: createAndAddPatch("Brand", "Nike"),
        }),
      );
      const rightPromise = applyStatePatch(
        rightConnection.db,
        explicitCommand({
          taskId: task.id,
          inputId: right.input.id,
          expectedRevision: 0n,
          patch: createAndAddPatch("Colour", "Black"),
        }),
      );
      await waitForDatabaseLock({
        observer: connection,
        applicationNames: ["task_cas_left", "task_cas_right"],
      });
      release.resolve();
      await blocker;
      const results = await Promise.allSettled([leftPromise, rightPromise]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(
        StaleTaskRevisionError,
      );
      expect(
        await connection.db.select().from(stateChangeApplications),
      ).toHaveLength(1);
    } finally {
      release.resolve();
      await blocker;
      await Promise.all([leftConnection.close(), rightConnection.close()]);
    }
  });

  it("reconstructs historical briefs through A to B to removed and detects immutable drift", async () => {
    const task = await createShoppingTask(connection.db);
    const addInput = await input(connection, task.id, "history-add", 0n);
    const addCommand = explicitCommand({
      taskId: task.id,
      inputId: addInput.input.id,
      expectedRevision: 0n,
      patch: createAndAddPatch(),
    });
    const add = await applyStatePatch(connection.db, addCommand);
    const criterionA = add.brief.items[0]!.criterionId;

    const replaceInput = await input(
      connection,
      task.id,
      "history-replace",
      1n,
    );
    const replaceCommand = explicitCommand({
      taskId: task.id,
      inputId: replaceInput.input.id,
      expectedRevision: 1n,
      patch: {
        schemaVersion: 1,
        outcome: "change",
        operations: [
          {
            op: "replace_target",
            targetCriterionId: criterionA,
            result: {
              strength: "strong_preference",
              targetSemantics: "categorical",
              semanticValue: {
                schemaVersion: 1,
                kind: "categorical",
                operator: "prefer",
                values: ["Nike"],
              },
            },
          },
        ],
      },
    });
    const replaced = await applyStatePatch(connection.db, replaceCommand);
    const criterionB = replaced.brief.items[0]!.criterionId;

    const removeInput = await input(connection, task.id, "history-remove", 2n);
    await applyStatePatch(
      connection.db,
      explicitCommand({
        taskId: task.id,
        inputId: removeInput.input.id,
        expectedRevision: 2n,
        patch: {
          schemaVersion: 1,
          outcome: "change",
          operations: [{ op: "remove", targetCriterionId: criterionB }],
        },
      }),
    );

    expect(
      (await applyStatePatch(connection.db, addCommand)).brief.items[0]
        ?.criterionId,
    ).toBe(criterionA);
    expect(
      (await applyStatePatch(connection.db, replaceCommand)).brief.items[0]
        ?.criterionId,
    ).toBe(criterionB);
    await connection.db
      .update(decisionCriteria)
      .set({
        semanticValue: {
          schemaVersion: 1,
          kind: "categorical",
          operator: "prefer",
          values: ["Adidas"],
        },
      })
      .where(eq(decisionCriteria.id, criterionA));
    await expect(
      applyStatePatch(connection.db, addCommand),
    ).rejects.toBeInstanceOf(PersistedDataCorruptionError);
    await expect(
      applyStatePatch(connection.db, {
        ...addCommand,
        patch: createAndAddPatch("Different label", "Adidas"),
      }),
    ).rejects.toBeInstanceOf(PersistedDataCorruptionError);
  });

  it("returns or conflicts before validating an altered non-causal origin", async () => {
    const task = await createShoppingTask(connection.db);
    const origin = await input(connection, task.id, "confirmed-origin", 0n);
    const confirmation = await input(
      connection,
      task.id,
      "confirmed-causal",
      0n,
    );
    const command = {
      applicationSchemaVersion: 1,
      applicationKind: "patch",
      taskId: task.id,
      expectedRevision: 0n,
      source: {
        kind: "user_confirmed",
        originInputId: origin.input.id,
        confirmationInputId: confirmation.input.id,
      },
      patch: createAndAddPatch(),
    };
    await applyStatePatch(connection.db, command);
    await expect(
      applyStatePatch(connection.db, {
        ...command,
        source: { ...command.source, originInputId: randomUUID() },
      }),
    ).rejects.toBeInstanceOf(StateApplicationIdempotencyConflictError);
  });

  it("undoes a confirmed removal with explicit authority and preserved provenance", async () => {
    const task = await createShoppingTask(connection.db);
    const origin = await input(connection, task.id, "undo-origin", 0n);
    const confirmation = await input(connection, task.id, "undo-confirm", 0n);
    const add = await applyStatePatch(connection.db, {
      applicationSchemaVersion: 1,
      applicationKind: "patch",
      taskId: task.id,
      expectedRevision: 0n,
      source: {
        kind: "user_confirmed",
        originInputId: origin.input.id,
        confirmationInputId: confirmation.input.id,
      },
      patch: createAndAddPatch(),
    });
    const removeInput = await input(connection, task.id, "undo-remove", 1n);
    const removed = await applyStatePatch(
      connection.db,
      explicitCommand({
        taskId: task.id,
        inputId: removeInput.input.id,
        expectedRevision: 1n,
        patch: {
          schemaVersion: 1,
          outcome: "change",
          operations: [
            {
              op: "remove",
              targetCriterionId: add.brief.items[0]!.criterionId,
            },
          ],
        },
      }),
    );
    const undoInput = await input(connection, task.id, "undo-action", 2n);
    const undone = await undoStateChange(connection.db, {
      applicationSchemaVersion: 1,
      applicationKind: "undo",
      taskId: task.id,
      expectedRevision: 2n,
      source: { kind: "user_explicit", inputId: undoInput.input.id },
      targetApplicationId: removed.application.id,
    });
    expect(undone.application.resultingRevision).toBe(3n);
    const current = await loadCurrentShoppingState(connection.db, task.id);
    expect(current.activeCriteria[0]?.criterion.authority).toBe(
      "user_explicit",
    );
    expect(
      current.activeCriteria[0]?.sources
        .map((source) => source.sourceRole)
        .sort(),
    ).toEqual(["change", "confirmation", "origin"]);
    expect(current.activeCriteria[0]?.criterion.id).not.toBe(
      add.brief.items[0]!.criterionId,
    );
  });

  it("remembers indifference outside the visible brief and undoes it forward", async () => {
    const task = await createShoppingTask(connection.db);
    const addInput = await input(connection, task.id, "indifferent-add", 0n);
    const added = await applyStatePatch(
      connection.db,
      explicitCommand({
        taskId: task.id,
        inputId: addInput.input.id,
        expectedRevision: 0n,
        patch: createAndAddPatch(),
      }),
    );
    const original = added.brief.items[0]!;
    const indifferentInput = await input(
      connection,
      task.id,
      "indifferent-mark",
      1n,
    );
    const marked = await applyStatePatch(
      connection.db,
      explicitCommand({
        taskId: task.id,
        inputId: indifferentInput.input.id,
        expectedRevision: 1n,
        patch: {
          schemaVersion: 1,
          outcome: "change",
          operations: [
            {
              op: "mark_indifferent",
              concept: { kind: "existing", conceptId: original.conceptId },
              replacesCriterionIds: [original.criterionId],
            },
          ],
        },
      }),
    );
    expect(marked.brief.items).toEqual([]);
    expect(
      (await loadCurrentShoppingState(connection.db, task.id)).activeCriteria[0]
        ?.criterion.semanticValue.kind,
    ).toBe("indifferent");

    const undoInput = await input(connection, task.id, "indifferent-undo", 2n);
    const undone = await undoStateChange(connection.db, {
      applicationSchemaVersion: 1,
      applicationKind: "undo",
      taskId: task.id,
      expectedRevision: 2n,
      source: { kind: "user_explicit", inputId: undoInput.input.id },
      targetApplicationId: marked.application.id,
    });
    expect(undone.brief.items).toHaveLength(1);
    expect(undone.brief.items[0]?.semanticValue).toMatchObject({
      kind: "categorical",
      values: ["Nike"],
    });
    expect(undone.brief.items[0]?.criterionId).not.toBe(original.criterionId);
  });

  it("rejects comparison persistence and corrupt receipt JSON without mutation", async () => {
    const task = await createShoppingTask(connection.db);
    const source = await input(connection, task.id, "comparison", 0n);
    const comparisonPatch = createAndAddPatch();
    const add = comparisonPatch.operations[1] as {
      target: { targetSemantics: string; semanticValue: unknown };
    };
    add.target.targetSemantics = "comparative";
    add.target.semanticValue = {
      schemaVersion: 1,
      kind: "comparison",
      relation: "more_than",
      reference: {
        kind: "candidate_listing",
        taskId: task.id,
        candidateListingId: randomUUID(),
      },
    };
    await expect(
      applyStatePatch(
        connection.db,
        explicitCommand({
          taskId: task.id,
          inputId: source.input.id,
          expectedRevision: 0n,
          patch: comparisonPatch,
        }),
      ),
    ).rejects.toThrow();
    expect(
      (await loadCurrentShoppingState(connection.db, task.id)).task
        .currentRevision,
    ).toBe(0n);

    const validInput = await input(
      connection,
      task.id,
      "receipt-corruption",
      0n,
    );
    const command = explicitCommand({
      taskId: task.id,
      inputId: validInput.input.id,
      expectedRevision: 0n,
      patch: createAndAddPatch(),
    });
    const result = await applyStatePatch(connection.db, command);
    const whitespaceDelta = structuredClone(result.application.appliedDelta);
    const addedEntry = whitespaceDelta.entries.find(
      (entry) => entry.kind === "criterion_added",
    );
    if (
      addedEntry === undefined ||
      addedEntry.kind !== "criterion_added" ||
      addedEntry.after.semanticValue.kind !== "categorical"
    )
      throw new Error("Expected categorical added delta");
    addedEntry.after.semanticValue.values[0] = " Nike ";
    await connection.db
      .update(stateChangeApplications)
      .set({ appliedDelta: whitespaceDelta })
      .where(eq(stateChangeApplications.id, result.application.id));
    await expect(
      applyStatePatch(connection.db, command),
    ).rejects.toBeInstanceOf(PersistedDataCorruptionError);
    await connection.db
      .update(stateChangeApplications)
      .set({
        appliedDelta: {
          schemaVersion: 1,
          entries: [{ kind: "invented" }],
        },
      })
      .where(eq(stateChangeApplications.id, result.application.id));
    await expect(
      applyStatePatch(connection.db, command),
    ).rejects.toBeInstanceOf(PersistedDataCorruptionError);
  });

  it("rejects a structurally valid receipt that omits part of its materialized mutation footprint", async () => {
    const task = await createShoppingTask(connection.db);
    const source = await input(connection, task.id, "incomplete-delta", 0n);
    const command = explicitCommand({
      taskId: task.id,
      inputId: source.input.id,
      expectedRevision: 0n,
      patch: createTwoCriteriaPatch(),
    });
    const applied = await applyStatePatch(connection.db, command);
    expect(applied.brief.items).toHaveLength(2);

    const incompleteDelta = structuredClone(applied.application.appliedDelta);
    const omittedIndex = incompleteDelta.entries.findIndex(
      (entry) => entry.kind === "criterion_added",
    );
    if (omittedIndex < 0) throw new Error("Expected an added criterion delta");
    incompleteDelta.entries.splice(omittedIndex, 1);
    await connection.client`
      UPDATE shopping_private.state_change_applications
      SET applied_delta = ${connection.client.json(incompleteDelta)}
      WHERE id = ${applied.application.id}
    `;

    await expect(
      applyStatePatch(connection.db, command),
    ).rejects.toBeInstanceOf(PersistedDataCorruptionError);
    const undoInput = await input(
      connection,
      task.id,
      "incomplete-delta-undo",
      1n,
    );
    await expect(
      undoStateChange(connection.db, {
        applicationSchemaVersion: 1,
        applicationKind: "undo",
        taskId: task.id,
        expectedRevision: 1n,
        source: { kind: "user_explicit", inputId: undoInput.input.id },
        targetApplicationId: applied.application.id,
      }),
    ).rejects.toBeInstanceOf(PersistedDataCorruptionError);

    const state = await loadCurrentShoppingState(connection.db, task.id);
    expect(state.task.currentRevision).toBe(1n);
    expect(state.activeCriteria).toHaveLength(2);
    expect(
      await connection.db
        .select()
        .from(stateChangeApplications)
        .where(eq(stateChangeApplications.taskId, task.id)),
    ).toHaveLength(1);
  });

  it("rejects relationally incoherent before and terminal snapshots", async () => {
    const task = await createShoppingTask(connection.db);
    const addInput = await input(connection, task.id, "mixed-snapshot-add", 0n);
    const added = await applyStatePatch(
      connection.db,
      explicitCommand({
        taskId: task.id,
        inputId: addInput.input.id,
        expectedRevision: 0n,
        patch: createTwoCriteriaPatch(),
      }),
    );
    const brand = added.brief.items.find(
      (entry) => entry.conceptLabel === "Brand",
    )!;
    const colour = added.brief.items.find(
      (entry) => entry.conceptLabel === "Colour",
    )!;
    const beforeReplace = await loadCurrentShoppingState(
      connection.db,
      task.id,
    );
    const colourCriterion = beforeReplace.activeCriteria.find(
      ({ criterion }) => criterion.id === colour.criterionId,
    )!.criterion;
    const replaceInput = await input(
      connection,
      task.id,
      "mixed-snapshot-replace",
      1n,
    );
    const replaceCommand = explicitCommand({
      taskId: task.id,
      inputId: replaceInput.input.id,
      expectedRevision: 1n,
      patch: {
        schemaVersion: 1,
        outcome: "change",
        operations: [
          {
            op: "replace_target",
            targetCriterionId: brand.criterionId,
            result: {
              strength: "strong_preference",
              targetSemantics: "categorical",
              semanticValue: {
                schemaVersion: 1,
                kind: "categorical",
                operator: "prefer",
                values: ["Nike"],
              },
            },
          },
        ],
      },
    });
    const replaced = await applyStatePatch(connection.db, replaceCommand);
    const incoherentDelta = structuredClone(replaced.application.appliedDelta);
    const replacement = incoherentDelta.entries.find(
      (entry) => entry.kind === "criterion_replaced",
    );
    if (replacement === undefined || replacement.kind !== "criterion_replaced")
      throw new Error("Expected a replacement delta");
    replacement.before = snapshotCriterion(colourCriterion);
    await connection.client`
      UPDATE shopping_private.state_change_applications
      SET applied_delta = ${connection.client.json(incoherentDelta)}
      WHERE id = ${replaced.application.id}
    `;

    await expect(
      applyStatePatch(connection.db, replaceCommand),
    ).rejects.toBeInstanceOf(PersistedDataCorruptionError);
    const state = await loadCurrentShoppingState(connection.db, task.id);
    expect(state.task.currentRevision).toBe(2n);
    expect(state.activeCriteria).toHaveLength(2);
  });

  it("validates the applied forward target claimed by an existing undo receipt", async () => {
    const task = await createShoppingTask(connection.db);
    const addInput = await input(connection, task.id, "undo-target-add", 0n);
    const added = await applyStatePatch(
      connection.db,
      explicitCommand({
        taskId: task.id,
        inputId: addInput.input.id,
        expectedRevision: 0n,
        patch: createAndAddPatch(),
      }),
    );
    const removeInput = await input(
      connection,
      task.id,
      "undo-target-remove",
      1n,
    );
    const removed = await applyStatePatch(
      connection.db,
      explicitCommand({
        taskId: task.id,
        inputId: removeInput.input.id,
        expectedRevision: 1n,
        patch: {
          schemaVersion: 1,
          outcome: "change",
          operations: [
            {
              op: "remove",
              targetCriterionId: added.brief.items[0]!.criterionId,
            },
          ],
        },
      }),
    );
    const noChangeInput = await input(
      connection,
      task.id,
      "undo-target-no-change",
      2n,
    );
    const noChange = await applyStatePatch(
      connection.db,
      explicitCommand({
        taskId: task.id,
        inputId: noChangeInput.input.id,
        expectedRevision: 2n,
        patch: { schemaVersion: 1, outcome: "no_change" },
      }),
    );
    const undoInput = await input(
      connection,
      task.id,
      "undo-target-action",
      2n,
    );
    const undoCommand = {
      applicationSchemaVersion: 1,
      applicationKind: "undo",
      taskId: task.id,
      expectedRevision: 2n,
      source: { kind: "user_explicit", inputId: undoInput.input.id },
      targetApplicationId: removed.application.id,
    };
    const undone = await undoStateChange(connection.db, undoCommand);

    const repoint = async (
      targetApplicationId: StateChangeApplication["id"],
    ) => {
      const delta = structuredClone(undone.application.appliedDelta);
      for (const entry of delta.entries) {
        if (
          entry.kind === "criterion_restored_by_undo" ||
          entry.kind === "criterion_ended_by_undo"
        ) {
          entry.targetApplicationId = targetApplicationId;
        }
      }
      await connection.client`
        UPDATE shopping_private.state_change_applications
        SET undoes_application_id = ${targetApplicationId},
            applied_delta = ${connection.client.json(delta)}
        WHERE id = ${undone.application.id}
      `;
    };

    await repoint(noChange.application.id);
    await expect(
      undoStateChange(connection.db, undoCommand),
    ).rejects.toBeInstanceOf(PersistedDataCorruptionError);
    await repoint(added.application.id);
    await expect(
      undoStateChange(connection.db, undoCommand),
    ).rejects.toBeInstanceOf(PersistedDataCorruptionError);

    const state = await loadCurrentShoppingState(connection.db, task.id);
    expect(state.task.currentRevision).toBe(3n);
    expect(state.activeCriteria).toHaveLength(1);
    expect(
      await connection.db
        .select()
        .from(stateChangeApplications)
        .where(eq(stateChangeApplications.taskId, task.id)),
    ).toHaveLength(4);
  });

  it("versions replace, relax, and tighten without mutating meaning in place, then undoes the latest", async () => {
    const task = await createShoppingTask(connection.db);
    const addInput = await input(connection, task.id, "version-add", 0n);
    const added = await applyStatePatch(
      connection.db,
      explicitCommand({
        taskId: task.id,
        inputId: addInput.input.id,
        expectedRevision: 0n,
        patch: createAndAddPatch(),
      }),
    );
    let currentId = added.brief.items[0]!.criterionId;

    const transition = async (
      key: string,
      revision: bigint,
      op: "replace_target" | "relax" | "tighten",
      strength: "preference" | "strong_preference",
    ) => {
      const source = await input(connection, task.id, key, revision);
      const result = await applyStatePatch(
        connection.db,
        explicitCommand({
          taskId: task.id,
          inputId: source.input.id,
          expectedRevision: revision,
          patch: {
            schemaVersion: 1,
            outcome: "change",
            operations: [
              {
                op,
                targetCriterionId: currentId,
                result: {
                  strength,
                  targetSemantics: "categorical",
                  semanticValue: {
                    schemaVersion: 1,
                    kind: "categorical",
                    operator: "prefer",
                    values: ["Nike"],
                  },
                },
              },
            ],
          },
        }),
      );
      currentId = result.brief.items[0]!.criterionId;
      return result;
    };

    await transition(
      "version-replace",
      1n,
      "replace_target",
      "strong_preference",
    );
    await transition("version-relax", 2n, "relax", "preference");
    const tightened = await transition(
      "version-tighten",
      3n,
      "tighten",
      "strong_preference",
    );
    const undoInput = await input(connection, task.id, "version-undo", 4n);
    const undone = await undoStateChange(connection.db, {
      applicationSchemaVersion: 1,
      applicationKind: "undo",
      taskId: task.id,
      expectedRevision: 4n,
      source: { kind: "user_explicit", inputId: undoInput.input.id },
      targetApplicationId: tightened.application.id,
    });
    expect(undone.brief.items[0]?.strength).toBe("preference");
    const rows = await connection.db
      .select()
      .from(decisionCriteria)
      .where(eq(decisionCriteria.taskId, task.id));
    expect(rows).toHaveLength(5);
    expect(rows.filter((row) => row.lifecycle === "active")).toHaveLength(1);
    expect(new Set(rows.map((row) => row.lineageId)).size).toBe(1);
  });

  it("allows a later no-change receipt before undoing the latest meaningful patch", async () => {
    const task = await createShoppingTask(connection.db);
    const addInput = await input(connection, task.id, "no-change-undo-add", 0n);
    const added = await applyStatePatch(
      connection.db,
      explicitCommand({
        taskId: task.id,
        inputId: addInput.input.id,
        expectedRevision: 0n,
        patch: createAndAddPatch(),
      }),
    );
    const noChangeInput = await input(
      connection,
      task.id,
      "no-change-before-undo",
      1n,
    );
    await applyStatePatch(
      connection.db,
      explicitCommand({
        taskId: task.id,
        inputId: noChangeInput.input.id,
        expectedRevision: 1n,
        patch: { schemaVersion: 1, outcome: "no_change" },
      }),
    );
    const undoInput = await input(
      connection,
      task.id,
      "no-change-undo-action",
      1n,
    );
    const undone = await undoStateChange(connection.db, {
      applicationSchemaVersion: 1,
      applicationKind: "undo",
      taskId: task.id,
      expectedRevision: 1n,
      source: { kind: "user_explicit", inputId: undoInput.input.id },
      targetApplicationId: added.application.id,
    });
    expect(undone.application.resultingRevision).toBe(2n);
    expect(undone.brief.items).toEqual([]);
  });

  it("serializes undo against a forward patch at the same revision", async () => {
    const task = await createShoppingTask(connection.db);
    const addInput = await input(connection, task.id, "undo-race-add", 0n);
    const added = await applyStatePatch(
      connection.db,
      explicitCommand({
        taskId: task.id,
        inputId: addInput.input.id,
        expectedRevision: 0n,
        patch: createAndAddPatch(),
      }),
    );
    const undoInput = await input(connection, task.id, "undo-race-undo", 1n);
    const forwardInput = await input(
      connection,
      task.id,
      "undo-race-forward",
      1n,
    );
    const undoConnection = createTestDatabaseConnection("undo_race_undo");
    const forwardConnection = createTestDatabaseConnection("undo_race_forward");
    const locked = deferred();
    const release = deferred();
    const blocker = connection.db.transaction(async (tx) => {
      await tx
        .select()
        .from(shoppingTasks)
        .where(eq(shoppingTasks.id, task.id))
        .for("update");
      locked.resolve();
      await release.promise;
    });
    try {
      await locked.promise;
      const undoPromise = undoStateChange(undoConnection.db, {
        applicationSchemaVersion: 1,
        applicationKind: "undo",
        taskId: task.id,
        expectedRevision: 1n,
        source: { kind: "user_explicit", inputId: undoInput.input.id },
        targetApplicationId: added.application.id,
      });
      const forwardPromise = applyStatePatch(
        forwardConnection.db,
        explicitCommand({
          taskId: task.id,
          inputId: forwardInput.input.id,
          expectedRevision: 1n,
          patch: createAndAddPatch("Colour", "Black"),
        }),
      );
      await waitForDatabaseLock({
        observer: connection,
        applicationNames: ["undo_race_undo", "undo_race_forward"],
      });
      release.resolve();
      await blocker;
      const results = await Promise.allSettled([undoPromise, forwardPromise]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(
        StaleTaskRevisionError,
      );
      expect(
        (await loadCurrentShoppingState(connection.db, task.id)).task
          .currentRevision,
      ).toBe(2n);
      expect(
        await connection.db.select().from(stateChangeApplications),
      ).toHaveLength(2);
    } finally {
      release.resolve();
      await blocker;
      await Promise.all([undoConnection.close(), forwardConnection.close()]);
    }
  });

  it("rejects cross-task source, concept, criterion, and undo targets without mutation", async () => {
    const sourceTask = await createShoppingTask(connection.db);
    const sourceInput = await input(
      connection,
      sourceTask.id,
      "foreign-state",
      0n,
    );
    const sourceResult = await applyStatePatch(
      connection.db,
      explicitCommand({
        taskId: sourceTask.id,
        inputId: sourceInput.input.id,
        expectedRevision: 0n,
        patch: createAndAddPatch(),
      }),
    );
    const foreignItem = sourceResult.brief.items[0]!;
    const targetTask = await createShoppingTask(connection.db);

    await expect(
      applyStatePatch(
        connection.db,
        explicitCommand({
          taskId: targetTask.id,
          inputId: sourceInput.input.id,
          expectedRevision: 0n,
          patch: { schemaVersion: 1, outcome: "no_change" },
        }),
      ),
    ).rejects.toBeInstanceOf(SourceInputTaskMismatchError);

    const conceptInput = await input(
      connection,
      targetTask.id,
      "foreign-concept",
      0n,
    );
    await expect(
      applyStatePatch(
        connection.db,
        explicitCommand({
          taskId: targetTask.id,
          inputId: conceptInput.input.id,
          expectedRevision: 0n,
          patch: {
            schemaVersion: 1,
            outcome: "change",
            operations: [
              {
                op: "add_criterion",
                concept: {
                  kind: "existing",
                  conceptId: foreignItem.conceptId,
                },
                target: {
                  strength: "preference",
                  targetSemantics: "categorical",
                  semanticValue: {
                    schemaVersion: 1,
                    kind: "categorical",
                    operator: "prefer",
                    values: ["Nike"],
                  },
                },
              },
            ],
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ConceptTaskMismatchError);

    const criterionInput = await input(
      connection,
      targetTask.id,
      "foreign-criterion",
      0n,
    );
    await expect(
      applyStatePatch(
        connection.db,
        explicitCommand({
          taskId: targetTask.id,
          inputId: criterionInput.input.id,
          expectedRevision: 0n,
          patch: {
            schemaVersion: 1,
            outcome: "change",
            operations: [
              { op: "remove", targetCriterionId: foreignItem.criterionId },
            ],
          },
        }),
      ),
    ).rejects.toBeInstanceOf(CriterionTaskMismatchError);

    const undoInput = await input(
      connection,
      targetTask.id,
      "foreign-undo",
      0n,
    );
    await expect(
      undoStateChange(connection.db, {
        applicationSchemaVersion: 1,
        applicationKind: "undo",
        taskId: targetTask.id,
        expectedRevision: 0n,
        source: { kind: "user_explicit", inputId: undoInput.input.id },
        targetApplicationId: sourceResult.application.id,
      }),
    ).rejects.toBeInstanceOf(UndoTargetUnavailableError);

    const targetState = await loadCurrentShoppingState(
      connection.db,
      targetTask.id,
    );
    expect(targetState.task.currentRevision).toBe(0n);
    expect(targetState.concepts).toEqual([]);
    expect(targetState.activeCriteria).toEqual([]);
    expect(
      await connection.db
        .select()
        .from(stateChangeApplications)
        .where(eq(stateChangeApplications.taskId, targetTask.id)),
    ).toEqual([]);
  });

  it("reports stale undo before target availability after a later meaningful transition", async () => {
    const task = await createShoppingTask(connection.db);
    const addInput = await input(connection, task.id, "stale-undo-add", 0n);
    const added = await applyStatePatch(
      connection.db,
      explicitCommand({
        taskId: task.id,
        inputId: addInput.input.id,
        expectedRevision: 0n,
        patch: createAndAddPatch(),
      }),
    );
    const staleUndoInput = await input(
      connection,
      task.id,
      "stale-undo-action",
      1n,
    );
    const laterInput = await input(
      connection,
      task.id,
      "stale-undo-later-change",
      1n,
    );
    await applyStatePatch(
      connection.db,
      explicitCommand({
        taskId: task.id,
        inputId: laterInput.input.id,
        expectedRevision: 1n,
        patch: createAndAddPatch("Colour", "Black"),
      }),
    );
    await expect(
      undoStateChange(connection.db, {
        applicationSchemaVersion: 1,
        applicationKind: "undo",
        taskId: task.id,
        expectedRevision: 1n,
        source: { kind: "user_explicit", inputId: staleUndoInput.input.id },
        targetApplicationId: added.application.id,
      }),
    ).rejects.toBeInstanceOf(StaleTaskRevisionError);
    expect(
      (await loadCurrentShoppingState(connection.db, task.id)).task
        .currentRevision,
    ).toBe(2n);
  });
});
