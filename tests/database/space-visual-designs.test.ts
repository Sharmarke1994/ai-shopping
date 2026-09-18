import { randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabaseConnection } from "./helpers";
import {
  createSpace,
  loadSpace,
  mutateSpace,
  uploadSpaceAsset,
} from "@/features/spaces/application";
import { createLocalSpaceAssetStorage } from "@/features/spaces/asset-storage";
import {
  listVisualDesigns,
  readVisualImage,
  renderVisualDesign,
  saveVisualDesign,
  type VisualDependencies,
} from "@/features/spaces/visual-application";
import {
  candidateListings,
  savedCandidateListings,
  spaceVisualDesigns,
} from "@/infrastructure/database/schema";
import { seedFounderJourney } from "../support/founder-journey";
import { chairCorpus } from "../support/founder-product-evidence";
import type { SpaceVisualRenderer } from "@/features/spaces/visual-renderer";

const connection = createTestDatabaseConnection();
let directory: string;
let deps: VisualDependencies;
let photo: Buffer;
beforeAll(async () => {
  directory = await realpath(
    await mkdtemp(path.join(tmpdir(), "consider-visual-test-")),
  );
  photo = await sharp({
    create: { width: 24, height: 24, channels: 3, background: "beige" },
  })
    .png()
    .toBuffer();
  deps = {
    db: connection.db,
    storage: createLocalSpaceAssetStorage(directory),
  };
});
afterAll(async () => {
  await connection.close();
  await rm(directory, { recursive: true, force: true });
});
async function room() {
  const created = await createSpace(deps, { name: "My office" });
  return uploadSpaceAsset(deps, created.id, {
    expectedRevision: 0,
    filename: "office.png",
    contentType: "image/png",
    bytes: photo,
  });
}
function input(s: Awaited<ReturnType<typeof room>>) {
  return {
    actionId: randomUUID(),
    expectedRevision: s.currentRevision,
    name: "Warmer office",
    direction: "Keep my desk, warm the lighting",
    assetIds: s.assets.map((a) => a.id),
    products: [],
  };
}
const consent = { consentToImageProvider: true };
it("binds persisted saved listing identity, price and image; never trusts client product facts", async () => {
  const journey = await seedFounderJourney(
    connection.db,
    "office-chair",
    chairCorpus,
  );
  const [listing] = await connection.db
    .update(candidateListings)
    .set({ imageUrl: "https://shop.example/chair-reference.png" })
    .where(eq(candidateListings.taskId, journey.taskId))
    .returning();
  expect(listing).toBeDefined();
  await connection.db
    .insert(savedCandidateListings)
    .values({ taskId: listing!.taskId, candidateListingId: listing!.id });
  const s = await room();
  const saved = await saveVisualDesign(deps, s.id, {
    ...input(s),
    products: [{ listingId: listing!.id, placement: "At the existing desk" }],
  });
  expect(saved.basis.products[0]).toMatchObject({
    taskId: listing!.taskId,
    title: listing!.title,
    priceAmountMinor: listing!.priceAmountMinor,
    imageUrl: listing!.imageUrl,
    placement: "At the existing desk",
  });
  await connection.db
    .delete(savedCandidateListings)
    .where(eq(savedCandidateListings.candidateListingId, listing!.id));
  // Unsaving in shopping never erases a frozen design selection.
  expect(
    (await listVisualDesigns(deps, s.id)).designs[0]?.basis.products,
  ).toEqual(saved.basis.products);
  const productImage = vi.fn(async () => ({
    bytes: photo,
    contentType: "image/png" as const,
  }));
  const render = vi.fn<SpaceVisualRenderer["render"]>(async () => photo);
  const completed = await renderVisualDesign(
    { ...deps, renderer: { render }, productImage },
    s.id,
    saved.id,
    consent,
  );
  expect(completed.status).toBe("completed");
  expect(productImage).toHaveBeenCalledWith(listing!.imageUrl);
  expect(render.mock.calls[0]?.[0]).toMatchObject({
    productImages: [{ contentType: "image/png" }],
  });
  await expect(
    connection.client`update shopping_private.space_visual_designs set status = 'running', finished_at = null, storage_key = null, byte_size = null where id = ${saved.id}`,
  ).rejects.toThrow();
});
it("does not generate a text-only lookalike when a selected product image fails", async () => {
  const journey = await seedFounderJourney(
    connection.db,
    "office-chair",
    chairCorpus,
  );
  const [listing] = await connection.db
    .update(candidateListings)
    .set({ imageUrl: "https://shop.example/chair-reference.png" })
    .where(eq(candidateListings.taskId, journey.taskId))
    .returning();
  await connection.db
    .insert(savedCandidateListings)
    .values({ taskId: listing!.taskId, candidateListingId: listing!.id });
  const s = await room();
  const saved = await saveVisualDesign(deps, s.id, {
    ...input(s),
    products: [{ listingId: listing!.id, placement: "At desk" }],
  });
  const render = vi.fn(async () => photo);
  const result = await renderVisualDesign(
    {
      ...deps,
      renderer: { render },
      productImage: async () => {
        throw new Error("private DNS");
      },
    },
    s.id,
    saved.id,
    consent,
  );
  expect(result.status).toBe("failed");
  expect(result.failure).toContain("No render was requested");
  expect(render).not.toHaveBeenCalled();
});
it("saves/reloads immutable design basis without changing the room revision or generating", async () => {
  const s = await room();
  const saved = await saveVisualDesign(deps, s.id, input(s));
  expect(saved.status).toBe("draft");
  expect(saved.basis.roomState).toEqual(s.state);
  expect((await listVisualDesigns(deps, s.id)).designs).toEqual([saved]);
  expect(await loadSpace(deps, s.id)).toEqual(s);
  await expect(
    renderVisualDesign(deps, s.id, saved.id, consent),
  ).rejects.toMatchObject({ status: 503 });
  expect((await listVisualDesigns(deps, s.id)).designs[0]?.status).toBe(
    "draft",
  );
});
it("deduplicates same-action save concurrently without exhausting the connection pool", async () => {
  const s = await room();
  const request = input(s);
  const results = await Promise.all(
    Array.from({ length: 6 }, () => saveVisualDesign(deps, s.id, request)),
  );
  expect(new Set(results.map((r) => r.id)).size).toBe(1);
  await expect(
    saveVisualDesign(deps, s.id, { ...request, name: "Other" }),
  ).rejects.toMatchObject({ status: 409 });
});
it("rejects foreign photos, unsaved listings, and forged price payloads", async () => {
  const s = await room(),
    other = await room();
  await expect(
    saveVisualDesign(deps, s.id, {
      ...input(s),
      assetIds: other.assets.map((a) => a.id),
    }),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    saveVisualDesign(deps, s.id, {
      ...input(s),
      products: [{ listingId: randomUUID(), placement: "Left" }],
    }),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    saveVisualDesign(deps, s.id, {
      ...input(s),
      products: [
        { listingId: randomUUID(), placement: "Left", priceAmountMinor: 1 },
      ],
    }),
  ).rejects.toThrow();
});
it("stale saves and stale generation fail without a provider call", async () => {
  const s = await room();
  const saved = await saveVisualDesign(deps, s.id, input(s));
  await mutateSpace(deps, s.id, {
    operation: "add_item",
    expectedRevision: s.currentRevision,
    label: "Desk",
  });
  const render = vi.fn(async () => photo);
  await expect(saveVisualDesign(deps, s.id, input(s))).rejects.toMatchObject({
    status: 409,
  });
  await expect(
    renderVisualDesign(
      { ...deps, renderer: { render } },
      s.id,
      saved.id,
      consent,
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(render).not.toHaveBeenCalled();
  expect(
    (await listVisualDesigns(deps, s.id)).designs[0]?.basis.roomState.items,
  ).toEqual([]);
});
it("requires explicit consent and invokes the renderer once across concurrent requests/replays", async () => {
  const s = await room();
  const saved = await saveVisualDesign(deps, s.id, input(s));
  const render = vi.fn(async () => photo);
  const live = { ...deps, renderer: { render } };
  await expect(
    renderVisualDesign(live, s.id, saved.id, { consentToImageProvider: false }),
  ).rejects.toThrow();
  const results = await Promise.allSettled([
    renderVisualDesign(live, s.id, saved.id, consent),
    renderVisualDesign(live, s.id, saved.id, consent),
  ]);
  expect(results.some((r) => r.status === "fulfilled")).toBe(true);
  expect(render).toHaveBeenCalledTimes(1);
  const replay = await renderVisualDesign(live, s.id, saved.id, consent);
  expect(replay.status).toBe("completed");
  expect(render).toHaveBeenCalledTimes(1);
  expect(await readVisualImage(deps, s.id, saved.id)).toEqual(
    await deps.storage.read(
      (
        await connection.db
          .select()
          .from(spaceVisualDesigns)
          .where(eq(spaceVisualDesigns.id, saved.id))
      )[0]!.storageKey!,
    ),
  );
  expect(await loadSpace(deps, s.id)).toEqual(s);
});
it("retains failed attempts without exposing provider exceptions or retrying", async () => {
  const s = await room();
  const saved = await saveVisualDesign(deps, s.id, input(s));
  const render = vi.fn(async (): Promise<Buffer> => {
    throw new Error("sensitive upstream failure");
  });
  const live = { ...deps, renderer: { render } };
  const failed = await renderVisualDesign(live, s.id, saved.id, consent);
  expect(failed.status).toBe("failed");
  expect(JSON.stringify(failed)).not.toContain("sensitive");
  await renderVisualDesign(live, s.id, saved.id, consent);
  expect(render).toHaveBeenCalledTimes(1);
  expect(await loadSpace(deps, s.id)).toEqual(s);
});
it("rejects malformed provider image bytes without a completed artifact", async () => {
  const s = await room(),
    saved = await saveVisualDesign(deps, s.id, input(s));
  const result = await renderVisualDesign(
    { ...deps, renderer: { render: async () => Buffer.from("<svg/>") } },
    s.id,
    saved.id,
    consent,
  );
  expect(result.status).toBe("failed");
  await expect(readVisualImage(deps, s.id, saved.id)).rejects.toMatchObject({
    status: 404,
  });
});
it("denies cross-space design generation and rendered image reads", async () => {
  const s = await room(),
    other = await room();
  const saved = await saveVisualDesign(deps, s.id, input(s));
  await expect(
    renderVisualDesign(deps, other.id, saved.id, consent),
  ).rejects.toMatchObject({ status: 404 });
  await expect(readVisualImage(deps, other.id, saved.id)).rejects.toMatchObject(
    { status: 404 },
  );
});
it("SQL rejects basis changes, skipped states, partial completed tuples and deletion", async () => {
  const s = await room(),
    saved = await saveVisualDesign(deps, s.id, input(s));
  await expect(
    connection.client`update shopping_private.space_visual_designs set basis = '{"version":1}'::jsonb where id = ${saved.id}`,
  ).rejects.toThrow();
  await expect(
    connection.client`update shopping_private.space_visual_designs set status = 'completed' where id = ${saved.id}`,
  ).rejects.toThrow();
  await expect(
    connection.client`delete from shopping_private.space_visual_designs where id = ${saved.id}`,
  ).rejects.toThrow();
  await connection.client`update shopping_private.space_visual_designs set status = 'running', started_at = now() where id = ${saved.id}`;
  await expect(
    connection.client`update shopping_private.space_visual_designs set status = 'completed', finished_at = now() where id = ${saved.id}`,
  ).rejects.toThrow();
});
it("shows an expired operation honestly and never replays its provider request", async () => {
  const s = await room(),
    saved = await saveVisualDesign(deps, s.id, input(s));
  await connection.client`update shopping_private.space_visual_designs set status = 'running', started_at = now() - interval '5 minutes' where id = ${saved.id}`;
  expect((await listVisualDesigns(deps, s.id)).designs[0]?.status).toBe(
    "interrupted",
  );
  const render = vi.fn(async () => photo);
  const live = { ...deps, renderer: { render } };
  await renderVisualDesign(live, s.id, saved.id, consent);
  expect(render).not.toHaveBeenCalled();
  const next = await saveVisualDesign(deps, s.id, input(s));
  expect((await renderVisualDesign(live, s.id, next.id, consent)).status).toBe(
    "completed",
  );
  expect(render).toHaveBeenCalledTimes(1);
});
it("does not dispatch a delayed paid request after another claim has expired it", async () => {
  const s = await room();
  const old = await saveVisualDesign(deps, s.id, input(s));
  const next = await saveVisualDesign(deps, s.id, input(s));
  let release!: () => void;
  let entered!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reading = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const render = vi.fn(async () => photo);
  const delayed = renderVisualDesign(
    {
      ...deps,
      renderer: { render },
      storage: {
        put: deps.storage.put,
        read: async (key) => {
          entered();
          await paused;
          return deps.storage.read(key);
        },
      },
    },
    s.id,
    old.id,
    consent,
  );
  await reading;
  // Same terminal transition made by the newer claim's expiration sweep.
  await connection.client`update shopping_private.space_visual_designs set status = 'failed', finished_at = now(), failure = 'provider_failed' where id = ${old.id}`;
  await renderVisualDesign(
    { ...deps, renderer: { render } },
    s.id,
    next.id,
    consent,
  );
  release();
  expect((await delayed).status).toBe("failed");
  expect(render).toHaveBeenCalledTimes(1);
});
