import { createHash } from "node:crypto";
import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { z } from "zod";

export const PAGE_EXTRACTION_VERSION = "bounded-product-page-v1" as const;
// This is the temporary raw-input ceiling shared with the page transport
// budget. The extracted document is governed independently by the much
// smaller MAX_PAGE_RETAINED_DOCUMENT_BYTES below.
export const MAX_PAGE_TRANSPORT_BYTES = 2_500_000;
export const MAX_PAGE_HTML_BYTES = MAX_PAGE_TRANSPORT_BYTES;
export const MAX_PAGE_DOM_NODES = 20_000;
export const MAX_PAGE_DOM_DEPTH = 64;
export const MAX_PAGE_JSON_LD_BLOCKS = 12;
export const MAX_PAGE_JSON_LD_BYTES = 256_000;
export const MAX_PAGE_VISIBLE_TEXT_BYTES = 24_000;
// Leave enough headroom for PostgreSQL JSONB's normalized textual form while
// keeping the durable extracted document below the 40 KB database guard.
export const MAX_PAGE_RETAINED_DOCUMENT_BYTES = 36_000;
// Backwards-compatible name for callers/tests while the two-budget contract
// is made explicit above.
export const MAX_PAGE_DOCUMENT_BYTES = MAX_PAGE_RETAINED_DOCUMENT_BYTES;

const MAX_JSON_LD_BLOCK_BYTES = 64_000;
const MAX_JSON_LD_DEPTH = 16;
const MAX_JSON_LD_NODES = 1_000;
const MAX_JSON_LD_ARRAY_LENGTH = 64;
const MAX_JSON_LD_STRING_BYTES = 4_096;
const MAX_JSON_LD_PRODUCT_NODES = 6;
const MAX_PRODUCT_OFFERS = 8;
const MAX_HEADINGS = 32;
const MAX_SPECIFICATIONS = 64;
const MAX_ELEMENT_TEXT_NODES = 500;
const MAX_ELEMENT_TEXT_DEPTH = 24;

const hiddenSubtreeTags = new Set([
  "aside",
  "button",
  "canvas",
  "dialog",
  "footer",
  "form",
  "header",
  "menu",
  "nav",
  "noscript",
  "script",
  "style",
  "svg",
  "template",
]);

const pageMeasurementSchema = z.strictObject({
  value: z.string().min(1).max(240).nullable(),
  minValue: z.string().min(1).max(120).nullable(),
  maxValue: z.string().min(1).max(120).nullable(),
  unitText: z.string().min(1).max(80).nullable(),
  unitCode: z.string().min(1).max(80).nullable(),
});

const pageOfferSchema = z.strictObject({
  kind: z.enum(["offer", "aggregate_offer"]),
  url: z.url().nullable(),
  price: z.string().min(1).max(120).nullable(),
  lowPrice: z.string().min(1).max(120).nullable(),
  highPrice: z.string().min(1).max(120).nullable(),
  priceCurrency: z.string().min(1).max(12).nullable(),
  availability: z.string().min(1).max(240).nullable(),
  sellerName: z.string().min(1).max(240).nullable(),
  offerCount: z.number().int().nonnegative().safe().nullable(),
});

const pageAggregateRatingSchema = z.strictObject({
  ratingValue: z.string().min(1).max(120),
  reviewCount: z.number().int().nonnegative().safe().nullable(),
  ratingCount: z.number().int().nonnegative().safe().nullable(),
  bestRating: z.string().min(1).max(120).nullable(),
  worstRating: z.string().min(1).max(120).nullable(),
});

const pageJsonLdProductSchema = z.strictObject({
  jsonLdBlockIndex: z.number().int().nonnegative(),
  jsonLdNodeIndex: z.number().int().nonnegative(),
  name: z.string().min(1).max(300),
  description: z.string().min(1).max(1_000).nullable(),
  url: z.url().nullable(),
  brand: z.string().min(1).max(240).nullable(),
  model: z.string().min(1).max(240).nullable(),
  sku: z.string().min(1).max(240).nullable(),
  mpn: z.string().min(1).max(240).nullable(),
  width: pageMeasurementSchema.nullable(),
  height: pageMeasurementSchema.nullable(),
  depth: pageMeasurementSchema.nullable(),
  weight: pageMeasurementSchema.nullable(),
  offers: z.array(pageOfferSchema).max(MAX_PRODUCT_OFFERS),
  aggregateRating: pageAggregateRatingSchema.nullable(),
});

export const extractedProductPageDocumentV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  extractionVersion: z.literal(PAGE_EXTRACTION_VERSION),
  sourceUrl: z.url(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  title: z.string().min(1).max(500).nullable(),
  canonicalUrlCandidate: z.url().nullable(),
  metadata: z.strictObject({
    title: z.string().min(1).max(500).nullable(),
    description: z.string().min(1).max(1_000).nullable(),
    openGraphTitle: z.string().min(1).max(500).nullable(),
    openGraphDescription: z.string().min(1).max(1_000).nullable(),
  }),
  headings: z
    .array(
      z.strictObject({
        level: z.number().int().min(1).max(6),
        text: z.string().min(1).max(300),
      }),
    )
    .max(MAX_HEADINGS),
  specifications: z
    .array(
      z.strictObject({
        label: z.string().min(1).max(160),
        value: z.string().min(1).max(600),
      }),
    )
    .max(MAX_SPECIFICATIONS),
  visibleText: z.string().max(MAX_PAGE_VISIBLE_TEXT_BYTES),
  jsonLdProducts: z
    .array(pageJsonLdProductSchema)
    .max(MAX_JSON_LD_PRODUCT_NODES),
  truncated: z.strictObject({
    domTraversal: z.boolean(),
    jsonLd: z.boolean(),
    visibleText: z.boolean(),
    output: z.boolean(),
  }),
});

export type ExtractedProductPageDocumentV1 = z.infer<
  typeof extractedProductPageDocumentV1Schema
>;

export type PageExtractionErrorCode = "invalid_source_url" | "input_too_large";

export class PageExtractionError extends Error {
  readonly code: PageExtractionErrorCode;

  constructor(code: PageExtractionErrorCode, message: string) {
    super(message);
    this.name = "PageExtractionError";
    this.code = code;
  }
}

type Element = DefaultTreeAdapterTypes.Element;
type Node = DefaultTreeAdapterTypes.Node;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

type JsonRecord = Record<string, unknown>;

type MutableDocument = ExtractedProductPageDocumentV1;

class BoundedTextCollector {
  readonly chunks: string[] = [];
  bytes = 0;
  truncated = false;

  constructor(private readonly maxBytes: number) {}

  add(input: string): void {
    const normalized = normalizeWhitespace(input);
    if (!normalized) return;

    const separatorBytes = this.chunks.length === 0 ? 0 : 1;
    const remaining = this.maxBytes - this.bytes - separatorBytes;
    if (remaining <= 0) {
      this.truncated = true;
      return;
    }

    const bounded = truncateUtf8(normalized, remaining);
    if (!bounded) {
      this.truncated = true;
      return;
    }

    if (this.chunks.length > 0) this.bytes += 1;
    this.chunks.push(bounded);
    this.bytes += Buffer.byteLength(bounded, "utf8");
    if (bounded !== normalized) this.truncated = true;
  }

  value(): string {
    return this.chunks.join(" ");
  }
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[\s\u00A0]+/g, " ")
    .trim();
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;

  let bytes = 0;
  let result = "";
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > maxBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result.trimEnd();
}

function boundedText(value: unknown, maxBytes: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = normalizeWhitespace(String(value));
  if (!normalized) return null;
  return truncateUtf8(normalized, maxBytes) || null;
}

function attribute(element: Element, name: string): string | null {
  const expected = name.toLowerCase();
  const match = element.attrs.find(
    (candidate) => candidate.name.toLowerCase() === expected,
  );
  return match?.value ?? null;
}

function isElement(node: Node): node is Element {
  return "tagName" in node;
}

function isTextNode(node: Node): node is DefaultTreeAdapterTypes.TextNode {
  return node.nodeName === "#text";
}

function isHiddenElement(element: Element): boolean {
  if (attribute(element, "hidden") !== null) return true;
  if (attribute(element, "aria-hidden")?.trim().toLowerCase() === "true") {
    return true;
  }
  if (attribute(element, "role")?.trim().toLowerCase() === "navigation") {
    return true;
  }

  const style = attribute(element, "style")?.toLowerCase() ?? "";
  return (
    /(?:^|;)\s*display\s*:\s*none(?:\s*!important)?\s*(?:;|$)/.test(style) ||
    /(?:^|;)\s*visibility\s*:\s*hidden(?:\s*!important)?\s*(?:;|$)/.test(
      style,
    ) ||
    /(?:^|;)\s*content-visibility\s*:\s*hidden(?:\s*!important)?\s*(?:;|$)/.test(
      style,
    )
  );
}

function children(node: ParentNode): Node[] {
  return node.childNodes;
}

function boundedElementText(element: Element, maxBytes: number): string | null {
  const collector = new BoundedTextCollector(maxBytes);
  const stack: Array<{ node: Node; depth: number }> = children(element)
    .toReversed()
    .map((node) => ({ node, depth: 1 }));
  let visited = 0;

  while (stack.length > 0 && visited < MAX_ELEMENT_TEXT_NODES) {
    const current = stack.pop();
    if (!current) break;
    visited += 1;

    if (isTextNode(current.node)) {
      collector.add(current.node.value);
      continue;
    }
    if (
      !isElement(current.node) ||
      current.depth >= MAX_ELEMENT_TEXT_DEPTH ||
      hiddenSubtreeTags.has(current.node.tagName) ||
      isHiddenElement(current.node)
    ) {
      continue;
    }

    const descendants = children(current.node);
    for (let index = descendants.length - 1; index >= 0; index -= 1) {
      const child = descendants[index];
      if (child) stack.push({ node: child, depth: current.depth + 1 });
    }
  }

  return collector.value() || null;
}

function directChildElements(element: Element, tags: Set<string>): Element[] {
  return children(element).filter(
    (node): node is Element => isElement(node) && tags.has(node.tagName),
  );
}

function addSpecification(
  specifications: ExtractedProductPageDocumentV1["specifications"],
  labelInput: string | null,
  valueInput: string | null,
): void {
  if (specifications.length >= MAX_SPECIFICATIONS) return;
  const label = labelInput
    ? truncateUtf8(normalizeWhitespace(labelInput), 160)
    : "";
  const value = valueInput
    ? truncateUtf8(normalizeWhitespace(valueInput), 600)
    : "";
  if (!label || !value || label === value) return;
  if (
    specifications.some(
      (existing) => existing.label === label && existing.value === value,
    )
  ) {
    return;
  }
  specifications.push({ label, value });
}

function collectTableSpecification(
  row: Element,
  specifications: ExtractedProductPageDocumentV1["specifications"],
): void {
  const cells = directChildElements(row, new Set(["th", "td"])).slice(0, 9);
  if (cells.length < 2) return;
  addSpecification(
    specifications,
    boundedElementText(cells[0]!, 160),
    cells
      .slice(1)
      .map((cell) => boundedElementText(cell, 300))
      .filter((value): value is string => value !== null)
      .join(" "),
  );
}

function collectDescriptionListSpecifications(
  list: Element,
  specifications: ExtractedProductPageDocumentV1["specifications"],
): void {
  const entries = children(list)
    .filter(
      (node): node is Element =>
        isElement(node) && (node.tagName === "dt" || node.tagName === "dd"),
    )
    .slice(0, MAX_SPECIFICATIONS * 2);
  let label: string | null = null;
  let values: string[] = [];

  const flush = () => {
    addSpecification(specifications, label, values.join(" "));
    values = [];
  };

  for (const entry of entries) {
    if (entry.tagName === "dt") {
      flush();
      label = boundedElementText(entry, 160);
    } else if (label) {
      const value = boundedElementText(entry, 300);
      if (value) values.push(value);
    }
  }
  flush();
}

function resolveHttpUrl(value: unknown, baseUrl: URL): string | null {
  const text = boundedText(value, 2_048);
  if (!text) return null;
  try {
    const resolved = new URL(text, baseUrl);
    if (
      (resolved.protocol !== "http:" && resolved.protocol !== "https:") ||
      resolved.username ||
      resolved.password
    ) {
      return null;
    }
    resolved.hash = "";
    return resolved.href;
  } catch {
    return null;
  }
}

function sameOriginCanonical(value: string, sourceUrl: URL): string | null {
  const candidate = resolveHttpUrl(value, sourceUrl);
  if (!candidate) return null;
  const parsed = new URL(candidate);
  return parsed.origin === sourceUrl.origin ? parsed.href : null;
}

function jsonType(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((candidate) => {
    if (typeof candidate !== "string") return [];
    const normalized = candidate.split(/[\/#]/).at(-1)?.toLowerCase();
    return normalized ? [normalized] : [];
  });
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateJsonShape(
  value: unknown,
  state: { nodes: number },
  depth = 0,
): boolean {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_LD_NODES || depth > MAX_JSON_LD_DEPTH) {
    return false;
  }
  if (typeof value === "string") {
    return Buffer.byteLength(value, "utf8") <= MAX_JSON_LD_STRING_BYTES;
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return (
      value.length <= MAX_JSON_LD_ARRAY_LENGTH &&
      value.every((item) => validateJsonShape(item, state, depth + 1))
    );
  }
  if (!isJsonRecord(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= MAX_JSON_LD_ARRAY_LENGTH &&
    entries.every(
      ([key, nested]) =>
        Buffer.byteLength(key, "utf8") <= 240 &&
        validateJsonShape(nested, state, depth + 1),
    )
  );
}

function decimalText(value: unknown): string | null {
  const text = boundedText(value, 120);
  return text && /^-?\d+(?:\.\d+)?$/.test(text) ? text : null;
}

function nonnegativeInteger(value: unknown): number | null {
  const text = boundedText(value, 32);
  if (!text || !/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function entityName(value: unknown, expectedType?: string): string | null {
  if (typeof value === "string") return boundedText(value, 240);
  if (!isJsonRecord(value)) return null;
  if (expectedType && !jsonType(value["@type"]).includes(expectedType)) {
    return null;
  }
  return boundedText(value.name, 240);
}

function brandName(value: unknown): string | null {
  return typeof value === "string"
    ? boundedText(value, 240)
    : entityName(value, "brand");
}

function parseMeasurement(
  value: unknown,
): z.infer<typeof pageMeasurementSchema> | null {
  if (typeof value === "string" || typeof value === "number") {
    const scalar = boundedText(value, 240);
    return scalar
      ? {
          value: scalar,
          minValue: null,
          maxValue: null,
          unitText: null,
          unitCode: null,
        }
      : null;
  }
  if (
    !isJsonRecord(value) ||
    !jsonType(value["@type"]).includes("quantitativevalue")
  ) {
    return null;
  }
  const measurement = {
    value: boundedText(value.value, 240),
    minValue: decimalText(value.minValue),
    maxValue: decimalText(value.maxValue),
    unitText: boundedText(value.unitText, 80),
    unitCode: boundedText(value.unitCode, 80),
  };
  return Object.values(measurement).some((item) => item !== null)
    ? measurement
    : null;
}

function parseOffer(
  value: unknown,
  baseUrl: URL,
): z.infer<typeof pageOfferSchema> | null {
  if (!isJsonRecord(value)) return null;
  const types = jsonType(value["@type"]);
  const kind = types.includes("offer")
    ? ("offer" as const)
    : types.includes("aggregateoffer")
      ? ("aggregate_offer" as const)
      : null;
  if (!kind) return null;

  const offer = {
    kind,
    url: resolveHttpUrl(value.url, baseUrl),
    price: decimalText(value.price),
    lowPrice: decimalText(value.lowPrice),
    highPrice: decimalText(value.highPrice),
    priceCurrency: boundedText(value.priceCurrency, 12),
    availability: boundedText(value.availability, 240),
    sellerName: entityName(value.seller) ?? entityName(value.offeredBy) ?? null,
    offerCount: nonnegativeInteger(value.offerCount),
  };
  const hasCommercialValue =
    offer.url !== null ||
    offer.price !== null ||
    offer.lowPrice !== null ||
    offer.highPrice !== null ||
    offer.availability !== null;
  return hasCommercialValue ? offer : null;
}

function parseAggregateRating(
  value: unknown,
): z.infer<typeof pageAggregateRatingSchema> | null {
  if (
    !isJsonRecord(value) ||
    !jsonType(value["@type"]).includes("aggregaterating")
  ) {
    return null;
  }
  const ratingValue = decimalText(value.ratingValue);
  if (!ratingValue) return null;
  const reviewCount = nonnegativeInteger(value.reviewCount);
  const ratingCount = nonnegativeInteger(value.ratingCount);
  if (reviewCount === null && ratingCount === null) return null;
  return {
    ratingValue,
    reviewCount,
    ratingCount,
    bestRating: decimalText(value.bestRating),
    worstRating: decimalText(value.worstRating),
  };
}

function nestedValues(value: unknown): unknown[] {
  return Array.isArray(value) ? value.slice(0, MAX_PRODUCT_OFFERS) : [value];
}

function parseProduct(
  value: unknown,
  baseUrl: URL,
  jsonLdBlockIndex: number,
  jsonLdNodeIndex: number,
): z.infer<typeof pageJsonLdProductSchema> | null {
  if (!isJsonRecord(value) || !jsonType(value["@type"]).includes("product")) {
    return null;
  }
  const name = boundedText(value.name, 300);
  if (!name) return null;

  const offers = nestedValues(value.offers)
    .map((offer) => parseOffer(offer, baseUrl))
    .filter((offer): offer is z.infer<typeof pageOfferSchema> => offer !== null)
    .slice(0, MAX_PRODUCT_OFFERS);
  const product = {
    jsonLdBlockIndex,
    jsonLdNodeIndex,
    name,
    description: boundedText(value.description, 1_000),
    url: resolveHttpUrl(value.url, baseUrl),
    brand: brandName(value.brand),
    model: boundedText(value.model, 240),
    sku: boundedText(value.sku, 240),
    mpn: boundedText(value.mpn, 240),
    width: parseMeasurement(value.width),
    height: parseMeasurement(value.height),
    depth: parseMeasurement(value.depth),
    weight: parseMeasurement(value.weight),
    offers,
    aggregateRating: parseAggregateRating(value.aggregateRating),
  };

  const hasIdentityEvidence =
    product.url !== null ||
    product.brand !== null ||
    product.model !== null ||
    product.sku !== null ||
    product.mpn !== null ||
    product.offers.length > 0;
  return hasIdentityEvidence ? product : null;
}

function candidateJsonLdNodes(value: unknown): {
  nodes: unknown[];
  truncated: boolean;
} {
  const topLevel = Array.isArray(value) ? value : [value];
  const candidates: unknown[] = [];
  let truncated = false;
  for (const node of topLevel) {
    if (candidates.length >= MAX_JSON_LD_ARRAY_LENGTH) {
      truncated = true;
      break;
    }
    if (!isJsonRecord(node)) continue;
    candidates.push(node);
    if (Array.isArray(node["@graph"])) {
      for (const graphNode of node["@graph"]) {
        if (candidates.length >= MAX_JSON_LD_ARRAY_LENGTH) {
          truncated = true;
          break;
        }
        candidates.push(graphNode);
      }
    }
  }
  return { nodes: candidates, truncated };
}

function parseJsonLdBlock(
  raw: string,
  blockIndex: number,
  baseUrl: URL,
): {
  products: z.infer<typeof pageJsonLdProductSchema>[];
  boundedOut: boolean;
} {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return { products: [], boundedOut: false };
  }
  if (!validateJsonShape(value, { nodes: 0 })) {
    return { products: [], boundedOut: true };
  }

  const products: z.infer<typeof pageJsonLdProductSchema>[] = [];
  const candidates = candidateJsonLdNodes(value);
  let boundedOut = candidates.truncated;
  candidates.nodes.forEach((node, nodeIndex) => {
    if (products.length >= MAX_JSON_LD_PRODUCT_NODES) {
      if (isJsonRecord(node) && jsonType(node["@type"]).includes("product")) {
        boundedOut = true;
      }
      return;
    }
    if (
      isJsonRecord(node) &&
      Array.isArray(node.offers) &&
      node.offers.length > MAX_PRODUCT_OFFERS
    ) {
      boundedOut = true;
    }
    const product = parseProduct(node, baseUrl, blockIndex, nodeIndex);
    if (product) products.push(product);
  });
  return { products, boundedOut };
}

function scriptText(
  element: Element,
  maxBytes: number,
): { raw: string; truncated: boolean } {
  let raw = "";
  let bytes = 0;
  let truncated = false;
  for (const node of children(element)) {
    if (!isTextNode(node)) continue;
    const remaining = maxBytes - bytes;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const chunk = truncateUtf8(node.value, remaining);
    raw += chunk;
    bytes += Buffer.byteLength(chunk, "utf8");
    if (chunk !== node.value) {
      truncated = true;
      break;
    }
  }
  return { raw, truncated };
}

function validSourceUrl(sourceUrl: string): URL {
  try {
    const parsed = new URL(sourceUrl);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error("not an uncredentialed HTTP URL");
    }
    parsed.hash = "";
    return parsed;
  } catch {
    throw new PageExtractionError(
      "invalid_source_url",
      "Page extraction requires an uncredentialed HTTP(S) source URL.",
    );
  }
}

export function computePageContentHash(html: string): string {
  return createHash("sha256").update(html, "utf8").digest("hex");
}

export function computeExtractedPageDocumentHash(
  document: ExtractedProductPageDocumentV1,
): string {
  return createHash("sha256")
    .update(JSON.stringify(document), "utf8")
    .digest("hex");
}

export function pageExtractionIdentity(html: string): {
  extractionVersion: typeof PAGE_EXTRACTION_VERSION;
  contentHash: string;
} {
  return {
    extractionVersion: PAGE_EXTRACTION_VERSION,
    contentHash: computePageContentHash(html),
  };
}

export function extractProductPageDocument(input: {
  html: string;
  sourceUrl: string;
}): ExtractedProductPageDocumentV1 {
  const sourceUrl = validSourceUrl(input.sourceUrl);
  const inputBytes = Buffer.byteLength(input.html, "utf8");
  if (inputBytes > MAX_PAGE_HTML_BYTES) {
    throw new PageExtractionError(
      "input_too_large",
      `Page HTML exceeds the ${MAX_PAGE_HTML_BYTES}-byte extraction limit.`,
    );
  }

  const parsed = parse(input.html);
  const visibleText = new BoundedTextCollector(MAX_PAGE_VISIBLE_TEXT_BYTES);
  const headings: ExtractedProductPageDocumentV1["headings"] = [];
  const specifications: ExtractedProductPageDocumentV1["specifications"] = [];
  const jsonLdProducts: ExtractedProductPageDocumentV1["jsonLdProducts"] = [];
  const meta = new Map<string, string>();
  const stack: Array<{
    node: Node;
    depth: number;
    visible: boolean;
    inBody: boolean;
  }> = parsed.childNodes.toReversed().map((node) => ({
    node,
    depth: 0,
    visible: true,
    inBody: false,
  }));
  let visited = 0;
  let domTraversalTruncated = false;
  let jsonLdTruncated = false;
  let jsonLdBlockCount = 0;
  let jsonLdBytes = 0;
  let title: string | null = null;
  let canonicalUrlCandidate: string | null = null;

  while (stack.length > 0) {
    if (visited >= MAX_PAGE_DOM_NODES) {
      domTraversalTruncated = true;
      break;
    }
    const current = stack.pop();
    if (!current) break;
    visited += 1;

    if (isTextNode(current.node)) {
      if (current.visible && current.inBody) {
        visibleText.add(current.node.value);
      }
      continue;
    }
    if (!isElement(current.node)) continue;
    const element = current.node;
    const tag = element.tagName;
    const inBody = current.inBody || tag === "body";
    const hidden = isHiddenElement(element);
    const visible = current.visible && !hidden && !hiddenSubtreeTags.has(tag);

    if (tag === "title" && title === null) {
      title = boundedElementText(element, 500);
    } else if (tag === "meta") {
      const key = (
        attribute(element, "property") ?? attribute(element, "name")
      )?.toLowerCase();
      const content = boundedText(attribute(element, "content"), 1_000);
      if (key && content && !meta.has(key)) meta.set(key, content);
    } else if (tag === "link" && canonicalUrlCandidate === null) {
      const rel = attribute(element, "rel")
        ?.toLowerCase()
        .split(/\s+/)
        .includes("canonical");
      const href = attribute(element, "href");
      if (rel && href) {
        canonicalUrlCandidate = sameOriginCanonical(href, sourceUrl);
      }
    }

    if (
      tag === "script" &&
      attribute(element, "type")?.toLowerCase().split(";")[0]?.trim() ===
        "application/ld+json"
    ) {
      if (jsonLdBlockCount >= MAX_PAGE_JSON_LD_BLOCKS) {
        jsonLdTruncated = true;
      } else {
        const script = scriptText(element, MAX_JSON_LD_BLOCK_BYTES + 1);
        const rawBytes = Buffer.byteLength(script.raw, "utf8");
        if (
          script.truncated ||
          rawBytes > MAX_JSON_LD_BLOCK_BYTES ||
          jsonLdBytes + rawBytes > MAX_PAGE_JSON_LD_BYTES
        ) {
          jsonLdTruncated = true;
        } else {
          const parsedBlock = parseJsonLdBlock(
            script.raw,
            jsonLdBlockCount,
            sourceUrl,
          );
          if (parsedBlock.boundedOut) jsonLdTruncated = true;
          const remainingProducts =
            MAX_JSON_LD_PRODUCT_NODES - jsonLdProducts.length;
          if (parsedBlock.products.length > remainingProducts) {
            jsonLdTruncated = true;
          }
          jsonLdProducts.push(
            ...parsedBlock.products.slice(0, remainingProducts),
          );
          jsonLdBytes += rawBytes;
        }
        jsonLdBlockCount += 1;
      }
      continue;
    }

    if (visible && /^h[1-6]$/.test(tag) && headings.length < MAX_HEADINGS) {
      const headingText = boundedElementText(element, 300);
      const level = Number(tag.slice(1));
      if (
        headingText &&
        !headings.some(
          (heading) => heading.level === level && heading.text === headingText,
        )
      ) {
        headings.push({ level, text: headingText });
      }
    } else if (visible && tag === "tr") {
      collectTableSpecification(element, specifications);
    } else if (visible && tag === "dl") {
      collectDescriptionListSpecifications(element, specifications);
    }

    if (current.depth >= MAX_PAGE_DOM_DEPTH) {
      if (element.childNodes.length > 0) domTraversalTruncated = true;
      continue;
    }
    if (hiddenSubtreeTags.has(tag) || hidden) continue;

    const descendants = children(element);
    for (let index = descendants.length - 1; index >= 0; index -= 1) {
      const child = descendants[index];
      if (!child) continue;
      stack.push({
        node: child,
        depth: current.depth + 1,
        visible,
        inBody,
      });
    }
  }

  const document: MutableDocument = {
    schemaVersion: 1,
    extractionVersion: PAGE_EXTRACTION_VERSION,
    sourceUrl: sourceUrl.href,
    contentHash: computePageContentHash(input.html),
    title,
    canonicalUrlCandidate,
    metadata: {
      title: boundedText(meta.get("title"), 500),
      description: boundedText(meta.get("description"), 1_000),
      openGraphTitle: boundedText(meta.get("og:title"), 500),
      openGraphDescription: boundedText(meta.get("og:description"), 1_000),
    },
    headings,
    specifications,
    visibleText: visibleText.value(),
    jsonLdProducts,
    truncated: {
      domTraversal: domTraversalTruncated,
      jsonLd: jsonLdTruncated,
      visibleText: visibleText.truncated,
      output: false,
    },
  };

  while (
    Buffer.byteLength(JSON.stringify(document), "utf8") >
    MAX_PAGE_DOCUMENT_BYTES
  ) {
    document.truncated.output = true;
    if (document.visibleText.length > 0) {
      document.visibleText = truncateUtf8(
        document.visibleText,
        Math.floor(Buffer.byteLength(document.visibleText, "utf8") * 0.7),
      );
      document.truncated.visibleText = true;
    } else if (document.specifications.length > 0) {
      document.specifications.pop();
    } else if (document.headings.length > 0) {
      document.headings.pop();
    } else if (document.jsonLdProducts.length > 0) {
      document.jsonLdProducts.pop();
      document.truncated.jsonLd = true;
    } else {
      break;
    }
  }

  return extractedProductPageDocumentV1Schema.parse(document);
}
