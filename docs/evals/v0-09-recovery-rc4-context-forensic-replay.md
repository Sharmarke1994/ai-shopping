# RC4 context-stability forensic replay

This report is a read-only replay of the preserved
`v0-09-recovery-rc4-context-stability-attempt.json` artifact. No provider calls
or state changes were made.

## Aggregate

- 8 ergonomic-mouse repetitions were present.
- 4 completed with protected semantic violations; 4 failed closed before state application.
- The completed violations were **ergonomic design became hard without must-language** and **ergonomic preference was not represented faithfully**.
- Failed repetitions had coverage issues for `strength_mismatch` and/or `conditional_loss`; their repairs did not reach a final complete verdict.
- The artifact ended with a harness serialization error: `Do not know how to serialize a BigInt`.

## Repetition matrix

| repetition | initial coverage | repair | final coverage | applied | exact first provable divergence | classification |
| --- | --- | --- | --- | --- | --- | --- |
| mouse-1 | needs repair: strength mismatch | completed | complete | yes | final complete verdict coexisted with an unauthorized hard ergonomic criterion | G: final-verifier false-pass |
| mouse-2 | complete | none | complete | yes | none; protected facets present in persisted state | pass |
| mouse-3 | needs repair: strength mismatch | completed | complete | yes | final complete verdict coexisted with an unauthorized hard ergonomic criterion | G: final-verifier false-pass |
| mouse-4 | needs repair: strength mismatch, conditional loss | completed | needs repair (stored with empty issue list) | no | repaired proposal still lost sculpted profile, parent/condition, and review importance | F: repair failed to fix; H: old attribution loss |
| mouse-5 | needs repair: strength mismatch | completed | complete | yes | final complete verdict coexisted with an unauthorized hard ergonomic criterion | G: final-verifier false-pass |
| mouse-6 | needs repair: strength mismatch | completed | needs repair (stored with empty issue list) | no | repaired proposal still lost sculpted profile, parent/condition, and review importance | F: repair failed to fix; H: old attribution loss |
| mouse-7 | needs repair: conditional loss, strength mismatch | completed | needs repair (stored with empty issue list) | no | repaired proposal still lost sculpted profile, parent/condition, and review importance | F: repair failed to fix; H: old attribution loss |
| mouse-8 | needs repair: strength mismatch, conditional loss | completed | needs repair (stored with empty issue list) | no | repaired proposal still lost sculpted profile, parent/condition, and review importance | F: repair failed to fix; H: old attribution loss |

The preserved artifact did not include proposal projections for the failed rows,
so it cannot distinguish whether the repair itself discarded a previously correct
meaning (E) from an initially omitted meaning that remained omitted (A/F). That
distinction is intentionally left unresolved rather than guessed. The new
diagnostic projection now persists sanitized initial, repair, and final proposal
semantics for future runs.

## Protected-facet evidence

The completed rows retain price, reviews, wireless/battery condition, sculpted
profile, brand-quality boundary, and the Amazon Basics exclusion in their
persisted semantic state. The only recorded violations in those rows concern
ergonomic meaning. The failed rows have no applied state, and therefore provide
no authoritative facet matrix beyond their persisted coverage issue kinds and
oracle failure strings.

## Consequence

The current verifier/repair architecture is not stable enough for the formal
V0-05 gate. No A/B reasoning-effort experiment, inventory prototype, formal
21/21 gate, or RC5 run was started from this failed evidence point.
