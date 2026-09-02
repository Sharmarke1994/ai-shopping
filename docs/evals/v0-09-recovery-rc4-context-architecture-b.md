# V0-05 context-hardening diagnostic (architecture-b)

This is one bounded Terra diagnostic batch, not V0-05 release acceptance.

- Model: gpt-5.6-terra (reasoning low)
- Logical interpretation calls: 14
- Coverage checks: 22; repairs: 8
- Logical action calls: 10
- Cases: 14; completed: 10; failed: 4
- Protected semantic violations: 21

## architecture-b-ergonomic-mouse-1

- status: completed
- action: search
- violations: ergonomic design became hard without must-language; ergonomic preference was not represented faithfully
- criteria: Price [hard], Wireless with very good battery life [preference], Review quality [strong_preference], Mouse shape [preference], Ergonomic design [hard], Brand reputation [hard], Brand [hard]
## architecture-b-ergonomic-mouse-2

- status: failed
- action: none
- violations: sculpted profile preference was lost; parent preference was lost; subordinate condition silently disappeared from state, ambiguity, and question; review importance was not preserved as strong preference
- criteria: none
## architecture-b-ergonomic-mouse-3

- status: failed
- action: none
- violations: sculpted profile preference was lost; parent preference was lost; subordinate condition silently disappeared from state, ambiguity, and question; review importance was not preserved as strong preference
- criteria: none
## architecture-b-ergonomic-mouse-4

- status: completed
- action: search
- violations: ergonomic design became hard without must-language; ergonomic preference was not represented faithfully
- criteria: Mouse shape [preference], Mouse bulk [preference], Reviews [strong_preference], Brand [hard], Brand quality [hard], Ergonomic design [hard], Wireless suitability with battery life [preference], Price [hard]
## architecture-b-ergonomic-mouse-5

- status: completed
- action: search
- violations: ergonomic design became hard without must-language; ergonomic preference was not represented faithfully
- criteria: Brand reputation [hard], Price [hard], Customer reviews [strong_preference], Wireless suitability with battery life [preference], Mouse shape and profile [preference], Ergonomic design [hard], Brand [hard]
## architecture-b-ergonomic-mouse-6

- status: completed
- action: search
- violations: ergonomic design became hard without must-language; ergonomic preference was not represented faithfully; subordinate condition became hard
- criteria: Mouse shape and profile [preference], Ergonomic design [hard], Brand reputation [hard], Wireless battery life [hard], Reviews [strong_preference], Wireless connectivity [preference], Brand [hard], Price [hard]
## conditional-wireless-battery

- status: completed
- action: ask
- violations: none
- criteria: Wireless with very good battery life [preference]
## explicit-hard-battery

- status: completed
- action: ask
- violations: none
- criteria: Battery life [hard], Wireless [preference]
## contextual-soft-lighter

- status: completed
- action: search
- violations: none
- criteria: Weight [preference]
## cap-golden

- status: completed
- action: search
- violations: none
- criteria: Breathability [preference], Physical weight [preference]
## shelving-golden

- status: completed
- action: search
- violations: none
- criteria: Product type [hard], Colour [hard], Visual weight [preference], Depth [hard], Price [preference], Slimness [preference], Width [hard]
## headphones-golden

- status: completed
- action: search
- violations: none
- criteria: Headphone form factor [hard], Noise cancellation [preference], Comfort with glasses [preference], Wireless connectivity [hard], Price [preference]
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