import { z } from "zod";

export const spaceIdSchema = z.uuid();
export const roomTypeSchema = z.enum([
  "bedroom",
  "living_room",
  "office",
  "kitchen",
  "dining_room",
  "workspace",
  "warehouse",
  "hallway",
  "studio",
  "workshop",
  "outdoor",
  "other",
]);
const label = z.string().trim().min(1).max(120);
const text = z.string().trim().min(1).max(600);
export const factKindSchema = z.enum([
  "architectural_feature",
  "existing_item",
  "material",
  "colour",
  "style",
  "layout_observation",
  "functional_observation",
]);
const factFields = {
  id: spaceIdSchema,
  kind: factKindSchema,
  label,
  value: text,
  origin: z.enum(["user", "photo_analysis", "fictional_fixture"]),
  sourceAssetIds: z.array(spaceIdSchema).max(10),
};
export const roomFactSchema = z.discriminatedUnion("basis", [
  z
    .object({
      ...factFields,
      basis: z.literal("visual_observation"),
      origin: z.enum(["photo_analysis", "fictional_fixture"]),
      status: z.enum(["proposed", "rejected"]),
      sourceAssetIds: z.array(spaceIdSchema).min(1).max(10),
    })
    .strict(),
  z
    .object({
      ...factFields,
      basis: z.literal("user_confirmed"),
      status: z.literal("confirmed"),
    })
    .strict(),
  z
    .object({
      ...factFields,
      basis: z.literal("user_explicit"),
      origin: z.literal("user"),
      status: z.literal("confirmed"),
      sourceAssetIds: z.array(spaceIdSchema).length(0),
    })
    .strict(),
]);
export const measurementInputSchema = z
  .object({
    label,
    amount: z.number().finite().positive().max(100000),
    unit: z.enum(["mm", "cm", "m"]),
  })
  .strict();
export const measurementSchema = measurementInputSchema
  .extend({
    id: spaceIdSchema,
    millimetres: z.number().finite().positive().max(10000000),
    basis: z.literal("user_measured"),
  })
  .strict()
  .refine(
    (m) => m.millimetres === m.amount * { mm: 1, cm: 10, m: 1000 }[m.unit],
    "Canonical measurement mismatch",
  );
export const itemSchema = z
  .object({
    id: spaceIdSchema,
    factId: spaceIdSchema.nullable(),
    label,
    intent: z.enum(["keep", "replace", "undecided"]),
  })
  .strict();
export const roomDesignSchema = z
  .object({
    goal: z.string().trim().max(1600),
    styles: z.array(label).max(12),
    palette: z.array(label).max(12),
    add: z.array(label).max(20),
    notes: z.string().trim().max(1600),
    budget: z
      .object({
        amountMinor: z.number().int().nonnegative().max(100000000),
        currency: z.literal("GBP"),
      })
      .strict()
      .nullable(),
  })
  .strict();
export const roomStateSchema = z
  .object({
    version: z.literal(1),
    facts: z.array(roomFactSchema).max(80),
    measurements: z.array(measurementSchema).max(40),
    items: z.array(itemSchema).max(40),
    design: roomDesignSchema,
    unknowns: z
      .array(
        z
          .object({
            id: spaceIdSchema,
            origin: z.enum(["user", "photo_analysis", "fictional_fixture"]),
            label,
            basis: z.enum(["user_explicit", "visual_observation"]),
            sourceAssetIds: z.array(spaceIdSchema).max(10),
          })
          .strict(),
      )
      .max(20),
  })
  .strict()
  .superRefine((state, ctx) => {
    for (const records of [
      state.facts,
      state.measurements,
      state.items,
      state.unknowns,
    ]) {
      if (new Set(records.map((x) => x.id)).size !== records.length)
        ctx.addIssue({ code: "custom", message: "Duplicate room identity" });
    }
    for (const item of state.items)
      if (
        item.factId &&
        !state.facts.some(
          (f) =>
            f.id === item.factId &&
            f.kind === "existing_item" &&
            f.status === "confirmed",
        )
      )
        ctx.addIssue({
          code: "custom",
          message: "Inventory must reference confirmed item facts",
        });
    for (const gap of state.unknowns)
      if (gap.basis === "visual_observation" && !gap.sourceAssetIds.length)
        ctx.addIssue({
          code: "custom",
          message: "Visual gaps require image provenance",
        });
  });
export type RoomState = z.infer<typeof roomStateSchema>;
export const createSpaceSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    roomType: roomTypeSchema.nullable().default(null),
  })
  .strict();
const mutation = {
  expectedRevision: z.number().int().nonnegative().max(2147483646),
};
export const spaceOperationSchema = z.discriminatedUnion("operation", [
  z
    .object({
      ...mutation,
      operation: z.literal("set_design"),
      design: roomDesignSchema,
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal("add_fact"),
      kind: factKindSchema,
      label,
      value: text,
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal("confirm_fact"),
      factId: spaceIdSchema,
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal("correct_fact"),
      factId: spaceIdSchema,
      value: text,
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal("reject_fact"),
      factId: spaceIdSchema,
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal("add_measurement"),
      measurement: measurementInputSchema,
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal("remove_measurement"),
      measurementId: spaceIdSchema,
    })
    .strict(),
  z.object({ ...mutation, operation: z.literal("add_item"), label }).strict(),
  z
    .object({
      ...mutation,
      operation: z.literal("set_item_intent"),
      itemId: spaceIdSchema,
      intent: itemSchema.shape.intent,
    })
    .strict(),
  z
    .object({ ...mutation, operation: z.literal("add_unknown"), label })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal("remove_unknown"),
      unknownId: spaceIdSchema,
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal("analyse_photos"),
      assetIds: z.array(spaceIdSchema).min(1).max(10),
    })
    .strict(),
]);
export type SpaceOperation = z.infer<typeof spaceOperationSchema>;
export const assetViewSchema = z
  .object({
    id: spaceIdSchema,
    contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    byteSize: z.number().int().positive(),
    filename: z.string().max(100),
    url: z.string().startsWith("/api/spaces/"),
  })
  .strict();
export const spaceViewSchema = z
  .object({
    id: spaceIdSchema,
    name: createSpaceSchema.shape.name,
    roomType: roomTypeSchema.nullable(),
    currentRevision: z.number().int().nonnegative(),
    updatedAt: z.iso.datetime(),
    state: roomStateSchema,
    assets: z.array(assetViewSchema).max(10),
    analysisMode: z.enum(["unavailable", "fictional_fixture"]),
  })
  .strict();
export type SpaceView = z.infer<typeof spaceViewSchema>;
export function emptyRoomState(): RoomState {
  return {
    version: 1,
    facts: [],
    measurements: [],
    items: [],
    unknowns: [],
    design: {
      goal: "",
      styles: [],
      palette: [],
      add: [],
      notes: "",
      budget: null,
    },
  };
}
