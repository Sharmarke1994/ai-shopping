# Founder MVP progress

**Updated:** 2026-08-28 Europe/London
**Durable goal:** Deliver a polished founder-usable AI shopping MVP whose live
understanding, market retrieval, evidence-aware evaluation, refinement, saving,
and comparison are meaningfully better than beginning with Google.

## Authoritative checkpoints

- Repository: `Sharmarke1994/ai-shopping`.
- Founder-MVP execution brief: `docs/plans/founder-usable-mvp.md`.
- Active isolated worktree:
  `/Users/alchemist32/Documents/AI Shopping/ai-shopping-v0-07-evidence`.
- Active branch: `codex/v0-07-evidence-assessment`, stacked on independently
  accepted V0-06 `d32fbd7ca46d15dc645dacf20617e9c81ca36ac0`.
- Latest product implementation checkpoint:
  the bounded V0-07 money/presentation correction pass is being finalized in
  stacked draft PR #11. It preserves the evidence/assessment decision-support
  boundaries; the final pushed SHA and exact-head CI must be recorded here
  before independent review.
  V0-06 remains draft PR #10 and is not merged.
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

## Current work

V0-06 is accepted at `d32fbd7ca46d15dc645dacf20617e9c81ca36ac0`.
V0-07 is implemented on `codex/v0-07-evidence-assessment` in stacked draft PR
#11. The current correction pass adds deterministic evidence admission,
target-distance and absolute-ceiling semantics, comparative stretch guards,
source-aware boolean assessment guards, and conservative exact-offer
presentation grouping while preserving bounded selective research, typed
observations, revision-scoped assessments, deterministic ordering, top-option
support and exact saved-listing comparison. V0-05 PR #9 and V0-06 PR #10
remain unmodified and unmerged; no later layer has started.

## Next validated checkpoints

1. Obtain exact-head quality/persistence/browser CI on the final correction
   handoff head of stacked draft PR #11, then stop for independent review.
2. If review finds a material issue, make only a bounded V0-07 correction and
   rerun the affected plus full gates. Do not weaken unknown/evidence boundaries.
3. After acceptance only: bare reject/undo, kept task-local to the acted-on
   listing without preference learning.
4. Expand source quality or selective page inspection only from measured
   decision-critical gaps; do not turn V0-07 into a crawler.
5. Continue unrelated-category founder journeys, resilience, security/privacy,
   deployment and founder handoff as separately reviewed checkpoints.

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
  product/security decisions. The bounded Serper organic experiment produced
  two useful visible direct destinations and structured rating evidence in the
  latest UK run; it can spend up to nine additional lookups per three-query run
  and should move post-triage at shortlist scale before broader founder use.

## Latest verification

- `pnpm check`: formatting, lint, generated route types, strict TypeScript,
  185/185 deterministic unit/component tests, production build — pass.
- Focused V0-07 PostgreSQL suite: 10/10 pass, including the unrelated-organic
  result rejection regression and one-snapshot current decision support under
  a concurrent authoritative revision.
- Full PostgreSQL suite: 100 functional tests pass; the sole failure is the
  intentional PostgreSQL 17.6 pin against local Homebrew 17.11.
- `pnpm test:e2e`: 8/8 Chromium tests pass, including research → two exact
  saves → comparison → refinement → revision-specific reassessment → refresh,
  plus mobile ASK → answer → SEARCH → research.
- `pnpm db:generate`: no schema drift after migration 0014. A guarded empty
  database applied all 15 migrations, then was dropped.
- Real Terra + Serper proof: 2 tasks, 3 SearchRuns, 72 raw listings, 4 bounded
  research runs, 40/40 successful evidence searches, 69 attributable sources,
  131 observations, 148 assessments, 90 unknown assessments, 2 observations
  reused across revisions, and 20/20 understanding calls. The mouse refinement
  contains no repeated exact Anker presentation offer and keeps battery,
  reputation and personal comfort unknown where evidence is insufficient. The
  chair best-supported options contain no product above the £350 stretch
  ceiling; below-target prices retain signed distance and comparative stretch
  is not satisfied by “good support over long sessions” alone. No B&Q
  phone-case, GXT926, Bayo+, or e-catalog false-positive evidence source was
  persisted; rejected organic rows remain only in received counts.
- Six production-rendered desktop/mobile/partial screenshots passed explicit
  horizontal-overflow checks. The fixture shell, top options, source disclosure,
  comparison table and partial-research state were inspected visually.
- Production dependency audit: no known vulnerabilities.
- `git diff --check` and changed-value secret scan: pass.
- The final correction handoff requires a new exact-head GitHub Quality,
  pinned PostgreSQL 17.6 persistence, and browser-smoke run before review.

## Exact resume instructions

1. Work only in
   `/Users/alchemist32/Documents/AI Shopping/ai-shopping-v0-07-evidence` on
   `codex/v0-07-evidence-assessment`; confirm the branch, exact head and clean
   tree first.
2. Read this file, `docs/plans/v0-07.md` and the concise
   `docs/evals/v0-07-live-founder-proof.md`; inspect stacked V0-07 draft PR #11
   and exact-head CI. Do not reopen accepted V0-03/V0-04/V0-06 architecture.
3. Preserve the original V0-05 checkout and draft PR #9 exactly; do not merge it
   and do not weaken its Terra gate.
4. Keep both the V0-06 and stacked V0-07 PRs draft and unmerged. Do not begin
   reject/undo, ProductIdentity, crawling, auth, deployment or later work while
   V0-07 review is pending.
5. If review finds a material issue, make only the bounded V0-07 correction and
   rerun the affected plus full gates. Never weaken the evaluator, unknown state,
   evidence authority or V0-04/V0-05 firewall to obtain a pass.
6. Do not merge automatically, start V0-08, or broaden evidence acquisition.
   Stop after exact-head CI for independent review.
