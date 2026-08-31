# Founder MVP progress

**Updated:** 2026-08-30 Europe/London
**Durable goal:** Deliver a polished founder-usable AI shopping MVP whose live
understanding, market retrieval, evidence-aware evaluation, refinement, saving,
and comparison are meaningfully better than beginning with Google.

## Authoritative checkpoints

- Repository: `Sharmarke1994/ai-shopping`.
- Founder-MVP execution brief: `docs/plans/founder-usable-mvp.md`.
- Active isolated worktree:
  `/Users/alchemist32/Documents/AI Shopping/ai-shopping-v0-09-recovery`.
- Active branch: `codex/v0-09-recovery-rc`, descending from preserved Recovery
  RC1 failure head `f02560132639e2095356e1ce54afbc87fbded068`, accepted context head
  `a17d37d80a710bb05b8c79d996596f2492c2424c` and frozen V0-09 head
  `934067e7d3796a4a68ba3b00387a16632a563f15`.
- Independently reviewed V0-08 pre-correction head:
  `c28c891885462eb2990f0b098f3817e744afdec0` in draft stacked PR #12.
- The final bounded six-issue correction and hardened one-shot proof harness
  were committed with honest diagnostic evidence at
  `76549c7abcefb81429d5ddda7c8f0069c2be78ce`. The subsequent focused
  product-understanding contract alignment has now completed exactly one newly
  authorized fresh mouse/chair/vacuum release proof. Sanitized success evidence
  replaces the earlier failure artifact. Release acceptance remains open only
  for independent review of the exact delivered checkpoint.
- Focused contract-alignment and successful release-evidence commit:
  `f35f2fe718704726fe3f26a131f3fb696cf06c45`.
- Release checkpoint ledger head
  `5874ed96c071e73679b374293bddfcaf6623cbbe` passed exact-head quality,
  pinned PostgreSQL persistence and browser-smoke in GitHub run `33248668320`.
- Correction/evidence plus ledger delivery head
  `4e891f81f581d8c2614bbdf76bf5ae1073399c43` passed exact-head quality,
  PostgreSQL persistence and browser-smoke in GitHub run `33228469926`.
- V0-08 was independently accepted at
  `cfd809740ae64be307798eb7870feaf56227d9dc`. PR #12 remains draft, stacked
  and unmerged. V0-09 is now the active isolated implementation checkpoint and
  will be delivered as a new draft PR stacked on
  `codex/v0-08-founder-decision-loop`; do not merge the stacked chain.
- V0-09 deterministic implementation head
  `080495089ef4a6c619302f0675e35eb0a5e74ac6` is pushed in draft stacked PR
  #13. Its single guarded live proof produced an honest diagnostic failure; the
  implementation PR remains draft and unmerged pending independent review.
- Original V0-05 checkout and draft PR #9 remain separate, unmodified,
  unmerged and formally unaccepted. The 21/21 Terra rule has not been weakened
  and Luna remains diagnostic only. V0-08 does not redefine that separate
  process checkpoint.
- Nothing on this experimental branch may be merged automatically. Each
  coherent layer is committed and pushed for recoverability while work
  continues toward the founder-usable product.
- Current bounded blocker-remediation worktree:
  `/Users/alchemist32/Documents/AI Shopping/ai-shopping-context-hardening` on
  `codex/context-acquisition-semantic-hardening`, based exactly on frozen V0-09
  head `934067e7d3796a4a68ba3b00387a16632a563f15`. PR #13 and its proof marker
  remain untouched.
- The one authorized Phase-A context-hardening Terra run completed all six
  protected cases with zero provider/structured-output failures but failed one
  semantic assertion: contextual backpack lighter produced `Weight` with a
  preference relation `less` anchored to `current alternatives`, not the
  explicit lighter direction. This is an interpretation-stage semantic failure;
  no Phase-B recovery work was started and no second run is authorized without
  independent review. Exact evidence is in
  `docs/evals/v0-05-context-hardening-diagnostic.{json,md}`; the prior 19/19
  artifact is archived as `*-prior-19-19.*`.
- A single final Phase-A Terra gate then completed 6/6 protected cases with
  zero provider failures, structured-output failures, invalid patches, or
  semantic violations after the comparison-anchor correction. Context
  hardening is now accepted for product continuation; formal V0-05 21/21
  acceptance remains open. The successful primary artifact is
  `docs/evals/v0-05-context-hardening-diagnostic.{json,md}` and the immediately
  prior failed batch is archived as `*-prior-6-5.*`.

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

## Accepted V0-08 founder decision loop

V0-08 is independently accepted at
`cfd809740ae64be307798eb7870feaf56227d9dc`. The original bounded review and
the final six-issue code correction review are complete. Draft stacked PR #12
is open, mergeable and intentionally unmerged. The independently reviewed
pre-correction head is `c28c891885462eb2990f0b098f3817e744afdec0`;
the prior fail-closed diagnostic checkpoint is
`76549c7abcefb81429d5ddda7c8f0069c2be78ce`, with its historical ledger head
`4e891f81f581d8c2614bbdf76bf5ae1073399c43`. The current checkpoint adds only
the bounded focused model-contract alignment and one successful fresh release
artifact at `f35f2fe718704726fe3f26a131f3fb696cf06c45`.

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
- Named-gap investigation carries the exact current criterion while card-level
  research remains server-selected. Foreign, stale, resolved and rejected
  targets fail closed or converge without paid work as appropriate.
- Deep/targeted model input, attempt bindings, output validation and assessment
  publication are restricted to the exact server-owned criterion subset. The
  target generation alone changes; non-target current assessment identities
  remain unchanged.
- Active candidate+criterion targets are reserved across automatic, card and
  gap policy identities, preventing duplicate calls while leaving different
  criteria independently researchable.
- Comparison uses only one authoritative purchase-price criterion; delivery and
  running-cost money concepts cannot masquerade as purchase price.
- Running and partial research now remain visibly honest while progressive
  cards stay usable. Failed runs count as useful only when evidence tied to that
  exact run survived.
- Exact direct-title soft contradictions can create a factual concept-bound
  descriptor plus a trade-off/watchout. The bounded matcher fails closed on
  negation, accessory and morphology ambiguity and never creates a hard
  exclusion from a soft preference.
- Deep-run read and publish boundaries require organic/extraction/assessment
  target-set coherence; raw cross-stage corruption is rejected before another
  provider/model call.
- The first destination-cost diagnostic spent 25 merchant lookups for only one
  useful top-card direct link. The bounded policy now checks at most the leading
  distinct merchant per shopping query. The successful release run used 12
  shopping and 7 merchant-resolution requests; direct retailer coverage remains
  thin and is measured rather than hidden.
- Focused deepening now has an explicit server-owned call policy. Its provider
  schema structurally requires non-null exact local criterion ordinals and one
  assessment per supplied criterion, while zero observations plus an honest
  uncertain assessment remains valid. First pass and reassessment remain broad;
  the authoritative post-call validator remains fail-closed.
- Exactly one newly authorized fresh real Terra + Serper proof completed
  ergonomic mouse plus refinement, office chair and cordless vacuum. Every
  named target used the focused `product-understanding-v2` contract, advanced
  one assessment generation and wrote zero out-of-scope assessments. Sanitized
  release evidence is in `docs/evals/v0-08-live-founder-proof.{json,md}`.
- Eight production-rendered desktop/mobile screenshots cover automatic,
  decision, comparison, rejection, refinement, verification and partial
  research states in `docs/screenshots/v0-08/`.

V0-05 PR #9, V0-06 PR #10 and V0-07 PR #11 remain unmodified and unmerged.

## Current V0-09 source-depth, purchase-path and speed checkpoint

V0-09 is active from the exact accepted V0-08 head in the isolated worktree and
branch recorded above. The durable execution contract is
`docs/plans/v0-09.md`.

- Implemented a no-crawler, server-owned fetch boundary for at most two
  already-discovered exact product pages. DNS pinning, redirect revalidation,
  deadlines, byte/encoding/content-type bounds and HTML extraction keep raw
  pages out of persistence and model input.
- Added replayable page-attempt, exact-target, admitted-source and typed
  extracted-document provenance. Read and write paths fail closed on orphaned,
  mutated, cross-scope or variant-conflicting evidence; unsupported product
  facts remain unknown.
- Added candidate-local organic -> page -> model pipelines with explicit
  concurrency caps 3/2/2. Terminal units persist as they finish and useful
  candidate decisions can project while slower candidates continue.
- Removed merchant resolution from initial Shopping retrieval. A separate
  task/run/candidate/policy-bound receipt now resolves only exact same-merchant
  destinations for current top or saved offers; accepted result title and URL
  are independently replayed, while Google Shopping remains the fallback.
- Projected fetched source depth, attributable checked-no-answer states,
  progressive research, page failures and direct/fallback purchase paths into
  the existing calm responsive decision UI.
- Added a guarded four-category Terra + Serper proof harness and eight-state
  production-server visual workflow. Both independent static audits returned
  GO. The single original live proof was consumed once and failed closed in
  the first mouse case before page/model work; its durable marker and sanitized
  diagnostic are preserved as historical evidence.
- Corrected the phase-specific page-planning invariant. First-pass organic
  attempts may be non-empty prioritized subsets of the full extraction /
  assessment criteria; deepening still requires exact cross-stage equality;
  reassessment still creates no organic/page work. Persisted page targets are
  intersected with the exact discovering organic attempt's criteria, so page
  authority cannot broaden. Deterministic and PostgreSQL regressions now cover
  the six-criterion / five-criterion real shape and foreign/deepening failures.
- The proof harness has a durable, non-resettable attempt ledger. Attempt 1 is
  preserved under the original `*-prior.*` names; Attempt 2 is preserved under
  the explicit `*-attempt-2.*` names; exactly one independent-review-authorized
  Attempt 3 may be claimed, after which a fourth attempt is refused.
- Attempt 2 (2026-08-29) failed closed in inherited ergonomic-mouse
  interpretation. The first model call produced an invalid state patch; its
  one safe retry produced a structured-output validation failure. No state
  mutation or downstream provider work occurred. This is diagnostic evidence,
  not release acceptance; Attempt 3 is authorized only to exercise the still
  untested V0-09 layers, with no production context-acquisition changes.
- Attempt 3 was the one independently authorized final full Terra + Serper
  proof, claimed at `2026-08-29T22:29:02.934Z` and failed at the ergonomic-mouse
  founder-intent semantic gate after V0-09 retrieval/evidence work had begun.
  Context, action, Shopping, organic evidence and product-understanding calls
  completed; four page fetches failed and no fetched document or destination
  receipt was accepted. The proof detected that the conditional wireless/battery
  request had been represented with `Battery life` as a hard criterion, which
  reverses/invents the protected founder semantics. This is not a V0-09 source
  depth defect and no production context, evaluator or V0-04 change is allowed.
  The enriched sanitized diagnostic is preserved in the primary failure files;
  the durable marker now refuses Attempt 4.

## Current context-acquisition hardening checkpoint

This bounded blocker-remediation branch is isolated from V0-09 at frozen head
`934067e7d3796a4a68ba3b00387a16632a563f15`:

- Worktree: `/Users/alchemist32/Documents/AI Shopping/ai-shopping-context-hardening`.
- Branch: `codex/context-acquisition-semantic-hardening`.
- V0-09 PR #13 remains draft, unmerged and untouched. Attempt 4 remains
  permanently refused; V0-10 has not started.
- The inherited V0-05 interpretation prompt now explicitly preserves the
  authority of a soft parent preference across subordinate conditions. The
  provider-visible interpretation/action schemas now expose branch
  cardinality and semantic-family constraints structurally while retaining
  the V0-04 validation firewall.
- Deterministic provider/lowering and PostgreSQL refinement regressions are
  green. No deterministic English authority parser was added because the
  repository cannot safely infer arbitrary grammar scope without a brittle,
  category-specific NLP approximation.
- The prior bounded Terra low-reasoning diagnostic reported 11/11 under its
  then-current oracle, but independent review found a cap light/heavy reversal
  and unverified conditional-loss cases. It is preserved as historical evidence
  under `docs/evals/v0-05-context-hardening-diagnostic-prior.*` (including its
  attempt marker) and is not acceptance evidence. This branch's corrected
  evaluator/provider diagnostic is separate; V0-05's formal 21/21 gate remains
  open.
- The prior corrected Terra diagnostic remains archived as
  `docs/evals/v0-05-context-hardening-diagnostic-prior-16-17.*` with 16/17
  completed and four findings. The final convergence diagnostic used the V2
  nested provider branches and the corrected full-state/brief oracle. It
  completed 19/19 cases with three semantic violations: contextless lighter
  preserved a bounded ambiguity but selected SEARCH instead of ASK; contextual
  backpack lighter was incorrectly treated as unresolved and produced no Weight
  preference; and the headphones golden case made wireless a preference rather
  than a hard include. No invalid patches or provider structured-output
  failures occurred. Its exact JSON/Markdown pair is preserved at
  `docs/evals/v0-05-context-hardening-diagnostic-prior-19-19.{json,md}`. The
  subsequent six-case Phase-A run is archived as `*-prior-6-5.*` and failed
  only the contextual-lighter semantic assertion described above. The final
  six-case Phase-A run passed 6/6 cleanly after the comparison-anchor
  correction; its primary artifact is
  `docs/evals/v0-05-context-hardening-diagnostic.{json,md}`. V0-05's 21/21
  formal gate remains open.

## Next validated checkpoints

1. Preserve the immutable Attempt 1, Attempt 2 and Attempt 3 artifacts and
   their non-resettable markers. Attempt 3 did not meet release acceptance.
2. Treat the earliest evidenced blocker as the inherited V0-05 founder-intent
   semantic interpretation surfaced by the proof predicate; do not patch it
   inside V0-09 and do not create Attempt 4.
3. Context hardening is accepted for product continuation after the one clean
   six-case Phase-A Terra gate. Keep PR #14 draft/unmerged and obtain exact-head
   CI, then continue only in a fresh recovery worktree/branch. PR #13/V0-09 and
   the original V0-05 checkout remain untouched; do not begin V0-10.

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
  product/security decisions. The bounded post-shortlist Serper destination
  layer is category-independent and exact-offer-only; unverifiable offers stay
  on an honest Google Shopping fallback. It is not permission for scraping or
  a second paid vendor.

## Latest verification

- `pnpm check`: formatting, lint, generated route types, strict TypeScript,
  342/342 deterministic unit/component tests and the production build pass on
  the corrected tree.
- Focused page-persistence PostgreSQL regression: 12/12 passes, including the
  first-pass prioritized subset and exact discovering-attempt page scope.
- Full PostgreSQL suite: 140/141 functional tests pass. The sole local failure is
  the intentional PostgreSQL 17.6 version assertion against Homebrew 17.11; the
  repository pin remains unchanged.
- `pnpm test:e2e`: 8/8 Chromium tests pass against a fresh migrated disposable
  local database, including automatic first/deep research, progressive cards,
  two saves, comparison, exact rejection/undo, refinement, refresh, mobile
  hard-unknown presentation and no overflow.
- `pnpm db:generate` reports 31 tables and no schema drift. The final additive
  `0016_lame_wolfpack.sql` migration runs from empty, revokes PUBLIC/anon/
  authenticated access to all new private tables, and preserves the accepted
  PostgreSQL 17.6 pin. Production dependency audit reports no vulnerabilities.
- Eight production `next start` desktop/mobile screenshots passed explicit
  horizontal-overflow assertions and were visually inspected without framework
  development chrome. They cover fast listings, progressive evidence, fetched
  source depth, an attributed page failure, exact direct/fallback purchase,
  comparison, targeted research and reject/undo.
- Credential-shape scanning found no OpenAI/Serper/Bearer key values in the
  deterministic checkpoint.
- The single original guarded live attempt ran once at
  `2026-08-29T14:26:58.216Z` and failed in the ergonomic-mouse first pass with
  `EvidenceAttemptConflictError`. Interpretation 1/1, action selection 1/1,
  Shopping 3/3 and organic evidence search 4/4 logical calls succeeded. No page
  fetch, product-understanding or destination logical call began.
- The exact failed candidate had six observation/assessment target criteria but
  its valid first-pass organic attempt targeted the prioritized maximum of five,
  omitting only `Wireless battery suitability`. Page planning required all three
  sets to be identical and raised on the still-planned extraction attempt. This
  is the earliest evidenced layer: a deepening-style cross-stage equality
  invariant was applied to the intentionally broader first-pass model scope.
  The error wording about different terminal content is misleading; no terminal
  replay conflict occurred. No semantic product result was produced and no
  evaluator was weakened.
- The original sanitized failure and marker are preserved under
  `docs/evals/v0-09-live-founder-proof-*-prior.*`; Attempt 2 is preserved under
  `docs/evals/v0-09-live-founder-proof-*-attempt-2.*`; Attempt 3 remains under
  the primary names. Attempts 2 and 3 destroyed their disposable databases
  with zero cleanup errors. All failures are diagnostic only.
- Post-correction proof attempt `d1e01d17-5116-4e56-bc0c-6e8ca6d75e6a` ran at
  `2026-08-29T17:11:44.503Z` and stopped in ergonomic-mouse interpretation.
  The first call was rejected as `invalid_state_patch`; the one safe retry was
  rejected as `structured_output_validation_failed`. The sanitized artifact
  records 2 interpretation calls (both provider-port operations), zero action,
  Shopping, evidence, page, model or destination calls, an empty revision-0
  brief, and no persisted SearchRun. This is a model-contract/provider result,
  not rate-limit or timeout noise; no speculative correction is authorized.
- Final independent-review-authorized Attempt 3
  `4ac724de-6576-49a3-b9b5-e419c45829f5` ran at
  `2026-08-29T22:30:23.817Z` and reached V0-09 before failing the ergonomic-
  mouse founder-intent semantic gate. It completed 2 interpretation, 2 action,
  6 Shopping, 11 organic evidence-search and 11 product-understanding logical
  provider operations; 4 page-fetch attempts failed, no fetched document was
  admitted, and no destination call began. The protected Battery life
  condition was represented as a hard criterion rather than the requested
  conditional wireless preference, so release acceptance is false. The exact
  sanitized diagnostic is `docs/evals/v0-09-live-founder-proof-failure.json`
  with its Markdown companion; its marker records both prior attempt IDs and
  permanently refuses Attempt 4.
- Exact diagnostic head `259722f` passed GitHub quality, pinned PostgreSQL
  persistence and browser-smoke in run `33278612605`. Draft stacked PR #13
  remains mergeable and unmerged. No production context-acquisition code,
  prompt or schema changed in the proof attempt.
- Context hardening Phase A was accepted separately on
  `a17d37d80a710bb05b8c79d996596f2492c2424c` after one final Terra six-case
  gate: 6/6 completed, with zero provider failures, structured-output
  failures, invalid patches or semantic violations. PR #14 remains draft and
  unmerged.
- Recovery RC1 is isolated in
  `/Users/alchemist32/Documents/AI Shopping/ai-shopping-v0-09-recovery` on
  `codex/v0-09-recovery-rc`. The bounded modern-page correction committed as
  `e742fe0` uses a 2.5 MB transport cap and a separate 36 KB retained-document
  cap; 66/66 page fetch/extraction tests, full deterministic checks and 8/8
  fixture E2E tests pass with the migrated test database.
- The single Recovery RC1 Terra + Serper proof was claimed once as attempt
  `04a46e0d-561d-4f7b-979a-60b664160ba6` on 2026-08-30 and failed in the
  ergonomic-mouse first case before any assessment or purchase path. The
  earliest responsible layer is the persisted fetched-page metadata schema,
  which still caps `encodedBytes` and `decodedBytes` at the historical
  1,500,000 bytes even though the bounded transport path now admits measured
  modern pages up to 2,500,000 bytes. The exact sanitized failure and durable
  one-shot marker are preserved as
  `docs/evals/v0-09-recovery-rc1-founder-proof-failure.{json,md}` and
  `docs/evals/v0-09-recovery-rc1-founder-proof-attempt.json`. No patch or
  second RC1 proof is authorized from this checkpoint.
- Recovery RC2 is the frozen diagnostic checkpoint pending independent review.
  It replaces the stale 1.5 MB
  persisted fetched-page metadata ceiling with one shared 2.5 MB transient
  transport/persistence contract while retaining a separate 36 KB extracted
  document bound. Additive migration `0017_shallow_jetstream.sql` changes only
  the fetched-document content CHECK.
- The RC2 page soak successfully exercised a 2,329,807-byte Tom's Guide page
  through production fetch, extraction, exact admission, PostgreSQL
  persistence, replay and bounded model input; the retained document was
  12,815 bytes. Two additional historical pages also crossed 1.5 MB: the
  Anker page was admitted as manufacturer evidence and the Amazon page failed
  closed as a wrong model/variant. The disposable database was destroyed and
  raw HTML was not retained.
- Historical broad-call failures plus one non-repeatable fixture-only Terra
  diagnostic evidenced an eight-criterion
  `assessment_observation_ref_criterion_mismatch`. RC2 now partitions only
  first-pass product understanding into deterministic one- or two-criterion
  calls with hashed paired receipts, strict bindings, atomic batch
  persistence, honest partial failure and unfinished-only resume. Deepening
  and reassessment semantics remain unchanged. Historical reads revalidate the
  exact partition against the authoritative brief at the run revision.
- Sanitized product-understanding failure taxonomy is diagnostic-only and
  contains no provider payload, source text or raw error. The founder proof
  requires failed model receipt pairs and taxonomy diagnostics to match
  exactly. The explicit schema-maximum cost ceiling is 25 calls per candidate,
  100 across four candidates; no criteria are silently truncated.
- The single bounded destination diagnostic resolved one same-merchant offer
  and rejected two no-result offers without cross-retailer substitution or DB
  mutation. The global eBay `.com` destination is recorded as an honest
  UK-market limitation for release inspection.
- RC2 deterministic evidence includes 376/376 unit/component tests,
  157/157 functional PostgreSQL tests, the real page soak and the destination
  diagnostic. The sole full-DB red result is the intentional local environment
  check: Homebrew PostgreSQL 17.11 does not impersonate the repository/CI pin
  at 17.6. `pnpm check`, production build, 8/8 browser tests, migration replay,
  no-drift generation, production dependency audit and eight production-render
  screenshot/overflow checks are green. Pre-proof checkpoint
  `326b1231031dd292347fa6c3d5af176a4bd85570` is pushed on draft PR #15,
  stacked on PR #14. Exact-head GitHub run `33337409664` passed quality,
  pinned-PostgreSQL persistence and browser-smoke; browser-smoke used its
  configured retry once and then passed 7/7.
- The only Recovery RC2 founder proof was claimed as attempt
  `9d1c6eea-6e66-47f6-95c5-86732b3829fd` at
  `2026-08-30T21:50:49.730Z` and failed closed in the ergonomic-mouse case.
  It completed two interpretation, two action-selection, six Shopping, eleven
  organic evidence-search, two page-fetch and thirty-one product-understanding
  logical provider operations without a provider failure. Two exact pages
  were admitted and persisted: a 2,329,807-byte independent review with a
  12,815-byte retained document and a 1,943,252-byte manufacturer page with a
  6,154-byte retained document. The active case contained two successful
  SearchRuns, five successful research runs, 75 succeeded evidence attempts,
  62 observations and 57 assessments. Destination work had not begun.
- The thrown message says the initial brief invented `Ergonomic design`, but
  the earliest actual failing layer is the release harness's deterministic
  founder-intent classifier. It builds meaning from the concept label plus
  definition, so `Ergonomic design` / `...ergonomic shape` matches both the
  allowed `ergonomic_subject` rule and the allowed `sculpted_shape` rule. The
  assertion requires exactly one match and misleadingly labels multiple
  matches as invention. This is not evidence of a provider, persistence or
  product-understanding failure. A separate, unreached semantic question
  remains for independent review: the persisted ergonomic criterion is
  `hard`, while the current prompt/oracle policy expects a preference.
- The sanitized failure, Markdown summary and durable marker are preserved as
  `docs/evals/v0-09-recovery-rc2-founder-proof-failure.{json,md}` and
  `docs/evals/v0-09-recovery-rc2-founder-proof-attempt.json`. Release
  acceptance is false, completed founder categories are zero, the disposable
  database was destroyed with zero cleanup errors, and no RC2 success artifact
  exists. The RC2 marker is permanently consumed; there will be no RC2 retry.

## Recovery RC3 in progress

- RC3 is a separately namespaced, one-shot recovery candidate based on the
  accepted RC2 evidence head `e4ad5b340a21ace15c6bb58dba6d981cc1055d6d`.
  RC2's marker and failure artifacts remain immutable historical evidence.
- The bounded correction separates lexical overlap from semantic founder-intent
  authorization and narrows interpretation policy so ordinary ergonomic design
  is a preference while explicit “must/only/requires” remains hard.
- One non-release Terra context precheck completed 4/4 protected cases with zero
  violations (`gpt-5.6-terra`): cap, headphones, ordinary ergonomic mouse and
  explicit-hard ergonomic mouse. Artifacts are preserved under the
  `v0-09-recovery-rc3-context-precheck` namespace.
- The full RC3 proof has not run. It has its own durable marker, artifacts,
  disposable database pattern and acknowledgement variable; it may be run
  exactly once after the clean committed checkpoint and deterministic gates are
  green. Acceptance remains the strict four-category Terra + Serper predicate.

- The single RC3 proof was then claimed as attempt
  `8619d766-d79e-44a6-8a67-39a6c4ac1749` and failed closed at the initial
  `ergonomic-mouse` oracle check. The exact sanitized failure artifacts and
  marker are preserved under `docs/evals/v0-09-recovery-rc3-founder-proof-*`;
  the disposable database was destroyed with zero cleanup errors. All completed
  Terra provider operations succeeded. The earliest responsible layer is the
  deterministic oracle's brand-facet cardinality check: it counted the single
  qualitative “good brands only; exclude bad brands” item as an additional
  exclusion alongside the explicit Amazon Basics exclusion, even though the
  persisted brief preserved both truths. No RC3 retry was made.

## Exact resume instructions

1. Resume only in
   `/Users/alchemist32/Documents/AI Shopping/ai-shopping-v0-09-recovery` on
   `codex/v0-09-recovery-rc`. Preserve RC1 and V0-09 Attempts 1–3 exactly; never
   rerun any of them or rewrite their markers/artifacts.
2. Do not run `proof:v0-09:recovery-rc2:live` again. Its one-shot marker is
   consumed. The RC3 deterministic oracle and semantic prompt correction are
   bounded and separately tested; do not broaden them or weaken the release
   predicate.
3. Preserve the exact RC2 failure artifacts and marker, the RC2 evidence head
   `e4ad5b340a21ace15c6bb58dba6d981cc1055d6d`, and PR #15. The RC3 full proof
   requires its own clean committed head, acknowledgement and one-shot marker;
   it must never reuse or rewrite RC2 evidence.
4. Keep the stacked PR draft/unmerged and stop for independent review after the
   single RC3 proof; do not begin V0-10.
5. Preserve V0-05 PR #9, V0-06 PR #10, V0-07 PR #11, PR #13, PR #14 and PR #15 as
   draft/unmerged historical checkpoints. Do not weaken V0-05's Terra rule,
   rerun V0-08 evidence, or begin V0-10.
