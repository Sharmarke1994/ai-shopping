# Founder MVP progress

**Updated:** 2026-08-23 23:05 Europe/London
**Durable goal:** Deliver a polished founder-usable AI shopping MVP whose live
understanding, market retrieval, evidence-aware evaluation, refinement, saving,
and comparison are meaningfully better than beginning with Google.

## Authoritative checkpoints

- Repository: `Sharmarke1994/ai-shopping`.
- Founder-MVP execution brief: `docs/plans/founder-usable-mvp.md`.
- Isolated product-progress worktree:
  `/Users/alchemist32/Documents/AI Shopping/ai-shopping-v0-06-spike`.
- Experimental branch: `codex/v0-06-retrieval-spike`.
- Current pushed V0-06 head: `a3f6e33dc30954467db9a6f8c4d70cc7711f9c6b`.
- Original V0-05 checkout and draft PR #9 remain separate, unmodified, unmerged,
  and formally unaccepted. Its last instructed checkpoint is `9c33018`; the
  latest known Terra release gate completed 19/21, with both failures at the
  provider connection layer and all model-completed runs semantically passing.
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

## Current work

Layer 3 is next: normal conversation-to-search orchestration, then the first
honest live consumer route. The accepted narrow design is:

1. Add a V0-06-owned immutable `shopping_task_subjects` binding from a task to
   its real persisted initial user message. The subject is not a criterion.
2. Keep the SEARCH-causing input separately as trigger provenance. In an
   ASK → answer → SEARCH flow, the answer is the trigger but the initial shopper
   message remains the shopping subject.
3. Load `{subject, trigger, current state, deterministic brief, SEARCH action}`
   in one coherent snapshot and persist the search plan before provider calls.
4. Add an explicit idempotent retrieval-trigger identity before any paid POST
   can be retried after a lost HTTP response.
5. Build a separate `/live` consumer path; retain `/` as the fixture regression
   harness. Live cards must show factual retrieved fields only and must not
   invent suitability, trade-offs, ranking, or deduplication before those layers
   exist.

## Next validated checkpoints

1. Normal message → ASK or SEARCH and ASK → answer → SEARCH orchestration with
   stable subject/trigger provenance and exact retries.
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
  assertion failure; all 66 functional database tests pass. Do not weaken the
  pin to make the local result green.
- Direct merchant URLs, public deployment/auth, and any second paid provider are
  unresolved product/security decisions. They are not blockers for the private
  local founder loop.

## Latest verification

At pushed Layer-2 head `a3f6e33`:

- `pnpm db:generate`: no unexplained schema drift.
- `pnpm check`: formatting, lint, generated route types, TypeScript, 131/131
  deterministic unit/component tests, and production build pass.
- Focused retrieval persistence PostgreSQL suite: 7/7 pass.
- Full PostgreSQL suite: 66 functional tests pass; only the intentional
  PostgreSQL 17.6-vs-local-17.11 version assertion fails.
- Production dependency audit: no known vulnerabilities.
- `git diff --check`: pass.
- Secret-value scan: pass.
- Independent Layer-2 rereview: approved with no material blocker after the
  run-lock and catalogue-ID corrections.

## Exact resume instructions

1. Work only in
   `/Users/alchemist32/Documents/AI Shopping/ai-shopping-v0-06-spike` on
   `codex/v0-06-retrieval-spike`; confirm the branch and clean tree first.
2. Read this file and only the Layer-3-relevant V0-05 persistence/coordinator,
   retrieval context, and live UI seams. Do not reopen accepted V0-03/V0-04
   architecture.
3. Preserve the original V0-05 checkout and draft PR #9 exactly; do not merge it
   and do not weaken its Terra gate.
4. Implement the stable task subject / current trigger distinction first, with
   database constraints, exact retries, cross-task/stale rejection, and an
   ASK → answer → SEARCH integration test.
5. Add durable retrieval-trigger idempotency before issuing paid provider calls
   from an HTTP request.
6. TEST → COMMIT → PUSH each coherent layer, update this ledger, and continue.
7. Do not merge automatically. Stop only for a real credential, paid-vendor,
   security/privacy, consequential product, or accepted-architecture blocker.
