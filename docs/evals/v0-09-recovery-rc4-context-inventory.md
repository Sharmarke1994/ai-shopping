# V0-05 context-hardening diagnostic (inventory)

This is one bounded Terra diagnostic batch, not V0-05 release acceptance.

- Model: gpt-5.6-terra (reasoning low)
- Logical interpretation calls: 14
- Proposal-blind inventory calls: 14; mapped interpretation calls: 7
- Coverage checks: 11; repairs: 6
- Logical action calls: 3
- Cases: 14; completed: 3; failed: 11
- Protected semantic violations: 36

## architecture-y-ergonomic-mouse-1

- status: completed
- action: search
- violations: ergonomic design became hard without must-language; ergonomic preference was not represented faithfully
- criteria: Wireless suitability with battery life [preference], Ergonomics [hard], Brand reputation [hard], Recommendation quality [preference], Price [hard], Mouse bulkiness [preference], Review quality [strong_preference], Flat minimal design [preference], Thumb-rest and side profile [preference], Mouse sculpting [preference], Brand [hard]
## architecture-y-ergonomic-mouse-2

- status: failed
- action: none
- violations: sculpted profile preference was lost; parent preference was lost; review importance was not preserved as strong preference
- criteria: none
## architecture-y-ergonomic-mouse-3

- status: completed
- action: search
- violations: ergonomic design became hard without must-language; ergonomic preference was not represented faithfully
- criteria: Overall option quality [preference], Mouse shape [preference], Mouse bulk [preference], Brand reputation [hard], Ergonomic design [hard], Price [hard], Wireless connectivity with very good battery life [preference], Brand [hard], Review quality [strong_preference]
## architecture-y-ergonomic-mouse-4

- status: completed
- action: search
- violations: ergonomic design became hard without must-language; ergonomic preference was not represented faithfully
- criteria: Price [hard], Ergonomic design [hard], Brand [hard], Brand reputation [hard], Wireless connectivity with battery suitability [preference], Review quality [strong_preference], Mouse body shape [preference], Overall option quality [strong_preference]
## architecture-y-ergonomic-mouse-5

- status: failed
- action: none
- violations: sculpted profile preference was lost; parent preference was lost; review importance was not preserved as strong preference
- criteria: none
## architecture-y-ergonomic-mouse-6

- status: failed
- action: none
- violations: sculpted profile preference was lost; parent preference was lost; subordinate condition silently disappeared from state, ambiguity, and question; review importance was not preserved as strong preference
- criteria: none
## conditional-wireless-battery

- status: failed
- action: none
- violations: parent preference was lost; subordinate condition silently disappeared from state, ambiguity, and question
- criteria: none
## explicit-hard-battery

- status: failed
- action: none
- violations: hard time condition was neither represented nor surfaced as ambiguity/ASK
- criteria: none
## contextual-soft-lighter

- status: failed
- action: none
- violations: contextual lighter preference/direction was not preserved
- criteria: none
## cap-golden

- status: failed
- action: none
- violations: light/low-weight direction missing; breathable meaning missing
- criteria: none
## shelving-golden

- status: failed
- action: none
- violations: around £30 target missing; maximum width 60 cm missing; maximum depth 30 cm missing; categorical exclude /^white$/i at hard was not preserved; visually light preference missing
- criteria: none
## headphones-golden

- status: failed
- action: none
- violations: wireless product mode was not preserved as a hard requirement; over-ear form factor missing; glasses comfort missing; noise cancellation missing; around £150 target missing
- criteria: none
## explicit-indifference

- status: failed
- action: none
- violations: authoritative full state did not mark the seeded width concept indifferent; the prior active width criterion remained effective after indifference; visible ShoppingBrief exposed an indifferent width item
- criteria: Maximum width [hard]
## change-of-mind-relaxation

- status: failed
- action: none
- violations: width relaxation did not preserve the new 80 cm ceiling
- criteria: Maximum width [hard]

Raw provider output and credentials are intentionally not persisted.