# V0-05 context-hardening diagnostic (architecture-a)

This is one bounded Terra diagnostic batch, not V0-05 release acceptance.

- Model: gpt-5.6-terra (reasoning low)
- Logical interpretation calls: 14
- Coverage checks: 22; repairs: 8
- Logical action calls: 8
- Cases: 14; completed: 8; failed: 6
- Protected semantic violations: 21

## architecture-a-ergonomic-mouse-1

- status: failed
- action: none
- violations: sculpted profile preference was lost; parent preference was lost; subordinate condition silently disappeared from state, ambiguity, and question; review importance was not preserved as strong preference
- criteria: none
## architecture-a-ergonomic-mouse-2

- status: failed
- action: none
- violations: sculpted profile preference was lost; parent preference was lost; subordinate condition silently disappeared from state, ambiguity, and question; review importance was not preserved as strong preference
- criteria: none
## architecture-a-ergonomic-mouse-3

- status: completed
- action: search
- violations: none
- criteria: Wireless connectivity [preference], Review quality [strong_preference], Brand reputation [hard], Ergonomic design [preference], Brand [hard], Mouse shape and profile [preference], Price [hard]
## architecture-a-ergonomic-mouse-4

- status: completed
- action: search
- violations: none
- criteria: Mouse shape and profile [preference], Reviews [strong_preference], Brand [hard], Ergonomic design [preference], Wireless with very good battery life [preference], Price [hard], Brand reputation [hard]
## architecture-a-ergonomic-mouse-5

- status: failed
- action: none
- violations: sculpted profile preference was lost; parent preference was lost; subordinate condition silently disappeared from state, ambiguity, and question; review importance was not preserved as strong preference
- criteria: none
## architecture-a-ergonomic-mouse-6

- status: failed
- action: none
- violations: sculpted profile preference was lost; parent preference was lost; subordinate condition silently disappeared from state, ambiguity, and question; review importance was not preserved as strong preference
- criteria: none
## conditional-wireless-battery

- status: completed
- action: ask
- violations: none
- criteria: Wireless preference conditional on battery life [preference]
## explicit-hard-battery

- status: completed
- action: ask
- violations: 40 minutes degraded to generic qualitative text
- criteria: Battery life [hard], Wireless [preference]
## contextual-soft-lighter

- status: completed
- action: search
- violations: none
- criteria: Physical weight [preference]
## cap-golden

- status: completed
- action: search
- violations: none
- criteria: Physical weight [preference], Breathability [preference], Activity and weather suitability [preference]
## shelving-golden

- status: completed
- action: search
- violations: none
- criteria: Colour [hard], Depth [hard], Visual lightness [preference], Price [preference], Slimness [preference], Product type [hard], Width [hard]
## headphones-golden

- status: completed
- action: ask
- violations: none
- criteria: Comfort with glasses [preference], Over-ear design [hard], Price [preference], Noise cancellation [preference], Wireless connectivity [hard]
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