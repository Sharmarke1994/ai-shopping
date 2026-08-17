# Research and Assumption Register

**Status:** Active
**Rule:** Unknown external facts stay unknown until bounded investigation produces evidence.

## Labels

- **FACT:** Supported by direct evidence or primary documentation.
- **PRODUCT PRINCIPLE:** A protected product/architecture choice.
- **HYPOTHESIS:** Plausible but unproven.
- **EXPERIMENT:** A bounded method for testing a hypothesis.
- **OPEN QUESTION:** Meaningful uncertainty that may alter implementation.

## Current facts

| Fact | Evidence / implication |
|---|---|
| Google's legacy Custom Search JSON API is closed to new customers and scheduled to end for existing users on 2027-01-01. | Use a third-party Google SERP provider behind an abstraction. [Google documentation](https://developers.google.com/custom-search/v1/overview) |
| OpenAI publicly documents structured merchant feeds containing core catalogue fields. | This documents an ingestion boundary, not OpenAI's private shopping architecture. [OpenAI commerce documentation](https://developers.openai.com/commerce/guides/get-started) |
| Current OpenAI documentation lists GPT-5.6 Terra with Responses API, structured outputs, and image input. | It is a reasonable initial model, not a permanent per-stage choice. [OpenAI model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-terra) |
| OpenAI Structured Outputs require an object root (not root `anyOf`), all fields required, and `additionalProperties: false`; nullable unions can represent optional transport fields, while refusals and incomplete Responses remain explicit non-success branches. | V0-05 uses separate strict provider-wire objects and deterministic lowering, scans typed Response message content, and still applies local/domain validation before mutation. [OpenAI Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs) |
| The runnable repository pins Node 22.18.0 and pnpm 11.19.0; scaffold, tests, fixture UI, and deterministic state work do not require external-service credentials. | Live AI/retrieval adapters remain service-scoped credential gates rather than blocking local quality checks. Repository runtime and environment contracts provide the direct evidence. |

## Open research

| Question | Why it matters | Blocks | Bounded investigation |
|---|---|---|---|
| Which Google SERP provider is best for V0? | Controls UK result fidelity, fields, images, URLs, cost, and latency. | Live retrieval | Timebox initial SerpAPI/Serper comparison to ~20–30 minutes across the golden categories; record uncertainty. |
| Does query expansion improve useful recall? | Query strategy may be valuable or AI theatre. | Search-strategy confidence, not initial adapter | Compare literal and purpose-labelled expanded queries with candidate lineage and human labels. |
| Where does SERP evidence become insufficient? | Determines whether selective page inspection should move earlier. | Strong suitability claims | Label SERP-only observations, then compare a few selectively inspected candidates at the product-understanding gate. |
| Can the model choose ASK vs SEARCH reliably? | Over-questioning and under-questioning both damage results. | Policy refinement, not first policy | Run labelled cases and trace actual downstream effects of answers. |
| Which model/effort split is appropriate? | Quality, latency, and cost differ by stage. | Optimisation, not first integration | Compare Terra low/medium and cheaper alternatives on fixed state/question/query/assessment cases. |
| How should products be identified across retailers? | Affects duplicates, suppression, and offer comparison. | Not V0 | Later test reliable identifiers before any fuzzy merge. |
| What image/response retention do provider terms allow? | Affects public deployment and fixtures. | External testing | Review official terms for the selected provider before retaining raw responses/images. |
| What is the current competitor baseline? | Prevents strawman differentiation. | Never blocks build | Run dated golden prompts periodically in current AI shopping products. |

## Assumptions to test

| Hypothesis | Evidence sought |
|---|---|
| Adaptive questioning improves product discrimination enough to justify interruption. | Whether answers change criteria, queries, candidates, judgement, or eventual choice. |
| Multiple query directions improve recall. | Incremental labelled candidates compared with the literal query. |
| Result-aware questions improve refinement. | Whether identified market clusters lead to useful state/search changes. |
| Task-local dynamic concepts work across unrelated categories. | Cap, shelving, and headphones pass without category columns. |
| SERP metadata plus optional imagery supports useful initial assessment. | Human-labelled observation accuracy and honest unknown handling. |
| A visible mutable brief improves trust and control. | Users can predict and correct what the next search prioritises. |
| Smaller curated pools outperform broad dumps. | Time-to-shortlist, decision confidence, and useful-candidate coverage. |
| Lightweight comparison reduces retailer-tab work. | Users narrow saved products before leaving the app. |

## Research discipline

1. State why an unknown matters and which gate it blocks.
2. Prefer primary documentation and direct provider responses.
3. Timebox initial research to the smallest decision-producing experiment.
4. Preserve sanitised fixtures and dated observations.
5. Record conclusions as fact, hypothesis, or remaining uncertainty.
6. Change durable architecture docs only when evidence changes a decision.
7. Do not turn provider marketing, model confidence, or agent consensus into evidence.
