# V0-09 Recovery RC1 founder proof — failed

Generated: 2026-08-30T16:47:31.461Z

- Failed case: ergonomic-mouse
- Completed categories: none
- Active-case state captured: yes
- Interpretation diagnostics captured: 1
- Disposable database destroyed: yes
- Sanitized failure: ZodError: [
  {
    "origin": "number",
    "code": "too_big",
    "maximum": 1500000,
    "inclusive": true,
    "path": [
      "encodedBytes"
    ],
    "message": "Too big: expected number to be <=1500000"
  },
  {
    "origin": "number",
    "code": "too_big",
    "maximum": 1500000,
    "inclusive": true,
    "path": [
      "decodedBytes"
    ],
    "message": "Too big: expected number to be <=1500000"
  }
]
- Release accepted: no

This single Recovery RC1 attempt is preserved as diagnostic evidence only. Historical V0-09 attempts remain untouched and a second RC1 proof is refused.
