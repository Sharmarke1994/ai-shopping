# V0-06 first live founder shopping flow

**Run date:** 25 August 2026

**Route:** `/live`

**Market:** GB / GBP / en-GB
**Status:** Experimental branch checkpoint; pending founder and independent
review; not merged.

## What this checkpoint proves

The normal application path now connects the accepted foundations without
reconstructing a demo state:

1. a browser-generated opaque retry/session key creates exactly one server-owned
   `ShoppingTask`;
2. the initial natural request is recorded through the immutable
   `ShoppingSubject` path;
3. the real V0-05 coordinator proposes a patch and persists the next action;
4. the deterministic current `ShoppingBrief` is projected for the consumer UI;
5. a persisted ASK can accept open text or a server-resolved option ordinal via
   the V2 context-action-answer path;
6. a persisted SEARCH action owns one resumable Layer-3 retrieval run;
7. settled query receipts and exact CandidateListing rows are loaded back into
   factual consumer product cards.

The browser never supplies a task ID, revision, context-action ID, question ID,
option ID, or SearchRun ID. It supplies only opaque local retry keys and shopper
content. The private founder-session row binds those keys to server-owned,
task-scoped identities and remembers the current action or an interrupted input.

## Real founder proof

The real application received:

> A light breathable cap for running in hot weather

The live V0-05 path completed at revision 1 and projected two ordinary brief
items:

- `Breathability`: prefer breathable;
- `Weight`: prefer lightweight.

The persisted SEARCH ran two Serper Google Shopping queries. Both terminal
receipts succeeded and 16 exact listing rows were stored. Recognizable useful UK
results included:

- Domyos Fitness Cap — Decathlon UK — £7.99;
- Harrier Trail Running Summer Cap — harrierrunfree.co.uk — £23.19;
- Kiprun V2 Running Cap — Decathlon UK — £8.99;
- adidas Adizero Lightweight CLIMACOOL Cap — Start Fitness — £21.90;
- Patagonia Duckbill Cap — Patagonia Europe — £24.00.

Images, merchant names and GBP prices were present. Delivery and availability
were absent and therefore omitted. Destinations remain Google Shopping
intermediary pages, labelled honestly in the UI.

After repeated browser refreshes, the database still contained exactly one
task, one founder session, one immutable subject, one SearchRun, two planned
queries, two terminal query executions and 16 listing rows. Refresh is a
read-only load and does not construct dependencies for OpenAI or Serper.

## Consumer presentation boundary

- Product cards show only persisted title, image, merchant, observed price,
  optional observed delivery/availability and destination.
- There is no score, ranking, suitability, evidence assessment, recommendation,
  product identity or fuzzy deduplication.
- Exact rows sharing the same provider result ID, merchant and observed price
  are collapsed only for presentation and retain a count. Different merchants
  or prices remain distinct offers.
- The first 12 rows are shown initially with an explicit “show more” control;
  this is pagination, not a shortlist or judgement.
- Partial runs retain successful rows; terminal failures and provider failures
  are described without raw provider bodies or stack traces.

## Automated and rendered proof

- Application integration tests cover one task/subject, exact lost-response
  retry, direct SEARCH, ASK → answer → SEARCH, immutable subject versus answer
  trigger, refresh load, no repeated provider call, partial results and
  task-scoped retry keys.
- Client-contract tests reject authoritative IDs/revisions and protect the
  server-only Serper boundary.
- Chromium tests exercise direct search plus refresh on desktop and the
  deterministic ASK → answer → SEARCH flow at 390 × 844.
- A separate live rendered pass used the Keychain-backed OpenAI and Serper
  credentials against a guarded disposable local database. No credential was
  printed, logged or written to an artifact.

## Known limitations

- This is private local-founder continuity, not authentication or authorization.
- V0-05 formal release acceptance and PR #9 remain separate and unmerged.
- Serper links are Google intermediaries rather than merchant-direct links.
- Cross-query product overlap remains visible where no exact provider/merchant/
  price identity exists. ProductIdentity and fuzzy deduplication are deferred.
- Results are discovery evidence only. Save/reject, refinement, product evidence,
  criterion assessment, judgement, ranking, shortlist and comparison have not
  started.
