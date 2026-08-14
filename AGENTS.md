# AI Shopping Agent Guide

## Purpose

Build a consumer shopping intelligence product that turns natural, incomplete, and evolving intent into evidence-aware product discovery and confident decisions. The repository, not chat history, is the durable source of truth.

## Current phase

The approved product and architecture knowledge base exists. Application scaffolding, dependencies, credentials, and implementation are separate bounded tasks. Do not broaden a task because later work is documented.

## Hard invariants

- Application state, not the LLM transcript, owns current shopping truth.
- Unknown is valid; do not manufacture criteria or product facts.
- Explicit or user-confirmed information outranks inference.
- `DecisionCriterion`, `SearchHypothesis`, `ProductObservation`, `CriterionAssessment`, and `CandidateJudgement` are distinct semantic models.
- Concepts are open-ended and task-local in V0; record/value shapes remain typed and validated.
- Search hypotheses and product evidence can never write authoritative user criteria.
- Product observations are evidence-backed claims; criterion assessments interpret those claims for one task/run; rankings compare assessments.
- A bare rejection suppresses a candidate in the task and creates no preference.
- Questions are qualitative decisions with no fixed count or fabricated value score.
- Retrieval and judgement are separate, separately testable stages.
- No fake match percentages, arbitrary weighted scoring, affiliate influence, broad crawling, or provider leakage into domain logic.
- V0 may show one active task in the UI, but persistence must support multiple independently identified tasks.

## Read before changing

- Product direction or UX: `docs/product/vision-and-principles.md` and `docs/product/v0.md`
- Domain/state: `docs/architecture/semantic-model.md`
- Orchestration/questioning: `docs/architecture/shopping-loop.md`
- Retrieval, evidence, or ranking: `docs/architecture/search-evidence-and-judgement.md`
- Behaviour or prompts: `docs/evals/golden-cases.md`
- Open technical claims: `docs/research/register.md`
- Task order and evidence gates: `docs/plans/v0.md`

## Working method

1. Take one bounded task with explicit acceptance criteria.
2. Inspect existing code and relevant docs before editing.
3. Keep provider and model details behind interfaces.
4. Add layer-specific tests/evals with behaviour changes.
5. Build timeout, malformed-output, partial-failure, and state-preservation behaviour with each external stage.
6. Run the repository's documented lint, typecheck, test, and browser checks once scaffolding defines them.
7. For UI work, inspect real desktop and mobile screenshots.
8. Self-review for semantic leakage, hidden assumptions, unnecessary abstraction, stale docs, and missing failure paths.
9. Use a targeted read-only independent review when its expected value is material.
10. Update the relevant durable doc in the same change when behaviour or architecture changes.

## Definition of done

A task is not complete because code exists. Its acceptance criteria must pass; relevant deterministic tests/evals must pass; external failures must preserve authoritative state; UI work must be browser-verified; accepted review findings must be resolved; and durable documentation must still match reality.

Architect for validated learning, not completeness or arbitrary deadlines.
