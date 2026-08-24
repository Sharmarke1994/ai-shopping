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
import { recordContextActionAnswer } from "../../src/features/context-acquisition/persistence/context-action-answers";
import { persistContextAction } from "../../src/features/context-acquisition/persistence/context-actions";
import {
  loadRetrievalContextFromPersistedState,
  RetrievalActionNotSearchError,
  RetrievalContextActionNotFoundError,
} from "../../src/features/retrieval-spike/context-from-persisted-state";
import {
  recordInitialShoppingSubject,
  ShoppingSubjectConflictError,
  ShoppingSubjectInitialInputError,
  ShoppingSubjectNotFoundError,
} from "../../src/features/retrieval-spike/persistence/shopping-subjects";
import { FakeShoppingProvider } from "../../src/features/retrieval-spike/fake-shopping-provider";
import { buildSearchQueryPortfolio } from "../../src/features/retrieval-spike/query-strategy";
import { prepareRetrievalRun } from "../../src/features/retrieval-spike/retrieval-orchestrator";
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
    const source = await recordInitialShoppingSubject({
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

  it("binds one exact initial V1 message and rejects a different subject", async () => {
    const task = await createShoppingTask(connection.db);
    const request = {
      inputSchemaVersion: 1 as const,
      expectedRevision: 0n,
      kind: "message" as const,
      body: "I need a lightweight running cap",
    };
    const first = await recordInitialShoppingSubject({
      db: connection.db,
      taskId: task.id,
      clientActionId: "immutable-subject",
      request,
    });
    const retry = await recordInitialShoppingSubject({
      db: connection.db,
      taskId: task.id,
      clientActionId: "immutable-subject",
      request,
    });

    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(retry.subject).toEqual(first.subject);
    expect(retry.input.id).toBe(first.input.id);
    expect(retry.message.id).toBe(first.message.id);

    await expect(
      recordInitialShoppingSubject({
        db: connection.db,
        taskId: task.id,
        clientActionId: "different-subject",
        request: { ...request, body: "I need over-ear headphones" },
      }),
    ).rejects.toBeInstanceOf(ShoppingSubjectConflictError);
  });

  it("cannot bind a later message as subject after revision-0 work already exists", async () => {
    const task = await createShoppingTask(connection.db);
    const first = await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: "unbound-first-message",
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 0n,
        kind: "message",
        body: "Message A",
      },
    });
    const acquired = await acquireShoppingContext({
      db: connection.db,
      model: model(noChangeWire),
      taskId: task.id,
      sourceInputId: first.input.id,
    });
    if (
      acquired.status !== "completed" ||
      acquired.action.action !== "search"
    ) {
      throw new Error("Expected revision-0 SEARCH");
    }

    await expect(
      recordInitialShoppingSubject({
        db: connection.db,
        taskId: task.id,
        clientActionId: "late-subject",
        request: {
          inputSchemaVersion: 1,
          expectedRevision: 0n,
          kind: "message",
          body: "Message B",
        },
      }),
    ).rejects.toBeInstanceOf(ShoppingSubjectInitialInputError);
  });

  it("loads the current deterministic brief and preserves hypothesis separation", async () => {
    const { task, source, acquired } = await acquireCapSearch();
    const stateBefore = await loadCurrentShoppingState(connection.db, task.id);
    const weightCriterionId = acquired.stateApplication.brief.items.find(
      (item) => item.conceptLabel === "Weight",
    )?.criterionId;
    if (weightCriterionId === undefined) throw new Error("Expected weight");

    const authority = await loadRetrievalContextFromPersistedState({
      db: connection.db,
      taskId: task.id,
      contextActionId: acquired.action.id,
      marketVocabulary: [
        {
          term: "race cap",
          rationale: "Explore commercial running-cap language.",
          basisCriterionIds: [weightCriterionId],
        },
      ],
    });
    const stateAfter = await loadCurrentShoppingState(connection.db, task.id);

    expect(authority).toMatchObject({
      contextActionId: acquired.action.id,
      stateApplicationId: acquired.stateApplication.application.id,
      triggerInputId: source.input.id,
      context: {
        taskId: task.id,
        revision: 1n,
        market: { country: "GB", language: "en-GB", currency: "GBP" },
        shoppingSubject: {
          text: "I need a light breathable cap for hot weather.",
          sourceInputId: source.input.id,
        },
      },
    });
    expect(authority.context.brief).toEqual(projectShoppingBrief(stateBefore));
    expect(
      authority.context.brief.items.map((item) => item.conceptLabel).toSorted(),
    ).toEqual(["Breathability", "Weight"]);
    expect(authority.context.brief.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ conceptLabel: "race cap" }),
      ]),
    );
    expect(stateAfter).toEqual(stateBefore);

    const portfolio = buildSearchQueryPortfolio(authority.context);
    expect(portfolio.queries.at(-1)).toMatchObject({
      purpose: "market_language",
      text: expect.stringContaining("race cap"),
    });
    expect(await loadCurrentShoppingState(connection.db, task.id)).toEqual(
      stateBefore,
    );
  });

  it("rejects a SEARCH action owned by another task", async () => {
    const { acquired } = await acquireCapSearch();
    const otherTask = await createShoppingTask(connection.db);

    await expect(
      loadRetrievalContextFromPersistedState({
        db: connection.db,
        taskId: otherTask.id,
        contextActionId: acquired.action.id,
      }),
    ).rejects.toBeInstanceOf(RetrievalContextActionNotFoundError);
  });

  it("fails closed when a task has no immutable shopping subject", async () => {
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
        contextActionId: acquired.action.id,
      }),
    ).rejects.toBeInstanceOf(ShoppingSubjectNotFoundError);
  });

  it("preserves the initial subject while an ASK answer becomes the SEARCH trigger", async () => {
    const task = await createShoppingTask(connection.db);
    const initial = await recordInitialShoppingSubject({
      db: connection.db,
      taskId: task.id,
      clientActionId: "shelving-subject",
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 0n,
        kind: "message",
        body: "I need visually light shelving for this alcove",
      },
    });
    const asked = await acquireShoppingContext({
      db: connection.db,
      model: {
        interpret: () => completed(noChangeWire),
        selectAction: () =>
          completed({
            providerSchemaVersion: 1,
            action: "ask" as const,
            question: {
              prompt: "What is the maximum height it can be?",
              responseMode: "open_text" as const,
              options: [],
              expectedImpact: "eligibility" as const,
              whyNow: "Height determines whether the shelf can fit.",
              canSearchWithoutAnswer: true,
            },
            rationale: null,
          }),
      },
      taskId: task.id,
      sourceInputId: initial.input.id,
    });
    if (asked.status !== "completed" || asked.action.action !== "ask") {
      throw new Error("Expected a persisted ASK");
    }
    await expect(
      loadRetrievalContextFromPersistedState({
        db: connection.db,
        taskId: task.id,
        contextActionId: asked.action.id,
      }),
    ).rejects.toBeInstanceOf(RetrievalActionNotSearchError);

    const answer = await recordContextActionAnswer({
      db: connection.db,
      taskId: task.id,
      clientActionId: "shelving-height-answer",
      request: {
        inputSchemaVersion: 2,
        expectedRevision: 0n,
        kind: "question_answer",
        questionId: asked.action.id,
        answer: { mode: "open_text", text: "60 cm high at most" },
      },
    });
    const answered = await acquireShoppingContext({
      db: connection.db,
      model: {
        interpret: () =>
          completed({
            providerSchemaVersion: 1,
            outcome: "change" as const,
            operations: [
              {
                op: "create_concept" as const,
                localRef: "maximum_height",
                label: "Maximum height",
                definition: "Maximum overall shelving height",
                valueFamily: "measurement" as const,
                canonicalUnit: "cm" as const,
              },
              {
                op: "add_criterion" as const,
                concept: {
                  kind: "created" as const,
                  localRef: "maximum_height",
                },
                target: {
                  strength: "hard" as const,
                  targetSemantics: "range" as const,
                  semanticValue: {
                    schemaVersion: 1 as const,
                    kind: "measurement_range" as const,
                    lower: null,
                    upper: { amount: "60", inclusive: true },
                    unit: "cm" as const,
                  },
                },
              },
            ],
            ambiguities: [],
          }),
        selectAction: () => completed(searchWire),
      },
      taskId: task.id,
      sourceInputId: answer.input.id,
    });
    if (
      answered.status !== "completed" ||
      answered.action.action !== "search"
    ) {
      throw new Error("Expected SEARCH after the answer");
    }

    const authority = await loadRetrievalContextFromPersistedState({
      db: connection.db,
      taskId: task.id,
      contextActionId: answered.action.id,
    });
    expect(authority).toMatchObject({
      contextActionId: answered.action.id,
      stateApplicationId: answered.stateApplication.application.id,
      triggerInputId: answer.input.id,
      context: {
        taskId: task.id,
        revision: 1n,
        shoppingSubject: {
          text: "I need visually light shelving for this alcove",
          sourceInputId: initial.input.id,
        },
      },
    });
    expect(
      authority.context.brief.items.map((item) => item.conceptLabel),
    ).toEqual(["Maximum height"]);
    const plan = await prepareRetrievalRun({
      db: connection.db,
      taskId: task.id,
      contextActionId: answered.action.id,
      provider: new FakeShoppingProvider(),
      now: () => new Date("2026-08-24T12:00:00.000Z"),
    });
    expect(plan).toMatchObject({
      created: true,
      run: {
        contextActionId: answered.action.id,
        provider: "fixture",
        status: "running",
        portfolio: {
          run: { taskId: task.id, taskRevision: 1n },
        },
      },
    });
    expect(plan.run.portfolio.queries[0]?.text).toContain(
      "I need visually light shelving for this alcove",
    );
    expect(
      plan.run.portfolio.queries.some((query) => query.text.includes("60")),
    ).toBe(true);
  });

  it("allows action-stage recovery at a later revision without changing the receipt trigger", async () => {
    const task = await createShoppingTask(connection.db);
    const subject = await recordInitialShoppingSubject({
      db: connection.db,
      taskId: task.id,
      clientActionId: "recovered-action-subject",
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 0n,
        kind: "message",
        body: "I need a compact black desk lamp",
      },
    });
    const originalApplication = await applyStatePatch(connection.db, {
      applicationSchemaVersion: 1,
      applicationKind: "patch",
      taskId: task.id,
      expectedRevision: 0n,
      source: { kind: "user_explicit", inputId: subject.input.id },
      patch: { schemaVersion: 1, outcome: "no_change" },
    });
    const laterInput = await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: "recovered-action-later-truth",
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 0n,
        kind: "message",
        body: "Black is a must",
      },
    });
    await applyStatePatch(connection.db, {
      applicationSchemaVersion: 1,
      applicationKind: "patch",
      taskId: task.id,
      expectedRevision: 0n,
      source: { kind: "user_explicit", inputId: laterInput.input.id },
      patch: {
        schemaVersion: 1,
        outcome: "change",
        operations: [
          {
            op: "create_concept",
            localRef: "colour",
            label: "Colour",
            definition: "Required product colour",
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
                operator: "include",
                values: ["black"],
              },
            },
          },
        ],
      },
    });
    const action = await persistContextAction({
      db: connection.db,
      taskId: task.id,
      stateChangeApplicationId: originalApplication.application.id,
      selectedAtRevision: 1n,
      proposal: {
        schemaVersion: 1,
        action: "search",
        rationale: {
          summary: "Recovered against current authoritative truth.",
        },
      },
      config: {
        provider: "fake",
        model: "action-stage-recovery-test",
        promptVersion: "test-v1",
        providerSchemaVersion: 1,
      },
    });

    const authority = await loadRetrievalContextFromPersistedState({
      db: connection.db,
      taskId: task.id,
      contextActionId: action.action.id,
    });
    expect(authority).toMatchObject({
      stateApplicationId: originalApplication.application.id,
      triggerInputId: subject.input.id,
      context: {
        revision: 1n,
        shoppingSubject: { sourceInputId: subject.input.id },
      },
    });
    expect(
      authority.context.brief.items.map((item) => item.conceptLabel),
    ).toEqual(["Colour"]);
  });

  it("refuses to retrieve from a SEARCH selected before later truth", async () => {
    const { task, acquired } = await acquireCapSearch();
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
        contextActionId: acquired.action.id,
      }),
    ).rejects.toMatchObject({
      name: "StaleRetrievalSearchActionError",
      selectedAtRevision: 1n,
      currentRevision: 2n,
    });
  });

  it("returns one coherent historical snapshot when truth advances concurrently", async () => {
    const { task, acquired } = await acquireCapSearch();
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
            contextActionId: acquired.action.id,
          });
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );

      expect(context.context.revision).toBe(1n);
      expect(
        context.context.brief.items.map((item) => item.conceptLabel),
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
