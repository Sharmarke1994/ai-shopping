# V0-09 Recovery RC3 checkpoint

Recovery RC3 is a single, separately namespaced release-proof attempt built on
the accepted RC2 evidence head `e4ad5b340a21ace15c6bb58dba6d981cc1055d6d`.
RC2 remains immutable and its failure artifacts are frozen historical evidence.

## Bounded corrections

- The founder-intent oracle now separates lexical overlap from the semantic
  rule that actually authorizes a criterion. Overlapping words such as
  “ergonomic” and “shape” no longer produce a false invented-criterion error.
- Interpretation prompt policy now treats ordinary ergonomic design language as
  a preference, while explicit “must/only/requires” language remains hard.
- The deterministic RC3 oracle replay covers ergonomic preference, sculpted
  profile, explicit hard ergonomic language, independent meanings, and the
  sanitized RC2 failure.

## Terra context precheck

One tiny, non-release Terra precheck was run once under the separate
`v0-09-recovery-rc3-context-precheck` artifact namespace. It completed 4/4
protected cases with zero violations: cap, headphones, ordinary ergonomic
mouse, and explicit-hard ergonomic mouse. It used `gpt-5.6-terra` and the
guarded disposable/test database. These results are diagnostic only and do not
constitute the four-category release proof.

## Full-proof gate

The RC3 proof has its own durable one-shot marker, output artifacts, database
name pattern, and acknowledgement variable. It must run exactly once, only
from a clean committed head descending from the accepted context/V0-09/RC2
checkpoints, with `V0_09_RECOVERY_RC3_LIVE_RELEASE_ACK` set to
`fresh-four-category-one-shot`. Acceptance remains the existing strict
four-category Terra + Serper predicate; a failure is preserved and is not
retried. PR #15 remains draft and unmerged, and V0-10 does not begin here.
