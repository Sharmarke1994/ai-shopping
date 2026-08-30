# V0-05 context-hardening diagnostic (phase-a)

This is one bounded Terra diagnostic batch, not V0-05 release acceptance.

- Model: gpt-5.6-terra (reasoning low)
- Logical interpretation calls: 6
- Logical action calls: 6
- Cases: 6; completed: 6; failed: 0
- Protected semantic violations: 0

## conditional-wireless-battery

- status: completed
- action: ask
- violations: none
- criteria: Battery life [preference], Wireless connectivity [preference]
## explicit-hard-battery

- status: completed
- action: ask
- violations: none
- criteria: Battery life [hard], Wireless [preference]
## contextless-lighter

- status: completed
- action: ask
- violations: none
- criteria: none
## contextual-soft-lighter

- status: completed
- action: search
- violations: none
- criteria: Weight [preference]
## cap-golden

- status: completed
- action: search
- violations: none
- criteria: Physical weight [preference], Breathability [preference]
## headphones-golden

- status: completed
- action: search
- violations: none
- criteria: Price [preference], Over-ear form factor [hard], Comfort with glasses [preference], Noise cancellation [preference], Wireless [hard]

Raw provider output and credentials are intentionally not persisted.