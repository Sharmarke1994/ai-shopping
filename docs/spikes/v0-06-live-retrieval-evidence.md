# V0-06 live retrieval evidence

**Run date:** 23 August 2026

**Provider:** Serper Google Shopping

**Market:** GB / GBP / en-GB
**Evidence-run boundary:** these live requests read authoritative task state but
did not themselves persist a SearchRun or CandidateListing. A later bounded
branch layer adds exact task-local retrieval persistence without changing these
recorded requests. Assessment, ranking, reactions, comparison, and UI remain
outside this evidence run.

## Verdict

Serper is **provisionally accepted for founder-MVP retrieval experiments**. It
produces current, recognizably UK candidate pools with excellent merchant, GBP
price, and image completeness. The cap and headphones pools are immediately
useful for discovery; a commercial-language query materially improves the weak
shelving pool.

This is not a permanent provider commitment and Serper is not sufficient as the
only purchase/evidence source. Its Shopping links are Google intermediary URLs,
not direct merchant URLs; delivery and availability were absent; dimensions and
experiential properties such as clamp comfort remain unknown; and cross-query
duplication is material.

## Persisted V0-05 to live-retrieval proof

The spike now proves the intended seam rather than manually assembling a brief:

1. create and record a real persisted shopping task and shopper message;
2. run that input through the actual V0-05 coordinator and persistence boundary
   with a deterministic model double, producing a validated state-application
   receipt and persisted `SEARCH` action;
3. reload current authoritative state, verify that the receipt and current
   `SEARCH` belong to the same task/input/application and revision, and project a
   fresh deterministic `ShoppingBrief`;
4. build `RetrievalContextV1` and a query portfolio without mutating the task;
5. execute the portfolio against live Serper Google Shopping in GB/GBP/en-GB.

The deterministic model double isolates the persisted-state/retrieval seam; it
does not claim a second live V0-05 model evaluation. The proof runs in a guarded
disposable database which is migrated from empty and dropped afterward.

Focused PostgreSQL tests also prove that cross-task sources, non-message inputs,
and a `SEARCH` selected before later authoritative truth are rejected. The
successful path compares state before and after query generation to prove that
`race cap` remains a retrieval hypothesis rather than becoming a criterion.

This is deliberately a one-message proof, not a claim that product-subject
identity is solved. V0-05 can persist a later free-text refinement as another
`message`, but the current state model cannot distinguish that refinement from a
complete shopping subject. The automatic boundary therefore must not be treated
as production-ready for multi-turn tasks until a first-class current
ShoppingSubject/source contract exists. Question answers and direct brief edits
already fail closed rather than being misrepresented as the subject.

Run with:

```sh
pnpm proof:v0-06:persisted-live cap
pnpm proof:v0-06:persisted-live shelving
```

Both commands require `SERPER_API_KEY` and the already-guarded
`TEST_DATABASE_URL`.

### Persisted running-cap proof

The persisted current state was revision 1 with exactly two active brief items:
`Breathability = breathable` and `Weight = lightweight`. It generated:

1. `I need a light breathable cap for running in hot weather.`
2. `I need a light breathable cap for running in hot weather. lightweight`
3. `I need a light breathable cap for running in hot weather. race cap`

Each live query returned 40 raw rows and the bounded adapter accepted eight.
Across the 24 accepted listings there were 12 unique provider IDs and seven
repeated-ID groups. Merchant, GBP price and image were present on all 24;
delivery and availability were present on none. Useful products included the
Kiprun Ultralight Cap from Decathlon (£9.99), Runr Doha Airflow Technical
Running Hat (£25.99), Harrier Trail Running Summer Cap (£23.19), adidas Adizero
caps, and ASICS Ultra Lightweight Running Cap. The pool is credible for recall,
but is not yet a suitability judgement.

### Persisted shelving proof

The persisted current state was revision 1 with four independently typed brief
items: maximum width 60 cm, maximum depth 30 cm, target budget £30 and excluded
colour white. It generated:

1. `I need a slim shelving unit around £30, max 60cm wide, max 30cm deep, no white.`
2. the same source plus `under 60 cm under 30 cm` from the authoritative brief;
3. the same source plus the retrieval-only term `narrow bookcase`.

Each query returned 40 raw rows and eight were accepted. The 24 accepted rows
contained 22 unique provider IDs. All had merchant, GBP price and image; none
had delivery or availability. The literal pool mixed useful furniture with
garage/storage noise. Brief expansion found options such as the Essentials
Small Narrow Bookcase (£27) but still returned over-budget products. `narrow
bookcase` produced a more consumer-relevant pool, including Furniture Edit's
Essentials Small Narrow Bookcase (£23.49), while still surfacing a white shelf
that later evidence and assessment must reject. This confirms why query recall
and suitability must remain separate disciplines.

## Exact live cases

The adapter requested eight candidates per query. Serper returned 37-40 raw rows
regardless of that request. The evidenced adapter correction now accepts only
the first eight validated rows while retaining the raw received count in
diagnostics.

### Light breathable running cap

Queries:

1. `I need a light breathable cap for running in this heat`
2. `I need a light breathable cap for running in this heat lightweight breathable in hot weather`
3. `I need a light breathable cap for running in this heat race cap`

| Measure | Result |
| --- | ---: |
| Raw results | 40 + 40 + 40 |
| Accepted candidates | 24 |
| Unique provider IDs | 16 |
| Repeated provider-ID groups across queries | 7 |
| Merchant / structured GBP price / image present | 24 / 24 / 24 |
| Delivery present / direct merchant URL | 0 / 0 |

Useful literal results included Kiprun Ultralight Cap at Decathlon (£9.99),
adidas Adizero Lightweight CLIMACOOL Cap at Start Fitness (£21.90), ON
Lightweight Cap, and Puma Lightweight Runner Cap. The `race cap` hypothesis
changed the leading result to Ronhill Race Cap and added Harrier Trail Running
Summer Cap and Beechfield Technical Running Cap. It therefore supplied some
distinct recall, not merely a textual variation.

The brief-expansion query was less valuable: its meaning was already present in
the source wording and five of its top eight provider IDs overlapped the literal
pool. A future query planner should omit semantically redundant expansions, but
this spike does not add an unproven semantic-deduplication heuristic.

### Slim shelving around £30

Authoritative subject:

`slim shelving unit around £30, max 60cm wide, max 30cm deep, no white`

The optional retrieval hypothesis was `narrow bookcase`; it remained search
theory and did not alter the supplied shopping truth.

| Measure | Result |
| --- | ---: |
| Raw results | 37 + 40 |
| Accepted candidates | 16 |
| Unique provider IDs | 16 |
| Merchant / structured GBP price / image present | 16 / 16 / 16 |
| Delivery present / direct merchant URL | 0 / 0 |

The literal query was poor: top results were dominated by Screwfix/Halfords
garage shelving, included £59-£174 products, and rarely exposed dimensions. The
`narrow bookcase` query was materially more consumer-relevant, returning a
VASAGLE six-tier bookcase (£29.99), Furniture Edit small narrow bookcase
(£21.89), and B&Q/Amazon/Wayfair options.

It still did not prove suitability. One top-eight result explicitly said white,
contrary to the hard exclusion; several were far over budget; and width/depth
were usually absent. Retrieval found plausible candidates, but later factual
evidence and criterion assessment must enforce these constraints.

### Wireless over-ear headphones around £150

Authoritative subject:

`wireless over-ear headphones around £150 where glasses clamp comfort and ANC matter`

The optional retrieval hypothesis was `low clamp force headphones for glasses`.

| Measure | Result |
| --- | ---: |
| Raw results | 40 + 40 |
| Accepted candidates | 16 |
| Unique provider IDs | 13 |
| Repeated provider-ID groups across queries | 3 |
| Merchant / structured GBP price / image present | 16 / 16 / 16 |
| Delivery present / direct merchant URL | 0 / 0 |

The literal pool was commercially strong: Sony WH-CH720N (£69), Bose
QuietComfort (£179.95-£199.95), Nothing Headphone (£149), Sennheiser Accentum
(£99.99), JBL Tune 780NC (£69), and Soundcore Q20i (£37.99), from recognizable UK
merchants.

The market-language query mostly repeated that pool, sometimes with different
prices/provider IDs, and introduced an irrelevant wireless TV headset. Shopping
results supplied no evidence about glasses or clamp comfort. That expansion is
not justified by this run; comfort must remain unknown until a separate evidence
stage can investigate it.

## Field and provider findings

- **Strong:** current UK merchants, GBP price text, exact parsed GBP amounts,
  product titles, images, source rank, and query lineage.
- **Useful but unstable:** `productId` helps diagnose overlap, but the same
  apparent product/merchant sometimes received different IDs across queries.
- **Missing:** direct merchant URL, delivery, availability, dimensions, and
  evidence for experiential properties.
- **URLs:** all 56 accepted URLs were `www.google.com` Shopping intermediaries.
  A bounded raw-shape inspection confirmed no `directLink` or offer-level URL.
- **Duplicates:** common across query portfolios. This spike intentionally does
  not add fuzzy product deduplication; retailer offers must not be collapsed on
  title similarity.
- **Noise:** modest for caps and headphones, material for shelving. Marketplace
  sellers and no-name products occur alongside strong retailers.
- **Provider behaviour:** `num: 8` did not constrain Serper's raw Shopping array;
  the adapter must enforce its own candidate budget.

## Direct-merchant destination experiment

The current Serper Shopping response offers no clean merchant destination. A
bounded `HEAD` request to one exact returned Google Shopping URL produced HTTP
200 with no `Location`; the URL is a rendered Google product/offer surface, not
a redirect. Its parameters contain opaque offer/catalog identifiers rather than
an encoded merchant URL. Serper exposes no separate direct-link or offer field
on this response. Parsing Google HTML or matching a second general-search result
by title would be brittle and was deliberately rejected.

One narrow, unproven follow-up exists for the later evidence stage:
[SearchApi's Google Product Page API](https://www.searchapi.io/docs/google-product-page)
documents lookup by Google catalog `product_id`, and its
[Google Product Offers API](https://www.searchapi.io/docs/google-product-offers)
documents merchant offer links. Serper's `productId` matched the returned URL's
`catalogid` in the inspected sample, and SearchApi supports
[GB market targeting](https://www.searchapi.io/docs/parameters/google-shopping/gl).
This would require a second provider, two calls for each shortlisted product,
seller/price reconciliation and a separate credential. It was not executed and
is not part of the retrieval boundary. SerpApi's former Google Product endpoint
is explicitly shut down, so it is not a viable fallback.

## Product conclusion

Serper is credible as the provisional source for learning about query recall and
building an initial candidate pool. Real persisted V0-05 state now drives that
pool without allowing retrieval vocabulary to become shopper truth. This is
still not evidence that the final product beats Google: the next layers must
resolve merchant destinations, obtain decision-critical facts, preserve
unknowns, and evaluate suitability separately.

The next smallest product step after independent review is to connect the now
persisted exact candidate pool to a narrow evidence experiment on a deliberately
small shortlist, including one live direct-offer lookup experiment before
adopting a second provider. Ranking remains outside this evidence report.
