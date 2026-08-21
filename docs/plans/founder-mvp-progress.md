# Founder MVP progress

**Updated:** 2026-08-21 20:38 Europe/London
**Durable goal:** Deliver a polished founder-usable AI shopping MVP whose live
understanding, market retrieval, evidence-aware evaluation, refinement, saving,
and comparison are meaningfully better than beginning with Google.

## Repository checkpoint

- Repository: `Sharmarke1994/ai-shopping`
- Merged `main`: `6cd0ec83ec6e5c807ecc57de83c0c9a99b2e2ce0`
- Current branch: `codex/v0-05-implementation`
- Current branch base: merged V0-05 planning checkpoint `6cd0ec8`.
- Draft [PR #9](https://github.com/Sharmarke1994/ai-shopping/pull/9) is the
  current checkpoint. Bounded evidence-driven correction `ca119db` is pushed,
  mergeable, independently reviewed, and green in GitHub Actions run
  `32519693077` across quality, persistence, and browser-smoke. V0-06 has not
  started.
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
`codex/v0-05-implementation`. The first independent implementation review and
adversarial follow-up are reconciled, and exact-head GitHub CI is green at
`ca119db`. The funded live gate has now produced two honest failing reports:

- Terra release configuration, before pacing: 1/21 passed. Most calls were
  contaminated by the fresh-project 3 RPM / 10k TPM / rolling request allowance,
  so this is not a valid semantic-quality denominator.
- Luna diagnostic configuration, paced: 10/21 passed. It exposed eight
  structured-output validation failures, one provider failure, and repeatable
  semantic over-interpretation. It is diagnostic evidence only, never a
  substitute for the approved Terra release configuration.

The resulting bounded correction classifies quota/rate-limit/SDK timeout
failures accurately, honours only same-deadline `Retry-After`, waits 35 seconds
after each completed live-eval model call, aligns qualitative ordinal and
indifference lifecycle evaluation with accepted contracts, and tightens prompt
contracts without weakening validation. A fresh paced 21-run Terra report is
still required after its provider allowance recovers.
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
- typed exhaustion after two action-selection revision races, with no stale
  question/action persisted;
- a closed V2 boundary: generic public and transaction input writers reject V2,
  while the module-private insert executes only inside the atomic question
  answer + binding transaction;
- explicit provider retries limited to reviewed HTTP/SDK transient failures,
  with OpenAI SDK retries disabled at every request boundary;
- a semantic release evaluator that checks exact strengths, targets, values,
  units/operators, indifference and lifecycle history, unexpected truth,
  relevant ASK content, and locally negated meanings;
- a guarded disposable `TEST_DATABASE_URL` run that evaluates actual persisted
  state on success or failure and emits one coherent sanitised JSON + Markdown
  report.

Next within this checkpoint: rotate the key that was disclosed in chat and
replace its Keychain value, then rerun the paced 21-run Terra gate against the
guarded local database after the rolling allowance recovers. Do not begin
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

- `OPENAI_API_KEY`: stored in macOS Keychain service `ai-shopping-openai`. The
  project is funded and successful model calls are confirmed. Terra currently
  has fresh-project limits of 3 RPM, 10k TPM, and a rolling request allowance;
  the unpaced run exhausted that allowance. Wait for recovery before its next
  21-run gate. Rotate the chat-disclosed key and replace the Keychain value.
  The key value must never be written to the repository, reports, or shell
  history.
- `DATABASE_URL`: missing — blocks local PostgreSQL integration/live task runs in
  this shell. GitHub persistence CI is green. A Supabase project named
  `ai-shopping` was previously created, but its connection string is not present
  in this shell.
- `DIRECT_DATABASE_URL`: missing.
- `TEST_DATABASE_URL`: not persisted as a shell secret. Local PostgreSQL 17.11
  is installed and running, with test-only base database `ai_shopping_test`.
  Supply its local loopback URL only to the command invocation. The live eval
  creates and drops its own guarded disposable database and never falls back to
  `DATABASE_URL`.
- `SERPAPI_API_KEY`: missing.
- `SERPER_API_KEY`: missing.
- GitHub CLI authentication: working as `Sharmarke1994`.

The retrieval provider remains deliberately unselected. Continue
provider-independent work and a short practical provider spike; pause only if a
non-trivial paid commitment is required.

## Latest verification state

- PR #8 corrected head `2439cfa`: quality green, persistence green,
  browser-smoke green; merged as `6cd0ec8`.
- Corrected implementation `ca05f07`: formatting, lint, typecheck, 112 deterministic
  unit/component tests, production build, six Playwright browser tests,
  migration drift generation, `git diff --check`, and production dependency
  audit all pass locally.
- Twelve V0-05 PostgreSQL integration cases bring the suite to 55 tests. They cover
  context-action/question persistence, atomic V2 answers, migration/security
  shape, exact coordinator retries, two action-selection races, rejection of
  unbound V2 transaction writes, ASK → answer → SEARCH, and change of mind.
  Local execution is unavailable because this shell has no disposable database;
  the suite is ready for GitHub persistence CI.
- First PR #9 persistence CI exposed a missing `@` alias in the database-only
  Vitest configuration before it could execute tests. The focused configuration
  correction at `54806ce` passed its replacement GitHub run. The current exact
  PR head `66e1a59` also passed GitHub Actions run `32505346894`: quality,
  53/53 PostgreSQL integration tests, and 6/6 browser tests are green.
- Independent review of `8e6c64b` found four bounded issues: second action-stage
  stale exhaustion, insufficient semantic live-gate assertions, an exported
  unbound V2 transaction path, and over-broad status-less retries. `ca05f07`
  resolves all four. A Sol High adversarial pass additionally found ASK-content,
  negated-meaning, failed-run-state, injected-client retry, and exact-5xx gaps;
  those are resolved in the same correction commit. GitHub Actions run
  `32509855120` is green at exact review head `1d048af`: quality, 55/55
  PostgreSQL tests, and 6/6 browser tests passed.
- The live release command is `pnpm eval:v0-05:live`; it is intentionally not
  claimed as passing until all 21 real-model runs execute with zero protected
  invariant violations. `pnpm harness:v0-05` is the interactive proof command.
- Local PostgreSQL 17.11 is installed through Homebrew, running on loopback, and
  validated as user `alchemist32` against `ai_shopping_test`. The 2026-08-21
  live attempt produced sanitised JSON and Markdown reports under
  `artifacts/evals/v0-05/2026-08-21T18-45-40.719Z.*`; 0/21 passed because every
  interpretation call received `provider_request_failed`. A separate minimal
  Responses API diagnostic returned 429 `insufficient_quota`, so this report
  must not be treated as a model-quality result.
- After funding, the unpaced Terra run emitted
  `artifacts/evals/v0-05/2026-08-21T18-55-42.849Z.*`: 1/21 passed, with provider
  rate-limit failures contaminating most runs. Direct rate-limit evidence showed
  Terra at 3 RPM / 10k TPM and a rolling request allowance. The report is kept
  as failure evidence, not claimed as a semantic release result.
- The paced Luna diagnostic emitted
  `artifacts/evals/v0-05/2026-08-21T19-34-21.982Z.*`: 10/21 passed. All cap,
  exact-lookup, and quoted-injection runs except one over-broad product-type
  interpretation passed; explicit indifference passed 2/3. Eight attempts were
  strict structured-output validation failures, one was a provider failure, and
  the remainder exposed duplicate conditional-budget truth, unresolved-size
  over-interpretation, and non-specific qualitative text. Prompt versions 3/2
  address these observed contract failures without loosening the schemas.
- Correction `ca119db` verification: formatting, lint, typecheck,
  119/119 unit/component tests, production build, 6/6 Playwright tests, no
  migration drift, no production dependency vulnerabilities, and
  `git diff --check` all pass. GitHub Actions run `32519693077` is green for
  quality, 55/55 PostgreSQL integration tests, and browser-smoke. Local
  PostgreSQL functional cases pass; the sole local suite mismatch is the
  intentional exact PostgreSQL 17.6 CI pin versus Homebrew PostgreSQL 17.11.
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
7. V0-05 draft PR #9 contains reviewed correction `ca119db`, green in run
   `32519693077`. Do not merge or begin retrieval/V0-06 until the approved Terra
   configuration produces a genuine paced 21/21 live report and that evidence
   is reviewed.
8. Do not claim the live gate passed without an artifact under
   `artifacts/evals/v0-05/` showing 21/21 protected runs. Missing credentials are
   a documented external blocker, not permission to substitute fake evidence.
   The Luna 10/21 report is diagnostic only. Before rerunning Terra, allow its
   rolling request allowance to recover; the runner itself now paces from each
   completed top-level call.
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
