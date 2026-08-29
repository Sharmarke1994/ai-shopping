# Founder MVP progress

**Updated:** 2026-08-29 Europe/London
**Durable goal:** Deliver a polished founder-usable AI shopping MVP whose live
understanding, market retrieval, evidence-aware evaluation, refinement, saving,
and comparison are meaningfully better than beginning with Google.

## Authoritative checkpoints

- Repository: `Sharmarke1994/ai-shopping`.
- Founder-MVP execution brief: `docs/plans/founder-usable-mvp.md`.
- Active isolated worktree:
  `/Users/alchemist32/Documents/AI Shopping/ai-shopping-v0-08-founder-loop`.
- Active branch: `codex/v0-08-founder-decision-loop`, stacked exactly on the
  independently accepted V0-07 head
  `149f93cd43092996e20621e8976003b341a82c6a`.
- V0-07 remains draft stacked PR #11 and is not merged. V0-08 is implemented,
  founder-dogfooded and locally verified; its final commit, draft stacked PR
  and exact-head CI are the current delivery checkpoint. Do not merge or begin
  V0-09.
- Original V0-05 checkout and draft PR #9 remain separate, unmodified,
  unmerged and formally unaccepted. The 21/21 Terra rule has not been weakened
  and Luna remains diagnostic only. V0-08 does not redefine that separate
  process checkpoint.
- Nothing on this experimental branch may be merged automatically. Each
  coherent layer is committed and pushed for recoverability while work
  continues toward the founder-usable product.

## Completed foundation

- V0-01: runnable Next.js/TypeScript foundation and repository quality gates.
- V0-02: responsive fixture-driven premium consumer shopping shell.
- V0-03: typed semantic domain and PostgreSQL persistence for task state,
  inputs, concepts, criteria, provenance, revisions, and fail-closed reads.
- V0-04: deterministic state transitions, CAS, idempotent receipts, change of
  mind, indifference, undo, historical reconstruction, and brief projection.
- V0-05 implementation checkpoint: strict AI interpretation/action proposals,
  V0-04 validation firewall, ASK/answer persistence, provider diagnostics,
  deterministic and live evals. Formal release acceptance remains separate.

## Completed V0-06 experimental layers

### Layer 1 — authoritative state to live retrieval

Pushed at `9e55cf810fecdd3e9b4a122f8ae1ee63e7f6d6e6`.

- Loads one coherent repeatable-read snapshot of persisted current state.
- Projects the deterministic `ShoppingBrief`; no hand-built brief in the main
  proof path.
- Builds at most three distinct UK-first query hypotheses while keeping market
  vocabulary outside shopper truth.
- Retrieves normalized live Serper Google Shopping listings for GB / GBP /
  en-GB.
- Real running-cap and shelving proofs succeeded. Serper is provisionally
  accepted for founder testing, not permanent procurement.
- Serper's UK Shopping links are usually Google intermediary pages. A bounded
  probe found no safe redirect unwrapping. Direct merchant destinations remain
  a later evidence-stage experiment; no brittle crawler was introduced.

### Layer 2 — exact retrieval persistence

Pushed at `a3f6e33dc30954467db9a6f8c4d70cc7711f9c6b`.

- Persists each authoritative SearchRun plan atomically before external calls.
- Stores normalized hypotheses and criterion bases, immutable queries, one
  terminal receipt per query, and exact task/run/query-scoped listing rows.
- Records provider calls outside long transactions and commits each settled
  query in a short transaction.
- Derives `running`, `succeeded`, `partial`, or `failed` from terminal receipts.
- Treats malformed provider results as isolated query failures.
- Stores bounded failure codes, never raw provider exceptions or payloads.
- Preserves multiple merchant offers even when Serper gives them the same
  catalogue `productId`; no ProductIdentity or fuzzy deduplication exists yet.
- Exact retries are idempotent and lock the run across multi-table reads so a
  concurrent final receipt cannot produce a torn view.
- Loaded runs validate task, action, revision, market, hypotheses, queries,
  receipts, listings, counts, status, and timestamps fail-closed.
- Migration `0007_bumpy_gorgon.sql` is additive and revokes private-table access
  from PUBLIC and Supabase client roles.

### Layer 3 — subject/trigger authority and resumable retrieval

Implemented and independently accepted as part of the V0-06 checkpoint at
`d32fbd7ca46d15dc645dacf20617e9c81ca36ac0`; intentionally unmerged.

- Binds each task once to the exact persisted initial V1 shopper message as its
  immutable `ShoppingSubject`; later criteria and answers never replace it.
- Keeps the persisted SEARCH-causing input as separate trigger provenance. The
  tested ASK → answer → SEARCH path retains the initial message as subject while
  recording the answer input as trigger.
- Loads subject, trigger application, current task/revision, deterministic brief,
  SEARCH action, and market in one repeatable-read authority snapshot.
- Uses the persisted SEARCH `ContextActionId` as the durable logical retrieval
  trigger and enforces one SearchRun per task/action above generated run IDs.
- Uses a short PostgreSQL-clock lease with token fencing. Concurrent retries
  return the same in-progress run; expired leases resume only queries without a
  terminal receipt.
- Persists each completed or failed query receipt immediately. Exact retries of
  terminal runs return stored evidence without another provider call.
- Checks current task authority before each new paid call. A response already
  authorized at revision R may persist as historical R evidence if truth changes
  in flight; no subsequent query starts after the newer revision is observed.
- Exactly-once charging cannot be guaranteed if a provider accepts a request and
  the process dies before its receipt commits. The lease is deliberately left to
  expire after ambiguous post-call failures so an immediate retry cannot double
  issue; provider-side idempotency would be required to remove that final window.
- Migration `0008_melodic_wallop.sql` adds only the immutable subject binding,
  one-run-per-action uniqueness, and paired lease fields, with private-table
  privileges revoked.

### Layer 4 — first honest live founder flow

Independently accepted at
`370a4ab6be8a99f25d3fb8b6b848a3fcb0589157`; intentionally unmerged.

- Adds a dedicated calm consumer `/live` route while preserving `/` as the V0-02
  fixture regression surface.
- Creates one real GB / GBP / en-GB task, records its immutable subject, runs the
  real V0-05 coordinator, renders the deterministic brief, supports persisted
  ASK answers, and executes/resumes the accepted Layer-3 SEARCH boundary.
- Uses one narrow private founder-session row to bind browser retry keys to
  server-owned task/action/input identities and to recover an interrupted
  context turn. No auth, account, global preference or client-selected domain
  ID was introduced.
- Loads completed persisted runs on refresh without OpenAI/Serper dependency
  construction or another provider call. Active and interrupted work has an
  explicit safe recovery path.
- Recovers the exact persisted answer when a process stops after the V2 ASK
  answer commits but before the founder-session pending pointer commits. The
  saved answer becomes pending work and the old question is not presented as
  answerable again.
- Orders visible listings by the persisted query-portfolio ordinal and then
  provider source rank, rather than random query UUID order. Presentation-only
  overlap counts distinct query IDs and uses canonical URL as an additional
  conservative grouping boundary.
- Renders only factual persisted listing fields. It does not claim suitability,
  ranking, product facts, confidence or recommendation.
- Migration `0009_easy_arachne.sql` adds only the local founder-session binding
  and revokes private-table access from PUBLIC and Supabase client roles.
- Real application proof: a light breathable running-cap request produced two
  explicit brief items, two successful Serper query receipts and 16 persisted
  UK listing rows. Multiple refreshes left exactly one task, subject and run.
- Post-review founder use also exercised headphones. An explicit unresolved
  comfort-versus-ANC priority produced the intended ASK. A less explicit
  around-£150 request searched directly and returned factual rows from £44.99
  to £349, demonstrating that retrieval works but suitability/price judgement
  is now the dominant visible product gap.
- Durable evidence is in `docs/spikes/v0-06-live-founder-flow.md`.

### Layer 5 — recursive refinement, saves and retrieval triage

Implemented and independently accepted as part of the V0-06 checkpoint at
`d32fbd7ca46d15dc645dacf20617e9c81ca36ac0`; intentionally unmerged.

- Adds natural same-task refinement through the real V0-05 coordinator. The
  original subject remains immutable while each new shopper turn can patch the
  current authoritative brief and trigger a new SearchRun.
- Adds exact task-local save/unsave persistence. Saved listing provenance
  survives later runs and refresh without becoming a ProductIdentity,
  preference or recommendation.
- Uses three distinct query jobs—concise literal precision, directly searchable
  hard/strong constraints and unresolved preferences—with exact criterion-basis
  lineage for included phrases only.
- Adds deliberately narrow pre-judgement triage for observed hard price-ceiling
  conflicts and explicit multiword categorical exclusions. Unsupported product
  properties remain unknown; there is still no suitability ranking.
- Carries a merchant-direct destination only when the provider supplies a
  validated non-Google HTTP(S) URL. The real UK mouse run supplied none, so the
  UI honestly retained Google Shopping fallbacks.
- Real founder proof stayed on one task through three revisions and three
  SearchRuns, preserved two saved offers, generated a 3-query/24-row current
  pool, withheld six direct conflicts and reloaded without another provider
  call.
- Long natural requests are clamped with an explicit full-request disclosure so
  results remain dominant while the original words remain inspectable.
- Durable evidence is in
  `docs/spikes/v0-06-recursive-founder-evidence.md`.

### Layer 6 — verified destinations and honest listing evidence

Implemented at `b112430` and extended with structured retailer rating evidence
at `aa9e1463c668c7bb576d758316bea84654329e5c`; independently accepted as part of
the V0-06 checkpoint at `d32fbd7ca46d15dc645dacf20617e9c81ca36ac0`
and intentionally unmerged.

- Enriches a bounded number of Google Shopping rows through an exact
  title/merchant organic lookup under the existing provider deadline.
- Accepts only retailer-like HTTPS pages with matching merchant host, strong
  title coverage and discriminative brand/model identity. Generic products,
  Google pages, aggregators, search/category pages and host mismatches keep the
  honest Google Shopping fallback.
- Stores destination provenance as `shopping_result` or `verified_organic` and
  keeps the original Shopping source. Migration `0011` backfills existing
  direct rows and enforces URL/provenance coherence.
- Presentation-only exact title/merchant/price grouping removes six duplicate
  rows in the latest 24-row pool without deleting source rows or creating
  `ProductIdentity`.
- Withholds explicit wired titles when wireless is hard, while titles that say
  neither remain unknown.
- Shows directly observed price/wireless support separately from unverified
  comfort, battery, reviews, shape and brand quality. There is no fabricated
  suitability score or recommendation.
- Preserves a structured rating/count only when it comes from the exact organic
  result whose title, merchant host and direct product URL already passed the
  merchant-destination verifier. The UI labels this as retailer evidence; it
  does not silently turn a 4.6/5 rating into a claim that the shopper's
  qualitative review preference is satisfied.
- Migration `0012_overrated_black_cat.sql` stores the rating, count and exact
  evidence URL together and rejects incomplete or mismatched provenance.
- Additive migration `0013_melodic_roland_deschain.sql` makes the populated
  destination and review branches explicitly require every participating
  nullable field, closing PostgreSQL CHECK-constraint NULL semantics.
- The correction pass adds a deterministic, server-owned organic-result
  relevance gate before candidate EvidenceSource insertion. Generic,
  search/category, comparison, mismatched-model, and ambiguous results remain
  untrusted and are discarded; the B&Q phone-case regression proves this
  boundary.
- `money_stretch` now preserves signed distance from the target: exact target
  can meet, cheaper is not an automatic target match, above-target options stay
  conditional within stretch, and above-ceiling options conflict without an
  invented tolerance.
- Boolean assessment now admits only criterion-relevant, sufficiently strong
  evidence; visual-only or weak evidence cannot hard-exclude, supported
  disagreement is explicit uncertainty, and soft visual mismatch is a
  preference watchout rather than a hidden exclusion.
- Absolute money ceilings now remove above-ceiling candidates from best-supported
  purchase options without deleting their persisted research. Target-distance
  uncertainty and inside-stretch conditional options remain eligible, while
  comparative stretch requires evidence that actually expresses comparison;
  “good support” alone is insufficient.
- Presentation-only grouping now removes exact repeated title/merchant/price
  offers when direct destinations do not contradict, while keeping distinct
  verified destinations separate. The fresh mouse proof no longer repeats the
  Anker offer.
- Real same-task proof reached revision 6, exercised relaxation, preference
  changes, use-case acquisition, ASK/answer, save, refresh and exact unsave.
- Durable evidence and responsive screenshots are in
  `docs/spikes/v0-06-recursive-founder-evidence.md` and
  `artifacts/screenshots/v0-06-recursive/`.

## Completed V0-07 evidence and assessment

V0-07 is independently accepted at
`149f93cd43092996e20621e8976003b341a82c6a` in stacked draft PR #11. It adds
selective attributable evidence acquisition, typed task/run-scoped product
observations, revision-scoped criterion assessments, deterministic money and
boolean guards, assessment-driven product ordering, conservative exact-offer
presentation grouping, and exact saved-listing comparison. Unknown remains a
valid result and cannot become a conflict or a suitability claim through
absence of evidence.

## Current V0-08 founder decision loop

V0-08 is implemented in the active isolated branch. Its one bounded independent
review is complete and all four material findings are closed. It awaits its
final commit, stacked draft PR and exact-head CI.

- Decision readiness is derived, qualitative and score-free: qualified, needs
  verification, trade-off or ineligible.
- Hard unknowns sort before ordinary preference support without being relabelled
  as conflicts. Section and badge language stays conservative when no product
  resolves all must-haves.
- Factual listings appear before evidence research. The browser can trigger
  only server-owned idempotent first-pass and deepening actions.
- First pass researches at most four exact listings with one combined search
  each. Deepening normally targets two leading/saved candidates and at most two
  unresolved high-authority criteria per candidate. Completed criterion work
  is not repeated.
- Assessment generations are append-only. A successful later generation
  supersedes the former current projection; a failed deep model call preserves
  prior evidence and is now projected as failed rather than “complete.”
- Exact task-local `Not for me` is idempotent, atomically unsaves, survives
  refresh, supports undo without silent re-save, and never changes shopper
  truth or task revision.
- Saved comparison now foregrounds must-haves, actual evidenced differences,
  important unknowns, observed price/target relationship and retailer exits.
  It does not manufacture a winner when assessment states are tied. All saved
  listings remain present even before assessment, and an atomic task-locked cap
  limits the comparison to four.
- Criterion assessments may cite only observations scoped to their exact
  criterion concept. Purchase price uses the persisted offer price; delivery,
  running and other money concepts require their own scoped evidence. These
  boundaries are enforced at provider parsing, policy and persistence layers.
- Research target persistence now matches the authoritative/provider maximum
  of 50 criteria; a 13-criterion PostgreSQL regression protects the boundary.
- The first destination-cost diagnostic spent 25 merchant lookups for only one
  useful top-card direct link. The bounded policy now checks at most the leading
  distinct merchant per shopping query; the exact-code release proof used 9
  lookups across 12 shopping queries.
- Fresh real Terra + Serper evidence covers ergonomic mouse plus refinement,
  office chair, and cordless vacuum in guarded disposable databases. Sanitized
  evidence is in `docs/evals/v0-08-live-founder-proof.{json,md}`.
- Eight production-rendered desktop/mobile screenshots cover automatic,
  decision, comparison, rejection, refinement, verification and partial
  research states in `docs/screenshots/v0-08/`.

V0-05 PR #9, V0-06 PR #10 and V0-07 PR #11 remain unmodified and unmerged.
V0-09 has not started.

## Next validated checkpoints

1. Commit and push `codex/v0-08-founder-decision-loop`, open a draft stacked PR
   against `codex/v0-07-evidence-assessment`, and wait for exact-head quality,
   pinned PostgreSQL persistence and browser-smoke CI.
2. Stop for founder review. Do not merge any stacked PR and do not start V0-09.
3. After V0-08 acceptance, use the measured leave-the-app gaps to choose the
   next smallest product layer. Direct destination coverage and richer
   decision-critical sources remain real gaps; do not turn them into a crawler
   or fabricate personal-fit evidence.

## Credentials and blockers

- `SERPER_API_KEY` is stored only in macOS Keychain service
  `ai-shopping-serper`. Never print it or write it to the repository. Live
  Serper retrieval has already succeeded.
- The OpenAI key is stored separately in Keychain service
  `ai-shopping-openai`. It is used by the isolated V0-05 release verification
  and the bounded V0-07 founder proof; it must not be copied into repository
  files or logs.
- Local PostgreSQL is running on loopback with guarded base database
  `ai_shopping_test`; test commands pass the URL only to the process. The local
  server is 17.11 while the repository deliberately pins CI to 17.6.
- The full local database suite therefore reports one expected version-pin
  assertion failure. Do not weaken the pin to make the local result green.
- Public deployment/auth and any second paid provider remain unresolved
  product/security decisions. The current bounded Serper policy performs at
  most one merchant-resolution attempt per shopping query and still leaves most
  top/saved products on an honest Google Shopping fallback. Moving resolution
  post-shortlist requires an immutable enrichment boundary and remains a
  measured product gap, not permission for scraping or a second paid vendor.

## Latest verification

- `pnpm check`: formatting, lint, generated route types, strict TypeScript,
  200/200 deterministic unit/component tests and the production build pass on
  the final V0-08 working tree.
- Focused V0-08 PostgreSQL suites: 17/17 pass, including progressive research,
  append-only assessment generations, failed-deep preservation, exact
  criterion/evidence scope, 13-criterion targeting, concurrent save caps,
  reject/undo, cross-task rejection and revision preservation.
- Full PostgreSQL suite: 107/107 functional tests pass. The sole local failure
  is the intentional PostgreSQL 17.6 version assertion against Homebrew 17.11.
- `pnpm test:e2e`: 8/8 Chromium tests pass, including automatic first/deep
  research, two saves, decision comparison, exact rejection/undo, refinement,
  refresh, mobile hard-unknown presentation and no horizontal overflow.
- `pnpm db:generate`: no schema drift after migration 0015. A guarded empty
  database applied all 16 migrations and was dropped.
- `pnpm audit --prod` reports no known production dependency vulnerabilities;
  `git diff --check` and the changed-file secret-pattern scan are clean.
- Exact-code real Terra + Serper proof: 12 shopping queries, 9 merchant
  resolution calls, 27 evidence searches and 29 product-understanding calls
  across mouse (including refinement), chair and vacuum. Mouse plus chair used
  20 evidence searches versus V0-07's 40 while using 22 understanding calls
  versus 20. Important unresolved facts remained unknown.
- Mouse hard unknowns moved 12 → 6 → 6; top/saved direct coverage was 1/4 and
  0/2. Chair had no explicit hard criteria and correctly preserved target versus
  conditional-stretch semantics; direct coverage was 0/4 and 0/2. Vacuum hard
  unknowns moved 12 → 8 → 8 and floor/noise stayed unresolved; direct coverage
  was 0/4 and 0/2.
- All three real journeys exercised two saves, atomic reject+unsave, undo without
  re-save, comparison and reload. The mouse refinement changed current
  authoritative priorities and allocated new research without rewriting the
  immutable subject or old assessments.
- Eight production-rendered desktop/mobile/partial screenshots passed explicit
  horizontal-overflow checks and were inspected visually after the final
  decision-gap action correction.
- Production dependency audit: no known vulnerabilities. Local diff, drift and
  changed-file secret checks are clean; exact-head CI remains the delivery-tail
  check after commit and push.

## Exact resume instructions

1. Work only in
   `/Users/alchemist32/Documents/AI Shopping/ai-shopping-v0-08-founder-loop` on
   `codex/v0-08-founder-decision-loop`; confirm branch, stacked base, exact head
   and tree state first.
2. Read this file, `docs/plans/v0-08.md` and the concise
   `docs/evals/v0-08-live-founder-proof.md`. Do not reopen accepted
   V0-03/V0-04/V0-06/V0-07 architecture.
3. Preserve V0-05 PR #9, V0-06 PR #10 and V0-07 PR #11 exactly. Do not merge
   them and do not weaken V0-05's Terra rule.
4. If exact-head CI or founder review reports a material issue,
   make only a bounded V0-08 correction and rerun affected plus full gates.
   Never weaken unknown, evidence, money, task authority or revision boundaries.
5. Keep the V0-08 PR draft and stacked on
   `codex/v0-07-evidence-assessment`. Do not begin V0-09, ProductIdentity,
   crawling, auth, deployment, checkout or affiliate work.
6. After exact-head quality/persistence/browser-smoke are green, leave the
   worktree clean and stop for founder review.
