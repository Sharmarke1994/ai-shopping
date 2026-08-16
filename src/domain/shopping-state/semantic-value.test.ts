import { describe, expect, it } from "vitest";
import {
  categoricalValueSchema,
  measurementRangeValueSchema,
  moneyStretchValueSchema,
  normalizeMeasurementAmount,
  qualitativeValueSchema,
  semanticValueSchema,
  unitsShareDimension,
} from "./semantic-value";

describe("semantic value V1", () => {
  it.each([
    { schemaVersion: 1, kind: "boolean", value: true },
    {
      schemaVersion: 1,
      kind: "qualitative",
      mode: "text",
      text: "low physical bulk",
    },
    {
      schemaVersion: 1,
      kind: "qualitative",
      mode: "ordinal",
      relation: "less",
      anchor: "candidate three",
    },
    { schemaVersion: 1, kind: "measurement", amount: "60", unit: "cm" },
    {
      schemaVersion: 1,
      kind: "measurement_range",
      upper: { amount: "30", inclusive: true },
      unit: "cm",
    },
    {
      schemaVersion: 1,
      kind: "money",
      mode: "target",
      amountMinor: 3000,
      currency: "GBP",
    },
    {
      schemaVersion: 1,
      kind: "money_stretch",
      targetMinor: 3000,
      stretchCeilingMinor: 4000,
      currency: "GBP",
      condition: "if materially better",
    },
    {
      schemaVersion: 1,
      kind: "categorical",
      operator: "exclude",
      values: ["white"],
    },
    { schemaVersion: 1, kind: "indifferent" },
  ])("accepts the typed $kind variant", (value) => {
    expect(semanticValueSchema.parse(value)).toEqual(value);
  });

  it("rejects unknown keys instead of becoming JSON soup", () => {
    expect(() =>
      semanticValueSchema.parse({
        schemaVersion: 1,
        kind: "boolean",
        value: true,
        confidence: 0.9,
      }),
    ).toThrow();
  });

  it("keeps qualitative text and ordinal relations structurally distinct", () => {
    expect(() =>
      qualitativeValueSchema.parse({
        schemaVersion: 1,
        kind: "qualitative",
        mode: "text",
        relation: "less",
        anchor: "candidate three",
      }),
    ).toThrow();
  });

  it("requires ordered measurement bounds", () => {
    expect(() =>
      measurementRangeValueSchema.parse({
        schemaVersion: 1,
        kind: "measurement_range",
        lower: { amount: "60.1", inclusive: true },
        upper: { amount: "60.01", inclusive: true },
        unit: "cm",
      }),
    ).toThrow();
  });

  it("requires stretch money to exceed its target", () => {
    expect(() =>
      moneyStretchValueSchema.parse({
        schemaVersion: 1,
        kind: "money_stretch",
        targetMinor: 4000,
        stretchCeilingMinor: 3000,
        currency: "GBP",
        condition: "if materially better",
      }),
    ).toThrow();
  });

  it("rejects case-insensitive duplicate categorical values", () => {
    expect(() =>
      categoricalValueSchema.parse({
        schemaVersion: 1,
        kind: "categorical",
        operator: "prefer",
        values: ["Nike", "nike"],
      }),
    ).toThrow();
  });

  it("recognises unit dimensions without inventing product categories", () => {
    expect(unitsShareDimension("cm", "m")).toBe(true);
    expect(unitsShareDimension("cm", "kg")).toBe(false);
  });

  it("normalises decimal measurements without floating-point loss", () => {
    expect(normalizeMeasurementAmount("0.6", "m", "cm")).toBe("60");
    expect(normalizeMeasurementAmount("60.10", "cm", "m")).toBe("0.601");
    expect(normalizeMeasurementAmount("0.001", "kg", "g")).toBe("1");
    expect(() => normalizeMeasurementAmount("1", "kg", "cm")).toThrow();
  });
});
