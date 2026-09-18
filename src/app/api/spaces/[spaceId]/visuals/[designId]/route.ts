import { renderVisualDesign } from "@/features/spaces/visual-application";
import { boundedJson, spaceHttp, spaceJson } from "@/features/spaces/http";
import { createVisualDependencies } from "@/features/spaces/runtime";
export const runtime = "nodejs";
export const maxDuration = 240;
export async function POST(
  request: Request,
  context: { params: Promise<{ spaceId: string; designId: string }> },
) {
  return spaceHttp(async () => {
    const input = await boundedJson(request);
    const { spaceId, designId } = await context.params;
    return spaceJson(
      await renderVisualDesign(
        createVisualDependencies(),
        spaceId,
        designId,
        input,
      ),
    );
  });
}
