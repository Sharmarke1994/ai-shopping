import { z } from "zod";
import { evidenceSourceRoleSchema } from "./contracts";

const pageIdentityFieldSchema = z.enum([
  "discovered_title",
  "page_title",
  "open_graph_title",
  "product_name",
  "product_brand",
  "product_model",
  "product_sku",
  "product_mpn",
]);

const admittedIdentityEvidenceSchema = z.strictObject({
  matchedCandidateTokens: z.array(z.string().min(1).max(80)).min(2).max(20),
  matchedFields: z.array(pageIdentityFieldSchema).min(2).max(8),
  productName: z.string().min(1).max(300).nullable(),
  brand: z.string().min(1).max(240).nullable(),
  model: z.string().min(1).max(240).nullable(),
  sku: z.string().min(1).max(240).nullable(),
  mpn: z.string().min(1).max(240).nullable(),
  discoveredHost: z.string().min(1).max(253),
  finalHost: z.string().min(1).max(253),
});

export const pageEvidenceAdmissionV1Schema = z.discriminatedUnion("decision", [
  z.strictObject({
    schemaVersion: z.literal(1),
    decision: z.literal("admit"),
    admittedRole: z.enum([
      "retailer",
      "manufacturer",
      "independent_review",
      "retailer_review_aggregate",
    ]),
    reason: z.enum([
      "exact_page_identity",
      "exact_page_identity_with_manufacturer_promotion",
    ]),
    identityEvidence: admittedIdentityEvidenceSchema,
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    decision: z.literal("reject"),
    reason: z.enum([
      "invalid_url",
      "redirect_origin_mismatch",
      "search_or_category_page",
      "comparison_page",
      "generic_candidate_identity",
      "generic_page_identity",
      "wrong_model_or_variant",
      "wrong_category",
      "ambiguous_product_data",
      "merchant_context_mismatch",
      "unsupported_source_role",
    ]),
    detail: z.string().min(1).max(300),
  }),
]);

export type PageEvidenceAdmissionV1 = z.infer<
  typeof pageEvidenceAdmissionV1Schema
>;

export type ExtractedPageIdentityProduct = Readonly<{
  productName: string;
  brand: string | null;
  model: string | null;
  sku: string | null;
  mpn: string | null;
}>;

export type ExtractedPageIdentity = Readonly<{
  finalUrl: string;
  canonicalUrl: string | null;
  title: string | null;
  openGraphTitle: string | null;
  products: readonly ExtractedPageIdentityProduct[];
}>;

export type DiscoveredPageSource = Readonly<{
  sourceRole: z.infer<typeof evidenceSourceRoleSchema>;
  url: string;
  title: string;
}>;

const noiseTokens = new Set([
  "and",
  "buy",
  "for",
  "from",
  "new",
  "official",
  "online",
  "product",
  "review",
  "reviews",
  "specification",
  "specifications",
  "the",
  "with",
]);

const genericProductTokens = new Set([
  "automatic",
  "battery",
  "bluetooth",
  "cap",
  "caps",
  "chair",
  "chairs",
  "cleaner",
  "coffee",
  "computer",
  "cordless",
  "earphone",
  "earphones",
  "ergonomic",
  "espresso",
  "gaming",
  "hat",
  "headphone",
  "headphones",
  "headset",
  "machine",
  "mice",
  "mouse",
  "office",
  "optical",
  "rechargeable",
  "running",
  "shelf",
  "shelves",
  "shelving",
  "unit",
  "units",
  "vacuum",
  "vertical",
  "wired",
  "wireless",
]);

const explicitVariantTokens = new Set([
  "air",
  "lite",
  "max",
  "mini",
  "plus",
  "pro",
  "ultra",
]);

const categoryGroups = [
  new Set(["mouse", "mice"]),
  new Set(["chair", "chairs", "seat", "seating"]),
  new Set(["vacuum", "cleaner", "hoover"]),
  new Set(["coffee", "espresso"]),
  new Set(["headphone", "headphones", "headset", "earphone", "earphones"]),
  new Set(["cap", "caps", "hat", "hats"]),
  new Set(["shelf", "shelves", "shelving", "bookcase", "rack"]),
  new Set(["keyboard", "keyboards"]),
];

function tokens(value: string): readonly string[] {
  return value
    .toLocaleLowerCase("en-GB")
    .split(/[^a-z0-9]+/)
    .filter(
      (token) =>
        (token.length >= 2 || /^\d$/.test(token)) && !noiseTokens.has(token),
    );
}

function compact(value: string): string {
  return value.toLocaleLowerCase("en-GB").replace(/[^a-z0-9]/g, "");
}

function identityTokens(value: string): readonly string[] {
  return [
    ...new Set(
      tokens(value).filter((token) => !genericProductTokens.has(token)),
    ),
  ];
}

function modelTokens(value: string): readonly string[] {
  return identityTokens(value).filter(
    (token) =>
      /\d/.test(token) ||
      /^(?:ii|iii|iv|vi|vii|viii|ix|xi|xii)$/i.test(token) ||
      explicitVariantTokens.has(token),
  );
}

function hasSameExplicitModelTokens(
  candidateTokens: readonly string[],
  value: string,
): boolean {
  const candidateModels = new Set(
    candidateTokens.filter(
      (token) =>
        /\d/.test(token) ||
        /^(?:ii|iii|iv|vi|vii|viii|ix|xi|xii)$/i.test(token) ||
        explicitVariantTokens.has(token),
    ),
  );
  const valueModels = new Set(modelTokens(value));
  return (
    candidateModels.size === valueModels.size &&
    [...candidateModels].every((token) => valueModels.has(token))
  );
}

function categories(value: string): ReadonlySet<number> {
  const values = new Set(tokens(value));
  return new Set(
    categoryGroups.flatMap((group, index) =>
      [...group].some((token) => values.has(token)) ? [index] : [],
    ),
  );
}

function parsedUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function normalizedHost(url: URL): string {
  return url.hostname.toLocaleLowerCase("en-GB").replace(/^www\./, "");
}

function registrableLabel(url: URL): string {
  const labels = normalizedHost(url).split(".").filter(Boolean);
  const compoundCountrySuffix =
    labels.length >= 3 &&
    new Set(["ac", "co", "com", "net", "org"]).has(labels.at(-2) ?? "") &&
    (labels.at(-1)?.length ?? 0) === 2;
  return compact(labels.at(compoundCountrySuffix ? -3 : -2) ?? "");
}

function hostsCoherent(left: URL, right: URL): boolean {
  const leftHost = normalizedHost(left);
  const rightHost = normalizedHost(right);
  return (
    leftHost === rightHost ||
    leftHost.endsWith(`.${rightHost}`) ||
    rightHost.endsWith(`.${leftHost}`)
  );
}

function isSearchOrCategoryPage(url: URL): boolean {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return (
    path === "/" ||
    /(?:^|\/)(?:search|s|browse|category|categories|collection|collections|shop)(?:\/|$)/i.test(
      path,
    ) ||
    url.searchParams.has("q")
  );
}

function isComparisonPage(
  url: URL,
  ...titles: readonly (string | null)[]
): boolean {
  const host = normalizedHost(url);
  return (
    /(?:^|\.)(?:idealo|pricerunner|pricespy|e-catalog)\./i.test(host) ||
    /(?:^|\/)(?:compare|comparison|versus|vs)(?:\/|$)/i.test(url.pathname) ||
    titles.some(
      (title) => title !== null && /\b(?:vs|versus|compare)\b/i.test(title),
    )
  );
}

function reject(
  reason: Extract<PageEvidenceAdmissionV1, { decision: "reject" }>["reason"],
  detail: string,
): PageEvidenceAdmissionV1 {
  return pageEvidenceAdmissionV1Schema.parse({
    schemaVersion: 1,
    decision: "reject",
    reason,
    detail: detail.slice(0, 300),
  });
}

function exactIdentityMatch(
  candidateTokens: readonly string[],
  value: string,
  requireExactModelTokens = true,
): boolean {
  return (
    hasCandidateIdentityCoverage(candidateTokens, value) &&
    (!requireExactModelTokens ||
      hasSameExplicitModelTokens(candidateTokens, value))
  );
}

function hasCandidateIdentityCoverage(
  candidateTokens: readonly string[],
  value: string,
): boolean {
  const valueTokens = new Set(tokens(value));
  return candidateTokens.every((token) => valueTokens.has(token));
}

function hasDistinctiveCandidateIdentityOverlap(
  candidateTokens: readonly string[],
  value: string,
): boolean {
  const valueTokens = new Set(identityTokens(value));
  // Candidate titles are expected to lead with a brand. A fetched title may
  // legitimately omit that brand, but it must still share a more distinctive
  // model/family token before its variant vocabulary can contradict the offer.
  return candidateTokens.slice(1).some((token) => valueTokens.has(token));
}

function matchingFields(options: {
  candidateTokens: readonly string[];
  discoveredTitle: string;
  page: ExtractedPageIdentity;
  product: ExtractedPageIdentityProduct | null;
}): readonly z.infer<typeof pageIdentityFieldSchema>[] {
  const values: ReadonlyArray<
    readonly [z.infer<typeof pageIdentityFieldSchema>, string | null]
  > = [
    ["discovered_title", options.discoveredTitle],
    ["page_title", options.page.title],
    ["open_graph_title", options.page.openGraphTitle],
    ["product_name", options.product?.productName ?? null],
    ["product_brand", options.product?.brand ?? null],
    ["product_model", options.product?.model ?? null],
    ["product_sku", options.product?.sku ?? null],
    ["product_mpn", options.product?.mpn ?? null],
  ];
  return values.flatMap(([field, value]) =>
    value !== null &&
    options.candidateTokens.some((token) => new Set(tokens(value)).has(token))
      ? [field]
      : [],
  );
}

function productIdentityText(product: ExtractedPageIdentityProduct): string {
  return [
    product.productName,
    product.brand,
    product.model,
    product.sku,
    product.mpn,
  ]
    .filter((value): value is string => value !== null)
    .join(" ");
}

function productIdentityMatches(
  candidateTokens: readonly string[],
  product: ExtractedPageIdentityProduct,
): boolean {
  const nameAndModel = [product.productName, product.model]
    .filter((value): value is string => value !== null)
    .join(" ");
  return (
    hasSameExplicitModelTokens(candidateTokens, nameAndModel) &&
    exactIdentityMatch(candidateTokens, productIdentityText(product), false)
  );
}

function hasAmbiguousProductData(
  products: readonly ExtractedPageIdentityProduct[],
): boolean {
  const identityFields: ReadonlyArray<keyof ExtractedPageIdentityProduct> = [
    "productName",
    "brand",
    "model",
    "sku",
    "mpn",
  ];
  return identityFields.some((field) => {
    const values = new Set(
      products.flatMap((product) => {
        const value = product[field];
        return value === null ? [] : [compact(value)];
      }),
    );
    return values.size > 1;
  });
}

function candidateBrandPrefixes(candidateTitle: string): readonly string[] {
  const candidateTokens = tokens(candidateTitle);
  const categoryIndex = candidateTokens.findIndex((token) =>
    genericProductTokens.has(token),
  );
  const leading = (
    categoryIndex === -1
      ? candidateTokens
      : candidateTokens.slice(0, categoryIndex)
  )
    .filter((token) => !genericProductTokens.has(token))
    .slice(0, 3);
  return leading.map((_, index) =>
    compact(leading.slice(0, index + 1).join("")),
  );
}

function qualifiesForManufacturerPromotion(options: {
  candidateTitle: string;
  finalUrl: URL;
  product: ExtractedPageIdentityProduct | null;
}): boolean {
  const brand = options.product?.brand;
  if (brand === null || brand === undefined) return false;
  const brandKey = compact(brand);
  if (!candidateBrandPrefixes(options.candidateTitle).includes(brandKey))
    return false;
  const domainLabel = registrableLabel(options.finalUrl);
  if (!domainLabel.startsWith(brandKey)) return false;
  return new Set(["", "appliances", "clean", "home", "official", "store"]).has(
    domainLabel.slice(brandKey.length),
  );
}

function merchantMatchesHost(merchant: string | null, url: URL): boolean {
  if (merchant === null) return false;
  const merchantTokens = tokens(merchant).filter(
    (token) =>
      !new Set(["company", "limited", "partners", "retail"]).has(token),
  );
  const domainLabel = registrableLabel(url);
  if (merchantTokens.length === 1) {
    return domainLabel === compact(merchantTokens[0]!);
  }
  if (merchantTokens.length < 2) return false;
  const merchantKey = compact(merchantTokens.join(""));
  return (
    domainLabel === merchantKey ||
    merchantTokens.every((token) => domainLabel.includes(compact(token)))
  );
}

/**
 * Admits only a task-local exact-product page. This result is bounded evidence
 * for one candidate/source pair, never a global ProductIdentity assertion.
 */
export function admitFetchedPageEvidence(options: {
  candidateTitle: string;
  merchant: string | null;
  discovered: DiscoveredPageSource;
  page: ExtractedPageIdentity;
}): PageEvidenceAdmissionV1 {
  const discoveredUrl = parsedUrl(options.discovered.url);
  const finalUrl = parsedUrl(options.page.finalUrl);
  const canonicalUrl =
    options.page.canonicalUrl === null
      ? null
      : parsedUrl(options.page.canonicalUrl);
  if (
    discoveredUrl === null ||
    finalUrl === null ||
    (options.page.canonicalUrl !== null && canonicalUrl === null)
  ) {
    return reject(
      "invalid_url",
      "A discovered, final, or canonical URL is invalid",
    );
  }
  if (
    !hostsCoherent(discoveredUrl, finalUrl) ||
    (canonicalUrl !== null && !hostsCoherent(finalUrl, canonicalUrl))
  ) {
    return reject(
      "redirect_origin_mismatch",
      "The fetched or canonical page moved outside the discovered hostname context",
    );
  }
  for (const url of [discoveredUrl, finalUrl, canonicalUrl].filter(
    (value): value is URL => value !== null,
  )) {
    if (isSearchOrCategoryPage(url)) {
      return reject(
        "search_or_category_page",
        "The URL identifies a search, category, collection, shop, or home page",
      );
    }
    if (
      isComparisonPage(
        url,
        options.discovered.title,
        options.page.title,
        options.page.openGraphTitle,
      )
    ) {
      return reject(
        "comparison_page",
        "Comparison pages cannot establish one exact product identity",
      );
    }
  }
  if (
    options.discovered.sourceRole === "listing" ||
    options.discovered.sourceRole === "visual"
  ) {
    return reject(
      "unsupported_source_role",
      "Listing and visual records are not fetched-page source roles",
    );
  }

  const candidateIdentity = identityTokens(options.candidateTitle);
  if (candidateIdentity.length < 2) {
    return reject(
      "generic_candidate_identity",
      "The candidate title has too little distinctive identity for exact-page admission",
    );
  }
  const candidateModels = modelTokens(options.candidateTitle);
  const discoveredTokens = new Set(tokens(options.discovered.title));
  if (candidateModels.some((token) => !discoveredTokens.has(token))) {
    return reject(
      "wrong_model_or_variant",
      "The discovered result does not contain the candidate model or variant token",
    );
  }
  if (!exactIdentityMatch(candidateIdentity, options.discovered.title)) {
    return reject(
      candidateModels.length > 0 ||
        modelTokens(options.discovered.title).length > 0
        ? "wrong_model_or_variant"
        : "generic_page_identity",
      "The discovered result title does not bind the exact candidate identity",
    );
  }
  if (hasAmbiguousProductData(options.page.products)) {
    return reject(
      "ambiguous_product_data",
      "The page exposes multiple distinct Product identities",
    );
  }

  const candidateCategories = categories(options.candidateTitle);
  const pageIdentityTexts = [
    options.discovered.title,
    options.page.title,
    options.page.openGraphTitle,
    ...options.page.products.map(({ productName }) => productName),
  ].filter((value): value is string => value !== null);
  if (candidateCategories.size > 0) {
    for (const identityText of pageIdentityTexts) {
      const pageCategories = categories(identityText);
      if (
        pageCategories.size > 0 &&
        ![...candidateCategories].some((category) =>
          pageCategories.has(category),
        )
      ) {
        return reject(
          "wrong_category",
          "A fetched-page identity field identifies a different product category",
        );
      }
    }
  }

  const conflictingFetchedTitle = [
    options.page.title,
    options.page.openGraphTitle,
  ].find(
    (value) =>
      value !== null &&
      hasDistinctiveCandidateIdentityOverlap(candidateIdentity, value) &&
      !hasSameExplicitModelTokens(candidateIdentity, value),
  );
  if (conflictingFetchedTitle !== undefined) {
    return reject(
      "wrong_model_or_variant",
      "A fetched page title adds or changes an explicit product model or variant",
    );
  }

  const product =
    options.page.products.find((entry) =>
      productIdentityMatches(candidateIdentity, entry),
    ) ?? null;
  const pageTitleMatches = [
    options.page.title,
    options.page.openGraphTitle,
  ].some(
    (value) => value !== null && exactIdentityMatch(candidateIdentity, value),
  );
  if (options.page.products.length > 0 && product === null) {
    const productHasExplicitModel = options.page.products.some(
      (entry) =>
        modelTokens([entry.productName, entry.model].filter(Boolean).join(" "))
          .length > 0,
    );
    return reject(
      candidateModels.length > 0 || productHasExplicitModel
        ? "wrong_model_or_variant"
        : "generic_page_identity",
      "The page contains Product data, but it does not bind the exact candidate identity",
    );
  }
  if (product === null && !pageTitleMatches) {
    const pageTitleHasExplicitModel = [
      options.page.title,
      options.page.openGraphTitle,
    ].some((value) => value !== null && modelTokens(value).length > 0);
    return reject(
      candidateModels.length > 0 || pageTitleHasExplicitModel
        ? "wrong_model_or_variant"
        : "generic_page_identity",
      "Neither one extracted Product nor the page title binds the exact candidate identity",
    );
  }

  if (
    (options.discovered.sourceRole === "retailer" ||
      options.discovered.sourceRole === "retailer_review_aggregate") &&
    !merchantMatchesHost(options.merchant, finalUrl)
  ) {
    return reject(
      "merchant_context_mismatch",
      "A retailer page must remain in the candidate merchant hostname context",
    );
  }

  const promoteManufacturer =
    options.discovered.sourceRole === "other" &&
    qualifiesForManufacturerPromotion({
      candidateTitle: options.candidateTitle,
      finalUrl,
      product,
    });
  if (options.discovered.sourceRole === "other" && !promoteManufacturer) {
    return reject(
      "unsupported_source_role",
      "An unclassified page needs explicit brand and manufacturer-domain coherence",
    );
  }
  const admittedRole = promoteManufacturer
    ? ("manufacturer" as const)
    : options.discovered.sourceRole;
  const matchedFields = matchingFields({
    candidateTokens: candidateIdentity,
    discoveredTitle: options.discovered.title,
    page: options.page,
    product,
  });
  // The discovered title is one independent acquisition signal. Admission
  // needs at least one fetched-page signal in addition to it.
  if (
    !matchedFields.includes("discovered_title") ||
    matchedFields.every((field) => field === "discovered_title")
  ) {
    return reject(
      "generic_page_identity",
      "Exact identity is not independently present in the fetched page",
    );
  }

  return pageEvidenceAdmissionV1Schema.parse({
    schemaVersion: 1,
    decision: "admit",
    admittedRole,
    reason: promoteManufacturer
      ? "exact_page_identity_with_manufacturer_promotion"
      : "exact_page_identity",
    identityEvidence: {
      matchedCandidateTokens: candidateIdentity.slice(0, 20),
      matchedFields,
      productName: product?.productName ?? null,
      brand: product?.brand ?? null,
      model: product?.model ?? null,
      sku: product?.sku ?? null,
      mpn: product?.mpn ?? null,
      discoveredHost: normalizedHost(discoveredUrl),
      finalHost: normalizedHost(finalUrl),
    },
  });
}
