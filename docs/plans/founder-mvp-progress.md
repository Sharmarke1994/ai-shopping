# Founder MVP progress

**Updated:** 2026-08-26 16:46 Europe/London
**Durable goal:** Deliver a polished founder-usable AI shopping MVP whose live
understanding, market retrieval, evidence-aware evaluation, refinement, saving,
and comparison are meaningfully better than beginning with Google.

## Authoritative checkpoints

- Repository: `Sharmarke1994/ai-shopping`.
- Founder-MVP execution brief: `docs/plans/founder-usable-mvp.md`.
- Isolated product-progress worktree:
  `/Users/alchemist32/Documents/AI Shopping/ai-shopping-v0-06-spike`.
- Experimental branch: `codex/v0-06-retrieval-spike`.
- Latest product checkpoint: recursive founder shopping at
  `b158e1e7b828fe097cb1fbc5663a7f13c93165ae`, followed only by the docs-only
  checkpoint commit containing this ledger update. It is pushed in draft PR #10
  and awaits independent review. Layer 3 remains the latest independently
  accepted checkpoint at `870356f5642923618186e794419d39116f62e54c`.
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

## Current work

The recursive `/live` founder loop, exact saves, query-strategy correction,
bounded hard-conflict triage and live ergonomic-mouse proof are implemented.
The current checkpoint is being packaged for exact-head CI and independent
review. Reject/undo, product evidence, assessment, ranking, comparison, auth and
deployment have not started.

## Next validated checkpoints

1. Founder and independent review of the recursive `/live` loop, real mouse
   evidence, exact saves and rendered desktop/mobile behaviour.
2. Bounded evidence acquisition, evidence-backed observations, criterion-level
   assessment, suitability judgement, and visible unknowns.
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
  product/security decisions. Merchant-direct URLs are supported when Serper
  supplies a validated destination, but live UK coverage is currently 0/24.

## Latest verification

- `pnpm check`: formatting, lint, generated route types, strict TypeScript,
  149/149 deterministic unit/component tests, production build — pass.
- Full PostgreSQL suite: 88 functional tests pass; the sole failure is the
  intentional PostgreSQL 17.6 pin against local Homebrew 17.11.
- `pnpm test:e2e`: 8/8 Chromium tests pass, including `/live` direct + refresh
  plus save → refine → new SearchRun → refresh and mobile ASK → answer → SEARCH.
- Second `pnpm db:generate`: no schema drift after migration 0010.
- Real recursive `/live` proof: one task at revision 3, three inputs, immutable
  subject, three SearchRuns, two saved listings and 24 exact rows in the current
  three-query run; 18 remained visible after six direct conflicts were withheld.
- Desktop and 390 × 844 rendered inspection: long requests remain inspectable
  without displacing the current product pool; no horizontal overflow or
  browser console warning/error was observed.
- Production dependency audit: no known vulnerabilities.
- `git diff --check` and changed-value secret scan: pass.
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
4. Keep PR #10 draft and unmerged. Do not start reject/undo, evidence,
   judgement, ranking, shortlist or comparison while review is pending.
5. If review finds a material issue, make only the bounded correction and rerun
   the affected/full gates.
6. Do not merge automatically. After acceptance, the next bounded product layer
   is evidence-backed candidate understanding and criterion assessment for a
   small pool, with unknowns kept visible.
