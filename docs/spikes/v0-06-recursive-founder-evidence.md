# V0-06 recursive founder-shopping evidence

**Run date:** 26 August 2026

**Route:** `/live`

**Market:** GB / GBP / en-GB

**Product checkpoint:** `b112430`

**Status:** Experimental branch evidence; draft and unmerged.

## Product result

The live founder flow now supports one real recursive task from natural request
through interpretation, deterministic brief, purpose-labelled UK retrieval,
exact persisted offers, verified merchant destinations where available,
refinement, ASK/answer, save/unsave and refresh.

The newest browser journey deliberately exercised change rather than a single
happy-path search:

1. start with a long ergonomic-mouse request under £50;
2. make wireless a must-have and add battery/brand priorities;
3. relax brand quality from must-have to preference;
4. reduce reviews from strong to ordinary preference;
5. save the Anker offer;
6. add long-office-day comfort as a strong preference;
7. answer the generated comfort-versus-shape trade-off question;
8. retrieve again on the same task;
9. refresh without another provider call; and
10. unsave the exact historical listing.

The initial `ShoppingSubject` remained immutable. Every refinement and answer
updated authoritative state through V0-05/V0-04. Search hypotheses, title
observations and merchant vocabulary never wrote `DecisionCriterion` rows.

## Latest real run

The persisted task reached revision 6. The latest SearchRun succeeded with
three queries and 24 exact listing rows:

1. literal precision: `I need an ergonomic mouse under £50`;
2. hard/strong intent: `ergonomic mouse under £50 -"Amazon Basics" Wireless
   connectivity established brands strong battery life comfortable for long
   office workdays`;
3. remaining preferences: `ergonomic mouse under £50 -"Amazon Basics"
   Wireless connectivity very good reviews ergonomic design sculpted
   thumb-rest shape`.

Query strategy v3 retains the literal baseline, removes request boilerplate
from expansions, uses natural boolean labels, preserves measurement ranges,
and limits each expansion to a bounded number of authoritative phrases. A
provided market-vocabulary hypothesis gets the third slot instead of being
crowded out by another preference query.

The 24 rows formed 18 exact title/merchant/price presentation groups: six rows
were exact repeats across queries, and six groups appeared in more than one
query. Raw rows remain persisted separately. Presentation grouping is not
`ProductIdentity`, fuzzy deduplication or cross-merchant merging.

Thirteen raw rows were withheld because observed price, the Amazon Basics
exclusion, or an explicit wired-versus-wireless title contradicted a must-have.
The latter is deliberately narrow: an explicitly `Wired Mouse` conflicts with
a hard wireless requirement; a title that says neither remains unknown.

## Merchant destination experiment

Serper's UK Shopping surface still returns Google intermediary links. A bounded
second Serper organic lookup now tests up to three distinct leading merchants
per query under the same overall provider deadline. A destination is accepted
only when all of these hold:

- HTTPS retailer product-like path, not Google, an aggregator, search page or
  category page;
- hostname matches the observed merchant;
- organic title covers the Shopping title; and
- the title contains the same discriminative brand/model identity tokens.

The last condition was added after live evidence caught a generic `Ergonomic
2.4G Wireless Mouse` being mapped to a specific Amazon-branded listing. That
ambiguous destination is now rejected and falls back to Google Shopping.

The latest run persisted five verified-direct rows representing three distinct
titles. Amazon Basics was correctly withheld, leaving two useful visible
destinations:

- Anker 2.4G Wireless Vertical Ergonomic Optical Mouse → Amazon UK product page;
- Trust Bayo II Ergonomic Wireless Mouse → Argos product page.

The original Google Shopping source remains available beside every enriched
destination. Organic resolution failures never discard the Shopping listing.
The experiment can add up to nine Serper lookups per three-query run;
shortlist-stage resolution remains the likely cost-efficient successor.

## Honest listing evidence

Product cards now separate a small direct-evidence projection from unknowns:

- observed GBP price can directly support a price ceiling;
- an explicit `wireless` title can support a hard wireless criterion;
- direct contradictions are withheld from the current pool and remain visible
  if an older saved listing later conflicts with the current brief;
- reviews, battery endurance, comfort, brand quality and sculpted shape remain
  `Still unverified` unless the listing fields actually support them.

Candidates with direct non-price must-have support appear before
evidence-limited rows; query overlap breaks ties. This is not a final
suitability score or recommendation. It is a deterministic, view-only criterion
check over persisted provider fields, and the UI says so.

The real result makes the remaining gap inspectable. Anker and Trust have
observed price and wireless-title support, but comfort, battery, brand quality
and shape are not silently treated as satisfied. Trust Verto and Logitech M196
retain observed prices but explicitly show wireless as unverified because their
titles do not say it.

## Persistence and responsive evidence

The saved Anker row survived a later ASK, answer, SearchRun and refresh, then an
exact unsave removed the saved section without changing shopper truth. The new
run's visually identical Anker row was not automatically marked saved because
no product identity has been established.

Inspected artifacts:

- `artifacts/screenshots/v0-06-recursive/06-evidence-and-direct-links-desktop.png`;
- `artifacts/screenshots/v0-06-recursive/07-evidence-and-direct-links-mobile.png`;
- `artifacts/screenshots/v0-06-recursive/08-evidence-card-mobile.png`.

The 390 × 844 view has no horizontal overflow. Evidence and unknowns remain
compact enough to preserve the product image, price and destination hierarchy.

## Verification

- `pnpm check`: 156/156 deterministic tests and production build pass.
- PostgreSQL: 89 functional tests pass; the sole local failure is the
  intentional PostgreSQL 17.6 pin against local Homebrew 17.11.
- `pnpm test:e2e`: 8/8 Chromium tests pass.
- `pnpm db:generate`: no unexplained schema drift after migration 0011.
- Production dependency audit: no known vulnerabilities.
- `git diff --check` and changed-value secret scan: pass.

## Honest limitations and next product step

- Search still returns obscure marketplace products even when reputation is
  important. Query text cannot establish reputation.
- The organic destination resolver spends calls before hard-conflict triage;
  resolving only a post-triage shortlist should reduce wasted lookups.
- SERP-only evidence cannot establish reviews, battery endurance, comfort or
  actual fit. Those unknowns now appear instead of being hidden.
- There is no persisted `ProductObservation`, full criterion assessment,
  qualitative comparative judgement, reject/undo, shortlist or comparison.

The next highest-value layer is selective evidence acquisition for a small,
promising pool, followed by persisted evidence-backed observations and
criterion assessments. Ranking should then consume those assessments rather
than keywords, price alone or an arbitrary scalar score.
