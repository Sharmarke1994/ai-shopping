import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLocalSpaceAssetStorage,
  displayFilename,
  MAX_IMAGE_BYTES,
  prepareImage,
} from "./asset-storage";

const temporaryDirectories: string[] = [];
async function storage() {
  const root = await mkdtemp(
    path.join(tmpdir(), "consider-space-assets-test-"),
  );
  temporaryDirectories.push(root);
  return {
    root,
    port: createLocalSpaceAssetStorage(
      await import("node:fs/promises").then((f) => f.realpath(root)),
    ),
  };
}
afterEach(async () => {
  for (const root of temporaryDirectories.splice(0))
    await rm(root, { recursive: true, force: true });
});
describe("bounded immutable room image storage", () => {
  it("rejects a real two-frame WebP rather than silently treating it as a still", async () => {
    const animated = await sharp(Buffer.from([255, 0, 0, 0, 0, 255]), {
      raw: { width: 1, height: 2, channels: 3, pageHeight: 1 },
    })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(2);
    await expect(prepareImage(animated, "image/webp")).rejects.toThrow(
      /still JPEG/,
    );
  });
  it.each(["jpeg", "png", "webp"] as const)(
    "decodes %s and strips EXIF",
    async (format) => {
      const bytes = await sharp({
        create: { width: 30, height: 20, channels: 3, background: "beige" },
      })
        .toFormat(format)
        .withMetadata()
        .toBuffer();
      const clean = await prepareImage(bytes, `image/${format}`);
      expect((await sharp(clean.bytes).metadata()).exif).toBeUndefined();
      const { port } = await storage();
      const stored = await port.put(clean.bytes);
      expect(await port.read(stored.storageKey)).toEqual(clean.bytes);
      expect(await port.put(clean.bytes)).toEqual(stored);
    },
  );
  it.each([
    Buffer.from("<svg><script>alert(1)</script></svg>"),
    Buffer.from("<html>photo.jpg</html>"),
    Buffer.from([255, 216, 255, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
  ])("rejects spoofed or corrupt content", async (bytes) => {
    await expect(prepareImage(bytes, "image/jpeg")).rejects.toThrow();
  });
  it("rejects incorrect declared MIME and oversized input", async () => {
    const png = await sharp({
      create: { width: 1, height: 1, channels: 3, background: "black" },
    })
      .png()
      .toBuffer();
    await expect(prepareImage(png, "application/octet-stream")).rejects.toThrow(
      /type/,
    );
    await expect(
      prepareImage(Buffer.alloc(MAX_IMAGE_BYTES + 1), "image/png"),
    ).rejects.toThrow(/12 MB/);
  });
  it.each([
    "../secret",
    "/etc/passwd",
    "%2e%2e/secret",
    "a".repeat(63),
    "A".repeat(64),
  ])("rejects key %s", async (key) => {
    const { port } = await storage();
    await expect(port.read(key)).rejects.toThrow();
  });
  it("does not read symlinks or modified assets", async () => {
    const { root, port } = await storage();
    const stored = await port.put(Buffer.from("immutable bytes"));
    await writeFile(path.join(root, stored.storageKey), "modified");
    await expect(port.read(stored.storageKey)).rejects.toThrow(/integrity/);
    await symlink(
      path.join(root, stored.storageKey),
      path.join(root, "b".repeat(64)),
    );
    await expect(port.read("b".repeat(64))).rejects.toThrow();
  });
  it("sanitises filenames and refuses source-tree storage", () => {
    expect(displayFilename("../../<x>\\photo\u0000.jpg")).toBe(
      "....xphoto.jpg",
    );
    expect(() =>
      createLocalSpaceAssetStorage(path.join(process.cwd(), "uploads")),
    ).toThrow(/outside/);
    expect(() => createLocalSpaceAssetStorage("uploads")).toThrow(/absolute/);
  });
});
