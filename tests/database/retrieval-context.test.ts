import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { projectShoppingBrief } from "../../src/domain/shopping-state/brief";
import { acquireShoppingContext } from "../../src/features/context-acquisition/coordinator";
import type {
  ContextAcquisitionModel,
  ModelCallMetadata,
} from "../../src/features/context-acquisition/model-port";
import type {
  ContextActionProviderWireV1,
  InterpretationProviderWireV1,
} from "../../src/features/context-acquisition/provider-wire";
import {
  loadRetrievalContextFromPersistedState,
  RetrievalSourceApplicationNotFoundError,
  RetrievalSubjectInputKindError,
} from "../../src/features/retrieval-spike/context-from-persisted-state";
import { buildSearchQueryPortfolio } from "../../src/features/retrieval-spike/query-strategy";
import { recordTaskInput } from "../../src/features/shopping-state/persistence/inputs-and-messages";
import { loadCurrentShoppingState } from "../../src/features/shopping-state/persistence/state-loaders";
import { applyStatePatch } from "../../src/features/shopping-state/persistence/state-transitions";
import { createShoppingTask } from "../../src/features/shopping-state/persistence/tasks";
import type { ShoppingDatabase } from "../../src/infrastructure/database/clients";
import {
  createTestDatabaseConnection,
  resetShoppingState,
  type TestDatabaseConnection,
} from "./helpers";

const metadata: ModelCallMetadata = {
  provider: "fake",
  model: "deterministic-retrieval-proof",
  promptVersion: "test-v1",
  providerSchemaVersion: 1,
  providerRequestId: "retrieval-proof",
  durationMs: 1,
  inputTokens: 10,
  outputTokens: 10,
};

const searchWire: ContextActionProviderWireV1 = {
  providerSchemaVersion: 1,
  action: "search",
  question: null,
  rationale: { summary: "The authoritative brief is ready for retrieval." },
};

const noChangeWire: InterpretationProviderWireV1 = {
  providerSchemaVersion: 1,
  outcome: "no_change",
  operations: [],
  ambiguities: [],
};

const capWire: InterpretationProviderWireV1 = {
  providerSchemaVersion: 1,
  outcome: "change",
  operations: [
    {
      op: "create_concept",
      localRef: "weight",
      label: "Weight",
      definition: "How light the cap should be",
      valueFamily: "qualitative",
      canonicalUnit: null,
    },
    {
      op: "add_criterion",
      concept: { kind: "created", localRef: "weight" },
      target: {
        strength: "preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative_text",
          text: "lightweight",
        },
      },
    },
    {
      op: "create_concept",
      localRef: "breathability",
      label: "Breathability",
      definition: "Airflow in hot weather",
      valueFamily: "qualitative",
      canonicalUnit: null,
    },
    {
      op: "add_criterion",
      concept: { kind: "created", localRef: "breathability" },
      target: {
        strength: "preference",
        targetSemantics: "qualitative",
        semanticValue: {
          schemaVersion: 1,
          kind: "qualitative_text",
          text: "breathable",
        },
      },
    },
  ],
  ambiguities: [],
};

function completed<T>(value: T) {
  return Promise.resolve({ status: "completed" as const, value, metadata });
}

function model(
  interpretation: InterpretationProviderWireV1,
): ContextAcquisitionModel {
  return {
    interpret: () => completed(interpretation),
    selectAction: () => completed(searchWire),
  };
}

describe("persisted V0-05 state to retrieval context", () => {
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

  async function acquireCapSearch() {
    const task = await createShoppingTask(connection.db);
    const source = await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: "retrieval-cap-source",
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 0n,
        kind: "message",
        body: "I need a light breathable cap for hot weather.",
      },
    });
    const acquired = await acquireShoppingContext({
      db: connection.db,
      model: model(capWire),
      taskId: task.id,
      sourceInputId: source.input.id,
    });
    if (
      acquired.status !== "completed" ||
      acquired.action.action !== "search"
    ) {
      throw new Error("Expected a persisted V0-05 SEARCH result");
    }
    return { task, source, acquired };
  }

  it("loads the current deterministic brief and preserves hypothesis separation", async () => {
    const { task, source, acquired } = await acquireCapSearch();
    const stateBefore = await loadCurrentShoppingState(connection.db, task.id);
    const weightCriterionId = acquired.stateApplication.brief.items.find(
      (item) => item.conceptLabel === "Weight",
    )?.criterionId;
    if (weightCriterionId === undefined) throw new Error("Expected weight");

    const context = await loadRetrievalContextFromPersistedState({
      db: connection.db,
      taskId: task.id,
      subjectInputId: acquired.stateApplication.application.sourceTaskInputId,
      marketVocabulary: [
        {
          term: "race cap",
          rationale: "Explore commercial running-cap language.",
          basisCriterionIds: [weightCriterionId],
        },
      ],
    });
    const stateAfter = await loadCurrentShoppingState(connection.db, task.id);

    expect(context).toMatchObject({
      taskId: task.id,
      revision: 1n,
      market: { country: "GB", language: "en-GB", currency: "GBP" },
      shoppingSubject: {
        text: "I need a light breathable cap for hot weather.",
        sourceInputId: source.input.id,
      },
    });
    expect(context.brief).toEqual(projectShoppingBrief(stateBefore));
    expect(
      context.brief.items.map((item) => item.conceptLabel).toSorted(),
    ).toEqual(["Breathability", "Weight"]);
    expect(context.brief.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ conceptLabel: "race cap" }),
      ]),
    );
    expect(stateAfter).toEqual(stateBefore);

    const portfolio = buildSearchQueryPortfolio(context);
    expect(portfolio.queries.at(-1)).toMatchObject({
      purpose: "market_language",
      text: expect.stringContaining("race cap"),
    });
    expect(await loadCurrentShoppingState(connection.db, task.id)).toEqual(
      stateBefore,
    );
  });

  it("rejects a validated source application owned by another task", async () => {
    const { source } = await acquireCapSearch();
    const otherTask = await createShoppingTask(connection.db);

    await expect(
      loadRetrievalContextFromPersistedState({
        db: connection.db,
        taskId: otherTask.id,
        subjectInputId: source.input.id,
      }),
    ).rejects.toBeInstanceOf(RetrievalSourceApplicationNotFoundError);
  });

  it("does not reinterpret a brief edit as the shopping subject", async () => {
    const task = await createShoppingTask(connection.db);
    const source = await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: "brief-edit-source",
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 0n,
        kind: "direct_brief_action",
        controlId: "budget",
        submittedText: "Around £30",
      },
    });
    const acquired = await acquireShoppingContext({
      db: connection.db,
      model: model(noChangeWire),
      taskId: task.id,
      sourceInputId: source.input.id,
    });
    if (acquired.status !== "completed") throw new Error("Expected completion");

    await expect(
      loadRetrievalContextFromPersistedState({
        db: connection.db,
        taskId: task.id,
        subjectInputId: source.input.id,
      }),
    ).rejects.toBeInstanceOf(RetrievalSubjectInputKindError);
  });

  it("refuses to retrieve from a SEARCH selected before later truth", async () => {
    const { task, source } = await acquireCapSearch();
    const laterInput = await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: "later-colour-truth",
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 1n,
        kind: "message",
        body: "No white",
      },
    });
    await applyStatePatch(connection.db, {
      applicationSchemaVersion: 1,
      applicationKind: "patch",
      taskId: task.id,
      expectedRevision: 1n,
      source: { kind: "user_explicit", inputId: laterInput.input.id },
      patch: {
        schemaVersion: 1,
        outcome: "change",
        operations: [
          {
            op: "create_concept",
            localRef: "colour",
            label: "Colour",
            definition: "Colours the shopper excludes",
            valueFamily: "categorical",
            canonicalUnit: null,
          },
          {
            op: "add_criterion",
            concept: { kind: "created", localRef: "colour" },
            target: {
              strength: "hard",
              targetSemantics: "categorical",
              semanticValue: {
                schemaVersion: 1,
                kind: "categorical",
                operator: "exclude",
                values: ["white"],
              },
            },
          },
        ],
      },
    });

    await expect(
      loadRetrievalContextFromPersistedState({
        db: connection.db,
        taskId: task.id,
        subjectInputId: source.input.id,
      }),
    ).rejects.toMatchObject({
      name: "StaleRetrievalSearchActionError",
      selectedAtRevision: 1n,
      currentRevision: 2n,
    });
  });

  it("returns one coherent historical snapshot when truth advances concurrently", async () => {
    const { task, source } = await acquireCapSearch();
    const writer = createTestDatabaseConnection("retrieval-snapshot-writer");
    try {
      const context = await connection.db.transaction(
        async (reader) => {
          expect(
            (await loadCurrentShoppingState(reader, task.id)).task
              .currentRevision,
          ).toBe(1n);

          const laterInput = await recordTaskInput({
            db: writer.db,
            taskId: task.id,
            clientActionId: "concurrent-colour-truth",
            request: {
              inputSchemaVersion: 1,
              expectedRevision: 1n,
              kind: "message",
              body: "No white",
            },
          });
          await applyStatePatch(writer.db, {
            applicationSchemaVersion: 1,
            applicationKind: "patch",
            taskId: task.id,
            expectedRevision: 1n,
            source: { kind: "user_explicit", inputId: laterInput.input.id },
            patch: {
              schemaVersion: 1,
              outcome: "change",
              operations: [
                {
                  op: "create_concept",
                  localRef: "colour",
                  label: "Colour",
                  definition: "Colours the shopper excludes",
                  valueFamily: "categorical",
                  canonicalUnit: null,
                },
                {
                  op: "add_criterion",
                  concept: { kind: "created", localRef: "colour" },
                  target: {
                    strength: "hard",
                    targetSemantics: "categorical",
                    semanticValue: {
                      schemaVersion: 1,
                      kind: "categorical",
                      operator: "exclude",
                      values: ["white"],
                    },
                  },
                },
              ],
            },
          });

          return loadRetrievalContextFromPersistedState({
            db: reader as unknown as ShoppingDatabase,
            taskId: task.id,
            subjectInputId: source.input.id,
          });
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );

      expect(context.revision).toBe(1n);
      expect(
        context.brief.items.map((item) => item.conceptLabel),
      ).not.toContain("Colour");
      const fresh = await loadCurrentShoppingState(connection.db, task.id);
      expect(fresh.task.currentRevision).toBe(2n);
      expect(
        projectShoppingBrief(fresh).items.map((item) => item.conceptLabel),
      ).toContain("Colour");
    } finally {
      await writer.close();
    }
  });
});
