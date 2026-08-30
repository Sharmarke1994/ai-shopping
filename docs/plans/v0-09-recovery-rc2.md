# V0-09 Recovery RC2

## Authority

- Recovery candidate: `RC2`
- Accepted context head: `a17d37d80a710bb05b8c79d996596f2492c2424c`
- Frozen V0-09 head: `934067e7d3796a4a68ba3b00387a16632a563f15`
- RC1 failure head: `f02560132639e2095356e1ce54afbc87fbded068`
- Historical frozen V0-09 Attempts 1, 2 and 3 remain immutable.
- RC1 evidence and its one-shot marker remain immutable.

RC2 exists because RC1 proved that the page transport policy accepted a real
response above 1.5 MB while persisted fetched-page metadata still validated
`encodedBytes` and `decodedBytes` against the obsolete 1.5 MB ceiling.

## Bounded implementation

1. Keep separate authoritative limits for transport bytes, retained extracted
   evidence and provider/model input.
2. Prove a response above 1.5 MB and below 2.5 MB through fetch, extraction,
   exact admission, persistence, replay and model-input projection. Preserve
   exact retry and fail-closed changed retry behaviour.
3. Run a bounded historical-page soak without storing raw HTML.
4. Add sanitized product-understanding failure taxonomy, reproduce the old
   broad first-pass cardinality, and correct only evidenced contract defects.
5. Verify destination identity, current authority, idempotency, fallback,
   bounded concurrency and source-depth projection before live proof.

No crawler, browser automation, ProductIdentity, cross-retailer substitution,
auth, affiliate work, deployment or V0-10 is in scope.

## Page contract

- Transport safety cap: 2.5 MB.
- Retained extracted-document cap: 36 KB.
- Raw HTML is ephemeral, never persisted, logged or sent to the model.
- Identity encoding remains required; encoded and decoded byte counts are kept
  as distinct metadata for forward-safe semantics.

## Pre-release evidence

- The guarded page soak fetched the three exact historical pages through the
  production SSRF-safe transport. All three responses exceeded the obsolete
  1.5 MB ceiling. The 2,329,807-byte Tom's Guide review traversed fetch,
  extraction, exact admission, PostgreSQL persistence, replay and bounded
  model-input projection; its retained typed document was 12,815 bytes. The
  1,943,252-byte Anker page was admitted as manufacturer evidence. The
  1,660,461-byte Amazon page was rejected as the wrong model or variant.
  Raw HTML was not retained, and the disposable database was destroyed.
- Historical evidence showed seven of eight broad eight-criterion calls
  failing while focused one- and two-criterion calls succeeded. One explicitly
  authorized fixture-only Terra diagnostic then reproduced a broad-call
  `assessment_observation_ref_criterion_mismatch`. It is diagnostic evidence,
  not shopping truth or release evidence, and it may not be rerun.
- First-pass product understanding is therefore partitioned deterministically
  in authoritative brief order into exact one- or two-criterion calls. Each
  call owns one hashed extraction/assessment attempt pair with local ordinals,
  strict criterion binding, atomic terminal persistence, honest partial
  failure and unfinished-only resume. Historical reads revalidate the complete
  disjoint partition against the brief at the run revision. Deepening remains
  focused and reassessment remains one broad call.
- The existing semantic input ceiling remains 50 criteria. RC2 does not drop
  truth to hide cost: the explicit theoretical maximum is 25 model calls per
  candidate and 100 across four first-pass candidates. The protected founder
  cases are materially smaller; the live proof reports actual logical calls
  and exact paired receipts rather than relabelling them as HTTP attempts or
  spend.
- A bounded three-offer destination diagnostic resolved one exact same-merchant
  offer and rejected two no-result offers. It made no cross-retailer
  substitution and no database mutation. The resolved eBay destination used a
  global `.com` host, which remains an honest UK-market product limitation to
  inspect in release evidence rather than a reason to weaken exact-offer
  identity.
- Product-understanding failures now emit a sanitized bounded taxonomy while
  durable attempt rows retain their compatible coarse failure codes. The
  release harness requires an exact multiset match between failed model-call
  receipt pairs and per-category diagnostics; raw provider output, source text
  and error messages are never retained in that taxonomy.

## Release gate

RC2 may create exactly one new proof marker in its own namespace. The marker
must bind the exact current recovery commit and descend from the RC1 failure
head. It must reference the accepted context head, frozen V0-09 head, frozen
attempt artifacts and RC1 head.

Only after the deterministic, PostgreSQL, migration, security, browser and
rendered UI gates are green may the exact four founder journeys run once with
Terra and Serper. Success or failure evidence is durable. A second RC2 proof is
refused. The branch remains draft and unmerged, and V0-10 does not begin.
