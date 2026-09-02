import { and, asc, eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type {
  ContextAcquisitionModel,
  ModelCallMetadata,
} from "../../src/features/context-acquisition/model-port";
import type {
  ContextActionProviderWireV1,
  InterpretationProviderWireV1,
} from "../../src/features/context-acquisition/provider-wire";
import type { InterpretationCoverageProviderWireV1 } from "../../src/features/context-acquisition/interpretation-coverage";
import { acquireShoppingContext } from "../../src/features/context-acquisition/coordinator";
import { recordContextActionAnswer } from "../../src/features/context-acquisition/persistence/context-action-answers";
import { recordTaskInput } from "../../src/features/shopping-state/persistence/inputs-and-messages";
import { loadCurrentShoppingState } from "../../src/features/shopping-state/persistence/state-loaders";
import {
  applyStatePatch,
  undoStateChange,
} from "../../src/features/shopping-state/persistence/state-transitions";
import { createShoppingTask } from "../../src/features/shopping-state/persistence/tasks";
import {
  contextAcquisitionAttempts,
  contextActions,
} from "../../src/infrastructure/database/schema";
import {
  createTestDatabaseConnection,
  resetShoppingState,
  type TestDatabaseConnection,
} from "./helpers";

const metadata: ModelCallMetadata = {
  provider: "fake",
  model: "deterministic",
  promptVersion: "test-v1",
  providerSchemaVersion: 1,
  providerRequestId: "fake-response",
  durationMs: 1,
  inputTokens: 10,
  outputTokens: 10,
};

const noChange: InterpretationProviderWireV1 = {
  providerSchemaVersion: 1,
  outcome: "no_change",
  operations: [],
  ambiguities: [],
};

const search: ContextActionProviderWireV1 = {
  providerSchemaVersion: 1,
  action: "search",
  question: null,
  rationale: { summary: "The request is actionable." },
};

function completed<T>(value: T) {
  return Promise.resolve({ status: "completed" as const, value, metadata });
}

describe("context-acquisition coordinator", () => {
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

  it("applies once, persists SEARCH, and recovers exact retries without another model call", async () => {
    const task = await createShoppingTask(connection.db);
    const input = await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: "exact-lookup",
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 0n,
        kind: "message",
        body: "Sony WH-1000XM6",
      },
    });
    const model: ContextAcquisitionModel = {
      interpret: vi.fn(() => completed(noChange)),
      selectAction: vi.fn(() => completed(search)),
    };

    const first = await acquireShoppingContext({
      db: connection.db,
      model,
      taskId: task.id,
      sourceInputId: input.input.id,
    });
    expect(first.status).toBe("completed");
    if (first.status !== "completed") throw new Error("Expected completion");
    expect(first.action.action).toBe("search");

    const retryModel: ContextAcquisitionModel = {
      interpret: vi.fn(() => {
        throw new Error("retry must not reinterpret");
      }),
      selectAction: vi.fn(() => {
        throw new Error("retry must not reselect");
      }),
    };
    const retry = await acquireShoppingContext({
      db: connection.db,
      model: retryModel,
      taskId: task.id,
      sourceInputId: input.input.id,
    });
    expect(retry).toEqual(first);
    expect(retryModel.interpret).not.toHaveBeenCalled();
    expect(retryModel.selectAction).not.toHaveBeenCalled();
  });

  it("performs at most one semantic repair before applying the final proposal", async () => {
    const task = await createShoppingTask(connection.db);
    const input = await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: "coverage-repair",
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 0n,
        kind: "message",
        body: "No change to my shopping criteria",
      },
    });
    let coverageCalls = 0;
    let repairCalls = 0;
    const incomplete: InterpretationCoverageProviderWireV1 = {
      providerSchemaVersion: 1,
      verdict: "needs_repair",
      issues: [
        {
          kind: "missing_explicit_meaning",
          summary: "A meaning needs review",
        },
      ],
    };
    const complete: InterpretationCoverageProviderWireV1 = {
      providerSchemaVersion: 1,
      verdict: "complete",
      issues: [],
    };
    const model: ContextAcquisitionModel = {
      interpret: () => completed(noChange),
      verifyInterpretationCoverage: () => {
        coverageCalls += 1;
        return completed(coverageCalls === 1 ? incomplete : complete);
      },
      repairInterpretation: () => {
        repairCalls += 1;
        return completed({
          providerSchemaVersion: 2,
          interpretation: { outcome: "no_change", operations: [] },
          ambiguities: [],
        });
      },
      selectAction: () => completed(search),
    };

    const result = await acquireShoppingContext({
      db: connection.db,
      model,
      taskId: task.id,
      sourceInputId: input.input.id,
    });
    expect(result.status).toBe("completed");
    expect(coverageCalls).toBe(2);
    expect(repairCalls).toBe(1);
    const coverageAttempts = await connection.db
      .select({ errorCode: contextAcquisitionAttempts.errorCode })
      .from(contextAcquisitionAttempts)
      .where(
        and(
          eq(contextAcquisitionAttempts.taskId, task.id),
          eq(contextAcquisitionAttempts.sourceTaskInputId, input.input.id),
          eq(contextAcquisitionAttempts.errorCode, "coverage_needs_repair"),
        ),
      );
    expect(coverageAttempts).toHaveLength(1);
  });

  it("persists final verifier issue kinds when one repair is still incomplete", async () => {
    const task = await createShoppingTask(connection.db);
    const input = await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: "coverage-final-issues",
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 0n,
        kind: "message",
        body: "I need a mouse with a comfortable shape and good battery life.",
      },
    });
    let coverageCalls = 0;
    const model: ContextAcquisitionModel = {
      interpret: () => completed(noChange),
      verifyInterpretationCoverage: () => {
        coverageCalls += 1;
        return completed({
          providerSchemaVersion: 1,
          verdict: "needs_repair",
          issues: [
            {
              kind:
                coverageCalls === 1
                  ? "missing_explicit_meaning"
                  : "conditional_loss",
              summary: "The proposal does not preserve this meaning.",
            },
          ],
        });
      },
      repairInterpretation: () => completed(noChange),
      selectAction: vi.fn(() => completed(search)),
    };

    const result = await acquireShoppingContext({
      db: connection.db,
      model,
      taskId: task.id,
      sourceInputId: input.input.id,
    });
    expect(result).toEqual({
      status: "failed",
      stage: "interpretation",
      errorCode: "semantic_coverage_failed",
    });
    expect(model.selectAction).not.toHaveBeenCalled();

    const [finalAttempt] = await connection.db
      .select({
        status: contextAcquisitionAttempts.status,
        coverageDiagnostic: contextAcquisitionAttempts.coverageDiagnostic,
      })
      .from(contextAcquisitionAttempts)
      .where(
        and(
          eq(contextAcquisitionAttempts.taskId, task.id),
          eq(
            contextAcquisitionAttempts.stage,
            "interpretation_repair_coverage",
          ),
        ),
      );
    expect(finalAttempt).toMatchObject({
      status: "malformed",
      coverageDiagnostic: {
        verdict: "needs_repair",
        issueKinds: ["conditional_loss"],
      },
    });
  });

  it("records both stale action races and fails closed without changing semantic truth", async () => {
    const task = await createShoppingTask(connection.db);
    const baselineInput = await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: "stale-action-baseline",
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 0n,
        kind: "message",
        body: "I prefer Nike",
      },
    });
    await applyStatePatch(connection.db, {
      applicationSchemaVersion: 1,
      applicationKind: "patch",
      taskId: task.id,
      expectedRevision: 0n,
      source: { kind: "user_explicit", inputId: baselineInput.input.id },
      patch: {
        schemaVersion: 1,
        outcome: "change",
        operations: [
          {
            op: "create_concept",
            localRef: "brand",
            label: "Brand",
            definition: "Preferred manufacturer",
            valueFamily: "categorical",
            canonicalUnit: null,
          },
          {
            op: "add_criterion",
            concept: { kind: "created", localRef: "brand" },
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
    });
    const semanticStateBefore = await loadCurrentShoppingState(
      connection.db,
      task.id,
    );
    const originalCriterion = semanticStateBefore.activeCriteria[0]?.criterion;
    if (originalCriterion === undefined) {
      throw new Error("Expected baseline criterion");
    }

    const source = await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: "stale-action-source",
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 1n,
        kind: "message",
        body: "Show me options",
      },
    });
    let racingApplicationId: string | null = null;
    let selectionOrdinal = 0;
    const selectAction = vi.fn(async () => {
      selectionOrdinal += 1;
      if (selectionOrdinal === 1) {
        const raceInput = await recordTaskInput({
          db: connection.db,
          taskId: task.id,
          clientActionId: "stale-action-race-change",
          request: {
            inputSchemaVersion: 1,
            expectedRevision: 1n,
            kind: "message",
            body: "Actually I prefer Adidas",
          },
        });
        const race = await applyStatePatch(connection.db, {
          applicationSchemaVersion: 1,
          applicationKind: "patch",
          taskId: task.id,
          expectedRevision: 1n,
          source: { kind: "user_explicit", inputId: raceInput.input.id },
          patch: {
            schemaVersion: 1,
            outcome: "change",
            operations: [
              {
                op: "replace_target",
                targetCriterionId: originalCriterion.id,
                result: {
                  strength: "preference",
                  targetSemantics: "categorical",
                  semanticValue: {
                    schemaVersion: 1,
                    kind: "categorical",
                    operator: "prefer",
                    values: ["Adidas"],
                  },
                },
              },
            ],
          },
        });
        racingApplicationId = race.application.id;
      } else {
        if (racingApplicationId === null) {
          throw new Error("Expected the first racing application");
        }
        const undoInput = await recordTaskInput({
          db: connection.db,
          taskId: task.id,
          clientActionId: "stale-action-race-undo",
          request: {
            inputSchemaVersion: 1,
            expectedRevision: 2n,
            kind: "message",
            body: "Undo that brand change",
          },
        });
        await undoStateChange(connection.db, {
          applicationSchemaVersion: 1,
          applicationKind: "undo",
          taskId: task.id,
          expectedRevision: 2n,
          source: { kind: "user_explicit", inputId: undoInput.input.id },
          targetApplicationId: racingApplicationId,
        });
      }
      return completed(search);
    });
    const model: ContextAcquisitionModel = {
      interpret: () => completed(noChange),
      selectAction,
    };

    const result = await acquireShoppingContext({
      db: connection.db,
      model,
      taskId: task.id,
      sourceInputId: source.input.id,
    });

    expect(result).toEqual({
      status: "failed",
      stage: "context_action",
      errorCode: "stale_action_exhausted",
    });
    expect(selectAction).toHaveBeenCalledTimes(2);
    const attempts = await connection.db
      .select({
        attemptOrdinal: contextAcquisitionAttempts.attemptOrdinal,
        snapshotRevision: contextAcquisitionAttempts.snapshotRevision,
        status: contextAcquisitionAttempts.status,
        errorCode: contextAcquisitionAttempts.errorCode,
      })
      .from(contextAcquisitionAttempts)
      .where(
        and(
          eq(contextAcquisitionAttempts.taskId, task.id),
          eq(contextAcquisitionAttempts.sourceTaskInputId, source.input.id),
          eq(contextAcquisitionAttempts.stage, "context_action"),
        ),
      )
      .orderBy(asc(contextAcquisitionAttempts.attemptOrdinal));
    expect(attempts).toEqual([
      {
        attemptOrdinal: 1,
        snapshotRevision: 1n,
        status: "stale",
        errorCode: "stale_action_retrying",
      },
      {
        attemptOrdinal: 2,
        snapshotRevision: 2n,
        status: "stale",
        errorCode: "stale_action_exhausted",
      },
    ]);
    expect(
      await connection.db
        .select()
        .from(contextActions)
        .where(eq(contextActions.taskId, task.id)),
    ).toEqual([]);
    const semanticStateAfter = await loadCurrentShoppingState(
      connection.db,
      task.id,
    );
    expect(semanticStateAfter.concepts).toEqual(semanticStateBefore.concepts);
    expect(semanticStateAfter.activeCriteria).toHaveLength(1);
    expect(semanticStateAfter.activeCriteria[0]?.criterion).toMatchObject({
      conceptId: originalCriterion.conceptId,
      strength: originalCriterion.strength,
      targetSemantics: originalCriterion.targetSemantics,
      semanticValue: originalCriterion.semanticValue,
    });
  });

  it("supports message to ASK to V2 answer to SEARCH and an explicit relaxation", async () => {
    const task = await createShoppingTask(connection.db);
    const initial = await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: "shelving-initial",
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 0n,
        kind: "message",
        body: "I need visually light shelving for this alcove",
      },
    });
    const askModel: ContextAcquisitionModel = {
      interpret: () => completed(noChange),
      selectAction: () =>
        completed({
          providerSchemaVersion: 1,
          action: "ask" as const,
          question: {
            prompt: "What is the maximum height it can be?",
            responseMode: "open_text" as const,
            options: [],
            expectedImpact: "eligibility" as const,
            whyNow: "Height determines whether a shelf can fit the alcove.",
            canSearchWithoutAnswer: true,
          },
          rationale: null,
        }),
    };
    const asked = await acquireShoppingContext({
      db: connection.db,
      model: askModel,
      taskId: task.id,
      sourceInputId: initial.input.id,
    });
    expect(asked.status).toBe("completed");
    if (asked.status !== "completed" || asked.action.action !== "ask") {
      throw new Error("Expected ASK");
    }

    const answer = await recordContextActionAnswer({
      db: connection.db,
      taskId: task.id,
      clientActionId: "height-answer",
      request: {
        inputSchemaVersion: 2,
        expectedRevision: 0n,
        kind: "question_answer",
        questionId: asked.action.id,
        answer: { mode: "open_text", text: "60 cm high at most" },
      },
    });
    const answerModel: ContextAcquisitionModel = {
      interpret: () =>
        completed({
          providerSchemaVersion: 1,
          outcome: "change" as const,
          operations: [
            {
              op: "create_concept" as const,
              localRef: "maximum_height",
              label: "Maximum height",
              definition:
                "Maximum overall shelving height that fits the alcove",
              valueFamily: "measurement" as const,
              canonicalUnit: "cm" as const,
            },
            {
              op: "add_criterion" as const,
              concept: { kind: "created" as const, localRef: "maximum_height" },
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
      selectAction: () => completed(search),
    };
    const answered = await acquireShoppingContext({
      db: connection.db,
      model: answerModel,
      taskId: task.id,
      sourceInputId: answer.input.id,
    });
    expect(answered.status).toBe("completed");
    if (answered.status !== "completed") throw new Error("Expected completion");
    expect(answered.action.action).toBe("search");

    const stateAfterAnswer = await loadCurrentShoppingState(
      connection.db,
      task.id,
    );
    const heightCriterion = stateAfterAnswer.activeCriteria[0]?.criterion;
    if (heightCriterion === undefined)
      throw new Error("Expected height criterion");
    const change = await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: "relax-height",
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 1n,
        kind: "message",
        body: "Actually 70 cm high is fine",
      },
    });
    const changeModel: ContextAcquisitionModel = {
      interpret: () =>
        completed({
          providerSchemaVersion: 1,
          outcome: "change" as const,
          operations: [
            {
              op: "relax" as const,
              targetCriterionId: heightCriterion.id,
              result: {
                strength: "hard" as const,
                targetSemantics: "range" as const,
                semanticValue: {
                  schemaVersion: 1 as const,
                  kind: "measurement_range" as const,
                  lower: null,
                  upper: { amount: "70", inclusive: true },
                  unit: "cm" as const,
                },
              },
            },
          ],
          ambiguities: [],
        }),
      selectAction: () => completed(search),
    };
    const changed = await acquireShoppingContext({
      db: connection.db,
      model: changeModel,
      taskId: task.id,
      sourceInputId: change.input.id,
    });
    expect(changed.status).toBe("completed");
    const finalState = await loadCurrentShoppingState(connection.db, task.id);
    expect(finalState.task.currentRevision).toBe(2n);
    expect(finalState.activeCriteria[0]?.criterion.semanticValue).toMatchObject(
      {
        kind: "measurement_range",
        upper: { amount: "70", inclusive: true },
        unit: "cm",
      },
    );
  });

  it("keeps a conditional preference soft through an unrelated refinement", async () => {
    const task = await createShoppingTask(connection.db);
    const initial = await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: "conditional-wireless-initial",
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 0n,
        kind: "message",
        body: "I'd prefer wireless, but only if the battery life is very good.",
      },
    });
    const initialWire: InterpretationProviderWireV1 = {
      providerSchemaVersion: 1,
      outcome: "change",
      operations: [
        {
          op: "create_concept",
          localRef: "connectivity",
          label: "Connectivity",
          definition:
            "Whether the product supports the preferred connection mode",
          valueFamily: "categorical",
          canonicalUnit: null,
        },
        {
          op: "create_concept",
          localRef: "battery_life",
          label: "Battery life",
          definition: "How long the product lasts between charges",
          valueFamily: "qualitative",
          canonicalUnit: null,
        },
        {
          op: "create_concept",
          localRef: "reviews",
          label: "Reviews",
          definition: "The importance of review quality",
          valueFamily: "qualitative",
          canonicalUnit: null,
        },
        {
          op: "add_criterion",
          concept: { kind: "created", localRef: "connectivity" },
          target: {
            strength: "preference",
            targetSemantics: "categorical",
            semanticValue: {
              schemaVersion: 1,
              kind: "categorical",
              operator: "prefer",
              values: ["wireless"],
            },
          },
        },
        {
          op: "add_criterion",
          concept: { kind: "created", localRef: "battery_life" },
          target: {
            strength: "preference",
            targetSemantics: "qualitative",
            semanticValue: {
              schemaVersion: 1,
              kind: "qualitative_text",
              text: "very good battery life",
            },
          },
        },
        {
          op: "add_criterion",
          concept: { kind: "created", localRef: "reviews" },
          target: {
            strength: "strong_preference",
            targetSemantics: "qualitative",
            semanticValue: {
              schemaVersion: 1,
              kind: "qualitative_text",
              text: "reviews matter a lot",
            },
          },
        },
      ],
      ambiguities: [],
    };
    const model: ContextAcquisitionModel = {
      interpret: vi.fn(() => completed(initialWire)),
      selectAction: vi.fn(() => completed(search)),
    };
    const first = await acquireShoppingContext({
      db: connection.db,
      model,
      taskId: task.id,
      sourceInputId: initial.input.id,
    });
    expect(first.status).toBe("completed");

    const stateAfterInitial = await loadCurrentShoppingState(
      connection.db,
      task.id,
    );
    const conceptLabel = (conceptId: string) =>
      stateAfterInitial.concepts.find((concept) => concept.id === conceptId)
        ?.label;
    const battery = stateAfterInitial.activeCriteria.find(
      ({ criterion }) => conceptLabel(criterion.conceptId) === "Battery life",
    )?.criterion;
    const wireless = stateAfterInitial.activeCriteria.find(
      ({ criterion }) => conceptLabel(criterion.conceptId) === "Connectivity",
    )?.criterion;
    const reviews = stateAfterInitial.activeCriteria.find(
      ({ criterion }) => conceptLabel(criterion.conceptId) === "Reviews",
    )?.criterion;
    if (
      battery === undefined ||
      wireless === undefined ||
      reviews === undefined
    ) {
      throw new Error("Expected conditional criteria");
    }

    const refinement = await recordTaskInput({
      db: connection.db,
      taskId: task.id,
      clientActionId: "conditional-wireless-refinement",
      request: {
        inputSchemaVersion: 1,
        expectedRevision: 1n,
        kind: "message",
        body: "Reviews matter less now. Comfort for long workdays matters most.",
      },
    });
    const refinementWire: InterpretationProviderWireV1 = {
      providerSchemaVersion: 1,
      outcome: "change",
      operations: [
        {
          op: "replace_target",
          targetCriterionId: reviews.id,
          result: {
            strength: "preference",
            targetSemantics: "qualitative",
            semanticValue: {
              schemaVersion: 1,
              kind: "qualitative_text",
              text: "reviews matter less now",
            },
          },
        },
        {
          op: "create_concept",
          localRef: "comfort",
          label: "Comfort",
          definition: "Comfort for long workdays",
          valueFamily: "qualitative",
          canonicalUnit: null,
        },
        {
          op: "add_criterion",
          concept: { kind: "created", localRef: "comfort" },
          target: {
            strength: "strong_preference",
            targetSemantics: "qualitative",
            semanticValue: {
              schemaVersion: 1,
              kind: "qualitative_text",
              text: "comfort for long workdays matters most",
            },
          },
        },
      ],
      ambiguities: [],
    };
    const refinementModel: ContextAcquisitionModel = {
      interpret: vi.fn(() => completed(refinementWire)),
      selectAction: vi.fn(() => completed(search)),
    };
    const changed = await acquireShoppingContext({
      db: connection.db,
      model: refinementModel,
      taskId: task.id,
      sourceInputId: refinement.input.id,
    });
    expect(changed.status).toBe("completed");

    const finalState = await loadCurrentShoppingState(connection.db, task.id);
    const finalBattery = finalState.activeCriteria.find(
      ({ criterion }) => criterion.id === battery.id,
    )?.criterion;
    const finalWireless = finalState.activeCriteria.find(
      ({ criterion }) => criterion.id === wireless.id,
    )?.criterion;
    const finalReviews = finalState.activeCriteria.find(
      ({ criterion }) =>
        finalState.concepts.find(
          (concept) => concept.id === criterion.conceptId,
        )?.label === "Reviews",
    )?.criterion;
    expect(finalBattery).toMatchObject({
      strength: "preference",
      targetSemantics: "qualitative",
      semanticValue: {
        kind: "qualitative",
        mode: "text",
        text: "very good battery life",
      },
    });
    expect(finalWireless).toMatchObject({
      strength: "preference",
      semanticValue: { kind: "categorical", values: ["wireless"] },
    });
    expect(finalReviews).toMatchObject({
      strength: "preference",
      semanticValue: { mode: "text", text: "reviews matter less now" },
    });
    expect(
      finalState.activeCriteria.some(
        ({ criterion }) =>
          finalState.concepts.find(
            (concept) => concept.id === criterion.conceptId,
          )?.label === "Comfort" && criterion.strength === "strong_preference",
      ),
    ).toBe(true);
  });
});
