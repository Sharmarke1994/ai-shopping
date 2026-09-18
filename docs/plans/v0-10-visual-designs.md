# V0-10 — Saved visual shopping designs

The founder explicitly expanded the foundation scope: see real products in a
recognisable version of their room and retain that design. CONSIDER remains a
general shopping product; room setup is optional, not shopping onboarding.

## Bounded implementation

Save an immutable design basis referencing an exact room revision and selected
room photos (first photo is the viewpoint). Copy authoritative saved listing data
server-side, with shopper placement instructions. Never accept client-written
product facts. Designs can be saved without generation or credentials.

One explicit, consented generation attempt per design; durable draft/running/
completed/failed state, bounded timeout, no automatic paid retries. A timeout or
process interruption is not a semantic failure. Original photos and room facts
never change. Output stays separate from the photo/measurement provenance chain.
Room edits make older designs visibly historical rather than silently current.

Images are photorealistic **concept renders**, not metric 3D reconstruction. Product
references help appearance but do not prove exact variant, material, scale or fit.
Keep the original photograph beside the concept. Keep listing links and observed
prices beside products; generated objects cannot create purchasable listings.

## Provider boundary

An opt-in image-editing adapter sends only selected room images, bounded confirmed
context/design instructions and selected product references. Public product images
use existing DNS-pinned transport primitives, with no redirects and strict binary
bounds/decoding. Missing references fail closed rather than secretly using text-only
lookalikes. Production generation requires local configuration and explicit UI consent.

Official API reference consulted:
https://developers.openai.com/api/reference/resources/images/methods/edit

No live photo-fidelity acceptance is possible without actual room photographs.
Tests can prove persistence, isolation and failure handling, not render fidelity.

## Local operation

Use `/spaces/{spaceId}/design` from the room's **Explore a room design** link.
Upload real room photos first. Save product listings in the existing shopping
experience; products without a reference image cannot be selected for a render.
The default view shows the actual uploaded photograph, not invented showcase art.
Each saved possibility keeps its name, direction, room design/keep intentions,
photo order and selected product/placement snapshots. Saving is free of provider
calls. Prices remain observed prices; listing links do not promise current stock.

Generation is disabled by default. With the existing local database/asset directory,
configure `OPENAI_API_KEY` and explicitly set `CONSIDER_SPACE_RENDER_ENABLED=1`.
The user must additionally consent on each draft's render action to sending selected
images/context to OpenAI for one paid request. Runtime fixture mode disables rendering
even when a key is present. No credentials were retrieved or provider calls made
during implementation.

The narrow adapter uses `gpt-image-2`, high input fidelity, one 1536×1024 PNG concept.
No SDK automatic retries; the request has a 150-second abort deadline and bounded
response bytes. Product references use a 3-second DNS deadline and 8-second pinned
transport, reject redirects/encoded responses, and cap source bytes at 4 MiB before
normalisation. Failure to load an item photo prevents rendering; there is no silent
text-only substitution. Visual appearance still requires human inspection.

Up to 40 immutable saved possibilities per room; no deletion UI/garbage collection.
Only one active generation per room. A process-interrupted attempt is shown as such
after four minutes, never retried; a newly saved design can be explicitly attempted.
Late completions cannot overwrite a terminal failed attempt. Product reference URLs
and listing fields are snapshotted; remote reference bytes are fetched at render time,
not retained as a versioned merchant-image archive. The final generated PNG is stored
immutably outside the source tree, separate from real room assets.

## Review and acceptance boundary

Targeted read-only review identified connection-pool starvation from out-of-transaction
reads during a room lock and missing DNS timeout. Both are corrected with regression
coverage. Model output never edits room state. Database guards freeze design identity,
basis and terminal results, and reject invalid/partial lifecycle tuples.
The follow-up review found a delayed-read expiration race; a final running/deadline
check now prevents an already-expired handler from dispatching a paid request. A
paused-storage regression exercises the race against a newer attempt.

Real visual quality remains **unproven** until actual room photos and selected products
are used in an explicitly authorised render. This implementation is not acceptance of
faithful room reconstruction or accurate product placement. No actual 3D mesh, editable
spatial geometry, scale validation or automatic purchasing is implemented.

## Verification — 2026-09-18

- `pnpm check`: **560/560**, 57 files; formatting, lint, strict types and production
  build pass under Node 22.23.2.
- New renderer/contracts/component tests: **18/18**. Covers explicit extra-photo
  selection, consent, before/after presentation, preserved drafts, room identity,
  malformed output, DNS safety/deadline, provider abort and no automatic retries.
- New PostgreSQL visual-design suite: **13/13**. Real room and listing persistence,
  six concurrent idempotent saves with a two-connection pool, frozen shopping
  selections, missing-image fail-closed, immutable SQL boundaries, stale rooms,
  cross-space denial, single provider dispatch, interrupted/delayed requests and
  unchanged authoritative room state are covered.
- Full database suite: **197/198**. Sole failure remains the unchanged PostgreSQL
  **17.6** pin against local **17.11**. No test/evaluator was weakened.
- Full production-server browser suite: **17/17**, including all 12 original
  shopping tests and the three existing Spaces tests. The two new journeys exercise
  desktop 1440px/mobile 390px, save/return, historical-room labelling, unconfigured
  generation, cross-origin and cross-space rejection. No browser API mocking.
- Actual process restart with fixture and rendering modes off: saved design JSON
  SHA-256 remained
  `64f5927a088fd4859d48f8bb439d7c1c0363dbe37846bcc3f8fb44441c1f7f33`.
  Historical room revision 1 remained attached after the room advanced to 2.
- Migration from empty and repeated migration checks run through the database suite;
  local QA database has **21 migrations / 37 tables**. `pnpm db:generate`: no drift.
- Diff/security review: no introduced secrets or private paths; no changes to V0-09
  engine/context/eval/checkpoint artifacts. Regenerated older screenshots were restored.

Functional UI evidence (fictional uploaded illustrations, **not render-quality proof**):

- [Desktop studio](../screenshots/v0-10-visual-designs/studio-1440.png)
- [Mobile studio](../screenshots/v0-10-visual-designs/studio-390.png)

Status: implementation checkpoint for independent review. Live provider operation,
room fidelity and recognisable product placement remain unverified. Next: obtain
3–5 actual room photos, identify furniture to keep, select real saved items, and run
one explicit concept generation before judging this capability's visual quality.
