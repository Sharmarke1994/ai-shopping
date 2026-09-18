import { z } from "zod";
import { roomStateSchema, spaceIdSchema } from "./contracts";

const externalUrl = z
  .string()
  .max(4000)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  });
export const visualProductSchema = z.strictObject({
  taskId: spaceIdSchema,
  listingId: spaceIdSchema,
  title: z.string().min(1).max(1000),
  merchant: z.string().max(1000).nullable(),
  url: externalUrl,
  destinationKind: z.enum(["merchant", "shopping_result"]),
  imageUrl: externalUrl.nullable(),
  priceAmountMinor: z.number().int().nonnegative().nullable(),
  priceCurrencyCode: z.string().length(3).nullable(),
  observedAt: z.iso.datetime(),
});
export const visualRequestSchema = z
  .strictObject({
    actionId: spaceIdSchema,
    expectedRevision: z.number().int().nonnegative().max(2147483646),
    name: z.string().trim().min(1).max(100),
    direction: z.string().trim().min(1).max(1600),
    assetIds: z.array(spaceIdSchema).min(1).max(5),
    products: z
      .array(
        z.strictObject({
          listingId: spaceIdSchema,
          placement: z.string().trim().min(1).max(300),
        }),
      )
      .max(4),
  })
  .superRefine((value, ctx) => {
    if (
      new Set(value.assetIds).size !== value.assetIds.length ||
      new Set(value.products.map((p) => p.listingId)).size !==
        value.products.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Select each photo and product once.",
      });
  });
export const visualBasisSchema = z.strictObject({
  version: z.literal(1),
  name: z.string().min(1).max(100),
  direction: z.string().min(1).max(1600),
  roomName: z.string().min(1).max(100),
  roomState: roomStateSchema,
  assetIds: z.array(spaceIdSchema).min(1).max(5),
  products: z
    .array(
      visualProductSchema.extend({ placement: z.string().min(1).max(300) }),
    )
    .max(4),
});
export type VisualBasis = z.infer<typeof visualBasisSchema>;
export const visualViewSchema = z.strictObject({
  id: spaceIdSchema,
  spaceId: spaceIdSchema,
  roomRevision: z.number().int().nonnegative(),
  basis: visualBasisSchema,
  status: z.enum(["draft", "running", "completed", "failed", "interrupted"]),
  failure: z.string().nullable(),
  createdAt: z.iso.datetime(),
  imageUrl: z.string().startsWith("/api/spaces/").nullable(),
});
export const visualCollectionSchema = z.strictObject({
  designs: z.array(visualViewSchema).max(40),
  products: z.array(visualProductSchema).max(100),
  generationAvailable: z.boolean(),
});
export type VisualView = z.infer<typeof visualViewSchema>;
export type VisualCollection = z.infer<typeof visualCollectionSchema>;
