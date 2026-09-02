import { z } from "zod";
import type { ProviderInputEnvelopeV1 } from "./provider-input";
import {
  interpretationProviderWireV2Schema,
  type InterpretationProviderWireV2,
} from "./provider-wire";

export const INTERPRETATION_INVENTORY_SCHEMA_VERSION = 1 as const;
export const INTERPRETATION_INVENTORY_MAX_MEANINGS = 16;

const inventoryMeaningSchema = z.strictObject({
  summary: z.string().min(1).max(240),
  role: z.enum([
    "criterion",
    "subject_context",
    "change_of_mind",
    "indifference",
    "condition",
  ]),
});

export const interpretationInventoryProviderWireV1Schema = z.strictObject({
  providerSchemaVersion: z.literal(INTERPRETATION_INVENTORY_SCHEMA_VERSION),
  meanings: z
    .array(inventoryMeaningSchema)
    .max(INTERPRETATION_INVENTORY_MAX_MEANINGS),
});

export type InterpretationInventoryProviderWireV1 = z.infer<
  typeof interpretationInventoryProviderWireV1Schema
>;

export type InterpretationInventoryV1 = Readonly<{
  providerSchemaVersion: 1;
  meanings: readonly (InterpretationInventoryProviderWireV1["meanings"][number] & {
    ordinal: number;
  })[];
}>;

export const inventoryAwareInterpretationProviderWireV2Schema =
  interpretationProviderWireV2Schema.extend({
    meaningCoverage: z
      .array(
        z.strictObject({
          meaningOrdinal: z.number().int().nonnegative().safe(),
          disposition: z.enum([
            "operation",
            "subject_context",
            "ambiguity",
            "combined",
          ]),
          operationIndexes: z
            .array(z.number().int().nonnegative().safe())
            .max(8),
        }),
      )
      .max(INTERPRETATION_INVENTORY_MAX_MEANINGS),
  });

export type InventoryAwareInterpretationProviderWireV2 = z.infer<
  typeof inventoryAwareInterpretationProviderWireV2Schema
>;

export function assignInventoryOrdinals(
  inventory: InterpretationInventoryProviderWireV1,
): InterpretationInventoryV1 {
  return {
    providerSchemaVersion: 1,
    meanings: inventory.meanings.map((meaning, ordinal) => ({
      ...meaning,
      ordinal,
    })),
  };
}

export function buildInventoryAwareInterpretationInputV1(options: {
  input: ProviderInputEnvelopeV1;
  inventory: InterpretationInventoryV1;
}): ProviderInputEnvelopeV1 {
  return {
    ...options.input,
    payload: {
      ...options.input.payload,
      semanticInventory: options.inventory,
    },
  };
}

export function validateInventoryCoverage(options: {
  wire: InventoryAwareInterpretationProviderWireV2;
  inventory: InterpretationInventoryV1;
}): InterpretationProviderWireV2 {
  const expected = options.inventory.meanings.map((meaning) => meaning.ordinal);
  const entries = options.wire.meaningCoverage;
  if (
    entries.length !== expected.length ||
    entries.some(
      (entry) =>
        entry.meaningOrdinal < 0 ||
        entry.meaningOrdinal >= expected.length ||
        entry.operationIndexes.some(
          (index) => index >= options.wire.interpretation.operations.length,
        ),
    ) ||
    new Set(entries.map((entry) => entry.meaningOrdinal)).size !==
      entries.length
  ) {
    throw new Error("inventory_coverage_invalid");
  }
  for (const ordinal of expected) {
    if (!entries.some((entry) => entry.meaningOrdinal === ordinal))
      throw new Error("inventory_coverage_incomplete");
  }
  const proposal = { ...options.wire } as {
    meaningCoverage?: unknown;
  };
  delete proposal.meaningCoverage;
  return proposal as InterpretationProviderWireV2;
}
