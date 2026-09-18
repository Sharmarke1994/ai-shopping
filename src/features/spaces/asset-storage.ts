import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, mkdir, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { SpaceError } from "./domain";

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_SPACE_PHOTOS = 10;
export type ImageContentType = "image/jpeg" | "image/png" | "image/webp";
export interface SpaceAssetStorage {
  put(bytes: Buffer): Promise<{ storageKey: string; sha256: string }>;
  read(storageKey: string): Promise<Buffer>;
}
export function imageSignature(bytes: Buffer): ImageContentType {
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (
    bytes.length >= 12 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return "image/jpeg";
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  throw new SpaceError(
    "invalid_request",
    "Choose a genuine JPEG, PNG or WebP photo.",
  );
}
export async function prepareImage(bytes: Buffer, declaredType: string) {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES)
    throw new SpaceError(
      "invalid_request",
      "Each photo must be no larger than 12 MB.",
      413,
    );
  const contentType = imageSignature(bytes);
  if (contentType !== declaredType)
    throw new SpaceError(
      "invalid_request",
      "Photo type does not match its contents.",
    );
  try {
    const decoder = sharp(bytes, {
      limitInputPixels: 40_000_000,
      failOn: "warning",
    });
    const metadata = await decoder.metadata();
    if ((metadata.pages ?? 1) !== 1) throw new Error("Animated image");
    // Apply orientation before dropping EXIF. Sharp excludes metadata by default.
    const clean = await decoder.rotate().toBuffer();
    if (clean.length > MAX_IMAGE_BYTES)
      throw new Error("Normalised image exceeds bound");
    if (imageSignature(clean) !== contentType)
      throw new Error("Format changed");
    return { bytes: clean, contentType };
  } catch {
    throw new SpaceError(
      "invalid_request",
      "That photo could not be safely decoded. Use a still JPEG, PNG or WebP under 40 megapixels.",
    );
  }
}
export function displayFilename(name: string) {
  return (
    name
      .replace(/[\x00-\x1f\x7f/\\<>]/g, "")
      .trim()
      .slice(0, 100) || "Room photo"
  );
}
export function createLocalSpaceAssetStorage(
  directory: string,
): SpaceAssetStorage {
  if (!path.isAbsolute(directory))
    throw new SpaceError(
      "storage_unavailable",
      "Photo storage needs an absolute directory outside the application.",
      503,
    );
  const root = path.resolve(directory);
  const source = path.resolve(process.cwd());
  if (
    root === source ||
    root.startsWith(source + path.sep) ||
    root === path.parse(root).root
  )
    throw new SpaceError(
      "storage_unavailable",
      "Photo storage must be outside the application.",
      503,
    );
  async function ready() {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const actual = await realpath(root);
    if (
      actual !== root ||
      actual === source ||
      actual.startsWith(source + path.sep)
    )
      throw new Error("Storage root is not canonical");
  }
  function target(key: string) {
    if (!/^[a-f0-9]{64}$/.test(key))
      throw new SpaceError("not_found", "Photo not found.", 404);
    return path.join(root, key);
  }
  async function read(key: string) {
    await ready();
    const file = await open(
      target(key),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES)
        throw new Error("Invalid stored asset");
      const bytes = await file.readFile();
      if (createHash("sha256").update(bytes).digest("hex") !== key)
        throw new Error("Asset integrity mismatch");
      return bytes;
    } finally {
      await file.close();
    }
  }
  return {
    read,
    async put(bytes) {
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES)
        throw new Error("Invalid storage size");
      await ready();
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const destination = target(sha256);
      const temporary = path.join(root, `.pending-${randomUUID()}`);
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      try {
        try {
          await link(temporary, destination);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
        await read(sha256);
      } finally {
        await unlink(temporary);
      }
      return { storageKey: sha256, sha256 };
    },
  };
}
