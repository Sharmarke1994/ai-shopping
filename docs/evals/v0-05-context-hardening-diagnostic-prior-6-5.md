# V0-05 context-hardening diagnostic (phase-a)

This is one bounded Terra diagnostic batch, not V0-05 release acceptance.

- Model: gpt-5.6-terra (reasoning low)
- Logical interpretation calls: 6
- Logical action calls: 6
- Cases: 6; completed: 6; failed: 0
- Protected semantic violations: 1

## conditional-wireless-battery

- status: completed
- action: ask
- violations: none
- criteria: Wireless with battery life [preference]
## explicit-hard-battery

- status: completed
- action: ask
- violations: none
- criteria: Wireless [preference], Battery life [hard]
## contextless-lighter

- status: completed
- action: ask
- violations: none
- criteria: none
## contextual-soft-lighter

- status: completed
- action: search
- violations: contextual lighter preference/direction was not preserved
- criteria: Weight [preference]
## cap-golden

- status: completed
- action: search
- violations: none
- criteria: Breathability [preference], Weight [preference]
## headphones-golden

- status: completed
- action: ask
- violations: none
- criteria: Wireless [hard], Noise cancellation [preference], Price [preference], Headphone form factor [hard], Glasses comfort [preference]

Raw provider output and credentials are intentionally not persisted.