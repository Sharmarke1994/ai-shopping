# V0-05 context-hardening diagnostic

This is one bounded Terra diagnostic batch, not V0-05 release acceptance.

- Model: gpt-5.6-terra (reasoning low)
- Logical interpretation calls: 11
- Logical action calls: 11
- Cases: 11; completed: 11; failed: 0
- Protected semantic violations: 0

## conditional-wireless-battery

- status: completed
- action: ask
- violations: none
- criteria: Battery life [preference], Wireless connectivity [preference]
## conditional-monitor-fit

- status: completed
- action: ask
- violations: none
- criteria: Monitor size [preference]
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
## cap-golden

- status: completed
- action: search
- violations: none
- criteria: Breathability [preference], Weight [preference]
## shelving-golden

- status: completed
- action: search
- violations: none
- criteria: Depth [hard], Colour [hard], Price [preference], Visual lightness [preference], Width [hard]
## headphones-golden

- status: completed
- action: ask
- violations: none
- criteria: Comfort with glasses [preference], Over-ear design [hard], Wireless connectivity [hard], Price [preference], Noise cancellation [preference]
## conditional-money-stretch

- status: completed
- action: search
- violations: none
- criteria: Price [preference]
## comfort-vs-anc-question

- status: completed
- action: ask
- violations: none
- criteria: Comfort [preference], Noise cancellation [strong_preference]

Raw provider output and credentials are intentionally not persisted.