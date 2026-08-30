import { describe, expect, it, vi } from "vitest";
import {
  buildPinnedRequestOptions,
  fetchBoundedPage,
  isPublicPageAddress,
  PageFetchError,
  parsePageFetchUrl,
  requestWithPinnedAddress,
  validateAndResolvePageUrl,
  type PageDnsResolver,
  type PinnedPageRequester,
} from "./page-fetch";

async function withPinnedHttpServer<T>(
  listener: RequestListener,
  run: (options: { url: URL; sockets: ReadonlySet<Socket> }) => Promise<T>,
) {
  const server = createServer(listener);
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => undefined);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  try {
    return await run({
      url: new URL(`http://public.example:${port}/product`),
      sockets,
    });
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const publicResolver: PageDnsResolver = async () => [
  { address: "93.184.216.34", family: 4 },
];

function response(options?: {
  statusCode?: number;
  headers?: Record<string, string>;
  body?: string;
}) {
  return {
    statusCode: options?.statusCode ?? 200,
    headers: options?.headers ?? { "content-type": "text/html; charset=utf-8" },
    body: Buffer.from(
      options?.body ?? "<html><title>Exact product</title></html>",
    ),
  };
}

describe("bounded page URL security", () => {
  it.each([
    ["8.8.8.8", true],
    ["2606:4700:4700::1111", true],
    ["127.0.0.1", false],
    ["10.0.0.1", false],
    ["172.16.0.1", false],
    ["192.168.0.1", false],
    ["100.64.0.1", false],
    ["169.254.169.254", false],
    ["192.0.2.1", false],
    ["198.18.0.1", false],
    ["198.51.100.1", false],
    ["203.0.113.1", false],
    ["240.0.0.1", false],
    ["255.255.255.255", false],
    ["169.254.170.2", false],
    ["100.100.100.200", false],
    ["224.0.0.1", false],
    ["0.0.0.0", false],
    ["::1", false],
    ["fe80::1", false],
    ["fc00::1", false],
    ["2001:db8::1", false],
    ["::ffff:127.0.0.1", false],
    ["::ffff:169.254.169.254", false],
    ["64:ff9b::7f00:1", false],
    ["2002:7f00:1::", false],
    ["2001:0000:4136:e378:8000:63bf:3fff:fdd2", false],
  ])("classifies %s as public=%s", (address, expected) => {
    expect(isPublicPageAddress(address)).toBe(expected);
  });

  it.each([
    "file:///etc/passwd",
    "data:text/html,hello",
    "javascript:alert(1)",
    "ftp://example.com/product",
    "https://user:secret@example.com/product",
    "https://example.com:8443/product",
    "http://localhost/product",
    "http://sub.localhost/product",
    "http://metadata.google.internal/latest/meta-data",
    "http://intranet/product",
    "http://2130706433/product",
    "http://0177.0.0.1/product",
    "http://0x7f000001/product",
  ])("rejects unsafe URL %s", (url) => {
    expect(() => parsePageFetchUrl(url)).toThrow(PageFetchError);
  });

  it("rejects a DNS answer set containing any non-public address", async () => {
    await expect(
      validateAndResolvePageUrl({
        value: "https://example.com/product",
        resolver: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
      }),
    ).rejects.toMatchObject({ code: "unsafe_url" });
  });

  it("pins one validated address and revalidates every redirect host", async () => {
    const resolver = vi.fn<PageDnsResolver>(async (hostname) => [
      {
        address: hostname === "example.com" ? "93.184.216.34" : "142.250.74.14",
        family: 4,
      },
    ]);
    const calls: { host: string; address: string }[] = [];
    const requester: PinnedPageRequester = async ({ url, address }) => {
      calls.push({ host: url.hostname, address: address.address });
      return calls.length === 1
        ? response({
            statusCode: 302,
            headers: { location: "https://shop.example.org/product" },
          })
        : response();
    };
    const result = await fetchBoundedPage({
      url: "https://example.com/product#reviews",
      resolver,
      requester,
    });
    expect(result.finalUrl).toBe("https://shop.example.org/product");
    expect(result.redirectCount).toBe(1);
    expect(calls).toEqual([
      { host: "example.com", address: "93.184.216.34" },
      { host: "shop.example.org", address: "142.250.74.14" },
    ]);
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("builds a non-pooled request with defensive scalar and all-address lookup shapes", async () => {
    const requestOptions = buildPinnedRequestOptions({
      url: new URL("https://manufacturer.example/product?q=one"),
      address: { address: "93.184.216.34", family: 4 },
    });
    expect(requestOptions).toMatchObject({
      hostname: "manufacturer.example",
      port: 443,
      path: "/product?q=one",
      agent: false,
      autoSelectFamily: false,
      family: 4,
      servername: "manufacturer.example",
      headers: expect.objectContaining({
        Host: "manufacturer.example",
        "Accept-Encoding": "identity",
      }),
    });
    const lookup = requestOptions.lookup;
    expect(lookup).toBeTypeOf("function");
    if (lookup === undefined) throw new Error("Pinned lookup is missing");
    const scalar = await new Promise<{
      address: string;
      family: number;
    }>((resolve, reject) => {
      lookup("ignored.example", { all: false }, (error, address, family) => {
        if (error) reject(error);
        else resolve({ address: String(address), family: Number(family) });
      });
    });
    const all = await new Promise<unknown>((resolve, reject) => {
      lookup("ignored.example", { all: true }, (error, addresses) => {
        if (error) reject(error);
        else resolve(addresses);
      });
    });
    expect(scalar).toEqual({ address: "93.184.216.34", family: 4 });
    expect(all).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("blocks HTTPS to HTTP downgrade before following the destination", async () => {
    const requester = vi.fn<PinnedPageRequester>().mockResolvedValue(
      response({
        statusCode: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data" },
      }),
    );
    await expect(
      fetchBoundedPage({
        url: "https://example.com/product",
        resolver: publicResolver,
        requester,
      }),
    ).rejects.toMatchObject({ code: "redirect_invalid" });
    expect(requester).toHaveBeenCalledTimes(1);
  });

  it("blocks a private redirect target even from an initial public HTTP page", async () => {
    const requester = vi.fn<PinnedPageRequester>().mockResolvedValue(
      response({
        statusCode: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data" },
      }),
    );
    await expect(
      fetchBoundedPage({
        url: "http://example.com/product",
        resolver: publicResolver,
        requester,
      }),
    ).rejects.toMatchObject({ code: "unsafe_url" });
    expect(requester).toHaveBeenCalledTimes(1);
  });

  it("allows a public HTTP page to upgrade to HTTPS", async () => {
    const requester = vi.fn<PinnedPageRequester>();
    requester
      .mockResolvedValueOnce(
        response({
          statusCode: 301,
          headers: { location: "https://example.com/product" },
        }),
      )
      .mockResolvedValueOnce(response());
    await expect(
      fetchBoundedPage({
        url: "http://example.com/product",
        resolver: publicResolver,
        requester,
      }),
    ).resolves.toMatchObject({
      finalUrl: "https://example.com/product",
      redirectCount: 1,
    });
  });
});

describe("bounded page response policy", () => {
  it("accepts bounded identity-encoded HTML and hashes exact bytes", async () => {
    const result = await fetchBoundedPage({
      url: "https://example.com/product",
      resolver: publicResolver,
      requester: async () => response({ body: "<p>Caf\u00e9</p>" }),
      now: () => new Date("2026-08-29T12:00:00.000Z"),
    });
    expect(result).toMatchObject({
      requestedUrl: "https://example.com/product",
      finalUrl: "https://example.com/product",
      contentType: "text/html",
      redirectCount: 0,
      text: "<p>Caf\u00e9</p>",
      fetchedAt: new Date("2026-08-29T12:00:00.000Z"),
    });
    expect(result.responseHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.encodedBytes).toBe(Buffer.byteLength("<p>Caf\u00e9</p>"));
  });

  it.each([
    {
      expected: "unsupported_content_type",
      value: response({ headers: { "content-type": "application/pdf" } }),
    },
    {
      expected: "unsupported_content_encoding",
      value: response({
        headers: {
          "content-type": "text/html",
          "content-encoding": "gzip",
        },
      }),
    },
    {
      expected: "http_status",
      value: response({ statusCode: 403 }),
    },
  ])("rejects $expected responses", async ({ expected, value }) => {
    await expect(
      fetchBoundedPage({
        url: "https://example.com/product",
        resolver: publicResolver,
        requester: async () => value,
      }),
    ).rejects.toMatchObject({ code: expected });
  });

  it("enforces the body bound even with a custom requester", async () => {
    await expect(
      fetchBoundedPage({
        url: "https://example.com/product",
        resolver: publicResolver,
        requester: async () => response({ body: "x".repeat(2_048) }),
        maxBytes: 1_024,
      }),
    ).rejects.toMatchObject({ code: "response_too_large" });
  });

  it("accepts a measured modern page above the historical 1.5 MB transport budget", async () => {
    const body = `<html><head><title>Modern product</title></head><body><h1>Modern product</h1><script>${"x".repeat(1_600_000)}</script></body></html>`;
    const result = await fetchBoundedPage({
      url: "https://example.com/product",
      resolver: publicResolver,
      requester: async () => response({ body }),
    });
    expect(result.encodedBytes).toBe(Buffer.byteLength(body));
    expect(result.text).toBe(body);
  });

  it("enforces one total deadline across resolver and requester work", async () => {
    await expect(
      fetchBoundedPage({
        url: "https://example.com/product",
        resolver: async () => {
          await new Promise((resolve) => setTimeout(resolve, 110));
          return publicResolver("example.com");
        },
        requester: async () => response(),
        timeoutMs: 100,
      }),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("rejects redirects after the configured maximum", async () => {
    await expect(
      fetchBoundedPage({
        url: "https://example.com/product",
        resolver: publicResolver,
        requester: async () =>
          response({ statusCode: 302, headers: { location: "/next" } }),
        maxRedirects: 1,
      }),
    ).rejects.toMatchObject({ code: "redirect_limit" });
  });

  it("uses the pinned socket, original Host header and no pooled connection", async () => {
    const hosts: (string | undefined)[] = [];
    await withPinnedHttpServer(
      (request, response) => {
        hosts.push(request.headers.host);
        response.writeHead(200, {
          "content-type": "text/html",
        });
        response.end("<p>product</p>");
      },
      async ({ url, sockets }) => {
        const input = {
          url,
          address: { address: "127.0.0.1", family: 4 as const },
          timeoutMs: 1_000,
          maxBytes: 1_024,
        };
        await requestWithPinnedAddress(input);
        await requestWithPinnedAddress(input);
        expect(hosts).toEqual([url.host, url.host]);
        expect(sockets.size).toBe(2);
      },
    );
  });

  it("rejects a response that closes before its declared body completes", async () => {
    await withPinnedHttpServer(
      (_request, response) => {
        response.writeHead(200, {
          "content-type": "text/html",
          "content-length": "100",
        });
        response.write("short");
        response.socket?.destroy();
      },
      async ({ url }) => {
        await expect(
          requestWithPinnedAddress({
            url,
            address: { address: "127.0.0.1", family: 4 },
            timeoutMs: 1_000,
            maxBytes: 1_024,
          }),
        ).rejects.toMatchObject({ code: "network_failed" });
      },
    );
  });

  it("rejects declared and chunked response overflow in the native transport", async () => {
    await withPinnedHttpServer(
      (request, response) => {
        response.writeHead(200, {
          "content-type": "text/html",
          ...(request.url?.includes("declared")
            ? { "content-length": "2048" }
            : {}),
        });
        response.end("x".repeat(2_048));
      },
      async ({ url }) => {
        for (const path of ["/declared", "/chunked"]) {
          await expect(
            requestWithPinnedAddress({
              url: new URL(path, url),
              address: { address: "127.0.0.1", family: 4 },
              timeoutMs: 1_000,
              maxBytes: 1_024,
            }),
          ).rejects.toMatchObject({ code: "response_too_large" });
        }
      },
    );
  });

  it("destroys a native request at the bounded timeout", async () => {
    await withPinnedHttpServer(
      () => undefined,
      async ({ url }) => {
        await expect(
          requestWithPinnedAddress({
            url,
            address: { address: "127.0.0.1", family: 4 },
            timeoutMs: 100,
            maxBytes: 1_024,
          }),
        ).rejects.toMatchObject({ code: "timeout" });
      },
    );
  });
});
import { createServer, type RequestListener } from "node:http";
import type { AddressInfo, Socket } from "node:net";
