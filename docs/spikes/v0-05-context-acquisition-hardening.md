# V0-05 context-acquisition hardening

This is a bounded blocker-remediation branch from frozen V0-09 head
`934067e7d3796a4a68ba3b00387a16632a563f15`. It does not change V0-09, create
Attempt 4, or claim V0-05 release acceptance.

## Attempt 3 reconstruction

The preserved Attempt 3 artifact proves that the final authoritative revision
contained `Battery life` as a `hard` qualitative criterion and that the initial
wireless/battery request had already produced the relevant criteria before the
later refinement about reviews and long-workday comfort. The refinement did
not itself mention battery and did not supply a battery tightening operation;
the final state therefore retained the earlier error rather than proving that
the refinement hardened it. The final artifact also shows `Connectivity` as a
preference and the battery value as “very good battery life”.

The exact provider wire for the interpretation that introduced Battery life is
not recoverable. The diagnostic projection recorded provider request IDs and
`present: true`, but looked for a lowered `patch` field while the coordinator
persists the provider wire in `modelResult.value`; the disposable database was
then destroyed. Consequently the exact provider-assigned strength, target
semantics and value shape cannot be stated from the artifact. The lowerer was
unchanged and now has deterministic tests proving that provider strength and
all supported value branches pass through without authority mutation. The
persisted final state is evidence of the application result, not evidence that
lowering changed it.

Attempt 2 proves two interpretation provider-port calls: the first failed as
`invalid_state_patch` and the safe retry failed as
`structured_output_validation_failed`. It preserves request IDs and stage
metadata but no malformed provider payload or partial validated wire. Exact
malformed fields are therefore unknowable and are not guessed here.

## Corrections

The interpretation prompt is now version `v0-05-interpretation-5` and states a
category-independent authority rule: a subordinate condition attached to soft
preference language inherits at most the parent preference authority; “only if
X” is not “only X”; only an independently stated requirement can establish a
hard condition. The contrast examples cover fit and delivery cost as well as
wireless/battery.

The provider-visible OpenAI schema previously exposed several important rules
only through Zod `superRefine`: operation count by outcome, semantic-value
family compatibility, canonical measurement concepts, non-empty measurement
ranges and ASK/non-ASK branch coherence. The provider schema now exposes
small nested structural unions for operation cardinality, target/value-family
compatibility, measurement range bounds, canonical-unit creation and question
option cardinality. The root remains a strict object because OpenAI's helper
rejects a root union; application-side validation remains the firewall for
cross-field and relational rules such as range ordering and unique options.

No deterministic English authority guard was added. The server does not have a
reliable grammar/provenance parser for arbitrary shopper language, and a
homemade `only-if` parser could soften real hard requirements or misread scope.
Prompt hardening, structural output constraints, lowering invariants and
protected semantic evaluation are the narrow, category-independent controls.

## Deterministic and live evidence

The provider/lowering suite covers the nine authority cases in the checkpoint:
soft wireless/battery, monitor fit and delivery cost conditionals, explicit hard
battery and width bounds, hard exclusion and categorical-only language,
ordinary soft language, and strong-but-soft comfort language. A PostgreSQL
coordinator regression applies the conditional wireless/battery state, then an
unrelated review/comfort refinement, and proves battery remains a preference,
wireless remains directionally unchanged, review alone is relaxed, and comfort
alone is strengthened.

The prior bounded Terra low-reasoning context diagnostic was run on 2026-08-30
using the production context adapter and a disposable database. Its then-current
oracle reported 11/11, but independent review found that the cap direction was
reversed and that conditional criteria could disappear without detection. The
preserved artifacts are `docs/evals/v0-05-context-hardening-diagnostic-prior.json`
and `.md` (plus the prior attempt marker). They are historical diagnostic
evidence only, not acceptance evidence and not the 21/21 release gate. A new
bounded diagnostic is authorized only after this evaluator/provider correction.

The prior corrected Terra diagnostic then ran once on 2026-08-30 with the V2
provider wire and richer sanitized oracle. It completed 16/17 cases and
recorded four findings. Those artifacts are preserved as
`docs/evals/v0-05-context-hardening-diagnostic-prior-16-17.*`; they remain
historical diagnostic evidence only, not V0-05 acceptance evidence.

The final convergence diagnostic ran once on 2026-08-30 with 19/19 cases
completed and three semantic violations. Contextless lighter preserved the
meaning as a bounded ambiguity but incorrectly selected SEARCH instead of ASK.
Contextual backpack lighter was incorrectly treated as an unresolved reference
and produced no Weight preference. The headphones golden case preserved
wireless as a preference rather than the required hard include. No invalid
patches or provider structured-output failures occurred. This remains
diagnostic evidence only, not V0-05 21/21 acceptance. The exact result is
preserved in
`docs/evals/v0-05-context-hardening-diagnostic-prior-19-19.{json,md}` (with its
attempt marker).

The one newly authorized Phase-A Terra run then exercised exactly six protected
cases: conditional wireless/battery, explicit hard battery, contextless
lighter, contextual soft lighter, the headphones golden case, and the cap
golden case. All six completed with no provider or structured-output failures,
but the gate failed because the contextual backpack request produced a
`Weight` preference whose qualitative anchor was `current alternatives` rather
than preserving the explicit lighter direction. The other five cases passed,
including the contextless ASK/no-criterion rule and hard wireless headphones
form/mode semantics. This is an interpretation-stage semantic failure (not an
action, persistence, provider, or evaluator failure). The exact failed result
is preserved in
`docs/evals/v0-05-context-hardening-diagnostic.{json,md}` (and its attempt
marker); the prior 19/19 result remains archived under the `prior-19-19`
names. Phase B recovery work is not authorized from this failed gate, and the
formal V0-05 21/21 release gate remains open.

## V0-09 follow-up signals (not fixed here)

Attempt 3 also recorded four page-fetch failures, `response_too_large` on the
Tom's Guide Anker review, Anker product page and Amazon retailer page, no
admitted fetched document, broad first-pass product-understanding
`invalid_model_output` rows, and no destination-resolution call. Retrieval
concurrency was materially faster than the older path. These remain V0-09
follow-up prioritization signals and are intentionally untouched on this
branch.
