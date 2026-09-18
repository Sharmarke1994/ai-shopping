import { describe, expect, it } from "vitest";
import {
  boundedBody,
  boundedJson,
  requireSameOrigin,
  requireLocalSpaceRequest,
  spaceHttp,
} from "./http";
import { SpaceError } from "./domain";

describe("spaces request boundary", () => {
  it("uses the actual local Host when Next rewrites its internal URL", () => {
    expect(() =>
      requireSameOrigin(
        new Request("http://localhost:3100/api/spaces", {
          headers: { host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100" },
        }),
      ),
    ).not.toThrow();
  });
  it("rejects non-local Host and does not trust forwarded host for reads or writes", () => {
    expect(() =>
      requireLocalSpaceRequest(
        new Request("http://localhost/api/spaces", {
          headers: { host: "evil.example", "x-forwarded-host": "localhost" },
        }),
      ),
    ).toThrow(/local founder/);
    expect(() =>
      requireSameOrigin(
        new Request("http://localhost/api/spaces", {
          headers: {
            host: "localhost",
            origin: "https://evil.example",
            "x-forwarded-host": "evil.example",
          },
        }),
      ),
    ).toThrow(/Cross-site/);
  });
  it("bounds declared and actual body sizes before parsing", async () => {
    await expect(
      boundedBody(
        new Request("http://localhost", {
          method: "POST",
          headers: { "Content-Length": "1000" },
          body: "x",
        }),
        10,
      ),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      boundedBody(
        new Request("http://localhost", {
          method: "POST",
          body: "x".repeat(11),
        }),
        10,
      ),
    ).rejects.toMatchObject({ status: 413 });
    expect(
      (
        await boundedBody(
          new Request("http://localhost", { method: "POST", body: "valid" }),
          10,
        )
      ).toString(),
    ).toBe("valid");
  });
  it.each(["https://evil.example", "null"])(
    "rejects cross-origin writes: %s",
    (origin) => {
      expect(() =>
        requireSameOrigin(
          new Request("http://localhost/api/spaces", { headers: { origin } }),
        ),
      ).toThrow(/Cross-site/);
    },
  );
  it("accepts a same-origin bounded JSON request", async () => {
    expect(
      await boundedJson(
        new Request("http://localhost/api/spaces", {
          method: "POST",
          headers: {
            origin: "http://localhost",
            "Content-Type": "application/json",
          },
          body: '{"name":"Bedroom"}',
        }),
      ),
    ).toEqual({ name: "Bedroom" });
  });
  it("does not leak filesystem paths or database details", async () => {
    const response = await spaceHttp(async () => {
      throw new Error("database-password /private/storage/location");
    });
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("returns a distinct recoverable CAS conflict", async () => {
    const response = await spaceHttp(async () => {
      throw new SpaceError("stale_revision", "Reload the latest room.", 409);
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("stale_revision");
  });
});
