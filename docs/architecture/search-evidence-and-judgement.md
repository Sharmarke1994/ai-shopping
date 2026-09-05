# Search, Evidence, and Judgement

**Status:** Approved boundaries; provider and evidence sufficiency remain research questions

## Search is separate from judgement

Poor products can result from distinct failures:

1. Intent or state
2. Question/context acquisition
3. Decision model
4. Query strategy
5. Provider retrieval
6. Candidate normalisation/deduplication
7. Product evidence acquisition
8. Product observation
9. Criterion assessment
10. Comparative judgement
11. Decision UX

Do not respond to all failures by changing one prompt.

## Search hypotheses

A `SearchHypothesis` is a per-run theory about how the market may describe what the shopper means. It records rationale and basis references to the original request, active criteria, or observed market direction.

Example:

```text
User truth: normal running caps feel too substantial
Hypothesis: relevant commercial terms may include unstructured, race cap, or packable
Query: ultralight unstructured running cap UK
Purpose: explore low-bulk construction language
```

The hypothesis may improve recall. It cannot be used as a criterion, exclusion, or fit reason unless the user separately confirms the underlying meaning.

## Query plan

Every query is bound to a search run and task revision and includes purpose, hypothesis/basis lineage, market, language, and provider parameters.

V0 starts with a configurable cost/latency budget rather than product semantics:

- Exact lookup normally uses one direct query.
- Exploration may use up to three distinct, purpose-labelled queries.
- Independent provider calls run concurrently.
- Literal and expanded queries are compared in evals.

If expansion does not improve useful recall, simplify or remove it.

## Provider boundary

The engine depends on a provider-neutral contract conceptually equivalent to:

```text
search(query, market, language, surface, limit, requestId)
    → provider-neutral search results
```

Provider response types stop at this boundary. The internal engine must not know SerpAPI, Serper, or their field names.

Google's legacy Custom Search JSON API is closed to new customers and is not a V0 foundation. The initial provider comparison is timeboxed to roughly 20–30 minutes, using the golden categories and a fixed matrix: UK localisation, organic/Shopping coverage, direct merchant URLs, price/image/merchant completeness, useful-candidate recall, duplicates, schema, latency, failures, cost, terms, and developer experience. The output is a defensible learning choice, not permanent procurement. Record uncertainty and revisit when evidence warrants it.

## Candidate normalisation

A candidate listing retains:

- Provider-scoped ID and raw URL
- Conservatively canonicalised URL
- Run/query lineage and source rank
- Organic or Shopping surface
- Title, snippet, merchant, and image URLs
- Optional brand/model identifier
- Optional observed money value and availability text
- Retrieval timestamp

Normalise host/scheme/trailing slash and remove only known tracking parameters. Preserve variant parameters. Do not merge retailers by fuzzy title similarity. Create/shared product identity only from reliable identifiers.

## V0 evidence boundary

V0 first observes what the selected SERP surface actually provides. It does not assume page crawling is necessary or unnecessary before evidence exists.

Evidence kinds include:

- Provider structured field
- Source text or manufacturer/retailer assertion
- Supplied source image

Observation derivation is recorded separately and may be direct mapping, source-text extraction, visual inference, or model synthesis from referenced evidence. Model synthesis is never evidence for itself.

An assertion is sourced, not objectively verified. Visual inference cannot establish exact measurements, current stock, comfort, or other invisible technical facts. Important missing information remains unknown.

Product observations are explicitly task/run-contextual in V0 and reference task-local concepts where relevant. Cross-task knowledge reuse is out of scope.

At the product-understanding evidence gate, label the gaps left by SERP-only observations. Only when a decision-critical gap is demonstrated should a separately bounded page-inspection experiment be queued. Page inspection is not a first-loop exit requirement; add it only when it materially improves labelled assessment quality enough to justify cost, latency, reliability, and terms risk.

## Criterion assessment

For each candidate and active criterion, assessment records:

- Coarse status: meets, conflicts, uncertain, or not applicable
- Qualitative relation: closer, partial, thinner/more structured, relative to reference, within stretch, etc.
- Grounded explanation
- Supporting observation/evidence references

Assessment is task-revision-specific suitability interpretation, never reusable product truth. A source-free reason is rejected or converted into explicit uncertainty.

Hard exclusion requires an explicit hard criterion, a direct comparable contradiction, and an admissible evidence kind. Unknown information is neither pass nor failure.

## Comparative judgement

Rank from criterion assessments rather than raw observations. Allow ties and evidence-limited candidates. Consumer groupings may include:

- Closest fit
- Strong alternative
- Worthwhile stretch
- Meaningful trade-off
- Insufficient evidence

Do not create percentages, scalar match scores, arbitrary category weights, or affiliate signals. Diversity may expose a useful alternative direction but must not displace a clearly better evidenced candidate merely to create variety.

## Current decision synthesis

The consumer-facing current decision is a deterministic projection over the
current authoritative brief, current-revision assessments, comparative ordering,
research gaps, saved state and purchase-path state. It is not a reusable product
fact and does not invoke another model.

The projection distinguishes research in progress, a leader blocked by a hard
unknown, a qualified leader with a softer trade-off, a ready choice, no clear
winner, insufficient evidence and no eligible option. An ordered first candidate
is not automatically a recommendation. A leader requires a grounded
criterion-level advantage over the best eligible alternative (or, for a sole
eligible option, non-popularity evidence that it satisfies the brief). Provider
rank, identical assessment profiles, review volume alone and unrequested tiny
price differences do not create separation.

Recommendation eligibility fails closed: a hard conflict excludes the candidate,
an unresolved hard requirement blocks ready-to-choose, and evidence from an old
task revision is ignored. Explanations use the qualitative criterion-strength
ordering rather than an additive score. At most one supported alternative and
one current decision-changing gap are promoted into the primary summary. A
purchase action is projected only for a ready decision; verified same-merchant
destinations remain visually distinct from checking and Google Shopping fallback
paths.

## Progressive investigation

```text
Google queries
→ raw results
→ conservative normalisation/deduplication
→ likely product listings
→ factual candidate display
→ observations for decision-relevant concepts
→ criterion assessments
→ comparative judgement
→ selective deeper evidence only when valuable
```

Do not deeply inspect hundreds of pages. Spend expensive intelligence on promising candidates and important information gaps only after the product demonstrates the need.

## Evaluation and security

- Retrieval eval asks whether a labelled target entered the pool, which query found it, and whether normalisation removed it.
- Observation eval uses fixed evidence independently of ranking.
- Judgement eval uses fixed observations independently of retrieval.
- Every run records provider/model configuration, lineage, failures, usage, and latency.
- Provider/retailer text is untrusted data. It cannot alter user state, prompts, tool permissions, or system policy.
- Check selected-provider terms before retaining raw responses or product imagery.
