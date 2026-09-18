import { createSpace, listSpaces } from "@/features/spaces/application";
import {
  boundedJson,
  requireLocalSpaceRequest,
  spaceHttp,
  spaceJson,
} from "@/features/spaces/http";
import { createSpaceDependencies } from "@/features/spaces/runtime";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return spaceHttp(async () => {
    requireLocalSpaceRequest(request);
    return spaceJson({ spaces: await listSpaces(createSpaceDependencies()) });
  });
}
export async function POST(request: Request) {
  return spaceHttp(async () => {
    const input = await boundedJson(request);
    return spaceJson(await createSpace(createSpaceDependencies(), input), 201);
  });
}
