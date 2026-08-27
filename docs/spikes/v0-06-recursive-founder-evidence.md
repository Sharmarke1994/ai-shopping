# V0-06 recursive founder-shopping evidence

**Run date:** 26–27 August 2026

**Route:** `/live`

**Market:** GB / GBP / en-GB

**Product checkpoint:** `aa9e1463c668c7bb576d758316bea84654329e5c`

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

The persisted task remained at revision 6 after an explicit no-change refresh.
The latest SearchRun `b7fb2004-1fc6-474a-8e74-5082e6ac05b7` succeeded with
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

Twelve raw rows were withheld because observed price, the Amazon Basics
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
- a rating/count from the exact verified retailer organic result is retained as
  an attributable provider-structured fact;
- direct contradictions are withheld from the current pool and remain visible
  if an older saved listing later conflicts with the current brief;
- reviews, battery endurance, comfort, brand quality and sculpted shape remain
  `Still unverified` unless the listing fields actually support them.

Candidates with direct non-price must-have support appear before
evidence-limited rows; query overlap breaks ties. This is not a final
suitability score or recommendation. It is a deterministic, view-only criterion
check over persisted provider fields, and the UI says so.

The refreshed run persisted five exact rating-evidence rows. Exact presentation
grouping renders two useful facts: Anker's Amazon result reports 4.3/5 from
52,629 reviews; Trust Bayo II's Argos result reports 4.6/5 from 29 reviews. The
rating, count and exact verified source URL are stored as one coherent evidence
shape. A malformed rating cannot suppress an otherwise valid merchant URL.

These numbers do not automatically satisfy `Prefer very good reviews` and do
not influence suitability ranking yet. Comfort, battery endurance, brand
quality and shape also remain unverified. The distinction is visible rather
than hidden: the card can show what the retailer result reports while the
criterion remains unresolved.

A bounded exact-source probe found that a Serper query restricted to the Argos
product URL can surface an excerpt claiming the mouse is rechargeable and
offers comfort. That is promising input for the next evidence layer, but it is
a retailer assertion delivered through a search snippet—not objective comfort
or strong-battery proof. It was deliberately not promoted into current product
truth or criterion assessment. Direct server fetching of the Argos page still
receives an Akamai 403, so no crawler or browser-automation dependency was
introduced.

## Persistence and responsive evidence

The saved Anker row survived a later ASK, answer, SearchRun and refresh, then an
exact unsave removed the saved section without changing shopper truth. The new
run's visually identical Anker row was not automatically marked saved because
no product identity has been established.

Inspected artifacts:

- `artifacts/screenshots/v0-06-recursive/06-evidence-and-direct-links-desktop.png`;
- `artifacts/screenshots/v0-06-recursive/07-evidence-and-direct-links-mobile.png`;
- `artifacts/screenshots/v0-06-recursive/08-evidence-card-mobile.png`;
- `artifacts/screenshots/v0-06-recursive/09-retailer-review-evidence-desktop.png`;
- `artifacts/screenshots/v0-06-recursive/10-retailer-review-evidence-mobile.png`.

The 390 × 844 view has no horizontal overflow. Evidence and unknowns remain
compact enough to preserve the product image, price and destination hierarchy.

## Verification

- `pnpm check`: 158/158 deterministic tests and production build pass.
- PostgreSQL: 90 functional tests pass; the sole local failure is the
  intentional PostgreSQL 17.6 pin against local Homebrew 17.11.
- `pnpm test:e2e`: 8/8 Chromium tests pass.
- `pnpm db:generate`: no unexplained schema drift after migration 0013.
- Migration `0013_melodic_roland_deschain.sql` explicitly requires every
  participating nullable field in populated destination/review branches, and
  raw PostgreSQL regressions reject eight incomplete or mismatched tuples while
  accepting three valid shapes.
- Production dependency audit: no known vulnerabilities.
- `git diff --check` and changed-value secret scan: pass.
- GitHub Quality run `33071030456` on exact head
  `962f9405655ed84cde0a39b8ea94e01db374b538`: quality, pinned-PostgreSQL
  persistence and browser-smoke all pass.

## Honest limitations and next product step

- Search still returns obscure marketplace products even when reputation is
  important. Query text cannot establish reputation.
- The organic destination resolver spends calls before hard-conflict triage;
  resolving only a post-triage shortlist should reduce wasted lookups.
- A retailer rating is now attributable, but its meaning for a qualitative
  review criterion remains unassessed. SERP-only evidence still cannot
  establish battery endurance, comfort or actual fit.
- There is no persisted `ProductObservation`, full criterion assessment,
  qualitative comparative judgement, reject/undo, shortlist or comparison.

The next highest-value layer is selective evidence acquisition for a small,
promising pool, followed by persisted evidence-backed observations and
criterion assessments. Ranking should then consume those assessments rather
than keywords, price alone or an arbitrary scalar score.
