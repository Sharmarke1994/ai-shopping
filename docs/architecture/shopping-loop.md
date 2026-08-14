# Shopping Loop Architecture

**Status:** Approved V0 direction

## Loop

```text
UNDERSTAND
→ CLARIFY OR SEARCH
→ DISCOVER
→ LEARN FROM THE MARKET
→ SHOW
→ REACT
→ REFINE
→ SEARCH AGAIN
→ COMPARE
→ DECIDE
```

The loop, not the chat box, is the core product.

## Stage ownership

### Application state

Owns actors, independently identified tasks, market, task revision, messages, concepts, criteria, questions, runs, candidates, observations, assessments, reactions, saves, and trace records. Conversation is evidence, not truth.

### LLM contracts

Use distinct structured contracts for:

1. User-message interpretation and proposed state patch
2. Question/action selection
3. Search hypotheses and query plan
4. Observation extraction
5. Criterion assessment
6. Comparative judgement

One model call may return multiple clearly separated sections for latency, but permissions and validation remain phase-specific. Each section is independently schema-validated. Comparative judgement consumes validated assessment identities, never raw observations. Search/product content is untrusted and cannot issue instructions or mutate criteria.

### Deterministic application logic

- Validates and applies state patches
- Owns IDs, revisions, provenance, lifecycle, and idempotency
- Renders the consumer brief from authoritative state
- Normalises provider results and handles conservative deduplication
- Enforces suppression, admissible hard exclusions, staleness, retries, and failure preservation

## Question/action policy

The initial policy is intentionally qualitative. It chooses among:

- **ASK:** another answer could plausibly change retrieval, eligibility, or judgement enough to justify interruption.
- **SEARCH:** current context is sufficient for productive discovery.
- **SHOW/REFINE:** current candidates should remain visible while the user reacts or a non-blocking market-aware question is offered.

A question candidate records qualitative rationale, expected impact category, likely effort, why now, and whether search can proceed without it. These are reasoning aids, not numeric scores or threshold formulas.

Unknown alone is not a reason to ask. Do not ask a generic category field merely because it exists. Present one question at a time with no lifetime count. Offer **Show me options now** whenever responsible exploratory search is possible.

After an answer, traces let us measure actual information gain:

- Did authoritative criteria change?
- Did generated queries change?
- Did the candidate pool change?
- Did assessment or ordering change?
- Did the eventual saved/chosen product change?

This evidence—not a fabricated QuestionValue number—should inform later policy.

## Runs, revisions, and staleness

Every external workflow has a run bound to the task revision that produced it. The run records trigger, attempt, status, timestamps, stage configuration, partial/failure state, and errors.

A meaningful refinement increments the task revision. Older products may remain visible during refresh, but their assessments are visibly stale and cannot be silently presented as current. External calls happen outside database transactions; validated state changes apply transactionally. Client action IDs prevent duplicate messages, criteria, saves, or rejections.

## Minimum trace

Store bounded structured artifacts rather than chain-of-thought:

- Input message, action ID, task revision
- Proposed/applied/rejected patch
- Question candidates and chosen action
- Hypotheses, queries, purposes, and query lineage
- Provider result → normalised candidate mapping
- Deduplication and candidate disposition
- Observations and evidence references
- Criterion assessments and shown ordering
- Reaction and subsequent revision
- Stage status, duration, model/provider version, usage, and sanitised error

Application tables remain authoritative; trace data is diagnostic, not event sourcing.

## Failure behaviour belongs to each slice

- Interpretation failure preserves the original message and applies no partial patch.
- Stale state output is reinterpreted against the latest revision.
- One failed query may yield a partial run from successful queries.
- Provider results must be displayable factually when model assessment fails.
- Missing/broken images use deliberate fallbacks.
- Duplicate submission returns the prior action result.
- A retry is bounded and must not duplicate state.
- Refresh reconstructs the completed task from persistence.

Broader latency/cost hardening remains a later task, but basic timeouts, errors, and state preservation are implemented with the stage they protect. No written latency ceiling should normalise a slow experience; measure and reduce expensive stages continuously.

## Consumer UI responsibilities

- Make “what the system thinks I want” inspectable in natural language.
- Make applied refinements and stale-result refresh visible.
- Keep products first-class and conversation supportive rather than dominant.
- Present evidence status without internal ontology or confidence numbers.
- Preserve products while optional post-search clarification occurs.
- Support Save, Not for me, undo, link-out, and later comparison/decision closure.
- Remain deliberately designed at desktop and mobile sizes.

The visual palette is an implementation hypothesis to validate in screenshots. Premium, calm, trustworthy consumer quality is the invariant—not any particular colour.
