import { createHash } from "node:crypto";
import { promises as dns } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { z } from "zod";

export const PAGE_FETCH_POLICY_VERSION = "bounded-page-fetch-v1";
export const DEFAULT_PAGE_FETCH_TIMEOUT_MS = 8_000;
export const DEFAULT_PAGE_FETCH_MAX_BYTES = 1_500_000;
export const DEFAULT_PAGE_FETCH_MAX_REDIRECTS = 3;

const pageFetchFailureCodeSchema = z.enum([
  "unsafe_url",
  "dns_failed",
  "network_failed",
  "timeout",
  "redirect_invalid",
  "redirect_limit",
  "http_status",
  "unsupported_content_type",
  "unsupported_content_encoding",
  "response_too_large",
  "invalid_text",
]);

export type PageFetchFailureCode = z.infer<typeof pageFetchFailureCodeSchema>;

export class PageFetchError extends Error {
  readonly code: PageFetchFailureCode;

  constructor(code: PageFetchFailureCode, message: string) {
    super(message);
    this.name = "PageFetchError";
    this.code = pageFetchFailureCodeSchema.parse(code);
  }
}

const resolvedAddressSchema = z.strictObject({
  address: z.string().min(1).max(80),
  family: z.union([z.literal(4), z.literal(6)]),
});

export type ResolvedPageAddress = z.infer<typeof resolvedAddressSchema>;

export type PageDnsResolver = (
  hostname: string,
) => Promise<readonly ResolvedPageAddress[]>;

type RawPageResponse = Readonly<{
  statusCode: number;
  headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  body: Uint8Array;
}>;

export type PinnedPageRequester = (options: {
  url: URL;
  address: ResolvedPageAddress;
  timeoutMs: number;
  maxBytes: number;
}) => Promise<RawPageResponse>;

export type BoundedPageFetch = Readonly<{
  requestedUrl: string;
  finalUrl: string;
  contentType: "text/html" | "application/xhtml+xml" | "text/plain";
  text: string;
  encodedBytes: number;
  decodedBytes: number;
  redirectCount: number;
  fetchedAt: Date;
  responseHash: string;
}>;

function normalizeHostname(hostname: string) {
  return hostname.toLocaleLowerCase("en-GB").replace(/\.$/, "");
}

function unsafeHostname(hostname: string) {
  const normalized = normalizeHostname(hostname);
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "metadata.google.internal" ||
    normalized.endsWith(".metadata.google.internal") ||
    (isIP(normalized) === 0 && !normalized.includes("."))
  );
}

export function isPublicPageAddress(address: string) {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.process(address);
  return parsed.range() === "unicast";
}

export function parsePageFetchUrl(value: string | URL) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PageFetchError("unsafe_url", "Page URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PageFetchError(
      "unsafe_url",
      "Only public HTTP(S) pages may be fetched",
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new PageFetchError(
      "unsafe_url",
      "Credential-bearing page URLs are not allowed",
    );
  }
  if (url.port !== "") {
    throw new PageFetchError(
      "unsafe_url",
      "Non-default page ports are not allowed",
    );
  }
  if (unsafeHostname(url.hostname)) {
    throw new PageFetchError("unsafe_url", "Local page hosts are not allowed");
  }
  const literalAddress = normalizeHostname(url.hostname);
  if (isIP(literalAddress) !== 0 && !isPublicPageAddress(literalAddress)) {
    throw new PageFetchError(
      "unsafe_url",
      "Non-public page addresses are not allowed",
    );
  }
  url.hash = "";
  return url;
}

export const resolvePublicPageAddress: PageDnsResolver = async (hostname) => {
  const normalized = normalizeHostname(hostname);
  if (isIP(normalized) !== 0) {
    return [
      resolvedAddressSchema.parse({
        address: normalized,
        family: isIP(normalized),
      }),
    ];
  }
  try {
    return (await dns.lookup(normalized, { all: true, verbatim: true })).map(
      (entry) => resolvedAddressSchema.parse(entry),
    );
  } catch {
    throw new PageFetchError("dns_failed", "Page host could not be resolved");
  }
};

export async function validateAndResolvePageUrl(options: {
  value: string | URL;
  resolver?: PageDnsResolver;
}) {
  const url = parsePageFetchUrl(options.value);
  const resolver = options.resolver ?? resolvePublicPageAddress;
  let addresses: readonly ResolvedPageAddress[];
  const normalizedHostname = normalizeHostname(url.hostname);
  if (isIP(normalizedHostname) !== 0) {
    addresses = [
      resolvedAddressSchema.parse({
        address: normalizedHostname,
        family: isIP(normalizedHostname),
      }),
    ];
  } else {
    try {
      addresses = (await resolver(normalizedHostname)).map((entry) =>
        resolvedAddressSchema.parse(entry),
      );
    } catch (error) {
      if (error instanceof PageFetchError) throw error;
      throw new PageFetchError("dns_failed", "Page host could not be resolved");
    }
  }
  if (addresses.length === 0) {
    throw new PageFetchError("dns_failed", "Page host returned no addresses");
  }
  if (addresses.some(({ address }) => !isPublicPageAddress(address))) {
    throw new PageFetchError(
      "unsafe_url",
      "Page host resolved to a non-public address",
    );
  }
  const address = [...addresses].sort(
    (left, right) =>
      left.family - right.family || left.address.localeCompare(right.address),
  )[0];
  if (address === undefined) {
    throw new PageFetchError("dns_failed", "Page host returned no addresses");
  }
  return { url, address } as const;
}

function headerValue(
  headers: RawPageResponse["headers"],
  name: string,
): string | null {
  const value = headers[name.toLocaleLowerCase("en-GB")];
  if (typeof value === "string") return value;
  if (value === undefined) return null;
  return value[0] ?? null;
}

export function buildPinnedRequestOptions(options: {
  url: URL;
  address: ResolvedPageAddress;
}) {
  const lookup: LookupFunction = (_hostname, lookupOptions, callback) => {
    if (lookupOptions.all) {
      callback(null, [options.address]);
    } else {
      callback(null, options.address.address, options.address.family);
    }
  };
  return {
    protocol: options.url.protocol,
    hostname: options.url.hostname,
    port:
      options.url.port === ""
        ? options.url.protocol === "https:"
          ? 443
          : 80
        : Number(options.url.port),
    method: "GET",
    path: `${options.url.pathname}${options.url.search}`,
    agent: false,
    autoSelectFamily: false,
    family: options.address.family,
    headers: {
      Accept: "text/html,application/xhtml+xml,text/plain;q=0.5",
      "Accept-Encoding": "identity",
      "Accept-Language": "en-GB,en;q=0.8",
      "Cache-Control": "no-cache",
      Host: options.url.host,
      "User-Agent": "ConsiderEvidenceFetcher/1.0",
    },
    lookup,
    ...(options.url.protocol === "https:" && isIP(options.url.hostname) === 0
      ? { servername: options.url.hostname }
      : {}),
  } as http.RequestOptions & { autoSelectFamily: false };
}

export function requestWithPinnedAddress(options: {
  url: URL;
  address: ResolvedPageAddress;
  timeoutMs: number;
  maxBytes: number;
}): Promise<RawPageResponse> {
  return new Promise((resolve, reject) => {
    const requestModule = options.url.protocol === "https:" ? https : http;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
    };
    const fail = (
      error: PageFetchError,
      destroy?: { destroy(error?: Error): void },
    ) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
      destroy?.destroy();
    };
    const succeed = (value: RawPageResponse) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const requestOptions = buildPinnedRequestOptions(options);
    const request = requestModule.request(requestOptions, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const declaredLength = Number(response.headers["content-length"]);
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > options.maxBytes
      ) {
        fail(
          new PageFetchError(
            "response_too_large",
            "Page response exceeded the byte limit",
          ),
          response,
        );
        return;
      }
      response.on("data", (chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.byteLength;
        if (size > options.maxBytes) {
          fail(
            new PageFetchError(
              "response_too_large",
              "Page response exceeded the byte limit",
            ),
            response,
          );
          return;
        }
        chunks.push(bytes);
      });
      response.on("end", () => {
        if (settled) return;
        if (!response.complete) {
          fail(
            new PageFetchError(
              "network_failed",
              "Page response ended before it was complete",
            ),
            response,
          );
          return;
        }
        succeed({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks, size),
        });
      });
      response.on("aborted", () => {
        fail(
          new PageFetchError("network_failed", "Page response was aborted"),
          response,
        );
      });
      response.on("close", () => {
        if (!settled && !response.complete) {
          fail(
            new PageFetchError(
              "network_failed",
              "Page response closed before completion",
            ),
            response,
          );
        }
      });
      response.on("error", () => {
        fail(
          new PageFetchError("network_failed", "Page response failed"),
          response,
        );
      });
    });
    const timeout = setTimeout(() => {
      fail(new PageFetchError("timeout", "Page request timed out"), request);
    }, options.timeoutMs);
    timeout.unref();
    request.on("error", () => {
      fail(
        new PageFetchError("network_failed", "Page request failed"),
        request,
      );
    });
    request.on("close", cleanup);
    request.end();
  });
}

function parseContentType(value: string | null) {
  if (value === null) {
    throw new PageFetchError(
      "unsupported_content_type",
      "Page response did not declare a content type",
    );
  }
  const [mediaType, ...parameters] = value
    .split(";")
    .map((part) => part.trim().toLocaleLowerCase("en-GB"));
  if (
    mediaType !== "text/html" &&
    mediaType !== "application/xhtml+xml" &&
    mediaType !== "text/plain"
  ) {
    throw new PageFetchError(
      "unsupported_content_type",
      "Page response is not supported textual web content",
    );
  }
  const charset = parameters
    .find((part) => part.startsWith("charset="))
    ?.slice("charset=".length)
    .replace(/^['"]|['"]$/g, "");
  if (
    charset !== undefined &&
    !["utf-8", "utf8", "us-ascii", "iso-8859-1", "windows-1252"].includes(
      charset,
    )
  ) {
    throw new PageFetchError(
      "unsupported_content_type",
      "Page character encoding is not supported",
    );
  }
  return {
    mediaType,
    decoderLabel:
      charset === undefined || charset === "utf8" ? "utf-8" : charset,
  } as const;
}

const redirectStatusCodes = new Set([301, 302, 303, 307, 308]);

async function beforeDeadline<T>(promise: Promise<T>, remainingMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new PageFetchError("timeout", "Page request timed out"));
    }, remainingMs);
    timeout.unref();
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export async function fetchBoundedPage(options: {
  url: string;
  resolver?: PageDnsResolver;
  requester?: PinnedPageRequester;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  now?: () => Date;
}): Promise<BoundedPageFetch> {
  const timeoutMs = z
    .number()
    .int()
    .min(100)
    .max(15_000)
    .parse(options.timeoutMs ?? DEFAULT_PAGE_FETCH_TIMEOUT_MS);
  const maxBytes = z
    .number()
    .int()
    .min(1_024)
    .max(2_000_000)
    .parse(options.maxBytes ?? DEFAULT_PAGE_FETCH_MAX_BYTES);
  const maxRedirects = z
    .number()
    .int()
    .min(0)
    .max(5)
    .parse(options.maxRedirects ?? DEFAULT_PAGE_FETCH_MAX_REDIRECTS);
  const resolver = options.resolver ?? resolvePublicPageAddress;
  const requester = options.requester ?? requestWithPinnedAddress;
  const startedAt = Date.now();
  const requestedUrl = parsePageFetchUrl(options.url).toString();
  let current = requestedUrl;

  for (let redirectCount = 0; ; redirectCount += 1) {
    const remaining = timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) {
      throw new PageFetchError("timeout", "Page request timed out");
    }
    const target = await beforeDeadline(
      validateAndResolvePageUrl({ value: current, resolver }),
      remaining,
    );
    const requestRemaining = timeoutMs - (Date.now() - startedAt);
    if (requestRemaining <= 0) {
      throw new PageFetchError("timeout", "Page request timed out");
    }
    let response: RawPageResponse;
    try {
      response = await beforeDeadline(
        requester({
          url: target.url,
          address: target.address,
          timeoutMs: requestRemaining,
          maxBytes,
        }),
        requestRemaining,
      );
    } catch (error) {
      if (error instanceof PageFetchError) throw error;
      throw new PageFetchError("network_failed", "Page request failed");
    }
    if (response.body.byteLength > maxBytes) {
      throw new PageFetchError(
        "response_too_large",
        "Page response exceeded the byte limit",
      );
    }
    if (redirectStatusCodes.has(response.statusCode)) {
      if (redirectCount >= maxRedirects) {
        throw new PageFetchError(
          "redirect_limit",
          "Page redirect limit was exceeded",
        );
      }
      const location = headerValue(response.headers, "location");
      if (location === null) {
        throw new PageFetchError(
          "redirect_invalid",
          "Page redirect did not include a destination",
        );
      }
      try {
        const redirect = new URL(location, target.url);
        if (target.url.protocol === "https:" && redirect.protocol === "http:") {
          throw new PageFetchError(
            "redirect_invalid",
            "HTTPS page redirects may not downgrade to HTTP",
          );
        }
        current = redirect.toString();
      } catch {
        if (target.url.protocol === "https:" && /^http:/i.test(location)) {
          throw new PageFetchError(
            "redirect_invalid",
            "HTTPS page redirects may not downgrade to HTTP",
          );
        }
        throw new PageFetchError(
          "redirect_invalid",
          "Page redirect destination is invalid",
        );
      }
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new PageFetchError(
        "http_status",
        `Page request returned HTTP ${response.statusCode}`,
      );
    }
    const contentEncoding = headerValue(
      response.headers,
      "content-encoding",
    )?.toLocaleLowerCase("en-GB");
    if (
      contentEncoding !== undefined &&
      contentEncoding !== null &&
      contentEncoding !== "" &&
      contentEncoding !== "identity"
    ) {
      throw new PageFetchError(
        "unsupported_content_encoding",
        "Compressed page responses are not accepted",
      );
    }
    const { mediaType, decoderLabel } = parseContentType(
      headerValue(response.headers, "content-type"),
    );
    let text: string;
    try {
      text = new TextDecoder(decoderLabel, { fatal: true }).decode(
        response.body,
      );
    } catch {
      throw new PageFetchError(
        "invalid_text",
        "Page text could not be decoded",
      );
    }
    if (text.trim().length === 0) {
      throw new PageFetchError("invalid_text", "Page response was empty");
    }
    const bytes = response.body.byteLength;
    return {
      requestedUrl,
      finalUrl: target.url.toString(),
      contentType: mediaType,
      text,
      encodedBytes: bytes,
      decodedBytes: bytes,
      redirectCount,
      fetchedAt: options.now?.() ?? new Date(),
      responseHash: createHash("sha256").update(response.body).digest("hex"),
    };
  }
}
