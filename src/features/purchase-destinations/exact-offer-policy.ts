import type { z } from "zod";
import { merchantDestinationRejectionCodeSchema } from "./contracts";

type RejectionCode = z.infer<typeof merchantDestinationRejectionCodeSchema>;

export type ExactOfferDestinationDecision =
  | Readonly<{ accepted: true; destinationUrl: string }>
  | Readonly<{ accepted: false; rejectionCode: RejectionCode }>;

const merchantNoise = new Set([
  "co",
  "com",
  "limited",
  "ltd",
  "marketplace",
  "official",
  "outlet",
  "plc",
  "seller",
  "shop",
  "shopping",
  "store",
  "uk",
]);

const titleDecoration = new Set([
  "at",
  "buy",
  "direct",
  "from",
  "official",
  "online",
  "order",
  "shop",
  "store",
]);

const comparisonOrContentHosts = new Set([
  "idealo.co.uk",
  "kelkoo.co.uk",
  "pinterest.com",
  "pricespy.co.uk",
  "pricerunner.com",
  "testmarket.io",
  "trustpilot.com",
  "youtube.com",
]);

const nonProductPathSegments = new Set([
  "article",
  "articles",
  "blog",
  "blogs",
  "browse",
  "categories",
  "category",
  "guide",
  "guides",
  "help",
  "manual",
  "manuals",
  "news",
  "review",
  "reviews",
  "search",
  "support",
]);

function tokens(value: string): string[] {
  return (
    value
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLocaleLowerCase("en-GB")
      .match(/[a-z0-9]+/g) ?? []
  );
}

function registrableBrandLabel(hostname: string) {
  const labels = hostname
    .toLocaleLowerCase("en-GB")
    .replace(/\.+$/, "")
    .split(".")
    .filter(Boolean);
  if (labels.length < 2) return labels[0] ?? "";
  const last = labels.at(-1)!;
  const second = labels.at(-2)!;
  const commonSecondLevel = new Set(["ac", "co", "com", "gov", "net", "org"]);
  const brandIndex =
    last.length === 2 && commonSecondLevel.has(second) ? -3 : -2;
  return labels.at(brandIndex) ?? "";
}

function compact(value: string) {
  return value.replace(/[^a-z0-9]/g, "");
}

function hasContiguousCompactName(values: readonly string[], target: string) {
  for (let start = 0; start < values.length; start += 1) {
    let combined = "";
    for (let index = start; index < values.length; index += 1) {
      combined += values[index];
      if (
        combined === target ||
        combined.replaceAll("and", "") === target.replaceAll("and", "")
      ) {
        return true;
      }
      if (combined.length > target.length + 3) break;
    }
  }
  return false;
}

export function isGoogleOwnedUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLocaleLowerCase("en-GB");
    const brand = registrableBrandLabel(hostname);
    return (
      brand === "google" ||
      brand === "googleusercontent" ||
      hostname === "g.co" ||
      hostname.endsWith(".g.co") ||
      hostname === "goo.gl" ||
      hostname.endsWith(".goo.gl")
    );
  } catch {
    return false;
  }
}

export function observedMerchantDestinationUrl(rawUrl: string) {
  return isGoogleOwnedUrl(rawUrl) ? null : rawUrl;
}

export function isGoogleShoppingFallbackUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      isGoogleOwnedUrl(url.toString())
    );
  } catch {
    return false;
  }
}

export function buildExactOfferMerchantQuery(options: {
  title: string;
  merchant: string;
}) {
  const title = options.title.replaceAll('"', "").trim().slice(0, 240);
  const merchant = options.merchant.trim().slice(0, 120);
  return `"${title}" ${merchant}`;
}

function merchantMatchesHostname(merchant: string, hostname: string) {
  const brand = compact(registrableBrandLabel(hostname));
  if (brand.length < 2) return false;
  const identityTokens = tokens(merchant).filter(
    (token) => !merchantNoise.has(token),
  );
  if (identityTokens.length === 0) return false;
  const joined = identityTokens.join("");
  const brandWithoutAnd = brand.replaceAll("and", "");
  const joinedWithoutAnd = joined.replaceAll("and", "");
  return (
    brand === joined ||
    brandWithoutAnd === joinedWithoutAnd ||
    hasContiguousCompactName(identityTokens, brand) ||
    identityTokens.some((token) => token.length >= 2 && token === brand)
  );
}

function merchantBrandAppearsInCandidateTitle(options: {
  merchant: string;
  hostname: string;
  candidateTitle: string;
}) {
  const brand = compact(registrableBrandLabel(options.hostname));
  if (brand.length < 2) return false;
  const candidateTokens = tokens(options.candidateTitle);
  const merchantTokens = tokens(options.merchant).filter(
    (token) => !merchantNoise.has(token),
  );
  return (
    hasContiguousCompactName(candidateTokens, brand) &&
    merchantTokens.some((token) => candidateTokens.includes(token))
  );
}

function identityTokens(title: string, merchant: string) {
  const merchantTokens = new Set(tokens(merchant));
  return tokens(title).filter(
    (token) =>
      !titleDecoration.has(token) &&
      !merchantNoise.has(token) &&
      !merchantTokens.has(token),
  );
}

function sortedTokens(values: readonly string[]) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function equalTokens(left: readonly string[], right: readonly string[]) {
  const sortedLeft = sortedTokens(left);
  const sortedRight = sortedTokens(right);
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((token, index) => token === sortedRight[index])
  );
}

function modelTokens(values: readonly string[]) {
  return values.filter(
    (token) =>
      /^\d+$/.test(token) ||
      (/\d/.test(token) && /[a-z]/.test(token)) ||
      /^(?:ii|iii|iv|v|vi|vii|viii|ix|x)$/i.test(token),
  );
}

function isComparisonOrContentHost(hostname: string) {
  return [...comparisonOrContentHosts].some(
    (blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`),
  );
}

export function evaluateExactOfferMerchantDestination(options: {
  candidateTitle: string;
  merchant: string;
  resultTitle: string;
  resultUrl: string;
}): ExactOfferDestinationDecision {
  let url: URL;
  try {
    url = new URL(options.resultUrl);
  } catch {
    return { accepted: false, rejectionCode: "unsafe_url" };
  }
  const hostname = url.hostname.toLocaleLowerCase("en-GB");
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.port !== "" && url.port !== "443")
  ) {
    return { accepted: false, rejectionCode: "unsafe_url" };
  }
  if (isGoogleOwnedUrl(url.toString())) {
    return { accepted: false, rejectionCode: "intermediary" };
  }
  if (isComparisonOrContentHost(hostname)) {
    return { accepted: false, rejectionCode: "comparison_or_content" };
  }
  if (!merchantMatchesHostname(options.merchant, hostname)) {
    return { accepted: false, rejectionCode: "merchant_mismatch" };
  }
  if (
    merchantBrandAppearsInCandidateTitle({
      merchant: options.merchant,
      hostname,
      candidateTitle: options.candidateTitle,
    })
  ) {
    return { accepted: false, rejectionCode: "merchant_brand_ambiguity" };
  }

  const pathSegments = url.pathname
    .toLocaleLowerCase("en-GB")
    .split("/")
    .filter(Boolean);
  if (
    pathSegments.length === 0 ||
    pathSegments.some((segment) => nonProductPathSegments.has(segment)) ||
    /^(?:s|search|browse|category|categories)$/.test(pathSegments[0] ?? "")
  ) {
    return { accepted: false, rejectionCode: "non_product_page" };
  }

  const candidateIdentity = identityTokens(
    options.candidateTitle,
    options.merchant,
  );
  const resultIdentity = identityTokens(options.resultTitle, options.merchant);
  if (
    candidateIdentity.length < 2 ||
    candidateIdentity.join("").length < 6 ||
    resultIdentity.length < 2
  ) {
    return { accepted: false, rejectionCode: "ambiguous_identity" };
  }
  if (!equalTokens(candidateIdentity, resultIdentity)) {
    const candidateModels = modelTokens(candidateIdentity);
    const resultModels = modelTokens(resultIdentity);
    return {
      accepted: false,
      rejectionCode:
        (candidateModels.length > 0 || resultModels.length > 0) &&
        !equalTokens(candidateModels, resultModels)
          ? "variant_mismatch"
          : "title_mismatch",
    };
  }

  url.hash = "";
  for (const parameter of [...url.searchParams.keys()]) {
    const normalized = parameter.toLocaleLowerCase("en-GB");
    if (
      normalized.startsWith("utm_") ||
      ["gclid", "gbraid", "srsltid", "wbraid"].includes(normalized)
    ) {
      url.searchParams.delete(parameter);
    }
  }
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return { accepted: true, destinationUrl: url.toString() };
}

export function verifyOrganicMerchantDestination(options: {
  candidateTitle: string;
  merchant: string;
  resultTitle: string;
  resultUrl: string;
}) {
  const decision = evaluateExactOfferMerchantDestination(options);
  return decision.accepted ? decision.destinationUrl : null;
}
