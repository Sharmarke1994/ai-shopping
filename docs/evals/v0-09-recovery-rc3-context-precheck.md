# V0-05 context-hardening diagnostic (rc3)

This is one bounded Terra diagnostic batch, not V0-05 release acceptance.

- Model: gpt-5.6-terra (reasoning low)
- Logical interpretation calls: 4
- Logical action calls: 4
- Cases: 4; completed: 4; failed: 0
- Protected semantic violations: 0

## cap-golden

- status: completed
- action: search
- violations: none
- criteria: Physical weight [preference], Breathability [preference]
## headphones-golden

- status: completed
- action: ask
- violations: none
- criteria: Noise cancellation [preference], Price [preference], Over-ear design [hard], Comfort with glasses [preference], Wireless connectivity [hard]
## rc3-ergonomic-mouse

- status: completed
- action: search
- violations: none
- criteria: Wireless connectivity and battery life [preference], Brand quality [hard], Reviews [strong_preference], Mouse shape and profile [preference], Brand [hard], Price [hard], Ergonomic design [preference]
## rc3-explicit-hard-ergonomic

- status: completed
- action: search
- violations: none
- criteria: Ergonomic design [hard]

Raw provider output and credentials are intentionally not persisted.