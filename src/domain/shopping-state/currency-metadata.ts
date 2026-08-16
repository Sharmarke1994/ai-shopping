import type { CurrencyCode } from "./market-context";

export type CurrencyMetadata = Readonly<{
  code: CurrencyCode;
  minorUnitScale: number;
}>;

const currencyMetadata = {
  GBP: { code: "GBP", minorUnitScale: 2 },
} as const satisfies Readonly<Record<string, CurrencyMetadata>>;

export type SupportedCurrencyCode = keyof typeof currencyMetadata;

export function getCurrencyMetadata(code: CurrencyCode) {
  return currencyMetadata[code as SupportedCurrencyCode];
}
