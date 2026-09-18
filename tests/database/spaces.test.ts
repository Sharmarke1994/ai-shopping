import { randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabaseConnection } from "./helpers";
import {
  createSpace,
  loadSpace,
  loadSpaceRevision,
  mutateSpace,
  readSpaceAsset,
  uploadSpaceAsset,
  type SpaceDependencies,
} from "../../src/features/spaces/application";
import { createLocalSpaceAssetStorage } from "../../src/features/spaces/asset-storage";
import { fictionalBedroomUnderstanding } from "../../src/features/spaces/understanding";
import { emptyRoomState } from "../../src/features/spaces/contracts";

const connection = createTestDatabaseConnection();
let directory: string;
let deps: SpaceDependencies;
let photo: Buffer;
beforeAll(async () => {
  directory = await realpath(
    await mkdtemp(path.join(tmpdir(), "consider-space-db-test-")),
  );
  deps = {
    db: connection.db,
    storage: createLocalSpaceAssetStorage(directory),
    understanding: fictionalBedroomUnderstanding(),
    fixtureMode: true,
  };
  photo = await sharp({
    create: { width: 40, height: 30, channels: 3, background: "beige" },
  })
    .png()
    .toBuffer();
});
afterAll(async () => {
  await connection.close();
  await rm(directory, { recursive: true, force: true });
});
async function room() {
  return createSpace(deps, { name: "Bedroom", roomType: "bedroom" });
}
async function upload(id: string, revision: number, bytes = photo) {
  return uploadSpaceAsset(deps, id, {
    expectedRevision: revision,
    filename: "bedroom.png",
    contentType: "image/png",
    bytes,
  });
}
describe("persistent spaces PostgreSQL and application", () => {
  it("creates and reloads revision zero without any measurement", async () => {
    const s = await room();
    expect(s.currentRevision).toBe(0);
    expect(s.state.measurements).toEqual([]);
    expect(await loadSpace(deps, s.id)).toEqual(s);
  });
  it("persists photos outside JSON and deterministically reuses duplicate digest", async () => {
    const s = await room();
    const first = await upload(s.id, 0);
    const repeated = await upload(s.id, 1);
    expect(first.assets).toHaveLength(1);
    expect(repeated).toEqual(first);
    expect(JSON.stringify(first)).not.toContain(directory);
    const read = await readSpaceAsset(deps, s.id, first.assets[0]!.id);
    expect(read.contentType).toBe("image/png");
    expect((await sharp(read.bytes).metadata()).width).toBe(40);
    expect((await loadSpaceRevision(deps.db, s.id, 0)).assets).toEqual([]);
  });
  it("denies cross-space and missing asset reads", async () => {
    const a = await room(),
      b = await room();
    const uploaded = await upload(a.id, 0);
    await expect(
      readSpaceAsset(deps, b.id, uploaded.assets[0]!.id),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      readSpaceAsset(deps, a.id, randomUUID()),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      readSpaceAsset(deps, a.id, "../../etc/passwd"),
    ).rejects.toThrow();
  });
  it("rejects invalid uploads without a revision or metadata row", async () => {
    const s = await room();
    await expect(upload(s.id, 0, Buffer.from("<svg>"))).rejects.toThrow();
    expect(await loadSpace(deps, s.id)).toEqual(s);
  });
  it("serializes two concurrent tabs with exactly one success", async () => {
    const s = await room();
    const edits = await Promise.allSettled(
      ["First", "Second"].map((label) =>
        mutateSpace(deps, s.id, {
          operation: "add_unknown",
          expectedRevision: 0,
          label,
        }),
      ),
    );
    expect(edits.filter((e) => e.status === "fulfilled")).toHaveLength(1);
    expect(edits.filter((e) => e.status === "rejected")).toHaveLength(1);
    expect(
      (edits.find((e) => e.status === "rejected") as PromiseRejectedResult)
        .reason,
    ).toMatchObject({ code: "stale_revision" });
    const next = await loadSpace(deps, s.id);
    expect(next.currentRevision).toBe(1);
    expect(next.state.unknowns).toHaveLength(1);
    expect((await loadSpaceRevision(deps.db, s.id, 0)).state).toEqual(
      emptyRoomState(),
    );
  });
  it("round-trips the founder journey and preserves corrections and measurements on reanalysis", async () => {
    let s = await room();
    const id = s.id;
    for (const background of ["beige", "tan", "brown"])
      s = await upload(
        id,
        s.currentRevision,
        await sharp({
          create: { width: 50, height: 30, channels: 3, background },
        })
          .png()
          .toBuffer(),
      );
    s = await mutateSpace(deps, id, {
      operation: "analyse_photos",
      expectedRevision: s.currentRevision,
      assetIds: s.assets.map((a) => a.id),
    });
    expect(s.state.facts).toHaveLength(6);
    expect(s.state.items).toEqual([]);
    const bed = s.state.facts.find((f) => f.label === "Bed")!,
      desk = s.state.facts.find((f) => f.label === "Desk")!;
    s = await mutateSpace(deps, id, {
      operation: "correct_fact",
      expectedRevision: s.currentRevision,
      factId: bed.id,
      value: "Double bed",
    });
    s = await mutateSpace(deps, id, {
      operation: "confirm_fact",
      expectedRevision: s.currentRevision,
      factId: desk.id,
    });
    s = await mutateSpace(deps, id, {
      operation: "reject_fact",
      expectedRevision: s.currentRevision,
      factId: s.state.facts.find((f) => f.label === "Shelving")!.id,
    });
    s = await mutateSpace(deps, id, {
      operation: "add_measurement",
      expectedRevision: s.currentRevision,
      measurement: { label: "Desk wall width", amount: 214, unit: "cm" },
    });
    for (const item of s.state.items)
      s = await mutateSpace(deps, id, {
        operation: "set_item_intent",
        expectedRevision: s.currentRevision,
        itemId: item.id,
        intent: "keep",
      });
    const design = {
      ...s.state.design,
      goal: "Make the room warmer, cleaner and more put together without replacing the desk or bed.",
      add: ["Rug", "Warmer lamp", "Wall art"],
      palette: ["Cream", "Beige", "Dark brown", "Black accents"],
    };
    s = await mutateSpace(deps, id, {
      operation: "set_design",
      expectedRevision: s.currentRevision,
      design,
    });
    const before = s;
    s = await mutateSpace(deps, id, {
      operation: "analyse_photos",
      expectedRevision: s.currentRevision,
      assetIds: s.assets.map((a) => a.id),
    });
    expect(s.state).toEqual(before.state);
    expect(s.state.measurements[0]).toMatchObject({
      millimetres: 2140,
      basis: "user_measured",
    });
    expect(s.state.facts.find((f) => f.id === bed.id)).toMatchObject({
      basis: "user_confirmed",
      value: "Double bed",
    });
    expect(await loadSpace(deps, id)).toEqual(s);
    expect(
      (await loadSpaceRevision(deps.db, id, before.currentRevision)).state,
    ).toEqual(before.state);
    // New connection/storage instance, not an in-memory cache.
    const fresh = createTestDatabaseConnection();
    try {
      expect(
        await loadSpace(
          {
            ...deps,
            db: fresh.db,
            storage: createLocalSpaceAssetStorage(directory),
          },
          id,
        ),
      ).toEqual(s);
    } finally {
      await fresh.close();
    }
  });
  it("does not invent runtime analysis or mutate on unavailable model", async () => {
    const s = await upload((await room()).id, 0);
    await expect(
      mutateSpace({ db: deps.db, storage: deps.storage }, s.id, {
        operation: "analyse_photos",
        expectedRevision: 1,
        assetIds: s.assets.map((a) => a.id),
      }),
    ).rejects.toMatchObject({ code: "analysis_unavailable" });
    expect(await loadSpace(deps, s.id)).toEqual(s);
  });
  it("rejects model measurement injection without any partial write", async () => {
    const s = await upload((await room()).id, 0);
    const bad = {
      ...deps,
      understanding: {
        async propose() {
          return {
            facts: [],
            unknowns: [],
            measurements: [{ amount: 214, unit: "cm" }],
          };
        },
      },
    };
    await expect(
      mutateSpace(bad, s.id, {
        operation: "analyse_photos",
        expectedRevision: 1,
        assetIds: s.assets.map((a) => a.id),
      }),
    ).rejects.toThrow();
    expect(await loadSpace(deps, s.id)).toEqual(s);
  });
  it("rejects analysis finishing against a stale revision", async () => {
    const s = await upload((await room()).id, 0);
    const delayed = {
      ...deps,
      understanding: {
        async propose() {
          await mutateSpace(deps, s.id, {
            operation: "add_unknown",
            expectedRevision: 1,
            label: "Keep this edit",
          });
          return { facts: [], unknowns: [] };
        },
      },
    };
    await expect(
      mutateSpace(delayed, s.id, {
        operation: "analyse_photos",
        expectedRevision: 1,
        assetIds: s.assets.map((a) => a.id),
      }),
    ).rejects.toMatchObject({ code: "stale_revision" });
    expect((await loadSpace(deps, s.id)).state.unknowns[0]?.label).toBe(
      "Keep this edit",
    );
  });
  it("enforces ten-photo quota, even for repeated upload requests", async () => {
    let s = await room();
    for (let index = 0; index < 10; index++)
      s = await upload(
        s.id,
        s.currentRevision,
        await sharp({
          create: {
            width: 20 + index,
            height: 10,
            channels: 3,
            background: "beige",
          },
        })
          .png()
          .toBuffer(),
      );
    const before = s;
    await expect(upload(s.id, s.currentRevision, photo)).rejects.toMatchObject({
      code: "asset_limit",
    });
    expect(await loadSpace(deps, s.id)).toEqual(before);
  });
  it("raw SQL cannot rewrite or delete historical snapshots", async () => {
    const s = await room();
    await expect(
      connection.client`update shopping_private.space_revisions set snapshot = ${JSON.stringify(emptyRoomState())}::jsonb where space_id = ${s.id}`,
    ).rejects.toThrow(/immutable/);
    await expect(
      connection.client`delete from shopping_private.space_revisions where space_id = ${s.id}`,
    ).rejects.toThrow(/immutable/);
  });
  it("raw pointer must advance one step and reference a real revision", async () => {
    const s = await room();
    await expect(
      connection.client`update shopping_private.spaces set current_revision = 1 where id = ${s.id}`,
    ).rejects.toThrow(/foreign key/);
    await expect(
      connection.client`update shopping_private.spaces set current_revision = 99 where id = ${s.id}`,
    ).rejects.toThrow(/exactly once/);
  });
  it("raw cross-space asset membership is rejected", async () => {
    const a = await upload((await room()).id, 0),
      b = await room();
    await expect(
      connection.client.begin(async (sql) => {
        await sql`insert into shopping_private.space_revisions (space_id,revision,snapshot) values (${b.id},1,${JSON.stringify(emptyRoomState())}::jsonb)`;
        await sql`insert into shopping_private.space_revision_assets values (${b.id},1,${a.assets[0]!.id})`;
      }),
    ).rejects.toThrow(/foreign key/);
  });
  it("raw photo metadata and membership cannot be changed retrospectively", async () => {
    const s = await upload((await room()).id, 0);
    await expect(
      connection.client`update shopping_private.space_assets set filename = 'other' where id = ${s.assets[0]!.id}`,
    ).rejects.toThrow(/immutable/);
    await expect(
      connection.client`delete from shopping_private.space_revision_assets where space_id = ${s.id}`,
    ).rejects.toThrow(/immutable/);
    await expect(
      connection.client`insert into shopping_private.space_revision_assets values (${s.id},0,${s.assets[0]!.id})`,
    ).rejects.toThrow(/historical/);
  });
  it("cannot roll the pointer back to reopen historical membership", async () => {
    const s = await upload((await room()).id, 0);
    await mutateSpace(deps, s.id, {
      operation: "add_unknown",
      expectedRevision: 1,
      label: "Bedside width",
    });
    await expect(
      connection.client`update shopping_private.spaces set current_revision = 0 where id = ${s.id}`,
    ).rejects.toThrow(/exactly once/);
    expect((await loadSpace(deps, s.id)).currentRevision).toBe(2);
  });
  it("retains fictional provenance when reopened without fixture mode", async () => {
    let s = await upload((await room()).id, 0);
    s = await mutateSpace(deps, s.id, {
      operation: "analyse_photos",
      expectedRevision: 1,
      assetIds: s.assets.map((a) => a.id),
    });
    const reopened = await loadSpace(
      { db: deps.db, storage: deps.storage },
      s.id,
    );
    expect(reopened.analysisMode).toBe("unavailable");
    expect(
      reopened.state.facts.every((f) => f.origin === "fictional_fixture"),
    ).toBe(true);
    expect(
      reopened.state.unknowns.every((u) => u.origin === "fictional_fixture"),
    ).toBe(true);
  });
});
