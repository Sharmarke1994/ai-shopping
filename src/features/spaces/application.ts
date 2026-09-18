import { and, desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  ShoppingDatabase,
  ShoppingTransaction,
} from "@/infrastructure/database/clients";
import {
  spaces,
  spaceAssets,
  spaceRevisions,
  spaceRevisionAssets,
} from "@/infrastructure/database/schema/spaces";
import {
  createSpaceSchema,
  emptyRoomState,
  roomStateSchema,
  spaceIdSchema,
  spaceOperationSchema,
  spaceViewSchema,
  type RoomState,
} from "./contracts";
import { assertRevision, applySpaceOperation, SpaceError } from "./domain";
import {
  displayFilename,
  imageSignature,
  MAX_SPACE_PHOTOS,
  prepareImage,
  type ImageContentType,
  type SpaceAssetStorage,
} from "./asset-storage";
import {
  appendVisualProposals,
  type SpaceUnderstandingModel,
} from "./understanding";

export type SpaceDependencies = {
  db: ShoppingDatabase;
  storage: SpaceAssetStorage;
  understanding?: SpaceUnderstandingModel;
  fixtureMode?: boolean;
};
type Executor = ShoppingDatabase | ShoppingTransaction;
async function getSpace(db: Executor, id: string) {
  const [space] = await db
    .select()
    .from(spaces)
    .where(eq(spaces.id, spaceIdSchema.parse(id)));
  if (!space) throw new SpaceError("not_found", "Space not found.", 404);
  return space;
}
export async function loadSpaceRevision(
  db: Executor,
  spaceId: string,
  revision: number,
) {
  const [row] = await db
    .select()
    .from(spaceRevisions)
    .where(
      and(
        eq(spaceRevisions.spaceId, spaceId),
        eq(spaceRevisions.revision, revision),
      ),
    );
  if (!row) throw new SpaceError("not_found", "Room revision not found.", 404);
  const assets = await db
    .select({ asset: spaceAssets })
    .from(spaceRevisionAssets)
    .innerJoin(
      spaceAssets,
      and(
        eq(spaceRevisionAssets.spaceId, spaceAssets.spaceId),
        eq(spaceRevisionAssets.assetId, spaceAssets.id),
      ),
    )
    .where(
      and(
        eq(spaceRevisionAssets.spaceId, spaceId),
        eq(spaceRevisionAssets.revision, revision),
      ),
    )
    .orderBy(spaceAssets.createdAt, spaceAssets.id);
  const state = roomStateSchema.parse(row.snapshot);
  const ids = assets.map((a) => a.asset.id);
  if (
    [...state.facts, ...state.unknowns].some((f) =>
      f.sourceAssetIds.some((id) => !ids.includes(id)),
    )
  )
    throw new Error("Invalid persisted room provenance");
  return { state, assets: assets.map((a) => a.asset) };
}
export async function loadSpace(deps: SpaceDependencies, id: string) {
  const space = await getSpace(deps.db, id);
  // Immutable revision read: a concurrent edit cannot mix its snapshot with ours.
  const current = await loadSpaceRevision(
    deps.db,
    space.id,
    space.currentRevision,
  );
  return spaceViewSchema.parse({
    id: space.id,
    name: space.name,
    roomType: space.roomType,
    currentRevision: space.currentRevision,
    updatedAt: space.updatedAt.toISOString(),
    state: current.state,
    assets: current.assets.map((a) => ({
      id: a.id,
      contentType: a.contentType,
      byteSize: a.byteSize,
      filename: a.filename,
      url: `/api/spaces/${space.id}/assets/${a.id}`,
    })),
    analysisMode:
      deps.fixtureMode && deps.understanding
        ? "fictional_fixture"
        : "unavailable",
  });
}
export async function listSpaces(deps: SpaceDependencies) {
  const rows = await deps.db
    .select({ id: spaces.id })
    .from(spaces)
    .orderBy(desc(spaces.updatedAt))
    .limit(100);
  return Promise.all(rows.map((s) => loadSpace(deps, s.id)));
}
export async function createSpace(deps: SpaceDependencies, input: unknown) {
  const parsed = createSpaceSchema.parse(input);
  const id = await deps.db.transaction(async (tx) => {
    const [space] = await tx.insert(spaces).values(parsed).returning();
    if (!space) throw new Error("Space insert failed");
    await tx
      .insert(spaceRevisions)
      .values({ spaceId: space.id, revision: 0, snapshot: emptyRoomState() });
    return space.id;
  });
  return loadSpace(deps, id);
}
async function locked(
  deps: SpaceDependencies,
  id: string,
  expectedRevision: number,
  apply: (
    tx: ShoppingTransaction,
    current: Awaited<ReturnType<typeof loadSpaceRevision>>,
  ) => Promise<{ state: RoomState; assetIds: string[] } | null>,
) {
  await deps.db.transaction(async (tx) => {
    const [space] = await tx
      .select()
      .from(spaces)
      .where(eq(spaces.id, spaceIdSchema.parse(id)))
      .for("update");
    if (!space) throw new SpaceError("not_found", "Space not found.", 404);
    assertRevision(space.currentRevision, expectedRevision);
    const current = await loadSpaceRevision(tx, id, space.currentRevision);
    const next = await apply(tx, current);
    if (!next) return;
    const revision = space.currentRevision + 1;
    const state = roomStateSchema.parse(next.state);
    if (next.assetIds.length > MAX_SPACE_PHOTOS)
      throw new SpaceError("asset_limit", "Keep up to 10 photos in a space.");
    if (
      [...state.facts, ...state.unknowns].some((f) =>
        f.sourceAssetIds.some((assetId) => !next.assetIds.includes(assetId)),
      )
    )
      throw new Error("Invalid photo provenance");
    await tx
      .insert(spaceRevisions)
      .values({ spaceId: id, revision, snapshot: state });
    if (next.assetIds.length)
      await tx
        .insert(spaceRevisionAssets)
        .values(
          next.assetIds.map((assetId) => ({ spaceId: id, revision, assetId })),
        );
    await tx
      .update(spaces)
      .set({ currentRevision: revision, updatedAt: new Date() })
      .where(eq(spaces.id, id));
  });
  return loadSpace(deps, id);
}
export async function mutateSpace(
  deps: SpaceDependencies,
  id: string,
  input: unknown,
) {
  const operation = spaceOperationSchema.parse(input);
  if (operation.operation === "analyse_photos") {
    if (!deps.understanding)
      throw new SpaceError(
        "analysis_unavailable",
        "Automatic photo analysis is not configured. You can still add your own room facts and measurements.",
        503,
      );
    const space = await getSpace(deps.db, id);
    assertRevision(space.currentRevision, operation.expectedRevision);
    const current = await loadSpaceRevision(deps.db, id, space.currentRevision);
    if (new Set(operation.assetIds).size !== operation.assetIds.length)
      throw new SpaceError("invalid_request", "Select each photo once.");
    const selected = operation.assetIds.map((assetId) => {
      const asset = current.assets.find((a) => a.id === assetId);
      if (!asset)
        throw new SpaceError("not_found", "Photo not found in this room.", 404);
      return asset;
    });
    const output = await deps.understanding.propose({
      name: space.name,
      roomType: space.roomType,
      assets: await Promise.all(
        selected.map(async (a) => ({
          id: a.id,
          contentType: a.contentType as ImageContentType,
          bytes: await deps.storage.read(a.storageKey),
        })),
      ),
      confirmedFacts: current.state.facts.filter(
        (f) => f.status === "confirmed",
      ),
      measurements: current.state.measurements,
    });
    const next = appendVisualProposals(
      current.state,
      output,
      operation.assetIds,
      deps.fixtureMode ? "fictional_fixture" : "photo_analysis",
    );
    // Model work is outside the transaction; CAS again after it returns.
    return locked(deps, id, operation.expectedRevision, async () => ({
      state: next,
      assetIds: current.assets.map((a) => a.id),
    }));
  }
  return locked(deps, id, operation.expectedRevision, async (_tx, current) => ({
    state: applySpaceOperation(current.state, operation),
    assetIds: current.assets.map((a) => a.id),
  }));
}
export async function uploadSpaceAsset(
  deps: SpaceDependencies,
  id: string,
  input: {
    expectedRevision: number;
    filename: string;
    contentType: string;
    bytes: Buffer;
  },
) {
  z.number().int().nonnegative().max(2147483646).parse(input.expectedRevision);
  const space = await getSpace(deps.db, id);
  assertRevision(space.currentRevision, input.expectedRevision);
  const image = await prepareImage(input.bytes, input.contentType);
  return locked(deps, id, input.expectedRevision, async (tx, current) => {
    // Serialize quota checking and filesystem writes per space. Content-addressed
    // orphans after a failed DB commit are safe; never delete shared assets blindly.
    const digest = createHash("sha256").update(image.bytes).digest("hex");
    const existing = current.assets.find((a) => a.sha256 === digest);
    if (existing) return null;
    if (current.assets.length >= MAX_SPACE_PHOTOS)
      throw new SpaceError(
        "asset_limit",
        "This space already has 10 photos. No more photos were added.",
      );
    const stored = await deps.storage.put(image.bytes);
    const [asset] = await tx
      .insert(spaceAssets)
      .values({
        spaceId: id,
        ...stored,
        contentType: image.contentType,
        byteSize: image.bytes.length,
        filename: displayFilename(input.filename),
      })
      .returning();
    if (!asset) throw new Error("Asset insert failed");
    return {
      state: current.state,
      assetIds: [...current.assets.map((a) => a.id), asset.id],
    };
  });
}
export async function readSpaceAsset(
  deps: SpaceDependencies,
  id: string,
  assetId: string,
) {
  spaceIdSchema.parse(id);
  spaceIdSchema.parse(assetId);
  const [asset] = await deps.db
    .select()
    .from(spaceAssets)
    .where(and(eq(spaceAssets.spaceId, id), eq(spaceAssets.id, assetId)));
  if (!asset) throw new SpaceError("not_found", "Photo not found.", 404);
  try {
    const bytes = await deps.storage.read(asset.storageKey);
    if (
      bytes.length !== asset.byteSize ||
      imageSignature(bytes) !== asset.contentType
    )
      throw new Error("Stored photo type mismatch");
    return {
      bytes,
      contentType: asset.contentType,
      sha256: asset.sha256,
    };
  } catch {
    throw new SpaceError(
      "not_found",
      "Photo is unavailable. Its room record has been preserved.",
      404,
    );
  }
}
