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

## Verification in progress

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
