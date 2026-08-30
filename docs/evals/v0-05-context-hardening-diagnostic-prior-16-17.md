# V0-05 context-hardening diagnostic

This is one bounded Terra diagnostic batch, not V0-05 release acceptance.

- Model: gpt-5.6-terra (reasoning low)
- Logical interpretation calls: 18
- Logical action calls: 17
- Cases: 17; completed: 16; failed: 1
- Protected semantic violations: 4

## conditional-wireless-battery

- status: completed
- action: ask
- violations: none
- criteria: Wireless connectivity with battery-life condition [preference]
## conditional-monitor-fit

- status: completed
- action: ask
- violations: none
- criteria: Monitor size with desk fit [preference]
## conditional-delivery-cost

- status: completed
- action: ask
- violations: none
- criteria: Delivery speed and cost trade-off [preference]
## explicit-hard-battery

- status: completed
- action: search
- violations: explicit hard battery requirement was not preserved
- criteria: Wireless [preference]
## explicit-hard-width

- status: completed
- action: ask
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
- criteria: Colour [hard]
## ordinary-soft-lighter

- status: failed
- action: none
- violations: ordinary soft lighter preference was not preserved
- criteria: none
## strong-soft-comfort

- status: completed
- action: ask
- violations: strong soft comfort language was not preserved as strong_preference
- criteria: none
## cap-golden

- status: completed
- action: search
- violations: none
- criteria: Weight [preference], Breathability [preference]
## shelving-golden

- status: completed
- action: search
- violations: none
- criteria: Width [hard], Depth [hard], Visual weight [preference], Colour [hard], Slim profile [preference], Price [preference]
## headphones-golden

- status: completed
- action: ask
- violations: none
- criteria: Wireless connectivity [hard], Price [preference], Comfort with glasses [preference], Over-ear design [hard], Noise cancellation [preference]
## conditional-money-stretch

- status: completed
- action: search
- violations: none
- criteria: Budget [preference]
## comfort-vs-anc-question

- status: completed
- action: ask
- violations: none
- criteria: Noise cancellation [preference], Comfort [preference]
## explicit-indifference

- status: completed
- action: search
- violations: explicit indifference did not replace the seeded width criterion
- criteria: none
## change-of-mind-relaxation

- status: completed
- action: search
- violations: none
- criteria: Maximum width [hard]
## two-turn-conditional-refinement

- status: completed
- action: ask
- violations: none
- criteria: Reviews [preference], Wireless with battery-life condition [preference], Comfort for long workdays [strong_preference]

Raw provider output and credentials are intentionally not persisted.