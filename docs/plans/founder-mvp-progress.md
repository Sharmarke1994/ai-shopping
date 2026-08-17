# Founder MVP progress

**Updated:** 2026-08-17 12:31 Europe/London
**Durable goal:** Deliver a polished founder-usable AI shopping MVP whose live
understanding, market retrieval, evidence-aware evaluation, refinement, saving,
and comparison are meaningfully better than beginning with Google.

## Repository checkpoint

- Repository: `Sharmarke1994/ai-shopping`
- Merged `main`: `cbb3314a4dcb04ef6ff8b351fa7823ffdc0bf753`
- Current branch: `codex/v0-05-plan`
- Current committed branch head before the V0-05 correction commit:
  `9d309aa58a1350b1d4be7bdca31cc6552b1c5dc8`
- Current checkpoint: draft PR #8, `V0-05: plan AI interpretation and context
  acquisition`
- PR #8 state before this continuity commit: open, draft, mergeable; quality,
  persistence, and browser-smoke checks green on `23178f3`.
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

The bounded V0-05 plan correction is complete locally and awaiting commit/push
to PR #8. It now includes:

- strict JSON-safe provider input and output wire boundaries;
- deterministic semantic-identity lowering into V0-04;
- stage-two independence from diagnostic ambiguities;
- receipt-bound idempotent action selection and fail-closed receipt recovery;
- backward-compatible question-answer/fingerprint V2 for open text and
  single-select, immutable single use, and stale rejection;
- conservative labelled strength fixtures;
- accurate diagnostic trace wording;
- repeatable three-run protected live gates and a multi-turn live harness proof.

After the correction commit is pushed and PR #8 checks are green, treat the
planning checkpoint as complete and begin bounded V0-05 implementation. Do not
reopen broad planning unless implementation evidence exposes a contradiction.

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

- PR #8 GitHub Actions on continuity head `9d309aa`: quality green, persistence
  green, browser-smoke failed only in the existing pre-hydration compact-brief
  test after three 30-second timeouts. The continuity commit changed docs only;
  inspect the new run before classifying this as flaky or fixing the test.
- Local `pnpm check` after the V0-05 plan correction passed formatting, lint,
  typecheck, 65 unit/component tests, and production build.
- Local shell currently runs Node 24.19.0 and emits the expected engine warning;
  the repository contract and CI pin Node 22.18.0.
- Working tree was clean before adding the two continuity documents.

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
7. Update this file whenever a checkpoint is committed, merged, blocked, or
   materially re-scoped. Include exact commit/PR/check state and credential
   requirements.
8. Keep checkpoints bounded; run the applicable full repository gates, perform
   a deliberate second review, commit, push, and keep the tree clean.
9. Continue autonomously through founder-MVP checkpoints. Stop for user input
   only for a required credential, material paid-vendor decision,
   consequential product decision, security/privacy implication, destructive
   migration, or fundamental conflict with accepted architecture.
10. Do not declare completion until every acceptance condition in section 42 of
    `docs/plans/founder-usable-mvp.md` is actually satisfied and the founder
    handoff has been produced.
