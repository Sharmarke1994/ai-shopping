# Decision Evolution — deterministic product checkpoint

## Scope and historical basis

This product-only change starts at `8e7b04fbe68d656ee98e5f0c55f86b8221fd0c18`.
It adds a server-projected, nullable transition below Current Decision, not a
second recommendation engine. No provider proof or release acceptance is claimed.

Authoritative before/after briefs come from `loadShoppingStateAtRevision` and
the applied state-change application's base/result revisions. Criterion lineage
connects replacements; displayed deltas describe resulting strengths and targets,
not internal operation names. Current decisions still use only current-revision
assessments. Historical decisions use only the exact captured prior generations.

Existing history alone was insufficient: rejection undo deletes its row and
later research can change which assessment generation is selected. Migration
0018 therefore adds a narrow immutable `decision_refinement_bases` record before
refinement interpretation: input/task/revision, assessment IDs, source IDs,
rejected exact listing IDs and capture time. It stores no generated prose. The
database rejects cross-task/revision references and updates. Capture is
idempotent and refuses unfinished research or stale input authority. The prior
conclusion is reconstructed only from terminal evidence; later mutable run
status cannot rewrite it. Missing history yields brief changes without an
invented previous decision. Previously existing tasks are not backfilled.

Listing continuity is exact ID equality, never cross-merchant product identity.
Evidence continuity follows the sources actually used by current assessments;
new shopper-relative assessments over previously captured sources count as
reused product evidence, not a new fetch. Rejection differences prevent
attributing movement solely to refinement. New sources produce conservative
mixed/new-evidence wording. This is not general same-revision decision history.

## Projection and experience

The transition contains revision basis, bounded brief changes, nullable previous
decision, current decision, movement, cause, causal criterion IDs, evidence
continuity, exact-listing continuity and unresolved check. Movement covers
reassessment, tie broken, leader changed, verification needed, ready, tie,
no recommendation, rationale changed, unchanged and no history.

Specific causal copy requires a changed criterion that participates in current
separation or a changed blocking requirement, plus grounded listing/evidence
continuity. Otherwise copy is deliberately non-specific. A changed leader is
not sufficient evidence of why it changed.

The compact What changed surface shows three deltas, with earlier conclusion,
remaining changes and evidence continuity behind native accessible details.
Current Decision remains the hero. Pending refinement suppresses the earlier
recommendation until server confirmation; persisted pending reassessment never
uses old assessments as current. Background deepening alone does not make a
completed current-revision decision stale. Refresh rebuilds from the database.

## Mouse evidence and bounded limitations

The exact test refinement is “Reviews matter less now. Comfort for long workdays
matters most.” Reviews changes from strong preference to preference; Comfort is
added as strong preference; unrelated price, wireless, conditional battery,
shape, brand boundary and Amazon Basics exclusion remain authoritative.

The controlled DecisionTransition unit fixture proves no-clear-winner to
ready-to-choose Mouse A when admitted comfort assessments distinguish it. The
real persisted application proof does **not** reach that result: the existing
assessment guard converts long-workday comfort into `personal_fit_unresolved`,
so the guarded revision 2 remains `no_clear_winner`. The proof verifies real
authority, pending-state isolation, new assessments, reused sources/pages,
saved exact listings, refresh and reject/undo attribution without overriding
that guard. Do not describe the unit result as an end-to-end product success.

The review/popularity lexical heuristic is coarse, but the present evidence
guard only admits rating aggregates for this category. A focused regression
records that independent review-quality prose remains insufficient evidence,
while preserving the explicit shopper criterion. Production policy is unchanged;
inventing a review-quality heuristic would exceed this bounded audit.

Targeted semantic cases also cover chair money/stretch authority, vacuum hard
unknowns, coffee width relaxation, leader switches, same-leader changed reasons,
ties, absent history and changed listing pools. Browser fixtures exercise cap
refinement, desktop/mobile layout and refresh; they are not a browser proof of
the unresolved mouse recommendation.

## Provider boundary

Only deterministic fixtures, disposable PostgreSQL state and fixture browser
mode were used. No OpenAI, Terra, Serper or context-provider calls; no credential
work, preflight, Checkpoint 3, proof marker or proof result. Checkpoints 1 and 2
remain unchanged and the one-shot product proof remains unconsumed.
