# Founder MVP progress

**Updated:** 2026-08-21 17:47 Europe/London
**Durable goal:** Deliver a polished founder-usable AI shopping MVP whose live
understanding, market retrieval, evidence-aware evaluation, refinement, saving,
and comparison are meaningfully better than beginning with Google.

## Repository checkpoint

- Repository: `Sharmarke1994/ai-shopping`
- Merged `main`: `6cd0ec83ec6e5c807ecc57de83c0c9a99b2e2ce0`
- Current branch: `codex/v0-05-implementation`
- Current branch base: merged V0-05 planning checkpoint `6cd0ec8`.
- Current V0-05 implementation commit: `bf62eb1`, with durable progress update
  `8ae4b86`; pushed for review as draft PR #9.
- Closed checkpoint: PR #8, `V0-05: plan AI interpretation and context
  acquisition`, squash-merged after quality, persistence, and browser-smoke
  passed on corrected head `2439cfa`.
- Authoritative execution brief: `docs/plans/founder-usable-mvp.md`

## Completed work

- Durable product, architecture, research, evaluation, and V0 planning docs.
- V0-01 runnable Next.js/TypeScript foundation and repository quality gates.
- V0-02 polished fixture-driven responsive consumer shopping shell and visual
  evidence.
- V0-03 typed semantic domain and PostgreSQL persistence for tasks, inputs,
  messages, concepts, criteria, provenance, revisions, and fail-closed reads.
- V0-04 deterministic state transitions, CAS, idempotent receipts, change of
  mind, indifference, undo, historical validation, and brief projection.
- Initial V0-05 planning document on PR #8, including separated interpretation
  and context-action stages, state-engine firewall, eval methodology, and a
  local conversation proof target.
- Founder-MVP continuity brief and progress ledger added as the required first
  commit of the sustained execution phase.

## Current work

V0-05 implementation is feature-complete on
`codex/v0-05-implementation` and is in final review/CI evidence collection.
The bounded slice now includes:

- strict JSON-safe provider input and output wire boundaries;
- deterministic semantic-identity lowering into V0-04;
- stage-two independence from diagnostic ambiguities;
- receipt-bound idempotent action selection and fail-closed receipt recovery;
- backward-compatible question-answer/fingerprint V2 for open text and
  single-select, immutable single use, and stale rejection;
- conservative labelled strength fixtures;
- accurate diagnostic trace wording;
- repeatable three-run protected live gates and a multi-turn live harness proof.

- strict provider-wire schemas, JSON-safe bounded inputs, deterministic
  lowering, and an official OpenAI Responses adapter;
- one same-deadline retry for explicitly retryable provider transport failures,
  with refusal, incomplete, malformed, timeout, and failed statuses kept
  distinct;
- receipt-bound interpretation/action orchestration with V0-04 CAS,
  fail-closed crash recovery, bounded stale reinterpretation, and application
  capability checks;
- immutable context actions/questions, atomic question-answer V2 bindings,
  exact V1/V2 fingerprints, server option IDs, and no public unbound V2 write
  path;
- minimal stage-specific attempt diagnostics, private PostgreSQL migrations,
  and fail-closed action/receipt reads;
- an interactive same-task real-model harness and seven protected live cases,
  each configured for three release-model runs.

Next within this checkpoint: let GitHub run the 53-test PostgreSQL suite on
PostgreSQL 17.6, reconcile any review/CI findings, and run the 21-call live
gate when `OPENAI_API_KEY` plus database URLs are available. Do not begin
retrieval inside this branch.

## Next validated checkpoints

1. V0-05 live interpretation/context acquisition: provider wire schemas,
   lowering, OpenAI adapter, independent ASK/SEARCH selector, persistent action
   artifacts, question-answer V2, diagnostics, deterministic/PostgreSQL tests,
   live evals, and local conversational harness.
2. UK-first live retrieval and task/run-scoped `CandidateListing` persistence,
   using a small query portfolio and conservative normalisation.
3. Evidence, observations, criterion assessments, and useful qualitative result
   ordering with visible uncertainty.
4. Real result UI plus save, exact-listing rejection, natural refinement, and
   re-search.
5. Shortlist and 2–4 product comparison against current shopper criteria.
6. Full live consumer UI integration, desktop/mobile screenshot iteration,
   founder journeys, unrelated-category generalisation, and hardening.
7. Founder handoff: testing guide, environment variables, limitations, exact
   run command, URL, and highest-value real-world questions.

## Blockers and credentials

Credential presence in the current shell at this checkpoint:

- `OPENAI_API_KEY`: missing — blocks credential-gated live V0-05 model eval and
  real-model harness only; does not block implementation or deterministic tests.
- `DATABASE_URL`: missing — blocks local PostgreSQL integration/live task runs in
  this shell. GitHub persistence CI is green. A Supabase project named
  `ai-shopping` was previously created, but its connection string is not present
  in this shell.
- `DIRECT_URL`: missing.
- `SERPAPI_API_KEY`: missing.
- `SERPER_API_KEY`: missing.
- GitHub CLI authentication: working as `Sharmarke1994`.

The retrieval provider remains deliberately unselected. Continue
provider-independent work and a short practical provider spike; pause only if a
non-trivial paid commitment is required.

## Latest verification state

- PR #8 corrected head `2439cfa`: quality green, persistence green,
  browser-smoke green; merged as `6cd0ec8`.
- Current implementation: formatting, lint, typecheck, 96 deterministic
  unit/component tests, production build, six Playwright browser tests,
  migration drift generation, `git diff --check`, and production dependency
  audit all pass locally.
- Ten new PostgreSQL integration cases bring the suite to 53 tests. They cover
  context-action/question persistence, atomic V2 answers, migration/security
  shape, exact coordinator retries, ASK → answer → SEARCH, and change of mind.
  Local execution is unavailable because this shell has no disposable database;
  the suite is ready for GitHub persistence CI.
- First PR #9 persistence CI exposed a missing `@` alias in the database-only
  Vitest configuration before it could execute tests. The focused configuration
  correction is awaiting its replacement CI run; quality and browser-smoke were
  green on the prior head.
- The live release command is `pnpm eval:v0-05:live`; it is intentionally not
  claimed as passing until all 21 real-model runs execute with zero protected
  invariant violations. `pnpm harness:v0-05` is the interactive proof command.
- Local shell currently runs Node 24.19.0 and emits the expected engine warning;
  the repository contract and CI pin Node 22.18.0.
- Working tree was clean when the implementation branch was created from merged
  main.

## Exact resume instructions

If execution stops because of usage exhaustion or a new Codex session, resume
as follows:

1. Read `AGENTS.md` completely.
2. Read `docs/plans/founder-usable-mvp.md` completely; it is the durable product
   and execution authority for this phase.
3. Read this file completely and trust the newest committed update over older
   chat history.
4. Run `git status --short`, `git branch --show-current`, `git rev-parse HEAD`,
   `git rev-parse main`, and inspect the current GitHub PR/check status before
   changing files.
5. Preserve V0-03/V0-04 architecture and all hard invariants in `AGENTS.md`.
6. Continue the first incomplete item under **Current work**. Do not restart
   accepted planning, redo completed checkpoints, or begin a later layer while
   the current checkpoint has a known material failure.
7. If V0-05 has not yet been pushed, run the full local gates, commit the
   bounded diff, push `codex/v0-05-implementation`, and open a draft PR. If the
   PR exists, inspect its exact head and all three CI jobs before editing.
8. Do not claim the live gate passed without an artifact under
   `artifacts/evals/v0-05/` showing 21/21 protected runs. Missing credentials are
   a documented external blocker, not permission to substitute fake evidence.
9. Update this file whenever a checkpoint is committed, merged, blocked, or
   materially re-scoped. Include exact commit/PR/check state and credential
   requirements.
10. Keep checkpoints bounded; run the applicable full repository gates, perform
   a deliberate second review, commit, push, and keep the tree clean.
11. Continue autonomously through founder-MVP checkpoints. Stop for user input
   only for a required credential, material paid-vendor decision,
   consequential product decision, security/privacy implication, destructive
   migration, or fundamental conflict with accepted architecture.
12. Do not declare completion until every acceptance condition in section 42 of
    `docs/plans/founder-usable-mvp.md` is actually satisfied and the founder
    handoff has been produced.
