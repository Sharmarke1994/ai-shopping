# V0-09 Recovery RC4 checkpoint

RC4 is the next isolated one-shot recovery candidate after the immutable RC3
failure. RC3 remains frozen, including its marker, context precheck, and
founder-proof failure artifacts. RC4 starts from evidence head
`3b67784199769cf2efdf711e5972b784a8d10645`.

## Evaluator correction

The RC3 state preserved two distinct founder facets: hard qualitative brand
quality (“good brands only; exclude bad brands”) and hard categorical exclusion
of Amazon Basics. The evaluator incorrectly counted the qualitative reputation
wording as a second concrete exclusion. RC4 keeps the oracle strict by requiring
exactly one hard quality facet and exactly one exact Amazon Basics categorical
exclusion, while rejecting missing, softened, wrong-brand, and duplicate forms.

The RC4 offline self-test also replays the RC2 hard-ergonomic failure,
corrected ergonomic preference, both RC3 revisions, and representative valid and
invalid chair, vacuum, and coffee-machine briefs. No context prompt change or
new Terra precheck is part of RC4.

## Release gate

After deterministic checks and exact-head CI, RC4 may consume one durable
`fresh-four-category-one-shot` Terra + Serper proof. It has an independent
RC4 marker, artifacts, acknowledgement variable, and disposable database
namespace. A failure is preserved and never retried; a success is reviewed
before any merge or V0-10 work.
