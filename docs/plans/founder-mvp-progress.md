# Founder MVP progress

**Updated:** 2026-08-24 16:16 Europe/London
**Durable goal:** Deliver a polished founder-usable AI shopping MVP whose live
understanding, market retrieval, evidence-aware evaluation, refinement, saving,
and comparison are meaningfully better than beginning with Google.

## Authoritative checkpoints

- Repository: `Sharmarke1994/ai-shopping`.
- Founder-MVP execution brief: `docs/plans/founder-usable-mvp.md`.
- Isolated product-progress worktree:
  `/Users/alchemist32/Documents/AI Shopping/ai-shopping-v0-06-spike`.
- Experimental branch: `codex/v0-06-retrieval-spike`.
- Latest completed pushed checkpoint: Layer 2 plus its durable ledger at
  `775311e7670519ab14c9d078cb14398961a0f8ff`. Layer 3 is represented by the
  commit containing this ledger update; do not try to embed that commit's own
  future SHA here.
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

## Current work

Layer 3 implementation and verification are complete. The branch must now stop
for independent review. No `/live` route, result UI, save/reject, refinement,
evidence, assessment, ranking, comparison, auth, or deployment work has started.

## Next validated checkpoints

1. Independent review and acceptance of the Layer-3 subject/trigger and
   idempotent resume boundary.
2. Founder-usable `/live` route with task creation, visible current brief,
   clarification, retrieval progress, factual real results, partial/failure
   states, and refresh-safe exact-run loading.
3. Exact-listing save/reject plus natural refinement and re-search. Bare reject
   remains task-local to the acted-on listing and undoable.
4. Bounded evidence acquisition, evidence-backed observations, criterion-level
   assessment, suitability judgement, and visible unknowns.
5. Shortlist and 2–4 item comparison against the shopper's current criteria.
6. Responsive visual iteration, unrelated-category founder journeys, resilience,
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
- Direct merchant URLs, public deployment/auth, and any second paid provider are
  unresolved product/security decisions. They are not blockers for the private
  local founder loop.

## Latest verification

- `pnpm check`: formatting, lint, generated route types, strict TypeScript,
  131/131 deterministic unit/component tests, production build — pass.
- Focused Layer-3 PostgreSQL suites: 23/23 pass across authority snapshots,
  retrieval persistence, and orchestration.
- Full PostgreSQL suite: 78 functional tests pass; the sole failure is the
  intentional PostgreSQL 17.6 pin against local Homebrew 17.11.
- `pnpm test:e2e`: 6/6 browser smoke tests pass; no UI changed in Layer 3.
- Second `pnpm db:generate`: no schema drift after migration 0008.
- Production dependency audit: no known vulnerabilities.
- `git diff --check` and changed-value secret scan: pass.
- Independent Layer-3 read-only review: no material implementation blocker;
  the unavoidable post-provider/pre-receipt crash ambiguity is documented.

## Exact resume instructions

1. Work only in
   `/Users/alchemist32/Documents/AI Shopping/ai-shopping-v0-06-spike` on
   `codex/v0-06-retrieval-spike`; confirm the branch and clean tree first.
2. Read this file and inspect the Layer-3 commit/independent review status. Do not
   reopen accepted V0-03/V0-04 architecture.
3. Preserve the original V0-05 checkout and draft PR #9 exactly; do not merge it
   and do not weaken its Terra gate.
4. Do not change Layer 3 or start `/live` while independent review is pending.
5. If review finds a material issue, make only the bounded correction and rerun
   the affected/full gates.
6. Do not merge automatically. After acceptance, the next bounded product layer
   is the honest live consumer route described above.
