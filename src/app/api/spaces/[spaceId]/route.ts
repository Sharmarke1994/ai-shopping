import { loadSpace, mutateSpace } from "@/features/spaces/application";
import {
  boundedJson,
  requireLocalSpaceRequest,
  spaceHttp,
  spaceJson,
} from "@/features/spaces/http";
import { createSpaceDependencies } from "@/features/spaces/runtime";
export const runtime = "nodejs";
type Context = { params: Promise<{ spaceId: string }> };
export async function GET(request: Request, context: Context) {
  return spaceHttp(async () => {
    requireLocalSpaceRequest(request);
    return spaceJson(
      await loadSpace(
        createSpaceDependencies(),
        (await context.params).spaceId,
      ),
    );
  });
}
export async function POST(request: Request, context: Context) {
  return spaceHttp(async () => {
    const input = await boundedJson(request);
    return spaceJson(
      await mutateSpace(
        createSpaceDependencies(),
        (await context.params).spaceId,
        input,
      ),
    );
  });
}
