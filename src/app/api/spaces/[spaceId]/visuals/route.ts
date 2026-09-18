import {
  listVisualDesigns,
  saveVisualDesign,
} from "@/features/spaces/visual-application";
import {
  boundedJson,
  requireLocalSpaceRequest,
  spaceHttp,
  spaceJson,
} from "@/features/spaces/http";
import { createVisualDependencies } from "@/features/spaces/runtime";
export const runtime = "nodejs";
type Context = { params: Promise<{ spaceId: string }> };
export async function GET(request: Request, context: Context) {
  return spaceHttp(async () => {
    requireLocalSpaceRequest(request);
    return spaceJson(
      await listVisualDesigns(
        createVisualDependencies(),
        (await context.params).spaceId,
      ),
    );
  });
}
export async function POST(request: Request, context: Context) {
  return spaceHttp(async () => {
    const input = await boundedJson(request);
    return spaceJson(
      await saveVisualDesign(
        createVisualDependencies(),
        (await context.params).spaceId,
        input,
      ),
      201,
    );
  });
}
