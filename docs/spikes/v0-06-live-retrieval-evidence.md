# V0-06 live retrieval evidence

**Run date:** 23 August 2026  
**Provider:** Serper Google Shopping  
**Market:** GB / GBP / en-GB  
**Branch boundary:** experimental retrieval spike; no persistence, assessment,
ranking, reactions, comparison, or UI

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

## Product conclusion

Serper is credible as the provisional source for learning about query recall and
building an initial candidate pool. It is not yet evidence that the final product
beats Google: the next layers must resolve merchant destinations, obtain
decision-critical facts, preserve unknowns, and evaluate suitability separately.

The next smallest product step after independent review is to feed an actual
V0-05 authoritative subject and structured brief into this boundary and measure
literal-versus-expanded useful-candidate recall. Persistence and ranking remain
outside this spike.
