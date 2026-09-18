import { readVisualImage } from "@/features/spaces/visual-application";
import { requireLocalSpaceRequest, spaceHttp } from "@/features/spaces/http";
import { createVisualDependencies } from "@/features/spaces/runtime";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ spaceId: string; designId: string }> },
) {
  return spaceHttp(async () => {
    requireLocalSpaceRequest(request);
    const { spaceId, designId } = await context.params;
    const bytes = await readVisualImage(
      createVisualDependencies(),
      spaceId,
      designId,
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  });
}
