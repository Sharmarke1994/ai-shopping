# V0-08 founder decision-loop proof

Generated: 2026-08-29T00:25:23.738Z

This is a sanitized real OpenAI + Serper run against a guarded disposable PostgreSQL database. Unknowns and provider failures are preserved rather than converted into fit claims.

## ergonomic-mouse

- Retrieval: {"status":"succeeded","queryCount":3,"completedQueryCount":3,"visibleListings":10}
- Efficiency: {"retrievalQueries":6,"candidatesBeforeTriage":48,"promisingCandidates":4,"firstPassEvidenceCalls":4,"deepeningEvidenceCalls":3,"productUnderstandingCalls":7,"hardUnknownsBeforeResearch":12,"hardUnknownsAfterFirstPass":6,"hardUnknownsAfterDeepening":6,"savedCandidates":2,"rejectedCandidates":0,"directRetailerCoverage":{"top":"1/4","saved":"0/2"},"timeToInitialListingsMs":21956,"timeToFirstDecisionSupportMs":62610,"firstPassDurationMs":40654,"actualProviderRequests":{"interpretationCalls":2,"actionCalls":2,"shoppingRequests":6,"merchantResolutionRequests":3,"evidenceSearchCalls":13,"understandingCalls":15}}
- Reject / undo: {"candidateListingId":"b4fe832a-a44e-456e-8d15-e019ec3a3b44","atomicallyUnsaved":true,"undoDidNotResave":true}
- Comparison: The current evidence does not meaningfully separate these saved options. Brand is the most important fact that could change the choice.
- Leave-the-app test: I would still leave Consider to verify Brand, Brand reputation, Battery life from richer product pages or specialist reviews; reach a direct retailer page for options that still use Google Shopping fallback.

### Current options

1. **Elprico 2.4G Wireless Vertical Mouse with Ergonomic Design and Adjustable DPI, Multiple Buttons for Gaming Works, Battery Operated, ABS Material** — £5.17; needs_verification; must-haves 1/3
2. **Amazon Ergonomic Wireless Mouse** — £7.90; needs_verification; must-haves 1/3
3. **Amazon Ergonomic Vertical Wireless Mouse 6 Buttons Right-Handed for Laptop PC** — £14.40; needs_verification; must-haves 1/3

## office-chair

- Retrieval: {"status":"succeeded","queryCount":3,"completedQueryCount":3,"visibleListings":23}
- Efficiency: {"retrievalQueries":3,"candidatesBeforeTriage":24,"promisingCandidates":4,"firstPassEvidenceCalls":4,"deepeningEvidenceCalls":3,"productUnderstandingCalls":7,"hardUnknownsBeforeResearch":0,"hardUnknownsAfterFirstPass":0,"hardUnknownsAfterDeepening":0,"savedCandidates":2,"rejectedCandidates":0,"directRetailerCoverage":{"top":"0/4","saved":"0/2"},"timeToInitialListingsMs":19185,"timeToFirstDecisionSupportMs":57440,"firstPassDurationMs":38255,"actualProviderRequests":{"interpretationCalls":1,"actionCalls":1,"shoppingRequests":3,"merchantResolutionRequests":3,"evidenceSearchCalls":7,"understandingCalls":7}}
- Reject / undo: {"candidateListingId":"699e753c-f5aa-4e3a-8671-1ed3ffba6466","atomicallyUnsaved":true,"undoDidNotResave":true}
- Comparison: NEWTRAL Magic H-BP Ergonomic Office Chair with Auto-following Lumbar Support-Black has stronger support on Chair appearance and Upholstery material. It currently has the strongest support against today’s brief; personal fit and explicit unknowns still remain yours to judge.
- Leave-the-app test: I would still leave Consider to verify Lower-back support, Budget, Chair size from richer product pages or specialist reviews; reach a direct retailer page for options that still use Google Shopping fallback; check returns and personal long-session comfort before purchase.

### Current options

1. **NEWTRAL Magic H-BP Ergonomic Office Chair with Auto-following Lumbar Support-Black** — £189.99; qualified; must-haves 0/0
2. **Ergonomic Office Chair with Arms & Headrest Cushion** — £338.00; qualified; must-haves 0/0
3. **GTPLAYER Mesh Gaming Chair with Footrest 3D Stereoscopic Frame Support Ergonomic Fabric CoverReclining Computer Office Desk Chair Height Adjustable** — £155.99; qualified; must-haves 0/0

## cordless-vacuum

- Retrieval: {"status":"succeeded","queryCount":3,"completedQueryCount":3,"visibleListings":21}
- Efficiency: {"retrievalQueries":3,"candidatesBeforeTriage":24,"promisingCandidates":4,"firstPassEvidenceCalls":4,"deepeningEvidenceCalls":3,"productUnderstandingCalls":7,"hardUnknownsBeforeResearch":12,"hardUnknownsAfterFirstPass":8,"hardUnknownsAfterDeepening":8,"savedCandidates":2,"rejectedCandidates":0,"directRetailerCoverage":{"top":"0/4","saved":"0/2"},"timeToInitialListingsMs":21153,"timeToFirstDecisionSupportMs":45146,"firstPassDurationMs":23993,"actualProviderRequests":{"interpretationCalls":1,"actionCalls":1,"shoppingRequests":3,"merchantResolutionRequests":3,"evidenceSearchCalls":7,"understandingCalls":7}}
- Reject / undo: {"candidateListingId":"de0aaaff-a30f-4600-8831-30cec51834db","atomicallyUnsaved":true,"undoDidNotResave":true}
- Comparison: The current evidence does not meaningfully separate these saved options. Floor compatibility is the most important fact that could change the choice.
- Leave-the-app test: I would still leave Consider to verify Floor compatibility, Noise level, Useful runtime from richer product pages or specialist reviews; reach a direct retailer page for options that still use Google Shopping fallback; validate real-world noise and durability beyond search snippets.

### Current options

1. **Vax Pace Plus Cordless Vacuum Cleaner** — £89.00; needs_verification; must-haves 1/3
2. **Einhell TE-VC 18 Li Solo Cordless Vacuum Cleaner 18V Bare Unit** — £37.99; needs_verification; must-haves 1/3
3. **Beldray Airgility Cordless Vacuum Cleaner** — £69.99; needs_verification; must-haves 1/3

## Honest boundary

- Search snippets remain attributable assertions, not crawled product-page truth.
- Personal fit, long-session comfort, real-world noise and durability can remain unknown after bounded research.
- Direct retailer destinations appear only when supplied or conservatively verified; Google Shopping remains the fallback.
- Exact listing rejection is task-local and is not preference learning.
- No ProductIdentity, crawler, affiliate ranking or hidden score was introduced.
