import { describe, expect, it } from "vitest";
import {
  assignInventoryOrdinals,
  interpretationInventoryProviderWireV1Schema,
  inventoryAwareInterpretationProviderWireV2Schema,
  validateInventoryCoverage,
} from "./interpretation-inventory";

const base = {
  providerSchemaVersion: 2 as const,
  interpretation: { outcome: "no_change" as const, operations: [] as const },
  ambiguities: [] as const,
};

describe("proposal-blind interpretation inventory", () => {
  it("assigns server-local ordinals after strict provider parsing", () => {
    const parsed = interpretationInventoryProviderWireV1Schema.parse({
      providerSchemaVersion: 1,
      meanings: [
        { summary: "wireless parent", role: "criterion" },
        { summary: "battery condition", role: "condition" },
      ],
    });
    expect(assignInventoryOrdinals(parsed).meanings).toEqual([
      { summary: "wireless parent", role: "criterion", ordinal: 0 },
      { summary: "battery condition", role: "condition", ordinal: 1 },
    ]);
  });

  it("requires exact inventory coverage and strips only the mapping metadata", () => {
    const wire = inventoryAwareInterpretationProviderWireV2Schema.parse({
      ...base,
      meaningCoverage: [
        {
          meaningOrdinal: 0,
          disposition: "combined",
          operationIndexes: [],
        },
      ],
    });
    expect(
      validateInventoryCoverage({
        wire,
        inventory: assignInventoryOrdinals({
          providerSchemaVersion: 1,
          meanings: [{ summary: "wireless", role: "criterion" }],
        }),
      }),
    ).toEqual(base);
  });

  it("rejects missing, duplicate, and foreign operation coverage", () => {
    const wire = inventoryAwareInterpretationProviderWireV2Schema.parse({
      ...base,
      meaningCoverage: [
        { meaningOrdinal: 0, disposition: "operation", operationIndexes: [1] },
        { meaningOrdinal: 0, disposition: "operation", operationIndexes: [] },
      ],
    });
    expect(() =>
      validateInventoryCoverage({
        wire,
        inventory: assignInventoryOrdinals({
          providerSchemaVersion: 1,
          meanings: [{ summary: "wireless", role: "criterion" }],
        }),
      }),
    ).toThrow("inventory_coverage_invalid");
  });
});
