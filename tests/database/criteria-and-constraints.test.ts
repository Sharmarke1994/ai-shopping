import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { conceptDefinitionSchema } from "../../src/domain/shopping-state/concept-definition";
import {
  criterionSourceSchema,
  decisionCriterionSchema,
} from "../../src/domain/shopping-state/decision-criterion";
import {
  CandidateIdentityNotAvailableError,
  PersistedDataCorruptionError,
} from "../../src/domain/shopping-state/errors";
import { recordTaskInput } from "../../src/features/shopping-state/persistence/inputs-and-messages";
import { insertConceptDefinition } from "../../src/features/shopping-state/persistence/concepts";
import {
  insertCriterionWithSourcesInTransaction,
  listDecisionCriteria,
} from "../../src/features/shopping-state/persistence/criteria";
import { createShoppingTask } from "../../src/features/shopping-state/persistence/tasks";
import {
  criterionSources,
  decisionCriteria,
  shoppingTasks,
} from "../../src/infrastructure/database/schema";
import {
  createTestDatabaseConnection,
  resetShoppingState,
  type TestDatabaseConnection,
} from "./helpers";

type NewConcept = Omit<z.input<typeof conceptDefinitionSchema>, "createdAt">;
type NewCriterion = Omit<
  z.input<typeof decisionCriterionSchema>,
  "createdAt" | "updatedAt"
>;
type NewSource = Omit<z.input<typeof criterionSourceSchema>, "createdAt">;

async function advanceFixtureRevision(
  connection: TestDatabaseConnection,
  taskId: string,
  revision: bigint,
) {
  await connection.db
    .update(shoppingTasks)
    .set({ currentRevision: revision })
    .where(eq(shoppingTasks.id, taskId));
}

function concept(options: {
  taskId: string;
  label: string;
  valueFamily: NewConcept["valueFamily"];
  canonicalUnit?: NewConcept["canonicalUnit"];
}): NewConcept {
  return {
    id: randomUUID(),
    taskId: options.taskId,
    label: options.label,
    definition: `Task-local ${options.label.toLowerCase()}`,
    valueFamily: options.valueFamily,
    canonicalUnit: options.canonicalUnit ?? null,
    createdRevision: 1n,
  };
}

function criterion(options: {
  taskId: string;
  conceptId: string;
  semanticValue: NewCriterion["semanticValue"];
  targetSemantics: NewCriterion["targetSemantics"];
  strength?: NewCriterion["strength"];
  authority?: NewCriterion["authority"];
  lineageId?: string;
  id?: string;
}): NewCriterion {
  return {
    id: options.id ?? randomUUID(),
    taskId: options.taskId,
    lineageId: options.lineageId ?? randomUUID(),
    conceptId: options.conceptId,
    authority: options.authority ?? "user_explicit",
    strength: options.strength === undefined ? "preference" : options.strength,
    targetSemantics: options.targetSemantics,
    valueSchemaVersion: 1,
    valueKind: options.semanticValue.kind,
    semanticValue: options.semanticValue,
    lifecycle: "active",
    createdRevision: 2n,
    endedRevision: null,
    supersededById: null,
  };
}

function originSource(options: {
  taskId: string;
  criterionId: string;
  taskInputId: string;
  messageId: string;
}): NewSource {
  return {
    id: randomUUID(),
    taskId: options.taskId,
    criterionId: options.criterionId,
    sourceRole: "origin",
    sourceKind: "message",
    taskInputId: options.taskInputId,
    messageId: options.messageId,
  };
}

describe("criterion persistence and PostgreSQL constraints", () => {
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

  it("round-trips every enabled semantic variant without collapsing golden distinctions", async () => {
    const task = await createShoppingTask(connection.db);
    await advanceFixtureRevision(connection, task.id, 10n);
    const origin = await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: "golden-origin",
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 10n,
        kind: "message",
        body: "Shelving under 60 cm wide and 30 cm deep, around £30; no white",
      },
    });
    if (origin.message === null) throw new Error("Expected origin message");

    const concepts = await Promise.all(
      [
        concept({ taskId: task.id, label: "Boolean", valueFamily: "boolean" }),
        concept({
          taskId: task.id,
          label: "Visual lightness",
          valueFamily: "qualitative",
        }),
        concept({
          taskId: task.id,
          label: "Maximum width",
          valueFamily: "measurement",
          canonicalUnit: "cm",
        }),
        concept({
          taskId: task.id,
          label: "Maximum depth",
          valueFamily: "measurement",
          canonicalUnit: "cm",
        }),
        concept({ taskId: task.id, label: "Budget", valueFamily: "money" }),
        concept({
          taskId: task.id,
          label: "Colour",
          valueFamily: "categorical",
        }),
        concept({
          taskId: task.id,
          label: "Brand",
          valueFamily: "categorical",
        }),
      ].map((entry) =>
        insertConceptDefinition({ db: connection.db, concept: entry }),
      ),
    );
    const byLabel = new Map(concepts.map((entry) => [entry.label, entry]));

    const fixtures: NewCriterion[] = [
      criterion({
        taskId: task.id,
        conceptId: byLabel.get("Boolean")!.id,
        targetSemantics: "exact",
        semanticValue: { schemaVersion: 1, kind: "boolean", value: true },
      }),
      criterion({
        taskId: task.id,
        conceptId: byLabel.get("Visual lightness")!.id,
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative",
          mode: "text",
          text: "visually light",
        },
      }),
      criterion({
        taskId: task.id,
        conceptId: byLabel.get("Maximum width")!.id,
        targetSemantics: "around",
        semanticValue: {
          schemaVersion: 1,
          kind: "measurement",
          amount: "0.6",
          unit: "m",
        },
      }),
      criterion({
        taskId: task.id,
        conceptId: byLabel.get("Maximum depth")!.id,
        targetSemantics: "range",
        strength: "hard",
        semanticValue: {
          schemaVersion: 1,
          kind: "measurement_range",
          upper: { amount: "30", inclusive: true },
          unit: "cm",
        },
      }),
      criterion({
        taskId: task.id,
        conceptId: byLabel.get("Budget")!.id,
        targetSemantics: "around",
        semanticValue: {
          schemaVersion: 1,
          kind: "money",
          mode: "target",
          amountMinor: 3000,
          currency: "GBP",
        },
      }),
      criterion({
        taskId: task.id,
        conceptId: byLabel.get("Budget")!.id,
        targetSemantics: "range",
        strength: "hard",
        semanticValue: {
          schemaVersion: 1,
          kind: "money",
          mode: "ceiling",
          amountMinor: 3000,
          currency: "GBP",
        },
      }),
      criterion({
        taskId: task.id,
        conceptId: byLabel.get("Budget")!.id,
        targetSemantics: "stretch",
        semanticValue: {
          schemaVersion: 1,
          kind: "money_stretch",
          targetMinor: 3000,
          stretchCeilingMinor: 4000,
          currency: "GBP",
          condition: "if materially better",
        },
      }),
      criterion({
        taskId: task.id,
        conceptId: byLabel.get("Colour")!.id,
        targetSemantics: "categorical",
        strength: "hard",
        semanticValue: {
          schemaVersion: 1,
          kind: "categorical",
          operator: "exclude",
          values: ["white"],
        },
      }),
      criterion({
        taskId: task.id,
        conceptId: byLabel.get("Brand")!.id,
        targetSemantics: "categorical",
        semanticValue: {
          schemaVersion: 1,
          kind: "categorical",
          operator: "prefer",
          values: ["Nike"],
        },
      }),
      criterion({
        taskId: task.id,
        conceptId: byLabel.get("Brand")!.id,
        targetSemantics: "indifferent",
        strength: null,
        semanticValue: { schemaVersion: 1, kind: "indifferent" },
      }),
    ];

    for (const entry of fixtures) {
      await connection.db.transaction((tx) =>
        insertCriterionWithSourcesInTransaction({
          tx,
          criterion: entry,
          sources: [
            originSource({
              taskId: task.id,
              criterionId: entry.id,
              taskInputId: origin.input.id,
              messageId: origin.message!.id,
            }),
          ],
        }),
      );
    }

    const stored = await listDecisionCriteria(connection.db, task.id);
    expect(stored).toHaveLength(fixtures.length);
    const values = stored.map((entry) => entry.criterion.semanticValue);
    expect(values).toContainEqual({
      schemaVersion: 1,
      kind: "measurement",
      amount: "60",
      unit: "cm",
    });
    expect(values).toContainEqual({
      schemaVersion: 1,
      kind: "money",
      mode: "target",
      amountMinor: 3000,
      currency: "GBP",
    });
    expect(values).toContainEqual({
      schemaVersion: 1,
      kind: "money",
      mode: "ceiling",
      amountMinor: 3000,
      currency: "GBP",
    });
    expect(values).toContainEqual({
      schemaVersion: 1,
      kind: "categorical",
      operator: "prefer",
      values: ["Nike"],
    });
    expect(values).toContainEqual({ schemaVersion: 1, kind: "indifferent" });
    expect(byLabel.has("Maximum height")).toBe(false);
    expect(byLabel.has("Product")).toBe(false);
  });

  it("rejects comparison persistence at the typed boundary", async () => {
    const task = await createShoppingTask(connection.db);
    await advanceFixtureRevision(connection, task.id, 2n);
    const origin = await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: "comparison-origin",
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 2n,
        kind: "message",
        body: "Thinner than candidate three",
      },
    });
    if (origin.message === null) throw new Error("Expected origin message");
    const qualitative = await insertConceptDefinition({
      db: connection.db,
      concept: concept({
        taskId: task.id,
        label: "Physical bulk",
        valueFamily: "qualitative",
      }),
    });
    const comparison = criterion({
      taskId: task.id,
      conceptId: qualitative.id,
      targetSemantics: "comparative",
      semanticValue: {
        schemaVersion: 1,
        kind: "comparison",
        relation: "less_than",
        reference: {
          kind: "candidate_listing",
          taskId: task.id,
          candidateListingId: randomUUID(),
        },
      },
    });

    await expect(
      connection.db.transaction((tx) =>
        insertCriterionWithSourcesInTransaction({
          tx,
          criterion: comparison,
          sources: [
            originSource({
              taskId: task.id,
              criterionId: comparison.id,
              taskInputId: origin.input.id,
              messageId: origin.message!.id,
            }),
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(CandidateIdentityNotAvailableError);
  });

  it("requires user-confirmed truth to retain origin and confirmation provenance", async () => {
    const task = await createShoppingTask(connection.db);
    await advanceFixtureRevision(connection, task.id, 3n);
    const origin = await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: "anc-origin",
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 3n,
        kind: "message",
        body: "Headphones for the train",
      },
    });
    const confirmation = await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: "anc-confirmation",
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 3n,
        kind: "question_answer",
        questionId: "train-priority",
        optionId: "anc",
        answerText: "Hearing less of the train",
      },
    });
    if (origin.message === null) throw new Error("Expected origin message");
    const anc = await insertConceptDefinition({
      db: connection.db,
      concept: concept({
        taskId: task.id,
        label: "Noise cancellation",
        valueFamily: "qualitative",
      }),
    });
    const entry = criterion({
      taskId: task.id,
      conceptId: anc.id,
      authority: "user_confirmed",
      targetSemantics: "qualitative",
      semanticValue: {
        schemaVersion: 1,
        kind: "qualitative",
        mode: "text",
        text: "strong noise cancellation",
      },
    });
    const sources: NewSource[] = [
      originSource({
        taskId: task.id,
        criterionId: entry.id,
        taskInputId: origin.input.id,
        messageId: origin.message.id,
      }),
      {
        id: randomUUID(),
        taskId: task.id,
        criterionId: entry.id,
        sourceRole: "confirmation",
        sourceKind: "question_answer",
        taskInputId: confirmation.input.id,
        messageId: null,
      },
    ];

    const stored = await connection.db.transaction((tx) =>
      insertCriterionWithSourcesInTransaction({
        tx,
        criterion: entry,
        sources,
      }),
    );
    expect(stored.criterion.authority).toBe("user_confirmed");
    expect(stored.sources.map((source) => source.sourceRole).sort()).toEqual([
      "confirmation",
      "origin",
    ]);
  });

  it("rejects raw cross-task and exact-message provenance mismatches", async () => {
    const firstTask = await createShoppingTask(connection.db);
    const secondTask = await createShoppingTask(connection.db);
    await advanceFixtureRevision(connection, firstTask.id, 3n);
    await advanceFixtureRevision(connection, secondTask.id, 3n);
    const firstMessage = await recordTaskInput({
      db: connection.db,
      taskId: firstTask.id,
      clientActionId: "first",
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 3n,
        kind: "message",
        body: "First source",
      },
    });
    const secondMessage = await recordTaskInput({
      db: connection.db,
      taskId: firstTask.id,
      clientActionId: "second",
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 3n,
        kind: "message",
        body: "Second source",
      },
    });
    if (firstMessage.message === null || secondMessage.message === null) {
      throw new Error("Expected message rows");
    }
    const secondConcept = await insertConceptDefinition({
      db: connection.db,
      concept: concept({
        taskId: secondTask.id,
        label: "Colour",
        valueFamily: "categorical",
      }),
    });

    await expect(
      connection.client.unsafe(`
        insert into shopping_private.decision_criteria (
          id, task_id, lineage_id, concept_id, authority, strength,
          target_semantics, value_schema_version, value_kind, semantic_value,
          lifecycle, created_revision
        ) values (
          '${randomUUID()}', '${firstTask.id}', '${randomUUID()}', '${secondConcept.id}',
          'user_explicit', 'preference', 'categorical', 1, 'categorical',
          '{"schemaVersion":1,"kind":"categorical","operator":"prefer","values":["dark"]}',
          'active', 2
        )
      `),
    ).rejects.toThrow();

    const firstConcept = await insertConceptDefinition({
      db: connection.db,
      concept: concept({
        taskId: firstTask.id,
        label: "Brand",
        valueFamily: "categorical",
      }),
    });
    const storedCriterion = criterion({
      taskId: firstTask.id,
      conceptId: firstConcept.id,
      targetSemantics: "categorical",
      semanticValue: {
        schemaVersion: 1,
        kind: "categorical",
        operator: "prefer",
        values: ["Nike"],
      },
    });
    await connection.db.transaction((tx) =>
      insertCriterionWithSourcesInTransaction({
        tx,
        criterion: storedCriterion,
        sources: [
          originSource({
            taskId: firstTask.id,
            criterionId: storedCriterion.id,
            taskInputId: firstMessage.input.id,
            messageId: firstMessage.message!.id,
          }),
        ],
      }),
    );

    await expect(
      connection.db.insert(criterionSources).values({
        id: randomUUID(),
        taskId: firstTask.id,
        criterionId: storedCriterion.id,
        sourceRole: "change",
        sourceKind: "message",
        taskInputId: firstMessage.input.id,
        messageId: secondMessage.message.id,
      }),
    ).rejects.toThrow();
  });

  it("enforces JSON, lifecycle, active-lineage, and cross-concept successor guards", async () => {
    const task = await createShoppingTask(connection.db);
    await advanceFixtureRevision(connection, task.id, 5n);
    const firstConcept = await insertConceptDefinition({
      db: connection.db,
      concept: concept({
        taskId: task.id,
        label: "Colour",
        valueFamily: "categorical",
      }),
    });
    const secondConcept = await insertConceptDefinition({
      db: connection.db,
      concept: concept({
        taskId: task.id,
        label: "Brand",
        valueFamily: "categorical",
      }),
    });
    const lineageId = randomUUID();
    const predecessorId = randomUUID();
    const successorId = randomUUID();
    const semanticJson = JSON.stringify({
      schemaVersion: 1,
      kind: "categorical",
      operator: "prefer",
      values: ["dark"],
    });
    await connection.db.insert(decisionCriteria).values({
      id: predecessorId,
      taskId: task.id,
      lineageId,
      conceptId: firstConcept.id,
      authority: "user_explicit",
      strength: "preference",
      targetSemantics: "categorical",
      valueSchemaVersion: 1,
      valueKind: "categorical",
      semanticValue: JSON.parse(semanticJson) as unknown,
      lifecycle: "active",
      createdRevision: 2n,
    });

    await expect(
      connection.db.insert(decisionCriteria).values({
        id: randomUUID(),
        taskId: task.id,
        lineageId,
        conceptId: firstConcept.id,
        authority: "user_explicit",
        strength: "preference",
        targetSemantics: "categorical",
        valueSchemaVersion: 1,
        valueKind: "categorical",
        semanticValue: JSON.parse(semanticJson) as unknown,
        lifecycle: "active",
        createdRevision: 3n,
      }),
    ).rejects.toThrow();

    await expect(
      connection.client.unsafe(`
        insert into shopping_private.decision_criteria (
          id, task_id, lineage_id, concept_id, authority, strength,
          target_semantics, value_schema_version, value_kind, semantic_value,
          lifecycle, created_revision
        ) values (
          '${randomUUID()}', '${task.id}', '${randomUUID()}', '${firstConcept.id}',
          'user_explicit', 'preference', 'categorical', 1, 'categorical',
          '{"schemaVersion":1,"kind":"money","mode":"target","amountMinor":3000,"currency":"GBP"}',
          'active', 3
        )
      `),
    ).rejects.toThrow();

    await expect(
      connection.client.unsafe(`
        insert into shopping_private.decision_criteria (
          id, task_id, lineage_id, concept_id, authority, strength,
          target_semantics, value_schema_version, value_kind, semantic_value,
          lifecycle, created_revision
        ) values (
          '${randomUUID()}', '${task.id}', '${randomUUID()}', '${firstConcept.id}',
          'user_explicit', 'preference', 'comparative', 1, 'comparison',
          '{"schemaVersion":1,"kind":"comparison","relation":"less_than","reference":{"kind":"candidate_listing","taskId":"${task.id}","candidateListingId":"${randomUUID()}"}}',
          'active', 3
        )
      `),
    ).rejects.toThrow();

    await expect(
      connection.client.unsafe(`
        insert into shopping_private.decision_criteria (
          id, task_id, lineage_id, concept_id, authority, strength,
          target_semantics, value_schema_version, value_kind, semantic_value,
          lifecycle, created_revision, ended_revision
        ) values (
          '${randomUUID()}', '${task.id}', '${randomUUID()}', '${firstConcept.id}',
          'user_explicit', 'preference', 'categorical', 1, 'categorical',
          '${semanticJson}', 'removed', 4, null
        )
      `),
    ).rejects.toThrow();

    await expect(
      connection.db.transaction(async (tx) => {
        await tx
          .update(decisionCriteria)
          .set({
            lifecycle: "superseded",
            endedRevision: 3n,
            supersededById: successorId,
          })
          .where(eq(decisionCriteria.id, predecessorId));
        await tx.insert(decisionCriteria).values({
          id: successorId,
          taskId: task.id,
          lineageId,
          conceptId: secondConcept.id,
          authority: "user_explicit",
          strength: "preference",
          targetSemantics: "categorical",
          valueSchemaVersion: 1,
          valueKind: "categorical",
          semanticValue: JSON.parse(semanticJson) as unknown,
          lifecycle: "active",
          createdRevision: 3n,
        });
      }),
    ).rejects.toThrow();

    const [stillActive] = await connection.db
      .select({ lifecycle: decisionCriteria.lifecycle })
      .from(decisionCriteria)
      .where(eq(decisionCriteria.id, predecessorId));
    expect(stillActive?.lifecycle).toBe("active");

    const validSuccessorId = randomUUID();
    await connection.db.transaction(async (tx) => {
      await tx
        .update(decisionCriteria)
        .set({
          lifecycle: "superseded",
          endedRevision: 3n,
          supersededById: validSuccessorId,
        })
        .where(eq(decisionCriteria.id, predecessorId));
      await tx.insert(decisionCriteria).values({
        id: validSuccessorId,
        taskId: task.id,
        lineageId,
        conceptId: firstConcept.id,
        authority: "user_explicit",
        strength: "preference",
        targetSemantics: "categorical",
        valueSchemaVersion: 1,
        valueKind: "categorical",
        semanticValue: JSON.parse(semanticJson) as unknown,
        lifecycle: "active",
        createdRevision: 3n,
      });
    });
    const lifecycleRows = await connection.db
      .select({
        id: decisionCriteria.id,
        lifecycle: decisionCriteria.lifecycle,
        supersededById: decisionCriteria.supersededById,
      })
      .from(decisionCriteria)
      .where(eq(decisionCriteria.lineageId, lineageId));
    expect(lifecycleRows).toEqual(
      expect.arrayContaining([
        {
          id: predecessorId,
          lifecycle: "superseded",
          supersededById: validSuccessorId,
        },
        {
          id: validSuccessorId,
          lifecycle: "active",
          supersededById: null,
        },
      ]),
    );
  });

  it("rolls back a criterion and its provenance with the caller transaction", async () => {
    const task = await createShoppingTask(connection.db);
    await advanceFixtureRevision(connection, task.id, 2n);
    const origin = await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: "rollback-origin",
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 2n,
        kind: "message",
        body: "Prefer dark",
      },
    });
    if (origin.message === null) throw new Error("Expected origin message");
    const colour = await insertConceptDefinition({
      db: connection.db,
      concept: concept({
        taskId: task.id,
        label: "Colour",
        valueFamily: "categorical",
      }),
    });
    const entry = criterion({
      taskId: task.id,
      conceptId: colour.id,
      targetSemantics: "categorical",
      semanticValue: {
        schemaVersion: 1,
        kind: "categorical",
        operator: "prefer",
        values: ["dark"],
      },
    });

    await expect(
      connection.db.transaction(async (tx) => {
        await insertCriterionWithSourcesInTransaction({
          tx,
          criterion: entry,
          sources: [
            originSource({
              taskId: task.id,
              criterionId: entry.id,
              taskInputId: origin.input.id,
              messageId: origin.message!.id,
            }),
          ],
        });
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");

    const [criterionCount] = await connection.db
      .select({ count: sql<number>`count(*)::integer` })
      .from(decisionCriteria)
      .where(eq(decisionCriteria.id, entry.id));
    expect(criterionCount?.count).toBe(0);
  });

  it("fails closed when persisted JSON passes shallow SQL checks but not Zod", async () => {
    const task = await createShoppingTask(connection.db);
    await advanceFixtureRevision(connection, task.id, 2n);
    const colour = await insertConceptDefinition({
      db: connection.db,
      concept: concept({
        taskId: task.id,
        label: "Colour",
        valueFamily: "categorical",
      }),
    });
    await connection.client.unsafe(`
      insert into shopping_private.decision_criteria (
        id, task_id, lineage_id, concept_id, authority, strength,
        target_semantics, value_schema_version, value_kind, semantic_value,
        lifecycle, created_revision
      ) values (
        '${randomUUID()}', '${task.id}', '${randomUUID()}', '${colour.id}',
        'user_explicit', 'preference', 'categorical', 1, 'categorical',
        '{"schemaVersion":1,"kind":"categorical","operator":"prefer","values":[]}',
        'active', 2
      )
    `);

    await expect(
      listDecisionCriteria(connection.db, task.id),
    ).rejects.toBeInstanceOf(PersistedDataCorruptionError);
  });
});
