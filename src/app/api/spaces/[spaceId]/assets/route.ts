import { z } from "zod";
import { uploadSpaceAsset } from "@/features/spaces/application";
import { MAX_IMAGE_BYTES } from "@/features/spaces/asset-storage";
import { SpaceError } from "@/features/spaces/domain";
import {
  boundedBody,
  requireSameOrigin,
  spaceHttp,
  spaceJson,
} from "@/features/spaces/http";
import { createSpaceDependencies } from "@/features/spaces/runtime";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ spaceId: string }> },
) {
  return spaceHttp(async () => {
    requireSameOrigin(request);
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.startsWith("multipart/form-data;"))
      throw new SpaceError("invalid_request", "Choose a photo to upload.");
    const bytes = await boundedBody(request, MAX_IMAGE_BYTES + 64 * 1024);
    const form = await new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": contentType },
    }).formData();
    if (
      form.getAll("photo").length !== 1 ||
      form.getAll("expectedRevision").length !== 1 ||
      [...form.keys()].some((k) => !["photo", "expectedRevision"].includes(k))
    )
      throw new SpaceError("invalid_request", "Upload one photo at a time.");
    const file = form.get("photo");
    if (!(file instanceof File) || file.size > MAX_IMAGE_BYTES)
      throw new SpaceError(
        "invalid_request",
        "Each photo must be no larger than 12 MB.",
        413,
      );
    const rawRevision = z
      .string()
      .regex(/^\d+$/)
      .parse(form.get("expectedRevision"));
    return spaceJson(
      await uploadSpaceAsset(
        createSpaceDependencies(),
        (await context.params).spaceId,
        {
          expectedRevision: Number(rawRevision),
          filename: file.name,
          contentType: file.type,
          bytes: Buffer.from(await file.arrayBuffer()),
        },
      ),
    );
  });
}
