# V0-05 context-hardening diagnostic

This is one bounded Terra diagnostic batch, not V0-05 release acceptance.

- Model: gpt-5.6-terra (reasoning low)
- Logical interpretation calls: 20
- Logical action calls: 20
- Cases: 19; completed: 19; failed: 0
- Protected semantic violations: 3

## conditional-wireless-battery

- status: completed
- action: search
- violations: none
- criteria: Wireless connectivity [preference]
## conditional-monitor-fit

- status: completed
- action: ask
- violations: none
- criteria: Monitor size subject to desk fit [preference]
## conditional-delivery-cost

- status: completed
- action: search
- violations: none
- criteria: Delivery speed [preference]
## explicit-hard-battery

- status: completed
- action: search
- violations: none
- criteria: Wireless [preference], Battery life [hard]
## explicit-hard-width

- status: completed
- action: search
- violations: none
- criteria: Width [hard]
## hard-exclusion

- status: completed
- action: ask
- violations: none
- criteria: Brand [hard]
## hard-only-black

- status: completed
- action: ask
- violations: none
- criteria: Color [hard]
## contextless-lighter

- status: completed
- action: search
- violations: contextless lighter did not ask for missing subject context
- criteria: none
## contextual-soft-lighter

- status: completed
- action: search
- violations: contextual lighter preference/direction was not preserved
- criteria: none
## contextless-comfort

- status: completed
- action: ask
- violations: none
- criteria: none
## contextual-strong-comfort

- status: completed
- action: search
- violations: none
- criteria: Comfort [strong_preference]
## cap-golden

- status: completed
- action: search
- violations: none
- criteria: Breathability [preference], Lightness [preference]
## shelving-golden

- status: completed
- action: search
- violations: none
- criteria: Price [preference], Depth [hard], Colour [hard], Visual lightness [preference], Width [hard]
## headphones-golden

- status: completed
- action: ask
- violations: categorical include /^wireless$/i at hard was not preserved
- criteria: Headphone form factor [preference], Noise cancellation [preference], Comfort with glasses [preference], Wireless connectivity [preference], Price [preference]
## conditional-money-stretch

- status: completed
- action: search
- violations: none
- criteria: Price [preference]
## comfort-vs-anc-question

- status: completed
- action: ask
- violations: none
- criteria: Comfort [preference], Noise cancellation [preference]
## explicit-indifference

- status: completed
- action: search
- violations: none
- criteria: none
## change-of-mind-relaxation

- status: completed
- action: search
- violations: none
- criteria: Maximum width [hard]
## two-turn-conditional-refinement

- status: completed
- action: search
- violations: none
- criteria: Reviews [preference], Wireless with battery life [preference], Comfort for long workdays [strong_preference]

Raw provider output and credentials are intentionally not persisted.