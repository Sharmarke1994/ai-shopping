# Founder MVP progress

**Updated:** 2026-08-27 11:55 Europe/London
**Durable goal:** Deliver a polished founder-usable AI shopping MVP whose live
understanding, market retrieval, evidence-aware evaluation, refinement, saving,
and comparison are meaningfully better than beginning with Google.

## Authoritative checkpoints

- Repository: `Sharmarke1994/ai-shopping`.
- Founder-MVP execution brief: `docs/plans/founder-usable-mvp.md`.
- Isolated product-progress worktree:
  `/Users/alchemist32/Documents/AI Shopping/ai-shopping-v0-06-spike`.
- Experimental branch: `codex/v0-06-retrieval-spike`.
- Latest product checkpoint: exact-source structured retailer review evidence
  at `aa9e1463c668c7bb576d758316bea84654329e5c`, followed only by the docs
  checkpoint containing this ledger update. It belongs in draft PR #10 and
  awaits independent review. GitHub Quality run `33065000397` passed quality,
  persistence and browser-smoke on its parent docs head `f3837ec`. Layer 4
  remains the latest independently accepted checkpoint at
  `370a4ab6be8a99f25d3fb8b6b848a3fcb0589157`; this Layer 4 checkpoint was
  independently accepted before the current recursive/evidence work.
- Original V0-05 checkout and draft PR #9 remain separate, unmodified, unmerged,
  and formally unaccepted. Its last instructed checkpoint is `9c33018`; the
  latest Terra release gate completed 14/21 on 24 August 2026. All seven failed
  runs were provider-only connection/timeout failures and all 14 completed runs
  passed the protected semantic measures.
  The 21/21 Terra rule has not been weakened and Luna remains diagnostic only.
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

Implemented in the checkpoint containing this ledger; pending independent
review and intentionally unmerged.

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

Implemented in the checkpoint containing this ledger; pending founder and
independent review and intentionally unmerged.

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

Implemented in the current unmerged checkpoint.

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
at `aa9e1463c668c7bb576d758316bea84654329e5c`; experimental, unmerged and
awaiting independent review.

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
- Real same-task proof reached revision 6, exercised relaxation, preference
  changes, use-case acquisition, ASK/answer, save, refresh and exact unsave.
- Durable evidence and responsive screenshots are in
  `docs/spikes/v0-06-recursive-founder-evidence.md` and
  `artifacts/screenshots/v0-06-recursive/`.

## Current work

V0-06 is accepted at `d32fbd7ca46d15dc645dacf20617e9c81ca36ac0`.
V0-07 is now isolated on `codex/v0-07-evidence-assessment` in
`/Users/alchemist32/Documents/AI Shopping/ai-shopping-v0-07-evidence`.
`docs/plans/v0-07.md` freezes the evidence-source, typed-observation,
revision-scoped assessment, selective-research, assessment-ordering and saved
comparison boundary before implementation. V0-05, PR #9 and V0-06 PR #10
remain unmodified and unmerged.

## Next validated checkpoints

1. Founder and independent review of the recursive `/live` loop, real mouse
   evidence, exact saves and rendered desktop/mobile behaviour.
2. Selective exact-source evidence acquisition for a small promising pool,
   followed by persisted evidence-backed observations and criterion-level
   assessment. Search snippets remain merchant assertions and must not become
   hard-exclusion evidence or objective comfort claims.
3. Bare reject/undo, kept task-local to the acted-on listing without preference
   learning.
4. Shortlist and 2–4 item comparison against the shopper's current criteria.
5. Responsive visual iteration, unrelated-category founder journeys, resilience,
   security/privacy review, and founder handoff.

## Credentials and blockers

- `SERPER_API_KEY` is stored only in macOS Keychain service
  `ai-shopping-serper`. Never print it or write it to the repository. Live
  Serper retrieval has already succeeded.
- The OpenAI key is stored separately in Keychain service
  `ai-shopping-openai`. It belongs to the isolated V0-05 release verification
  and must not be copied into repository files or logs.
- Local PostgreSQL is running on loopback with guarded base database
  `ai_shopping_test`; test commands pass the URL only to the process. The local
  server is 17.11 while the repository deliberately pins CI to 17.6.
- The full local database suite therefore reports one expected version-pin
  assertion failure. Do not weaken the pin to make the local result green.
- Public deployment/auth and any second paid provider remain unresolved
  product/security decisions. The bounded Serper organic experiment produced
  two useful visible direct destinations and structured rating evidence in the
  latest UK run; it can spend up to nine additional lookups per three-query run
  and should move post-triage at shortlist scale before broader founder use.

## Latest verification

- `pnpm check`: formatting, lint, generated route types, strict TypeScript,
  158/158 deterministic unit/component tests, production build — pass.
- Full PostgreSQL suite: 90 functional tests pass; the sole failure is the
  intentional PostgreSQL 17.6 pin against local Homebrew 17.11.
- `pnpm test:e2e`: 8/8 Chromium tests pass, including `/live` direct + refresh
  plus save → refine → new SearchRun → refresh and mobile ASK → answer → SEARCH.
- `pnpm db:generate`: no schema drift after migration 0013.
- PostgreSQL raw-write regression coverage rejects all eight incomplete or
  mismatched destination/review provenance tuples while accepting the three
  valid nullable/verified shapes.
- Real recursive `/live` proof: one task at revision 6, immutable subject,
  purpose-labelled three-query current run, 24 exact rows, 18 exact offer
  groups, 12 direct-conflict rows withheld, two useful visible merchant pages,
  five exact rating-evidence rows, ASK/answer, exact save, refresh and exact
  unsave. Visible cards report Anker 4.3/5 from 52,629 Amazon reviews and Trust
  4.6/5 from 29 Argos reviews without claiming either meets the shopper's
  qualitative review criterion.
- Desktop and 390 × 844 rendered inspection: evidence/unknown labels remain
  readable, direct/source links retain hierarchy and mobile has no horizontal
  overflow.
- Production dependency audit: no known vulnerabilities.
- `git diff --check` and changed-value secret scan: pass.
- GitHub Quality run `33071030456` on exact head
  `962f9405655ed84cde0a39b8ea94e01db374b538`: quality, PostgreSQL 17.6
  persistence and browser-smoke all pass.
- Independent Layer-3 read-only review: no material implementation blocker;
  the unavoidable post-provider/pre-receipt crash ambiguity is documented.

## Exact resume instructions

1. Work only in
   `/Users/alchemist32/Documents/AI Shopping/ai-shopping-v0-06-spike` on
   `codex/v0-06-retrieval-spike`; confirm the branch and clean tree first.
2. Read this file and
   `docs/spikes/v0-06-recursive-founder-evidence.md`; inspect the exact-head PR
   #10 CI. Do not reopen accepted V0-03/V0-04 or Layer-3 architecture.
3. Preserve the original V0-05 checkout and draft PR #9 exactly; do not merge it
   and do not weaken its Terra gate.
4. Keep PR #10 draft and unmerged. Do not start reject/undo, full evidence
   acquisition, comparative judgement, shortlist or comparison while the
   current structured-review-evidence checkpoint's CI/review is pending.
5. If review finds a material issue, make only the bounded correction and rerun
   the affected/full gates.
6. Do not merge automatically. After acceptance, the next bounded product layer
   is selective source evidence and persisted candidate observations/criterion
   assessments for a small pool, with unknowns kept visible.
