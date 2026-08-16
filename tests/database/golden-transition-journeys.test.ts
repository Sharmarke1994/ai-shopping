import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { BriefItemV1 } from "../../src/domain/shopping-state/brief";
import { recordTaskInput } from "../../src/features/shopping-state/persistence/inputs-and-messages";
import { loadCurrentShoppingState } from "../../src/features/shopping-state/persistence/state-loaders";
import {
  applyStatePatch,
  type StateApplicationResult,
  undoStateChange,
} from "../../src/features/shopping-state/persistence/state-transitions";
import { createShoppingTask } from "../../src/features/shopping-state/persistence/tasks";
import {
  createTestDatabaseConnection,
  resetShoppingState,
  type TestDatabaseConnection,
} from "./helpers";

type ValueFamily =
  "boolean" | "categorical" | "measurement" | "money" | "qualitative";

type Journey = {
  connection: TestDatabaseConnection;
  taskId: string;
  revision: bigint;
  step: number;
};

function target(
  strength: "hard" | "preference" | "strong_preference",
  targetSemantics:
    "around" | "categorical" | "exact" | "qualitative" | "range" | "stretch",
  semanticValue: unknown,
) {
  return { strength, targetSemantics, semanticValue };
}

function createCriterion(options: {
  localRef: string;
  label: string;
  definition: string;
  valueFamily: ValueFamily;
  canonicalUnit?: "cm";
  target: ReturnType<typeof target>;
}) {
  return [
    {
      op: "create_concept",
      localRef: options.localRef,
      label: options.label,
      definition: options.definition,
      valueFamily: options.valueFamily,
      canonicalUnit: options.canonicalUnit ?? null,
    },
    {
      op: "add_criterion",
      concept: { kind: "created", localRef: options.localRef },
      target: options.target,
    },
  ];
}

function categorical(
  operator: "exclude" | "include" | "prefer",
  values: readonly string[],
) {
  return { schemaVersion: 1, kind: "categorical", operator, values };
}

function qualitative(text: string) {
  return { schemaVersion: 1, kind: "qualitative", mode: "text", text };
}

function measurementMaximum(amount: string) {
  return {
    schemaVersion: 1,
    kind: "measurement_range",
    upper: { amount, inclusive: true },
    unit: "cm",
  };
}

function moneyTarget(amountMinor: number) {
  return {
    schemaVersion: 1,
    kind: "money",
    mode: "target",
    amountMinor,
    currency: "GBP",
  };
}

function moneyCeiling(amountMinor: number) {
  return {
    schemaVersion: 1,
    kind: "money",
    mode: "ceiling",
    amountMinor,
    currency: "GBP",
  };
}

async function createJourney(connection: TestDatabaseConnection) {
  const task = await createShoppingTask(connection.db);
  return {
    connection,
    taskId: task.id,
    revision: 0n,
    step: 0,
  } satisfies Journey;
}

async function apply(
  journey: Journey,
  operations: readonly unknown[],
): Promise<StateApplicationResult> {
  const key = `journey-${journey.taskId}-${journey.step}`;
  journey.step += 1;
  const source = await recordTaskInput({
    db: journey.connection.db,
    taskId: journey.taskId,
    clientActionId: key,
    request: {
      inputSchemaVersion: 1,
      expectedRevision: journey.revision,
      kind: "direct_brief_action",
      controlId: key,
      submittedText: key,
    },
  });
  const result = await applyStatePatch(journey.connection.db, {
    applicationSchemaVersion: 1,
    applicationKind: "patch",
    taskId: journey.taskId,
    expectedRevision: journey.revision,
    source: { kind: "user_explicit", inputId: source.input.id },
    patch: { schemaVersion: 1, outcome: "change", operations },
  });
  journey.revision = result.application.resultingRevision;
  return result;
}

async function undo(
  journey: Journey,
  targetApplicationId: string,
): Promise<StateApplicationResult> {
  const key = `journey-${journey.taskId}-undo-${journey.step}`;
  journey.step += 1;
  const source = await recordTaskInput({
    db: journey.connection.db,
    taskId: journey.taskId,
    clientActionId: key,
    request: {
      inputSchemaVersion: 1,
      expectedRevision: journey.revision,
      kind: "direct_brief_action",
      controlId: key,
      submittedText: key,
    },
  });
  const result = await undoStateChange(journey.connection.db, {
    applicationSchemaVersion: 1,
    applicationKind: "undo",
    taskId: journey.taskId,
    expectedRevision: journey.revision,
    source: { kind: "user_explicit", inputId: source.input.id },
    targetApplicationId,
  });
  journey.revision = result.application.resultingRevision;
  return result;
}

function item(result: StateApplicationResult, label: string): BriefItemV1 {
  const found = result.brief.items.find(
    (entry) => entry.conceptLabel === label,
  );
  if (found === undefined) throw new Error(`Missing brief item ${label}`);
  return found;
}

function itemIds(result: StateApplicationResult, labels: readonly string[]) {
  return new Map(
    labels.map((label) => [label, item(result, label).criterionId]),
  );
}

describe("V0-04 golden shopping transition journeys", () => {
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

  it("preserves explicit cap truth through refinement, indifference, and undo", async () => {
    const journey = await createJourney(connection);
    let result = await apply(journey, [
      ...createCriterion({
        localRef: "cap_weight",
        label: "Weight",
        definition: "How light the cap should feel",
        valueFamily: "qualitative",
        target: target("preference", "qualitative", qualitative("lightweight")),
      }),
      ...createCriterion({
        localRef: "cap_breathability",
        label: "Breathability",
        definition: "Airflow for running in hot weather",
        valueFamily: "qualitative",
        target: target(
          "strong_preference",
          "qualitative",
          qualitative("breathable in hot weather"),
        ),
      }),
    ]);
    expect(result.brief.items.map((entry) => entry.conceptLabel)).toEqual([
      "Weight",
      "Breathability",
    ]);

    result = await apply(journey, [
      ...createCriterion({
        localRef: "cap_structure",
        label: "Construction",
        definition: "How substantial the cap feels",
        valueFamily: "categorical",
        target: target(
          "strong_preference",
          "categorical",
          categorical("exclude", ["thick", "substantial"]),
        ),
      }),
    ]);
    expect(item(result, "Construction").semanticValue).toMatchObject({
      operator: "exclude",
      values: ["thick", "substantial"],
    });

    result = await apply(journey, [
      ...createCriterion({
        localRef: "cap_brand",
        label: "Brand",
        definition: "Preferred cap brand",
        valueFamily: "categorical",
        target: target(
          "preference",
          "categorical",
          categorical("prefer", ["Nike"]),
        ),
      }),
    ]);
    const brand = item(result, "Brand");
    const marked = await apply(journey, [
      {
        op: "mark_indifferent",
        concept: { kind: "existing", conceptId: brand.conceptId },
        replacesCriterionIds: [brand.criterionId],
      },
    ]);
    expect(
      marked.brief.items.some((entry) => entry.conceptLabel === "Brand"),
    ).toBe(false);
    const indifferent = (
      await loadCurrentShoppingState(connection.db, journey.taskId)
    ).activeCriteria.find(
      ({ criterion }) => criterion.conceptId === brand.conceptId,
    )!.criterion;
    expect(indifferent.semanticValue.kind).toBe("indifferent");

    const restored = await undo(journey, marked.application.id);
    expect(item(restored, "Brand").semanticValue).toMatchObject({
      operator: "prefer",
      values: ["Nike"],
    });
    expect(item(restored, "Brand").criterionId).not.toBe(brand.criterionId);
    const concepts = (
      await loadCurrentShoppingState(connection.db, journey.taskId)
    ).concepts.map((concept) => concept.label);
    expect(concepts).not.toContain("Budget");
  });

  it("preserves shelving dimensions and appearance while budget and colour evolve", async () => {
    const journey = await createJourney(connection);
    let result = await apply(journey, [
      ...createCriterion({
        localRef: "shelf_width",
        label: "Maximum width",
        definition: "Maximum shelving width",
        valueFamily: "measurement",
        canonicalUnit: "cm",
        target: target("hard", "range", measurementMaximum("60")),
      }),
      ...createCriterion({
        localRef: "shelf_depth",
        label: "Maximum depth",
        definition: "Maximum shelving depth",
        valueFamily: "measurement",
        canonicalUnit: "cm",
        target: target("hard", "range", measurementMaximum("30")),
      }),
      ...createCriterion({
        localRef: "shelf_colour",
        label: "Colour",
        definition: "Shelving colour direction",
        valueFamily: "categorical",
        target: target(
          "preference",
          "categorical",
          categorical("prefer", ["dark"]),
        ),
      }),
      ...createCriterion({
        localRef: "shelf_visual",
        label: "Visual form",
        definition: "How open and visually light the shelving should feel",
        valueFamily: "qualitative",
        target: target(
          "strong_preference",
          "qualitative",
          qualitative("open and visually light"),
        ),
      }),
      ...createCriterion({
        localRef: "shelf_white",
        label: "White finish",
        definition: "Whether white shelving is acceptable",
        valueFamily: "categorical",
        target: target(
          "hard",
          "categorical",
          categorical("exclude", ["white"]),
        ),
      }),
      ...createCriterion({
        localRef: "shelf_budget",
        label: "Budget",
        definition: "Shelving spend",
        valueFamily: "money",
        target: target("preference", "around", moneyTarget(3000)),
      }),
    ]);
    const unchanged = itemIds(result, [
      "Maximum width",
      "Maximum depth",
      "Colour",
      "Visual form",
    ]);
    const originalNoWhite = item(result, "White finish");
    const originalBudget = item(result, "Budget");

    result = await apply(journey, [
      {
        op: "replace_target",
        targetCriterionId: originalBudget.criterionId,
        result: target("hard", "range", moneyCeiling(3000)),
      },
    ]);
    expect(item(result, "Budget").semanticValue).toMatchObject({
      kind: "money",
      mode: "ceiling",
      amountMinor: 3000,
    });

    result = await apply(journey, [
      {
        op: "replace_target",
        targetCriterionId: item(result, "Budget").criterionId,
        result: target("preference", "stretch", {
          schemaVersion: 1,
          kind: "money_stretch",
          targetMinor: 3000,
          stretchCeilingMinor: 4000,
          currency: "GBP",
          condition: "the option is visually light",
        }),
      },
    ]);
    expect(item(result, "Budget").semanticValue).toMatchObject({
      kind: "money_stretch",
      targetMinor: 3000,
      stretchCeilingMinor: 4000,
      condition: "the option is visually light",
    });
    for (const [label, criterionId] of unchanged) {
      expect(item(result, label).criterionId).toBe(criterionId);
    }

    const removed = await apply(journey, [
      { op: "remove", targetCriterionId: originalNoWhite.criterionId },
    ]);
    expect(
      removed.brief.items.some(
        (entry) => entry.conceptLabel === "White finish",
      ),
    ).toBe(false);
    const restored = await undo(journey, removed.application.id);
    expect(item(restored, "White finish").semanticValue).toMatchObject({
      operator: "exclude",
      values: ["white"],
    });
    expect(item(restored, "White finish").criterionId).not.toBe(
      originalNoWhite.criterionId,
    );
    const concepts = (
      await loadCurrentShoppingState(connection.db, journey.taskId)
    ).concepts;
    expect(concepts.some((concept) => concept.label === "Height")).toBe(false);
    expect(concepts.every((concept) => concept.taskId === journey.taskId)).toBe(
      true,
    );
  });

  it("keeps headphones unknowns absent while preference and brand state change", async () => {
    const journey = await createJourney(connection);
    let result = await apply(journey, [
      ...createCriterion({
        localRef: "headphones_wireless",
        label: "Wireless",
        definition: "Whether the headphones are wireless",
        valueFamily: "boolean",
        target: target("hard", "exact", {
          schemaVersion: 1,
          kind: "boolean",
          value: true,
        }),
      }),
      ...createCriterion({
        localRef: "headphones_form",
        label: "Form factor",
        definition: "Headphone wearing style",
        valueFamily: "categorical",
        target: target(
          "hard",
          "categorical",
          categorical("include", ["over-ear"]),
        ),
      }),
      ...createCriterion({
        localRef: "headphones_budget",
        label: "Budget",
        definition: "Headphone spend",
        valueFamily: "money",
        target: target("preference", "around", moneyTarget(15000)),
      }),
      ...createCriterion({
        localRef: "headphones_comfort",
        label: "Comfort with glasses",
        definition: "Clamp comfort while wearing glasses",
        valueFamily: "qualitative",
        target: target(
          "preference",
          "qualitative",
          qualitative("comfortable with glasses; avoid strong clamp"),
        ),
      }),
      ...createCriterion({
        localRef: "headphones_anc",
        label: "Noise cancellation",
        definition: "Active noise cancellation priority",
        valueFamily: "boolean",
        target: target("strong_preference", "exact", {
          schemaVersion: 1,
          kind: "boolean",
          value: true,
        }),
      }),
      {
        op: "create_concept",
        localRef: "headphones_brand",
        label: "Brand",
        definition: "Headphone brand",
        valueFamily: "categorical",
        canonicalUnit: null,
      },
      {
        op: "mark_indifferent",
        concept: { kind: "created", localRef: "headphones_brand" },
        replacesCriterionIds: [],
      },
    ]);
    const stable = itemIds(result, ["Wireless", "Form factor", "Budget"]);
    const comfort = item(result, "Comfort with glasses");
    const anc = item(result, "Noise cancellation");
    const brandConcept = (
      await loadCurrentShoppingState(connection.db, journey.taskId)
    ).concepts.find((concept) => concept.label === "Brand")!;
    expect(
      result.brief.items.some((entry) => entry.conceptLabel === "Brand"),
    ).toBe(false);

    result = await apply(journey, [
      {
        op: "tighten",
        targetCriterionId: comfort.criterionId,
        result: target(
          "strong_preference",
          "qualitative",
          qualitative("comfortable with glasses; avoid strong clamp"),
        ),
      },
      {
        op: "relax",
        targetCriterionId: anc.criterionId,
        result: target("preference", "exact", {
          schemaVersion: 1,
          kind: "boolean",
          value: true,
        }),
      },
    ]);
    expect(item(result, "Comfort with glasses").strength).toBe(
      "strong_preference",
    );
    expect(item(result, "Noise cancellation").strength).toBe("preference");
    for (const [label, criterionId] of stable) {
      expect(item(result, label).criterionId).toBe(criterionId);
    }

    const stateWithIndifference = await loadCurrentShoppingState(
      connection.db,
      journey.taskId,
    );
    const brandIndifference = stateWithIndifference.activeCriteria.find(
      ({ criterion }) => criterion.conceptId === brandConcept.id,
    )!.criterion;
    expect(brandIndifference.semanticValue.kind).toBe("indifferent");
    const removed = await apply(journey, [
      { op: "remove", targetCriterionId: brandIndifference.id },
    ]);
    expect(
      (
        await loadCurrentShoppingState(connection.db, journey.taskId)
      ).activeCriteria.some(
        ({ criterion }) => criterion.conceptId === brandConcept.id,
      ),
    ).toBe(false);

    await undo(journey, removed.application.id);
    const restoredBrand = (
      await loadCurrentShoppingState(connection.db, journey.taskId)
    ).activeCriteria.find(
      ({ criterion }) => criterion.conceptId === brandConcept.id,
    )!.criterion;
    expect(restoredBrand.semanticValue.kind).toBe("indifferent");
    expect(restoredBrand.id).not.toBe(brandIndifference.id);

    const labels = (
      await loadCurrentShoppingState(connection.db, journey.taskId)
    ).concepts.map((concept) => concept.label);
    for (const unknown of [
      "Colour",
      "Microphone",
      "Codec",
      "Battery",
      "Ecosystem",
    ]) {
      expect(labels).not.toContain(unknown);
    }
  });
});
