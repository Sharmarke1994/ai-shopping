# V0-06 live-retrieval spike

**Status:** Experimental branch only; live Serper evidence collected; V0-05
remains the release checkpoint.

Serper is provisionally accepted for founder-MVP retrieval experiments, subject
to the limitations recorded in
[`v0-06-live-retrieval-evidence.md`](./v0-06-live-retrieval-evidence.md).

## Learning boundary

The original live spike proved the smallest useful path from an authoritative
shopping subject and structured brief to a small query portfolio and normalized
UK Shopping listings. The subsequent bounded persistence layer now stores the
exact task-local `SearchRun`, its hypotheses and queries, terminal per-query
execution receipts, and exact `CandidateListing` offer rows. Layer 3 adds the
immutable initial-message subject, separate SEARCH trigger provenance, and a
fenced resume boundary keyed above generated SearchRun IDs. This remains an
experimental founder-MVP boundary rather than the final V0-06 architecture; it
does not implement evidence, assessment, ranking, reactions, comparison, or UI.

The exact shopping subject is context, not a `DecisionCriterion`. A
`market_vocabulary` hypothesis is explicitly retrieval theory. Neither has a
write path into the supplied brief.

## Durable trigger and resume boundary

- One task is bound once to its exact persisted initial V1 shopper message.
- The persisted input behind the current SEARCH application is a separate
  trigger. An ASK answer can trigger search without replacing the subject.
- The persisted SEARCH `ContextActionId` owns exactly one logical run per task,
  so a lost response cannot create a new paid run with fresh random IDs.
- A PostgreSQL-clock lease fences concurrent workers. Each completed or failed
  query receipt is committed immediately, and retries issue only queries with no
  receipt.
- The adapter's enforced request timeout must remain below the lease duration by
  a safety margin. Current task authority is checked before each new call.
- If truth changes during an already-authorized request, its result remains
  historical evidence for that run revision; later missing queries do not start.

There is one honest external boundary: if Serper accepts a call and the process
dies before its receipt commits, neither this application nor Serper exposes a
provider-side idempotency/status mechanism that can prove whether the charge
occurred. The lease prevents immediate duplication and delays takeover, but
cannot make that final crash window exactly once.

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

Every query retains its purpose and hypothesis/criterion lineage. The original
standalone harness runs independent calls concurrently. The durable orchestration
path instead processes missing queries one at a time so each receipt is committed
before the next paid call; one failed query still does not discard successful
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
