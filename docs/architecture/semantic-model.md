# Semantic Model

**Status:** Approved conceptual architecture; code-level schema remains an implementation decision

## Core boundary

```text
DecisionCriterion
    ↓ evaluated against
ProductObservation
    ↓ interpreted as
CriterionAssessment
    ↓ compared through
CandidateJudgement
```

`SearchHypothesis` is a separate retrieval theory and has no write path into this chain's authoritative user state.

## Why these models differ

- **DecisionCriterion:** what the shopper explicitly wants or has confirmed.
- **SearchHypothesis:** a theory about commercial terminology or search direction that may find relevant products.
- **ProductObservation:** what evidence suggests about a product or listing in a task/run decision context.
- **CriterionAssessment:** what those observations mean for one active criterion at one task revision.
- **CandidateJudgement:** how candidates compare, including qualitative trade-offs and evidence gaps.

An observation such as “the crown appears unstructured” is not itself “a strong match.” A query term such as “race cap” is not automatically a preference. A bare rejection is neither.

## Task and concept scope

V0 authoritative criteria and dynamic concepts are owned by a `ShoppingTask`. Session data is transient. Workspace and user-level memory are not writable scopes yet.

The UI may expose one active task in V0. Persistence must support multiple independently identified tasks and must never use a global current-shopping singleton.

### ConceptDefinition

A task-local concept has:

- Opaque identity
- Human label
- Concise shopper-specific definition
- Value kind and optional unit
- Owning task

Examples include physical bulk, crown structure, robot-vacuum clearance, seat depth, clamp comfort, or screen glare. These are not a predetermined global enum. Existing task concepts must be reused across turns when meaning is the same; creating a concept is an explicit state-patch operation.

Task-local identity prevents model-generated synonym drift without creating a universal product ontology. Cross-task concept normalisation is deferred.

## Typed dynamic values

Concepts are open; values use a versioned discriminated union validated at every boundary. The initial grammar should cover:

- Boolean
- Qualitative text or ordinal relation
- Number with unit
- Range
- Money target, ceiling, or target-plus-stretch
- Categorical include, prefer, or exclude
- Comparison to a known candidate
- Explicit indifference

Examples:

- “Maximum £30” → hard upper bound
- “Around £30” → flexible target
- “Up to £40 if clearly better” → target plus conditional stretch
- “No white” → categorical exclusion
- “Nike preferred, others welcome” → preference, not eligibility
- “Thinner than number three” → comparative target referencing a candidate

JSONB may be a storage mechanism, but untyped `Record<string, any>` is forbidden. Record type, value shape, authority, provenance, strength, lifecycle, and subject are all validated independently.

## DecisionCriterion dimensions

Do not collapse these fields:

- **Authority:** user explicit or user confirmed
- **Source:** message, question answer, or direct brief action, with source reference
- **Strength:** hard requirement/exclusion, strong preference, or preference
- **Target semantics:** exact, range, around, stretch, categorical, qualitative, comparative, or indifferent
- **Lifecycle:** active, superseded, or removed

User confirmation gives an inferred idea user-confirmed authority while retaining its inferred origin in provenance. Unconfirmed model ideas do not enter active criteria.

## Four meanings of unknown

1. **Unmentioned preference:** no criterion exists.
2. **Explicit indifference:** remembered so the system does not ask again; excluded from ranking and the visible brief.
3. **Uncertain interpretation:** pending proposal or question, not authoritative state.
4. **Missing product knowledge:** the relevant criterion assessment is uncertain because evidence is missing or inadequate.

Do not pre-create common category attributes with unknown values.

## State-update contract

1. Persist each user message with an idempotency key.
2. Read the exact current task revision and active concepts/criteria.
3. Ask the state interpreter for a structured patch proposal only.
4. Allowed operations are create concept, add criterion, replace target, relax/tighten, remove, mark indifferent, or no change.
5. The server assigns IDs, task ownership, authority, provenance, timestamps, lifecycle, and the next revision.
6. Validate task ownership, expected revision, source message, concept/value compatibility, referenced records, lifecycle transition, and idempotency.
7. Apply a valid patch transactionally and increment the task revision.
8. Apply nothing on malformed or ambiguous output. A stale patch is reinterpreted against current state.
9. Clear new user truth may supersede prior conflicting truth. Ambiguity may trigger a question.
10. Render the consumer brief deterministically from active criteria and expose an undoable delta.

Query planning, observation extraction, assessment, ranking, and rejection handlers use separate contracts with no capability to mutate criteria.

## Product, listing, and observation subject

`ProductIdentity` represents a reliable underlying model when identifiers justify it. `CandidateListing` represents a merchant offer/URL. Price, availability, delivery, and merchant assertions are listing-level; construction or dimensions may eventually be product-level.

Every V0 `ProductObservation` is scoped to a `ShoppingTask` and `SearchRun`. `CandidateListing` is the default subject; reliable identifiers may additionally reference `ProductIdentity`, but never remove task/run scope or permit cross-task reuse. An observation includes:

- Task and run context
- Relevant task-local concept when applicable
- Product/listing subject
- Typed observed/interpreted value
- Evidence references and derivation kind
- Observation time

“Weight = 48 g” may later prove reusable. “Appears visually minimal relative to this shopper's brief” is contextual and must not become universal product truth.

### Evidence

Evidence identifies the external support available to an observation: source/result/image identity, structured field or bounded excerpt, evidence kind, source URL where relevant, and observed-at time. Evidence is not itself a suitability judgement. Model synthesis may derive an observation from referenced evidence; model output cannot serve as its own evidence.

## CriterionAssessment

An assessment is bound to a task revision, run, candidate, and criterion. It may use a coarse status:

- Meets
- Conflicts
- Uncertain
- Not applicable

The status does not flatten fuzzy shopping semantics. The assessment also retains a qualitative relation and grounded explanation, such as closer, partly aligned, thinner than reference, more structured, outside the preferred target but within stretch, or impossible to verify. It references the supporting observations/evidence.

Hard exclusion is permitted only when an explicitly hard criterion is directly contradicted by comparable evidence of an admissible kind. Missing evidence, visual inference, snippets, or model confidence cannot hard-exclude a candidate.

## Reactions

- Save changes shortlist state only.
- Bare Not for me suppresses only the acted-on `CandidateListing` in this task and supports undo.
- Cross-listing or product-wide suppression requires explicit user intent and is deferred.
- A rejection explanation is a new user message and follows the normal patch contract.
- No behaviour silently promotes context to workspace/user scope.

## Invariants to test

- A search term cannot become a criterion.
- An observation cannot become a fit judgement.
- A judgement call cannot mutate state.
- Explicit change removes conflicting active truth.
- Duplicate messages/actions are idempotent.
- Omitted colour remains absent; indifference is remembered.
- Source-free product claims fail validation or become explicit uncertainty.
- Stale assessments are not presented as current after task revision changes.
