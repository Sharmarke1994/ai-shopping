import { and, desc, eq, lt } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  candidateListings,
  savedCandidateListings,
  spaceVisualDesigns,
  spaces,
} from "@/infrastructure/database/schema";
import {
  loadSpace,
  readSpaceAsset,
  type SpaceDependencies,
} from "./application";
import { assertRevision, SpaceError } from "./domain";
import { spaceIdSchema } from "./contracts";
import {
  visualBasisSchema,
  visualCollectionSchema,
  visualProductSchema,
  visualRequestSchema,
  visualViewSchema,
} from "./visual-contracts";
import {
  fetchVisualProductImage,
  type RenderImage,
  type SpaceVisualRenderer,
} from "./visual-renderer";
import { prepareImage } from "./asset-storage";

export type VisualDependencies = SpaceDependencies & {
  renderer?: SpaceVisualRenderer;
  productImage?: (url: string) => Promise<RenderImage>;
};
const INTERRUPTED_AFTER_MS = 4 * 60 * 1000;
function view(row: typeof spaceVisualDesigns.$inferSelect) {
  const interrupted =
    row.status === "running" &&
    row.startedAt &&
    Date.now() - row.startedAt.getTime() > INTERRUPTED_AFTER_MS;
  return visualViewSchema.parse({
    id: row.id,
    spaceId: row.spaceId,
    roomRevision: row.roomRevision,
    basis: visualBasisSchema.parse(row.basis),
    status: interrupted ? "interrupted" : row.status,
    failure: interrupted
      ? "Generation was interrupted. No automatic retry was made."
      : row.failure === "reference_unavailable"
        ? "A selected product image could not be safely loaded. No render was requested."
        : row.failure
          ? "Generation did not complete. Your room and saved design are unchanged. No automatic retry was made."
          : null,
    createdAt: row.createdAt.toISOString(),
    imageUrl:
      row.status === "completed"
        ? `/api/spaces/${row.spaceId}/visuals/${row.id}/image`
        : null,
  });
}
export async function savedVisualProducts(deps: VisualDependencies) {
  const rows = await deps.db
    .select({ listing: candidateListings })
    .from(savedCandidateListings)
    .innerJoin(
      candidateListings,
      and(
        eq(savedCandidateListings.taskId, candidateListings.taskId),
        eq(savedCandidateListings.candidateListingId, candidateListings.id),
      ),
    )
    .orderBy(desc(savedCandidateListings.savedAt))
    .limit(100);
  return rows.map(({ listing: p }) =>
    visualProductSchema.parse({
      taskId: p.taskId,
      listingId: p.id,
      title: p.title,
      merchant: p.merchant,
      url: p.merchantDestinationUrl ?? p.url,
      destinationKind: p.merchantDestinationUrl
        ? "merchant"
        : "shopping_result",
      imageUrl: p.imageUrl,
      priceAmountMinor: p.priceAmountMinor,
      priceCurrencyCode: p.priceCurrencyCode,
      observedAt: p.retrievedAt.toISOString(),
    }),
  );
}
export async function listVisualDesigns(
  deps: VisualDependencies,
  spaceId: string,
) {
  await loadSpace(deps, spaceId);
  const rows = await deps.db
    .select()
    .from(spaceVisualDesigns)
    .where(eq(spaceVisualDesigns.spaceId, spaceId))
    .orderBy(desc(spaceVisualDesigns.createdAt))
    .limit(40);
  return visualCollectionSchema.parse({
    designs: rows.map(view),
    products: await savedVisualProducts(deps),
    generationAvailable: Boolean(deps.renderer),
  });
}
export async function saveVisualDesign(
  deps: VisualDependencies,
  spaceId: string,
  input: unknown,
) {
  spaceIdSchema.parse(spaceId);
  const request = visualRequestSchema.parse(input);
  const requestHash = createHash("sha256")
    .update(JSON.stringify(request))
    .digest("hex");
  return deps.db.transaction(async (tx) => {
    const [space] = await tx
      .select()
      .from(spaces)
      .where(eq(spaces.id, spaceId))
      .for("update");
    if (!space) throw new SpaceError("not_found", "Room not found.", 404);
    const [existing] = await tx
      .select()
      .from(spaceVisualDesigns)
      .where(
        and(
          eq(spaceVisualDesigns.spaceId, spaceId),
          eq(spaceVisualDesigns.actionId, request.actionId),
        ),
      );
    if (existing) {
      if (existing.requestHash !== requestHash)
        throw new SpaceError(
          "invalid_request",
          "This save action already belongs to a different design.",
          409,
        );
      return view(existing);
    }
    assertRevision(space.currentRevision, request.expectedRevision);
    const prior = await tx
      .select({ id: spaceVisualDesigns.id })
      .from(spaceVisualDesigns)
      .where(eq(spaceVisualDesigns.spaceId, spaceId))
      .limit(40);
    if (prior.length >= 40)
      throw new SpaceError(
        "asset_limit",
        "This room has reached the 40-design founder limit.",
      );
    const transactionalDeps = { ...deps, db: tx };
    const room = await loadSpace(transactionalDeps, spaceId);
    if (request.assetIds.some((id) => !room.assets.some((a) => a.id === id)))
      throw new SpaceError(
        "not_found",
        "Choose photos from this room only.",
        404,
      );
    const available = await savedVisualProducts(transactionalDeps);
    const products = request.products.map((selection) => {
      const product = available.find(
        (p) => p.listingId === selection.listingId,
      );
      if (!product)
        throw new SpaceError(
          "not_found",
          "Save that product in shopping before adding it to a room design.",
          404,
        );
      if (!product.imageUrl)
        throw new SpaceError(
          "invalid_request",
          "That listing has no product image. Choose an item with a reference photo.",
        );
      return { ...product, placement: selection.placement };
    });
    const basis = visualBasisSchema.parse({
      version: 1,
      name: request.name,
      direction: request.direction,
      roomName: room.name,
      roomState: room.state,
      assetIds: request.assetIds,
      products,
    });
    const [row] = await tx
      .insert(spaceVisualDesigns)
      .values({
        spaceId,
        roomRevision: space.currentRevision,
        actionId: request.actionId,
        requestHash,
        basis,
      })
      .returning();
    return view(row!);
  });
}
async function getDesign(
  deps: VisualDependencies,
  spaceId: string,
  id: string,
) {
  const [row] = await deps.db
    .select()
    .from(spaceVisualDesigns)
    .where(
      and(
        eq(spaceVisualDesigns.spaceId, spaceIdSchema.parse(spaceId)),
        eq(spaceVisualDesigns.id, spaceIdSchema.parse(id)),
      ),
    );
  if (!row) throw new SpaceError("not_found", "Room design not found.", 404);
  visualBasisSchema.parse(row.basis);
  return row;
}
export async function renderVisualDesign(
  deps: VisualDependencies,
  spaceId: string,
  id: string,
  input: unknown,
) {
  z.strictObject({ consentToImageProvider: z.literal(true) }).parse(input);
  const row = await getDesign(deps, spaceId, id);
  if (row.status !== "draft") return view(row); // Never replay a paid operation.
  if (!deps.renderer)
    throw new SpaceError(
      "analysis_unavailable",
      "Room rendering is not configured. Your design is safely saved.",
      503,
    );
  const claimed = await deps.db.transaction(async (tx) => {
    const [space] = await tx
      .select()
      .from(spaces)
      .where(eq(spaces.id, spaceId))
      .for("update");
    if (!space) throw new SpaceError("not_found", "Room not found.", 404);
    assertRevision(space.currentRevision, row.roomRevision);
    // Expired attempts are never replayed. A late result can no longer commit.
    await tx
      .update(spaceVisualDesigns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        failure: "provider_failed",
      })
      .where(
        and(
          eq(spaceVisualDesigns.spaceId, spaceId),
          eq(spaceVisualDesigns.status, "running"),
          lt(
            spaceVisualDesigns.startedAt,
            new Date(Date.now() - INTERRUPTED_AFTER_MS),
          ),
        ),
      );
    const running = await tx
      .select({ id: spaceVisualDesigns.id })
      .from(spaceVisualDesigns)
      .where(
        and(
          eq(spaceVisualDesigns.spaceId, spaceId),
          eq(spaceVisualDesigns.status, "running"),
        ),
      )
      .limit(1);
    if (running.length)
      throw new SpaceError(
        "invalid_request",
        "This room already has a generation attempt in progress. Refresh its status; do not start another.",
        409,
      );
    const [result] = await tx
      .update(spaceVisualDesigns)
      .set({ status: "running", startedAt: new Date() })
      .where(
        and(
          eq(spaceVisualDesigns.id, id),
          eq(spaceVisualDesigns.status, "draft"),
        ),
      )
      .returning();
    return result;
  });
  if (!claimed) return view(await getDesign(deps, spaceId, id));
  let failure: "reference_unavailable" | "provider_failed" =
    "reference_unavailable";
  try {
    const roomImages = await Promise.all(
      row.basis.assetIds.map((assetId) =>
        readSpaceAsset(deps, spaceId, assetId),
      ),
    );
    const productImages = await Promise.all(
      row.basis.products.map((p) =>
        (deps.productImage ?? fetchVisualProductImage)(p.imageUrl!),
      ),
    );
    // Local reads/DNS may finish after a process pause. Do not spend on an
    // attempt that another request has already expired or whose lease elapsed.
    const beforeDispatch = await getDesign(deps, spaceId, id);
    if (
      beforeDispatch.status !== "running" ||
      !beforeDispatch.startedAt ||
      Date.now() - beforeDispatch.startedAt.getTime() >= INTERRUPTED_AFTER_MS
    )
      throw new Error("Render attempt expired before provider dispatch");
    failure = "provider_failed";
    const bytes = await deps.renderer.render({
      basis: structuredClone(row.basis),
      roomImages: roomImages.map((i) => ({
        bytes: i.bytes,
        contentType: i.contentType as RenderImage["contentType"],
      })),
      productImages,
    });
    const image = await prepareImage(bytes, "image/png");
    const stored = await deps.storage.put(image.bytes);
    await deps.db
      .update(spaceVisualDesigns)
      .set({
        status: "completed",
        finishedAt: new Date(),
        storageKey: stored.storageKey,
        byteSize: image.bytes.length,
      })
      .where(
        and(
          eq(spaceVisualDesigns.id, id),
          eq(spaceVisualDesigns.status, "running"),
        ),
      );
  } catch {
    await deps.db
      .update(spaceVisualDesigns)
      .set({ status: "failed", finishedAt: new Date(), failure })
      .where(
        and(
          eq(spaceVisualDesigns.id, id),
          eq(spaceVisualDesigns.status, "running"),
        ),
      );
  }
  return view(await getDesign(deps, spaceId, id));
}
export async function readVisualImage(
  deps: VisualDependencies,
  spaceId: string,
  id: string,
) {
  const row = await getDesign(deps, spaceId, id);
  if (row.status !== "completed" || !row.storageKey)
    throw new SpaceError(
      "not_found",
      "This design has no completed image.",
      404,
    );
  try {
    const bytes = await deps.storage.read(row.storageKey);
    if (
      bytes.length !== row.byteSize ||
      createHash("sha256").update(bytes).digest("hex") !== row.storageKey ||
      !bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw new Error("Invalid render");
    return bytes;
  } catch {
    throw new SpaceError(
      "not_found",
      "Render image unavailable; your saved design is preserved.",
      404,
    );
  }
}
