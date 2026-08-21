# Golden Evaluation Cases

**Status:** Initial approved cases
**Purpose:** Diagnose shopping quality by layer rather than relying on “it feels better”

## Evaluation rules

- Deterministic fixtures gate regressions; live model/provider runs produce dated reports.
- Human labels remain authoritative. An LLM grader may assist but cannot be the sole judge.
- Test retrieval, observation, assessment, and judgement independently as well as end to end.
- A failed case must be assigned to the earliest responsible layer where practical.
- Live product availability and prices are time-sensitive; refresh labelled candidates rather than treating them as permanent facts.

## Case A — Summer running cap

### Initial prompt

> I need a light breathable cap for running in this heat.

### Expected context behaviour

- Preserve light and breathable as explicit qualitative criteria.
- Do not invent colour, budget, retailer, sun-protection, or brand requirements.
- A useful question may ask what normally bothers the shopper about typical caps.

### Scripted answer

> Normal running caps feel too thick and substantial. I liked an old Nike race cap because it barely felt like anything. Nike is preferred, but I am open.

Expected state includes extremely low physical bulk/soft minimal feel and Nike as a preference, not a constraint. “Race cap,” “unstructured,” and “packable” may be search hypotheses but are not automatically criteria.

### Retrieval expectations

- Literal and expanded queries are both traceable.
- Expanded queries should test soft, race-style, ultralight, packable, or unstructured commercial directions.
- Target recall is evaluated independently of later rank.

### Observation/assessment traps

- The word “lightweight” is not proof of extremely low bulk.
- A thumbnail cannot establish exact weight or fabric thickness.
- Visual structure may be an explicitly labelled inference.
- Nike alternatives remain eligible.

### Refinement

> Number three is closest, but I want something even thinner.

Expected: a comparative criterion references candidate three; task revision changes; old assessments become stale; saves persist; new queries/judgement change observably.

### Success

The system distinguishes superficial marketing relevance from evidence-limited actual suitability, while remaining honest about unknowns.

## Case B — Slim shelving

### Initial prompt

> I need a slim open shelving unit for this corner, around £30.

### Expected context behaviour

- “Around £30” is a flexible target, not a hard ceiling.
- Dimensions are a high-value question because fit may become hard.
- No colour preference is invented.

### Scripted context

> It must be no more than 60 cm wide and 30 cm deep. No white. Dark is preferable, and I do not want anything visually bulky.

Expected: fit limits and white exclusion are hard and task-scoped; dark and visual lightness are preferences.

### Retrieval expectations

- Results target GB retailers and GBP.
- Slim/open products appear without hiding good £31–£35 options solely because of the flexible target.
- Missing dimensions stay unknown and cannot support “definitely fits.”

### Refinement

> I could go to £40 if it looks much better.

Expected: the budget becomes target-plus-stretch; no conflicting prior budget remains active; a meaningfully better stretch product may appear with a trade-off explanation.

### Success

The system preserves fit, flexible money semantics, visual preference, scope, and change of mind without converting the case into a fixed furniture schema.

## Case C — Commuting headphones

### Initial prompt

> I need wireless over-ear headphones for commuting, around £150. I wear glasses and hate strong clamping; good noise cancellation matters, but I am open on brand.

### Expected context behaviour

- Flexible budget, over-ear form, glasses/clamp comfort, ANC preference, and open brand remain separate.
- Do not invent colour, microphone, codec, battery, or ecosystem requirements.
- Avoid generic brand questions. A useful question may distinguish maximum ANC from lighter comfort.

### Retrieval expectations

- Technically relevant models enter the pool.
- Retrieval is not treated as proof of comfort or ANC quality.
- Product popularity/review count does not substitute for this shopper's decision lens.

### Observation/assessment traps

- Clamp comfort is often unknown from SERP evidence.
- Marketing claims about comfort/ANC remain source assertions.
- Absence of comfort evidence does not become positive or negative fact.

### Refinement

> Comfort with glasses matters more than having the strongest ANC.

Expected: criterion strength changes visibly; the new task revision invalidates prior judgement; ordering changes when fixed evidence supports it.

### Success

The model handles non-visual technical and experiential concepts without adding a headphone-specific schema.

## Layer-specific suites

### V0-05 protected live interpretation gate

The executable cases in
`src/features/context-acquisition/evals/golden-cases.ts` freeze the initial
release expectations for natural-language interpretation and ASK/SEARCH
selection. Run each case three times with the recorded release model and
configuration. All 21 runs must have zero protected-invariant violations; do
not average an invented criterion away.

- Light/breathable cap: retain only those two meanings, use no hard criterion,
  and do not manufacture minimal construction, colour, brand, or budget.
- Bounded shelving: retain width, visual lightness, and conditional budget
  semantics without broadening visual lightness into generic quality.
- Unsettled headphones: retain comfort and noise cancellation separately, keep
  both soft, and ask which leads rather than pretending one already does.
- Exact model lookup: add no decision criterion and go directly to SEARCH.
- Explicit change to indifference: end the prior width requirement without
  showing indifference in the visible brief.
- Underspecified size: ask rather than filling a category schema with common
  requirements.
- Quoted prompt injection: treat quoted listing text as data and preserve only
  the shopper's explicit red-colour request.

Qualitative truth may use text or a directionally equivalent ordinal. An
ordinal passes only when both its relation and anchor preserve the labelled
meaning—for example, less weight/heaviness or more lightness, never more weight.
This is
the two-variant wire contract already accepted in V0-05, not a relaxation of
criterion meaning.

The live report records case/run denominators, action, authoritative brief,
latency/usage diagnostics in persistence, and failures separately. A live pass
is release evidence, not permission to weaken the deterministic state engine.

The release evaluator matches labelled concept meaning against task-local
concept definitions without requiring exact labels, then checks a one-to-one
authoritative criterion set. For each protected case it freezes the exact
strength, target semantics, semantic-value kind, and relevant value details
(including categorical direction, measurement bounds/units, and conditional
money target/stretch). It also compares the structured brief with the
authoritative current state. The width change case additionally inspects the
persisted criterion history: the seeded explicit lineage must be removed at the
same revision that a new active indifference lineage is created, matching the
frozen V0-04 concept-level indifference contract. Indifference must remain
hidden from the brief. Protected ASK cases also inspect the
persisted prompt, rationale, and visible options so an unrelated or
unsupported question cannot pass merely because its action kind is `ASK`.
Positive qualitative and stretch meanings reject locally negated wording.

`pnpm eval:v0-05:live` requires `TEST_DATABASE_URL` naming a clearly test-only
database. Each invocation creates, migrates, uses, and drops a separately
guarded disposable database; it never falls back to `DATABASE_URL`. One dated,
sanitised result object produces both JSON and concise Markdown artifacts under
`artifacts/evals/v0-05`, including per-run and per-measure failures. The live
command evaluates and records the actual authoritative state even when action
selection fails after interpretation. It remains credential-gated and must not
be run or reported as passing until the corrected gate has been independently
reviewed.

The non-CI live runner waits 35 seconds after one top-level model call finishes
before starting the next. Measuring from completion also covers any bounded
internal retry. This conservative pacing preserves the release
model/configuration while keeping fresh-project request and token limits from
masquerading as semantic failures; production request scheduling is outside
this eval-only mechanism.

### State semantics

- Explicit replaces or removes conflicting active truth.
- `around £30` remains flexible; `maximum £30` is hard.
- Nike preferred never becomes Nike-only.
- Omitted colour stays absent; explicit indifference is remembered.
- Comparative criteria reference a known candidate.
- Duplicate messages/actions are idempotent; stale patches do not apply.

### Boundary safety

- Search hypotheses cannot become criteria.
- Product observations cannot become suitability judgements.
- Assessment/ranking outputs cannot mutate criteria.
- Bare rejection changes suppression only.
- Explained rejection updates state only through the standard user-message contract.

### Question policy

- Exact lookup normally asks none unless blocked.
- Vague requests may receive a useful discovery question.
- Low-value unknowns do not trigger a questionnaire.
- One question appears at a time without a lifetime count.
- Search-result clusters may generate a non-blocking question without changing state before the answer.
- Trace records whether the answer later changed state, queries, candidates, judgement, or decision.

### Retrieval

- Known target/provider-searchability is recorded.
- Literal and expanded queries are evaluated separately.
- Candidate query lineage survives normalisation.
- Conservative deduplication does not remove distinct variants or retailer offers.

### Observation and evidence

- Fixed evidence produces only supported or explicitly inferred observations.
- Source-free claims fail validation or become unknown.
- Visual inference cannot hard-exclude.
- Missing weight, comfort, fit, availability, or dimensions remain unknown.
- Contradictory evidence is preserved rather than silently overwritten.

### Assessment and judgement

- Fixed observations can be assessed without retrieval.
- Coarse status retains qualitative relations such as partial, closer, thinner, or within stretch.
- Hard exclusion requires direct admissible contradiction.
- Candidate groups use grounded trade-offs and permit ties.
- No scalar score or affiliate signal exists.

### UX and resilience

- Brief appears from authoritative state and displays applied deltas.
- Save/reject/undo survive refresh and rerun.
- Existing products remain visible during refinement/post-search questions.
- One failed query can still render partial results.
- Assessment failure falls back to factual cards.
- Broken images have deliberate fallbacks.
- Mobile and desktop screenshots are reviewed for hierarchy, spacing, product prominence, and interaction safety.

### Security

- Malicious instructions in snippets, titles, or product pages cannot alter task state, tools, prompts, or trusted claims.
- Paid provider/model routes remain server-only and protected before external deployment.

## Failure taxonomy

Classify failures as intent, context acquisition, state, decision model, query strategy, retrieval, normalisation, product evidence, observation, assessment, comparative judgement, decision UX, or trust. Fix the responsible layer rather than reflexively editing a giant prompt.
