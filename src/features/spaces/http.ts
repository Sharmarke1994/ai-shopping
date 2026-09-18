import { ZodError } from "zod";
import { SpaceError } from "./domain";

export function spaceJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export async function spaceHttp(action: () => Promise<Response>) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof SpaceError)
      return spaceJson(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    if (
      error instanceof ZodError ||
      error instanceof SyntaxError ||
      error instanceof TypeError
    )
      return spaceJson(
        {
          error: {
            code: "invalid_request",
            message:
              "That room request is not valid. Check the fields and try again.",
          },
        },
        400,
      );
    return spaceJson(
      {
        error: {
          code: "unavailable",
          message:
            "The room could not be loaded or saved. Your last saved revision is unchanged. Try again.",
        },
      },
      503,
    );
  }
}
export function requireSameOrigin(request: Request) {
  const expected = requireLocalSpaceRequest(request);
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if ((origin && origin !== expected.origin) || site === "cross-site")
    throw new SpaceError(
      "invalid_request",
      "Cross-site room requests are not allowed.",
      403,
    );
}

export function requireLocalSpaceRequest(request: Request) {
  // Next's internal request URL can use its bind hostname instead of the browser
  // hostname. The HTTP Host header identifies this request; forwarded headers do not.
  const expected = new URL(request.url);
  const host = request.headers.get("host");
  if (host) {
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host))
      throw new SpaceError(
        "invalid_request",
        "Spaces are available on this local founder instance only.",
        403,
      );
    expected.host = host;
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(expected.hostname))
    throw new SpaceError(
      "invalid_request",
      "Spaces are available on this local founder instance only.",
      403,
    );
  return expected;
}
export async function boundedBody(request: Request, maxBytes: number) {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes))
    throw new SpaceError(
      "invalid_request",
      "Upload or request is too large.",
      413,
    );
  if (!request.body)
    throw new SpaceError("invalid_request", "Request body is missing.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new SpaceError(
          "invalid_request",
          "Upload or request is too large.",
          413,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
export async function boundedJson(request: Request) {
  requireSameOrigin(request);
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim() !==
    "application/json"
  )
    throw new SpaceError("invalid_request", "Expected a JSON room request.");
  return JSON.parse(
    (await boundedBody(request, 128 * 1024)).toString("utf8"),
  ) as unknown;
}
