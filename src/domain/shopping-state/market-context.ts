import { z } from "zod";

export const countryCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/, "Expected an ISO 3166-1 alpha-2 country code");

export const languageTagSchema = z
  .string()
  .regex(
    /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/,
    "Expected a BCP 47 language tag",
  );

export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "Expected an uppercase ISO 4217 currency code");

export type CurrencyCode = z.infer<typeof currencyCodeSchema>;

export const marketContextSchema = z.strictObject({
  country: countryCodeSchema,
  language: languageTagSchema,
  currency: currencyCodeSchema,
});

export type MarketContext = z.infer<typeof marketContextSchema>;

export const DEFAULT_MARKET_CONTEXT = marketContextSchema.parse({
  country: "GB",
  language: "en-GB",
  currency: "GBP",
}) satisfies MarketContext;
