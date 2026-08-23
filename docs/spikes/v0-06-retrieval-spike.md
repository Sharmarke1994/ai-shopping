# V0-06 live-retrieval spike

**Status:** Experimental branch only; V0-05 remains the release checkpoint.

## Learning boundary

This spike proves the smallest useful path from an authoritative shopping
subject and structured brief to a small query portfolio and normalized UK
Shopping listings. It does not persist a `SearchRun`, establish the final V0-06
architecture, or implement evidence, assessment, ranking, reactions, comparison,
or UI work.

The exact shopping subject is context, not a `DecisionCriterion`. A
`market_vocabulary` hypothesis is explicitly retrieval theory. Neither has a
write path into the supplied brief.

## Provider check (23 August 2026)

The timeboxed comparison used current official product and pricing pages:

| Provider | Trial | Relevant fit | Spike decision |
| --- | ---: | --- | --- |
| [Serper](https://serper.dev/) | 2,500 queries; no card | Real-time Google Shopping, country/language localization, title/link/source/price/image fields, simple POST API | Chosen provisionally |
| [SerpApi](https://serpapi.com/google-shopping-api) | 250 searches/month | Strong Shopping documentation and localization; larger paid entry point than this spike needs | Documented fallback |
| [SearchApi](https://www.searchapi.io/google-shopping) | 100 requests | Google Shopping and structured results; smaller free allowance | Not selected |

Serper is a learning choice, not permanent procurement. The spike retains no raw
provider payload. Terms, image retention, reliability, and useful-candidate
recall still require live evaluation before an accepted V0-06 provider decision.

## What runs

The deterministic strategy creates at most three distinct queries:

1. the shopper's literal wording;
2. the literal wording plus active brief values;
3. an optional commercial-language hypothesis.

Every query retains its purpose and hypothesis/criterion lineage. Provider calls
run independently and concurrently; one failed query does not discard successful
listings. Normalization is conservative: retailer offers are not deduplicated,
ambiguous prices remain text rather than manufactured GBP values, and only known
tracking parameters are removed from URLs.

Run the credential-free fixture path:

```sh
pnpm harness:v0-06
```

Run another literal subject through the fixture provider:

```sh
pnpm harness:v0-06 -- --subject "Sony WH-1000XM6 headphones"
```

Run live Google Shopping retrieval after creating a free Serper account:

```sh
SERPER_API_KEY="..." pnpm harness:v0-06 -- --live
```

The live path is deliberately unavailable without `SERPER_API_KEY`; it never
falls back to fixture listings while claiming a live result.
