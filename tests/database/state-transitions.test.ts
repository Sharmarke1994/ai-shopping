import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  PersistedDataCorruptionError,
  StaleTaskRevisionError,
  StateApplicationIdempotencyConflictError,
} from "../../src/domain/shopping-state/errors";
import { recordTaskInput } from "../../src/features/shopping-state/persistence/inputs-and-messages";
import { loadCurrentShoppingState } from "../../src/features/shopping-state/persistence/state-loaders";
import {
  applyStatePatch,
  undoStateChange,
} from "../../src/features/shopping-state/persistence/state-transitions";
import { createShoppingTask } from "../../src/features/shopping-state/persistence/tasks";
import {
  decisionCriteria,
  stateChangeApplications,
} from "../../src/infrastructure/database/schema";
import {
  createTestDatabaseConnection,
  resetShoppingState,
  type TestDatabaseConnection,
} from "./helpers";

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

  it("serializes concurrent same-source applications onto one exact receipt", async () => {
    const task = await createShoppingTask(connection.db);
    const source = await input(connection, task.id, "same-source-race", 0n);
    const command = explicitCommand({
      taskId: task.id,
      inputId: source.input.id,
      expectedRevision: 0n,
      patch: createAndAddPatch(),
    });
    const [left, right] = await Promise.all([
      applyStatePatch(connection.db, command),
      applyStatePatch(connection.db, command),
    ]);
    expect(left).toEqual(right);
    expect(
      await connection.db.select().from(stateChangeApplications),
    ).toHaveLength(1);
    expect(
      (await loadCurrentShoppingState(connection.db, task.id)).task
        .currentRevision,
    ).toBe(1n);
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

  it("allows one revision winner and leaves the stale writer with no receipt", async () => {
    const task = await createShoppingTask(connection.db);
    const left = await input(connection, task.id, "left", 0n);
    const right = await input(connection, task.id, "right", 0n);
    const results = await Promise.allSettled([
      applyStatePatch(
        connection.db,
        explicitCommand({
          taskId: task.id,
          inputId: left.input.id,
          expectedRevision: 0n,
          patch: createAndAddPatch("Brand", "Nike"),
        }),
      ),
      applyStatePatch(
        connection.db,
        explicitCommand({
          taskId: task.id,
          inputId: right.input.id,
          expectedRevision: 0n,
          patch: createAndAddPatch("Colour", "Black"),
        }),
      ),
    ]);
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
});
