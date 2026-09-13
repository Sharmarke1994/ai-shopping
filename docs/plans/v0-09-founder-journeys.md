# Deterministic founder shopping journeys

## Scope and evidence boundary

Product-only continuation from `7c66942465c2f0a74f27dc64042bf071e49e74c5`.
These are fictional source-backed development journeys, not live product facts
or a provider release proof. No external provider, context acquisition,
credential access, preflight, Checkpoint 3 or one-shot proof is involved.

`tests/support/founder-product-evidence.ts` owns neutral fictional exact product
identities, Shopping rows, evidence results and HTML pages. Its test model reads
only projected source rows and authoritative criterion values. It never reads
an expected decision, winner, candidate index or provider rank. Exact model
identifiers distinguish the fictional pages without weakening identity admission.

`tests/support/founder-journey.ts` seeds the accepted founder requests through
actual V0-04 PostgreSQL state transitions. Retrieval, page admission, observation
and assessment persistence, decision synthesis, saves and application projection
are real. No final assessment rows are injected. Browser tests replace API
transport with those application functions over PostgreSQL; the exact refinement
is a labelled V0-04 seeding seam, not a test of natural-language interpretation.
Existing browser tests separately cover normal fixture-backed API transport.

## Flagship mouse

FLAGSHIP DETERMINISTIC MOUSE LOOP CLOSED

The generic symmetric corpus remains a separate regression: both candidates have
admissible extended-use comfort support; otherwise equivalent evidence stays
`no_clear_winner`, regardless of provider rank.

The differentiated corpus has equally priced (£39.99) Mouse A Workform 100 and
Mouse B Workform 200, balanced wireless, battery, shape, brand-boundary and review
evidence. A's exact independent page reports several full working days of comfort
without wrist fatigue. B's page explicitly does not evaluate extended-session
comfort. The latter is unknown, not a conflict or a positive ergonomic claim.

Revision 1 ties. Exact input:

> Reviews matter less now. Comfort for long workdays matters most.

The persisted patch relaxes Reviews to preference and adds long-workday Comfort
as strong preference while preserving unrelated truth. Existing guarded
assessment gives A `meets / extended_use_evidence` with an individual-fit caveat,
and B `uncertain`. Ordinary decision synthesis produces `ready_to_choose`, exact
A leader, with Comfort rather than Reviews explaining the separation.

The DB regression protects saved IDs, existing observation/source/document IDs,
historical revision-1 assessments, current revision-2 assessments, zero additional
evidence searches or page fetches, and new model/assessment work. Decision
Evolution is `tie_broken / brief_refinement / reused / same_listings`, with Comfort
as the causal criterion. Reload, leader rejection and undo preserve the grounded
history. The desktop/mobile browser scenario exercises save, refinement, reload,
reject and undo through the persisted application composition.

The mouse corpus is now frozen; further work moves to product breadth.

## Founder journey matrix

All requests and authoritative patches reuse the accepted four-category founder
definitions in `scripts/support/v0-09-product-engine-cases.ts`. GB/GBP/en-GB,
strengths, conditional targets, exclusions and indifference are unchanged.

| Journey | Source truth and boundaries | Decision / leader | Alternative, trade-off and gap | Next useful action |
| --- | --- | --- | --- | --- |
| Mouse rev2 | Equal £39.99 wireless products; A extended-use comfort, B explicitly untested; £50 ceiling and brand boundary preserved | `ready_to_choose`, Mouse A | B remains eligible but lacks Comfort support; individual fit can vary | Inspect evidence or purchase A |
| Chair | A £245, compact mesh with untested long-session comfort; B £330, compact mesh with sustained lumbar evidence and explicit comparative long-session support; £250 target, conditional £350 ceiling, no huge/gamer style | `leader_with_tradeoff`, Chair B | A is the budget alternative; B costs £80 above target, justified only by evidence addressing the stretch condition | Decide whether the evidenced long-session benefit warrants £80 |
| Vacuum | A £220, B £210, cordless and hard-floor/rug support; A noise untested, B explicitly very loud; £250 ceiling, hard not-very-loud boundary | `leader_needs_verification`, Vacuum A | B is ineligible, not a recommended alternative; A's hard noise gap prevents readiness; weight can remain unassessed in bounded page projection | Verify noise before buying; an exhausted identical source check is not offered again |
| Coffee | Both £299; A width24cm, B29cm against hard25cm ceiling; independent espresso and cleaning evidence, optional frothing; noise untested | `ready_to_choose`, Machine A | B is ineligible on width; unresolved soft noise preference does not become a hard block | Inspect A / purchase; compare the excluded B only as a factual saved option |

Each persisted category test verifies its exact leader, assessments and refresh
stability, plus a two-listing comparison (including a deliberately excluded row
where useful). Bounded missing evidence remains missing; source content is not
assumed to have been assessed merely because it exists in the fixture page.

## General defects corrected

- Supported conditional stretch lost its trade-off in decision synthesis. Both
  supported and unresolved in-ceiling stretch now retain the budget trade-off;
  copy exposes the actual amount above target. Guarded eligibility is unchanged.
- A current revision with reused-evidence reassessment looked like research had
  never started, hiding its valid decision. Reassessment now counts as the current
  initial assessment pass without fabricating a new source-search count.
- Explicitly untested/unassessed comfort prose could pass a positive experiential
  phrase check. The negative guard now retains uncertainty. Hard fit policy is
  unchanged.
- Distinct source captures sharing a URL caused React duplicate keys. Source
  rows preserve every capture with distinct presentation keys; no evidence merge.
- A real research/refinement authority race was mapped to temporary service
  failure. `StaleTaskRevisionError` now returns sanitized `409 stale_authority`
  with refresh guidance, not an instruction to abandon the saved task. A focused
  route regression protects that classification; it does not permit stale writes.

## Browser review and limitations

Four persisted browser scenarios cover desktop and 390px mobile, state-specific
purchase semantics, comparison and refresh. Screenshots live in
`docs/screenshots/v0-09-founder/`. The vacuum screenshot follows a completed
bounded check: “Checked · still unresolved” is truthful and prevents duplicate
research. It does not claim that the missing hard fact was resolved.

This demonstrates deterministic product breadth, not live-provider extraction
quality or real merchant purchase success. Fictional destinations are never
opened. Full gate results and remaining review items are recorded below when
verification finishes.
