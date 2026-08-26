# V0-06 recursive founder-shopping evidence

**Run date:** 26 August 2026

**Route:** `/live`

**Market:** GB / GBP / en-GB

**Status:** Experimental branch evidence; draft and unmerged.

## Product result

The live founder flow now supports a real recursive shopping loop on one
authoritative task:

1. natural initial request → V0-05 interpretation → deterministic brief;
2. persisted SEARCH → focused UK query portfolio → exact Serper listing rows;
3. task-local save of an exact observed offer;
4. natural refinement → V0-05 patch/change-of-mind handling → new revision and
   SearchRun;
5. previously saved offers remain visible while the current market pool changes;
6. refresh reloads the exact task, brief, current run and saves without another
   provider call.

Search hypotheses and market vocabulary remain retrieval-only. They do not
write `DecisionCriterion` rows. Saved listings retain exact offer provenance
and are not promoted to a product identity, endorsement, preference or
recommendation.

## Real ergonomic-mouse journey

The initial request described an ergonomic mouse under £50, strong review and
battery preferences, a chunky/sculpted shape preference, wireless if battery
life was very good, and an explicit exclusion of Amazon Basics. The live model
projected these as separate typed brief items rather than collapsing them into
one blob.

Two later natural turns stayed on the same task and immutable initial subject:

- “These brands are too obscure. I want established reputable brands. Keep
  everything else the same and favour chunkier sculpted wireless options.”
- “Wireless only now, but battery life needs to be excellent.”

The persisted task finished at revision 3 with three task inputs, three
SearchRuns and two saved exact listing rows. The latest query portfolio was:

1. literal precision: `I need an ergonomic mouse under £50`;
2. hard/strong constraints: `I need an ergonomic mouse under £50 -"Amazon
   Basics" Wireless connectivity: yes very good reviews excellent battery life`;
3. preferences: `I need an ergonomic mouse under £50 -"Amazon Basics"
   established reputable brands a little chunkier and sculpted, with a
   noticeable side profile or thumb-rest`.

Each query persisted eight exact rows. Six of the 24 current rows were withheld
because observed price or an explicit listing phrase directly contradicted a
must-have. The remaining pool included Anker, Trust, ProtoArc and other observed
offers. An observed title saying “wired” is not yet treated as proof against a
wireless criterion; that requires a bounded evidence/assessment rule rather
than an unsafe title heuristic.

The founder saved:

- Anker 2.4G Wireless Vertical Ergonomic Optical Mouse — £17.99;
- Hama EMC-500 Vertical Ergonomic Optical Mouse — £17.99.

Those saves survived both later SearchRuns and refresh. They are interesting
options, not model claims that the brands are reputable or the products are
suitable.

## Retrieval and destination evidence

Query strategy version 2 now gives each query a distinct job: concise literal
precision, directly searchable hard/strong constraints, and unresolved shopper
preferences. Criterion-basis lineage contains only criteria whose phrases were
actually used. A third market-vocabulary query is added only when the other
jobs leave portfolio capacity.

In this UK mouse run, all 24 persisted Serper rows had Google Shopping
intermediary URLs and none supplied a verifiable merchant-direct destination.
The UI therefore labelled all 18 non-conflicting visible rows “View on Google
Shopping”. It never guessed or unwrapped a merchant URL. The adapter and UI can
use a direct HTTP(S) merchant destination if the provider supplies one in a
later result.

## Bounded hard-constraint triage

Pre-judgement triage is deliberately narrow:

- an observed numeric price can conflict with a hard price ceiling;
- an explicit title/merchant phrase can conflict with a hard categorical
  exclusion, including spaced, concatenated or hyphenated multiword forms such
  as Amazon Basics/AmazonBasics;
- anything else remains unknown and visible.

This is not suitability ranking. There are no fabricated product facts,
reputation claims, fuzzy identity, affiliate influence or hidden preference
updates.

## Visual findings

The current pool is visually dominant, the current brief remains inspectable,
and the refinement composer is adjacent to results. A long original request is
clamped with an explicit “Read the full request” disclosure so natural shopper
context remains accessible without pushing products below an oversized text
wall. Desktop and 390 × 844 mobile screenshots were inspected from the live
persisted task.

## Honest limitations and next product step

- Serper Shopping alone does not establish brand reputation, review quality,
  battery endurance, comfort or dimensions.
- Direct merchant coverage was 0/24 on the latest live run.
- Search recall still contains obscure marketplace offers and repeated products
  across query rows.
- Save is exact task-local persistence; reject/undo has not started.
- There is still no evidence-backed observation, criterion assessment,
  suitability judgement, shortlist or comparison.

The next smallest high-value layer is bounded product evidence for a small
candidate pool, followed by criterion-level assessment with visible unknowns.
That—not more query expansion—is what can distinguish actual suitability from
Google-style superficial relevance.
