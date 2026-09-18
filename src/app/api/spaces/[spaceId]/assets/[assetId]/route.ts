import { readSpaceAsset } from "@/features/spaces/application";
import { requireLocalSpaceRequest, spaceHttp } from "@/features/spaces/http";
import { createSpaceDependencies } from "@/features/spaces/runtime";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ spaceId: string; assetId: string }> },
) {
  return spaceHttp(async () => {
    requireLocalSpaceRequest(request);
    const { spaceId, assetId } = await context.params;
    const asset = await readSpaceAsset(
      createSpaceDependencies(),
      spaceId,
      assetId,
    );
    return new Response(new Uint8Array(asset.bytes), {
      headers: {
        "Content-Type": asset.contentType,
        "Content-Length": String(asset.bytes.length),
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cross-Origin-Resource-Policy": "same-origin",
        ETag: `"${asset.sha256}"`,
      },
    });
  });
}
