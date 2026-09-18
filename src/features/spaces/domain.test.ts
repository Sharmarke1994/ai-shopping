import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createSpaceSchema,
  emptyRoomState,
  measurementSchema,
  roomFactSchema,
  roomStateSchema,
  spaceOperationSchema,
} from "./contracts";
import { applySpaceOperation, assertRevision } from "./domain";
import {
  appendVisualProposals,
  spaceUnderstandingOutputSchema,
} from "./understanding";

const assetId = randomUUID();
const proposal = {
  facts: [
    {
      kind: "existing_item",
      label: "Bed",
      value: "King bed",
      sourceAssetIds: [assetId],
    },
  ],
  unknowns: [],
};
describe("persistent room authority", () => {
  it.each([
    "bedroom",
    "living_room",
    "office",
    "kitchen",
    "dining_room",
    "other",
    null,
  ])("creates optional type %s without measurements", (roomType) => {
    expect(createSpaceSchema.parse({ name: " Bedroom ", roomType }).name).toBe(
      "Bedroom",
    );
    expect(emptyRoomState().measurements).toEqual([]);
  });
  it("rejects invalid types and unbounded metadata", () => {
    expect(() =>
      createSpaceSchema.parse({ name: "B", roomType: "castle" }),
    ).toThrow();
    expect(() => createSpaceSchema.parse({ name: "x".repeat(101) })).toThrow();
  });
  it("confirms and corrects without mutating old proposals", () => {
    const old = appendVisualProposals(emptyRoomState(), proposal, [assetId]);
    const next = applySpaceOperation(old, {
      operation: "correct_fact",
      expectedRevision: 0,
      factId: old.facts[0]!.id,
      value: "Double bed",
    });
    expect(old.facts[0]).toMatchObject({
      value: "King bed",
      basis: "visual_observation",
      status: "proposed",
    });
    expect(next.facts[0]).toMatchObject({
      value: "Double bed",
      basis: "user_confirmed",
      status: "confirmed",
      sourceAssetIds: [assetId],
    });
    expect(next.items[0]).toMatchObject({
      label: "Double bed",
      intent: "undecided",
    });
    expect(appendVisualProposals(next, proposal, [assetId]).facts).toEqual(
      next.facts,
    );
  });
  it("rejects a proposal, never silently revives it", () => {
    const old = appendVisualProposals(emptyRoomState(), proposal, [assetId]);
    const next = applySpaceOperation(old, {
      operation: "reject_fact",
      expectedRevision: 0,
      factId: old.facts[0]!.id,
    });
    expect(next.facts[0]?.status).toBe("rejected");
    expect(appendVisualProposals(next, proposal, [assetId]).facts).toEqual(
      next.facts,
    );
  });
  it.each([
    [214, "cm", 2140],
    [2.14, "m", 2140],
    [2140, "mm", 2140],
  ] as const)("canonicalises %s %s", (amount, unit, millimetres) => {
    const state = applySpaceOperation(emptyRoomState(), {
      operation: "add_measurement",
      expectedRevision: 0,
      measurement: { label: "Desk wall width", amount, unit },
    });
    expect(state.measurements[0]).toMatchObject({
      millimetres,
      basis: "user_measured",
      amount,
      unit,
    });
    expect(
      appendVisualProposals(
        state,
        {
          facts: [
            {
              kind: "layout_observation",
              label: "Desk wall",
              value: "Desk wall appears wide",
              sourceAssetIds: [assetId],
            },
          ],
          unknowns: [],
        },
        [assetId],
      ).measurements,
    ).toEqual(state.measurements);
  });
  it("fails closed on inferred dimensions and forged authority", () => {
    expect(() =>
      spaceUnderstandingOutputSchema.parse({
        ...proposal,
        measurements: [{ label: "Width", amount: 214, unit: "cm" }],
      }),
    ).toThrow();
    expect(() =>
      spaceUnderstandingOutputSchema.parse({
        facts: [{ ...proposal.facts[0], width: 214, basis: "user_measured" }],
        unknowns: [],
      }),
    ).toThrow();
    expect(() =>
      roomFactSchema.parse({
        ...proposal.facts[0],
        id: randomUUID(),
        basis: "visual_observation",
        status: "confirmed",
      }),
    ).toThrow();
    expect(() =>
      measurementSchema.parse({
        id: randomUUID(),
        label: "Width",
        amount: 214,
        unit: "cm",
        millimetres: 214,
        basis: "user_measured",
      }),
    ).toThrow();
    expect(() =>
      spaceOperationSchema.parse({
        operation: "add_measurement",
        expectedRevision: 0,
        measurement: {
          label: "Width",
          amount: 214,
          unit: "cm",
          basis: "visual_observation",
        },
      }),
    ).toThrow();
  });
  it("accepts explicit facts and independent inventory intents", () => {
    const one = applySpaceOperation(emptyRoomState(), {
      operation: "add_fact",
      expectedRevision: 0,
      kind: "existing_item",
      label: "Bed",
      value: "Double bed",
    });
    const next = applySpaceOperation(one, {
      operation: "set_item_intent",
      expectedRevision: 1,
      itemId: one.items[0]!.id,
      intent: "keep",
    });
    expect(next.items[0]?.intent).toBe("keep");
    expect(next.facts[0]?.basis).toBe("user_explicit");
  });
  it("persists design without requiring styles, budget or dimensions", () => {
    const design = {
      ...emptyRoomState().design,
      goal: "Warmer and more put together",
      add: ["Rug"],
    };
    expect(
      applySpaceOperation(emptyRoomState(), {
        operation: "set_design",
        expectedRevision: 0,
        design,
      }).design,
    ).toEqual(design);
  });
  it("requires valid source photos and rejects stale edits", () => {
    expect(() =>
      appendVisualProposals(emptyRoomState(), proposal, []),
    ).toThrow();
    expect(() => assertRevision(2, 1)).toThrow(/another tab/);
    expect(() => assertRevision(2, 2)).not.toThrow();
    const state = emptyRoomState();
    state.items.push({
      id: randomUUID(),
      factId: randomUUID(),
      label: "bed",
      intent: "keep",
    });
    expect(() => roomStateSchema.parse(state)).toThrow();
  });
  it("keeps long item descriptions while using their short label in inventory", () => {
    const value = "A".repeat(600);
    const manual = applySpaceOperation(emptyRoomState(), {
      operation: "add_fact",
      expectedRevision: 0,
      kind: "existing_item",
      label: "Bed",
      value,
    });
    expect(manual.facts[0]?.value).toBe(value);
    expect(manual.items[0]?.label).toBe("Bed");
    const proposed = appendVisualProposals(
      emptyRoomState(),
      { ...proposal, facts: [{ ...proposal.facts[0], value }] },
      [assetId],
    );
    const confirmed = applySpaceOperation(proposed, {
      operation: "confirm_fact",
      expectedRevision: 0,
      factId: proposed.facts[0]!.id,
    });
    expect(confirmed.items[0]?.label).toBe("Bed");
    expect(confirmed.facts[0]?.value).toBe(value);
  });
  it("preserves fractional user measurements rather than rounding away fit information", () => {
    const next = applySpaceOperation(emptyRoomState(), {
      operation: "add_measurement",
      expectedRevision: 0,
      measurement: { label: "Measured clearance", amount: 0.5, unit: "mm" },
    });
    expect(next.measurements[0]).toMatchObject({
      amount: 0.5,
      millimetres: 0.5,
      basis: "user_measured",
    });
  });
});
