import type { EvidenceSearchResponse } from "./evidence-search";

const titleNoise = new Set([
  "and",
  "for",
  "from",
  "the",
  "with",
  "this",
  "that",
  "new",
  "official",
  "review",
  "reviews",
  "specification",
  "specifications",
]);

// These describe the broad object being searched, rather than identifying a
// particular product. They are deliberately conservative and task-local: this
// is not a global product taxonomy or brand database.
const genericProductTokens = new Set([
  "bluetooth",
  "computer",
  "ergonomic",
  "gaming",
  "headphone",
  "headphones",
  "headset",
  "hat",
  "hats",
  "mouse",
  "mice",
  "optical",
  "office",
  "pc",
  "rechargeable",
  "running",
  "shelf",
  "shelves",
  "shelving",
  "usb",
  "vertical",
  "wired",
  "wireless",
  "chair",
  "chairs",
  "cap",
  "caps",
  "unit",
  "units",
]);

const categoryGroups = [
  new Set(["mouse", "mice"]),
  new Set(["headphone", "headphones", "headset", "earphone", "earphones"]),
  new Set(["chair", "chairs", "seat", "seating"]),
  new Set(["cap", "caps", "hat", "hats"]),
  new Set(["shelf", "shelves", "shelving", "bookcase", "rack", "unit"]),
];

function tokens(value: string) {
  return value
    .toLocaleLowerCase("en-GB")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !titleNoise.has(token));
}

function categorySet(value: string) {
  const valueTokens = new Set(tokens(value));
  return new Set(
    categoryGroups.flatMap((group, index) =>
      [...group].some((token) => valueTokens.has(token)) ? [index] : [],
    ),
  );
}

function identityTokens(value: string) {
  return [
    ...new Set(
      tokens(value).filter((token) => !genericProductTokens.has(token)),
    ),
  ];
}

function modelTokens(value: string) {
  return identityTokens(value).filter(
    (token) => /\d/.test(token) || token.length <= 3,
  );
}

function isSearchOrCategoryPage(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return true;
  }
  if (url.protocol !== "https:") return true;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return (
    path === "/" ||
    /(?:^|\/)(?:search|s|browse|category|categories|collections|shop)(?:\/|$)/i.test(
      path,
    ) ||
    url.searchParams.has("q")
  );
}

function isComparisonPage(rawUrl: string, title: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return true;
  }
  const host = url.hostname.toLocaleLowerCase("en-GB");
  return (
    /(?:^|\.)(?:idealo|pricerunner|pricespy|e-catalog)\./i.test(host) ||
    /(?:^|\/)(?:compare|comparison|vs)(?:\/|$)/i.test(url.pathname) ||
    /\b(?:vs|versus|compare)\b/i.test(title)
  );
}

/**
 * A search result is acquisition output until this conservative identity gate
 * admits it. The gate intentionally abstains for generic candidate titles and
 * never attempts fuzzy/global product identity or model inference.
 */
export function isCandidateEvidenceRelevant(options: {
  candidateTitle: string;
  merchant: string | null;
  result: EvidenceSearchResponse["results"][number];
}) {
  void options.merchant;
  if (isSearchOrCategoryPage(options.result.url)) return false;
  if (isComparisonPage(options.result.url, options.result.title)) return false;

  const candidateIdentity = identityTokens(options.candidateTitle);
  const resultTokenSet = new Set(tokens(options.result.title));
  // A generic title such as “Ergonomic USB Wireless Mouse” cannot establish
  // which exact product a third-party result concerns.
  if (candidateIdentity.length < 2) return false;

  const candidateModels = modelTokens(options.candidateTitle);
  const requiredIdentity =
    candidateModels.length > 0
      ? [
          ...new Set([
            ...candidateModels,
            ...candidateIdentity
              .filter((token) => !candidateModels.includes(token))
              .slice(-1),
          ]),
        ]
      : candidateIdentity;
  if (!requiredIdentity.every((token) => resultTokenSet.has(token))) {
    return false;
  }

  const matchedIdentityCount = candidateIdentity.filter((token) =>
    resultTokenSet.has(token),
  ).length;
  if (matchedIdentityCount < requiredIdentity.length) {
    return false;
  }

  const candidateCategories = categorySet(options.candidateTitle);
  const resultCategories = categorySet(options.result.title);
  if (
    candidateCategories.size > 0 &&
    resultCategories.size > 0 &&
    ![...candidateCategories].some((category) => resultCategories.has(category))
  ) {
    return false;
  }

  return true;
}
