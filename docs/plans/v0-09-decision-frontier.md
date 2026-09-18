# Decision Frontier

Product-only continuation from `62639ba42210830e85328e0b2c5f8f11244deedc`.
Current Decision states and ordinary ranking stay unchanged. A nullable,
server-derived frontier identifies at most one rational alternative, not the
second-ranked offer or a second recommendation.

## Contract and derivation

The alternative includes an exact listing ID/title, shopper-facing summary,
what is given up, up to two current assessment/observation-backed advantages on
each side, and an optional integer-minor-unit money relationship. It is never
persisted as shopper truth, product fact or a new judgement generation.

Derivation searches the existing bounded shortlist after current-revision,
rejection, conservative exact-offer and hard-exclusion guards. Both sides must
have an evidenced advantage. Only ready or ready-with-trade-off decisions may
have a frontier. A hard-unknown contender is not a clean alternative. Ties,
provisional leaders, excluded options and dominated options have no frontier.
Popularity and bare lower prices do not create an advantage.

For money, the bounded supported case is an explicit conditional stretch:
the leader has `conditional_stretch_supported`; the alternative has an exact
target or an evidenced below-target relationship. Both actual listing prices
must use the authoritative currency and agree with the deterministic assessment
relationship. No tolerance or “near enough” target band is invented. Savings
and target distance are integer arithmetic, not parsed display-price text.

The chair exposes the missing distinction in the prior implementation: ordinary
status comparison could not describe the target-budget side because £245 is
correctly not assumed to be an exact £250 match. The frontier may accurately
describe £5 below target and £85 saved without changing that assessment status
or making cheapness a ranking score. Non-price alternatives use grounded support
on another existing soft criterion, and explicitly retain the leader's advantage.

## Boundaries

No new category, fixture evidence rules, state mutation path, scoring system,
database migration, provider call, credential access or live proof. Mouse corpus
remains frozen. Checkpoints 1/2 immutable; Checkpoint 3 and proof unconsumed.

## Market-informed refinement audit

The existing loop has three useful but distinct pieces:

- `query-strategy.ts` builds purpose-labelled hypotheses and accepts up to three
  market-vocabulary seeds with criterion basis references. These remain search
  hypotheses, not user criteria. The live retrieval path loads its context
  without supplying those optional vocabulary seeds.
- Current decision gaps distinguish unknown hard boundaries from softer
  differentiators. Targeted research investigates existing evidence gaps. Saved
  comparison exposes differing current assessment states with provenance.
- Context action input contains source, concepts, active criteria, brief and
  capabilities, but no discovered-candidate/frontier/market-learning payload.
  Refinement already uses a human-submitted message through normal V0-04
  authority and can ask, search or show/refine without replacing the subject.

Decision Frontier now answers one important “what distinction matters?” question
from researched products: the chair trades target budget against stronger lumbar
support evidence. The vacuum's existing Noise gap already answers what must be
verified next; duplicating it as another suggestion would add noise.

The bounded bridge links the frontier to the existing refinement input and,
when both products are saved, to the evidence comparison. It does not prefill,
submit, change strength, save a product or call any provider. The shopper must
write and submit their own refinement. This is deliberately less assertive than
inventing a new interpretation/mutation path under the provider moratorium.

Remaining distinct gap: the engine does not yet turn a recurring observed market
distinction into one provenance-backed, optional search/refinement direction and
trace whether the shopper's confirmation changes queries and useful candidates.
That is the next product move, not another category or a duplicate summary.
It is not implemented in this run.

## Founder outcomes and verification

The persisted chair proves £330 supported leader / £245 alternative, £85 saved,
£5 below the authoritative £250 target, exact assessment/observation references,
refresh stability, save/unsave neutrality, rejection removal and undo restoration.
Mouse, vacuum and coffee remain negative controls. Unit coverage also protects
non-price bilateral trade-offs, third-option discovery, hard unknown/conflict,
staleness, rejection, duplicate exact offers, currency admission, source-free
claims and 1,000-character valid listing titles. Existing priority-change
Decision Evolution coverage now verifies the frontier flips with the leader.

Read-only review found one optional-projection title-boundary issue. The contract
now admits the full listing title, prose does not repeat unbounded titles, and
invalid optional enrichment fails closed rather than hiding the main decision.
The mouse corpus, assessment policy and ordinary recommendation states remain
unchanged.

Implementation checkpoint: `36b4a91`. This replaces the prior “no explicit chair
alternative” follow-up; the source corpus itself has not changed.

| Journey | Current Decision | Frontier | Reason |
| --- | --- | --- | --- |
| Mouse rev2 | `ready_to_choose`, Mouse A | null | B has no positive criterion advantage; existence/rank is not a reason |
| Chair | `leader_with_tradeoff`, Chair B | Chair A, eligible alternative | £85 saved, £5 below the £250 target, giving up stronger lower-back/long-session support evidence |
| Vacuum | `leader_needs_verification`, Vacuum A | null | B violates hard noise requirement; A still needs noise verified |
| Coffee | `ready_to_choose`, Machine A | null | B violates hard25cm width and remains factual comparison only |

The UI displays one “A sensible alternative” section with “You give up”, not a
second primary buy action. Purchase remains attached to the recommendation.
When both options are saved, the frontier links to the full comparison, which
also explains its relationship to the recommendation. Null frontiers render no
section. Keyboard checks verify focus and unchanged authority/empty draft when
following the refinement bridge. No duplicate live announcement is introduced.

Product QA used the real persisted application composition with fixture ports
and intercepted API transport, plus the existing normal fixture API browser
tests. It does not claim live provider execution. Both dedicated chair screenshots
were visually inspected at desktop and 390px mobile; reading order is decision,
leader reasons/trade-off, secondary frontier, then decision-changing check.
There is no horizontal overflow. The product explains **why B wins and when A
is rational**, rather than just announcing B.

- [Chair desktop](../screenshots/v0-09-frontier/chair-desktop.png)
- [Chair 390px mobile](../screenshots/v0-09-frontier/chair-mobile.png)
- Other founder controls refreshed under `docs/screenshots/v0-09-founder/`.

Deterministic gates:

- `pnpm check`: 487/487 tests in 51 files; format, lint, typecheck and production
  build pass. Decision/frontier semantic tests: 36/36, including the long-title
  regression; decision-evolution and component tests are included in the full gate.
- Focused persisted founder/product-engine journeys: 10/10, including the real
  symmetric/differentiated mouse paths and three differentiated founder categories.
- Production-server Playwright: 12/12, including all four persisted founder
  journeys, keyboard bridge, comparison navigation and null-frontier controls.
- Full PostgreSQL suite: 167/168 pass. The only failure is the permitted local
  `17.11 (Homebrew)` versus pinned `17.6` version assertion. Disposable databases
  migrate from empty through 0018; all other migration/structural tests pass.
  `db:generate`: no schema drift or new migration.
- Diff audit and added-line secret/private-path scans clean. Read-only review's
  title-boundary finding was corrected and re-reviewed as resolved.

Provider boundary: zero external OpenAI, Terra, Serper or context-provider calls;
no credentials, preflight, Checkpoint 3, proof marker or proof result. The one-shot
product proof is unconsumed. Protected checkpoint SHA256 hashes remain:

- Checkpoint1: `0e2d4ddbbf9eac649646b99454ac8962c9159e3d615b6a87c2a67967e4261272`
- Checkpoint2: `8a4001a01ddac452e896829cf50b7cf046d3caf07ecdaa8d28bd78910c25347d`

Implementation verdict: Decision Frontier ACCEPT; overall deterministic product
experience ACCEPT WITH BOUNDED FOLLOW-UP for the distinct market-learning gap
above. These verdicts are for independent review, not live release acceptance.
