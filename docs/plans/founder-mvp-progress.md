# Founder MVP progress

**Updated:** 2026-08-29 Europe/London
**Durable goal:** Deliver a polished founder-usable AI shopping MVP whose live
understanding, market retrieval, evidence-aware evaluation, refinement, saving,
and comparison are meaningfully better than beginning with Google.

## Authoritative checkpoints

- Repository: `Sharmarke1994/ai-shopping`.
- Founder-MVP execution brief: `docs/plans/founder-usable-mvp.md`.
- Active isolated worktree:
  `/Users/alchemist32/Documents/AI Shopping/ai-shopping-v0-09-source-depth`.
- Active branch: `codex/v0-09-source-depth-purchase-path`, starting exactly at
  the independently accepted V0-08 head
  `cfd809740ae64be307798eb7870feaf56227d9dc`.
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

- Add no-crawler, server-owned fetching of at most two already-discovered exact
  source pages for one candidate/focused generation, behind a DNS-pinned SSRF,
  redirect, deadline, byte, encoding and content-type boundary.
- Extend the existing evidence attempt/source architecture with replayable
  bounded extracted-page provenance. Raw HTML is never persisted or sent to
  the model; page text is hostile input and the focused Structured Output
  contract remains authoritative.
- Select source roles according to the unresolved criterion, recheck exact
  candidate identity after fetch and leave unsupported facts unknown.
- Remove merchant resolution from initial retrieval, run independent shopping
  and candidate work under explicit small concurrency caps, persist every
  terminal unit independently and report honest comparable latency.
- Resolve exact same-merchant destinations only for current top/saved offers in
  an immutable idempotent post-shortlist layer; Google Shopping remains the
  honest fallback.
- Project source depth, useful reasons for unknown and progressive purchase
  state into the calm consumer UI without exposing implementation internals.
- Run deterministic, PostgreSQL, browser, security, drift and production gates
  before exactly one guarded four-category Terra + Serper proof. Stop for
  independent review after exact-head CI; do not merge or start V0-10.

## Next validated checkpoints

1. Implement the V0-09 security/extraction boundary and page-evidence
   persistence with focused deterministic and PostgreSQL proof.
2. Implement post-shortlist exact-offer destinations and bounded retrieval /
   evidence concurrency with deferred-provider proof and measured timings.
3. Complete consumer projection and browser visual QA, then run all repository,
   migration, security and production gates.
4. Only when those gates and independent static review are green, run exactly
   one fresh guarded Terra + Serper proof across mouse, chair, vacuum and the
   exact compact-coffee-machine prompt. Preserve an honest diagnostic on
   failure; on success update evidence/ledger/PR, obtain exact-head CI and stop
   for independent review. Do not merge or begin V0-10.

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
  225/225 deterministic unit/component tests and the production build pass on
  the model-contract-aligned tree.
- Focused V0-08 PostgreSQL suite: 21/21 passes, including explicit broad versus
  focused model-call policy, exact gap targeting, A/B/C/D generation identity,
  malformed non-target output, active reservation, cross-stage target
  corruption, title evidence and failed-deep preservation.
- Full PostgreSQL suite: 114 functional tests pass. The sole local failure is
  the intentional PostgreSQL 17.6 version assertion against Homebrew 17.11; the
  repository pin remains unchanged.
- `pnpm test:e2e`: 8/8 Chromium tests pass, including automatic first/deep
  research, progressive cards, two saves, comparison, exact rejection/undo,
  refinement, refresh, mobile hard-unknown presentation and no overflow.
- `pnpm db:generate` reports 28 tables and no schema drift; V0-08 adds no
  migration. Production audit reports no known vulnerabilities.
- Eight production-server desktop/mobile/partial screenshots were regenerated,
  passed explicit horizontal-overflow checks and were inspected without Next
  development chrome.
- Exactly one newly authorized fresh live attempt generated at
  `2026-08-29T10:39:53.483Z` completed mouse, chair and vacuum. Each exact named
  target used a focused one-criterion provider contract, advanced exactly one
  current generation and wrote one in-scope assessment with no out-of-scope
  assessment writes. Mouse also proved one prevented duplicate call; vacuum
  proved an honest controlled partial run after a real provider response.
- Logical port counts were interpretation 4, action 4, shopping 12, merchant
  resolution 7, evidence search 27 and product understanding 29. These are
  logical application/port invocations, not transport-retry counts.
- The prior failure JSON/Markdown were removed before success evidence was
  written. The success JSON and Markdown contain no repository credentials or
  private local paths and strip known third-party tracking parameters.
- Historical delivery head `4e891f81f581d8c2614bbdf76bf5ae1073399c43`
  passed GitHub quality, PostgreSQL persistence and browser-smoke in run
  `33228469926`. The successful release checkpoint
  `5874ed96c071e73679b374293bddfcaf6623cbbe` passed exact-head quality, pinned
  PostgreSQL persistence and browser-smoke in run `33248668320`. PR #12 remains
  draft and unmerged; the following CI-record commit changes only this durable
  progress documentation.

## Exact resume instructions

1. Work only in
   `/Users/alchemist32/Documents/AI Shopping/ai-shopping-v0-09-source-depth` on
   `codex/v0-09-source-depth-purchase-path`; confirm it descends exactly from
   accepted V0-08 head `cfd809740ae64be307798eb7870feaf56227d9dc`
   and inspect the tree first.
2. Read this file and `docs/plans/v0-09.md`. Read only the V0-08 seams required
   by the current implementation layer; do not reopen accepted V0-03/V0-04 or
   earlier retrieval/evidence architecture.
3. Preserve V0-05 PR #9, V0-06 PR #10 and V0-07 PR #11 exactly. Do not merge
   them and do not weaken V0-05's Terra rule.
4. Do not rerun V0-08 evidence. Build V0-09 in the ordered layers recorded in
   its plan. Never weaken unknown, exact offer identity, evidence provenance,
   money, task authority, revisions, leases or focused target scope.
5. Do not fetch arbitrary user URLs, crawl links, create ProductIdentity,
   substitute another merchant, add auth/deployment/checkout/affiliate work or
   begin V0-10.
6. Before the single V0-09 live proof, require all deterministic, PostgreSQL,
   security, browser, migration and production checks plus independent static
   review to be green. After the one guarded proof, keep the new stacked PR
   draft/unmerged, confirm exact-head quality/persistence/browser-smoke, leave
   the worktree clean and stop for independent review.
