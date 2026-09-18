# V0-10 — Persistent Spaces

Isolated from accepted V0-09 `d6c2b5999126e077e373a57504473caacaa1ce15`.
This explicitly authorised scope extends the earlier V0 non-goal of long-term
context without changing shopping criteria, judgement, retrieval or release proof.

## Design

A Space is an independent durable identity with an immutable revision stream.
Each revision holds bounded, validated room facts, explicit measurements, inventory
intent, unknowns and a RoomDesign. Photo membership is relational, with same-space
foreign keys. All operations use expected revision under a row lock. No stale
tab can overwrite current truth. Historical snapshots are never updated.

Photos live outside the source tree behind SpaceAssetStorage. PostgreSQL holds
metadata only. Uploads are bounded before multipart parsing; decoded images are
normalised once using Sharp (already present in Next's dependency tree), stripping
EXIF/location metadata, rejecting animation and limiting decoded pixels. This is
not a thumbnail/editor pipeline. Immutable SHA-256 keys never use shopper filenames.

Visual understanding is a provider-neutral port accepting multiple selected images
and confirmed truth. Its strict output permits only proposals and explicit unknowns,
never measurements. Production has no model. An opt-in local test-database fixture
mode is prominently labelled fictional; it never claims to understand uploaded photos.

Confirmation/correction is explicit. Later proposals append without overwriting
confirmed facts or measurements. Inventory keep/replace/undecided is shopper intent,
not a model inference. RoomDesign (goal, palette, styles, additions, notes and optional
GBP budget) is revisioned with the room; it is not a generated image.

No auth is added: this is a local single-founder surface, not safe public hosting.
Same-space asset membership is not a substitute for future user authorisation.
Object-storage lifecycle/deletion and multi-user access control remain future work.

## Next integration seam (not implemented)

A shopping task may eventually reference an exact `(spaceId, revision)` context.
Room observations, user-measured fit constraints and design preferences remain
separate authorities. Nothing here writes DecisionCriteria.

## Verification

Local verification uses Node 22.23.2 and PostgreSQL 17.11 (Homebrew).

- Focused unit/component boundary checks: **55/55** (19 domain, 15 asset/security,
  8 HTTP, 13 component). Includes actual two-frame WebP rejection, metadata removal,
  traversal/symlink/integrity guards, exact fractional measurements and cross-room UI
  identity reset.
- `pnpm check`: **542/542**, 55 files; formatting, ESLint, Next route types, strict
  TypeScript and production build pass.
- Full browser suite: **15/15** against a production build. Both complete Spaces
  journeys run at 1440px and 390px; all 12 pre-existing shopping tests pass. Spaces
  use real HTTP routes, PostgreSQL and filesystem bytes, not mocked API responses.
- The spaces DB suite also checks that adapter input mutation cannot change room
  truth, alongside output injection, stale analysis completion, historical membership,
  pointer progression, ten-photo quota and restart/reload consistency.
- Spaces PostgreSQL behavioural suite: **17/17**. Full isolated database suite:
  **184/185**; the sole failure is the unchanged PostgreSQL **17.6** version assertion
  against installed **17.11**. Earlier concurrent build/browser verification caused
  two existing five-second shopping-test timeouts; the standalone rerun cleared both
  without changing tests, timeouts or shopping code.
- Fresh disposable database migration completed; migration rerun checks pass with
  **20 migrations / 36 tables**. `pnpm db:generate` reports no schema changes.

### Process restart proof

Stopped and restarted the production server against the same database and asset
directory, with fixture analysis disabled. Revision **14**, all **three photos** and
the complete saved state remained identical. State-plus-assets SHA-256 before/after:
`895cb7290797cfb7e86db6a24fba6898f7920bfd0d119d597a2fe5e012f2cb9a`.
Every photo returned HTTP 200 with the recorded byte size. The normal runtime showed
analysis unavailable; an analysis request returned 503 without changing the state.
Previously confirmed fixture facts retained their fictional origin label.

[Room after process restart](../screenshots/v0-10-spaces/bedroom-after-process-restart.png)

### Scope and audit

No model, retrieval or image-generation provider calls were made. V0-09 shopping
logic and accepted evaluation artifacts remain unchanged; no Checkpoint 3 or release
proof was created. Secret/private-path review and diff checks found no introduced
credentials or real private filesystem paths. Test fixtures contain deliberately
synthetic exception text to verify error sanitisation.

Implementation self-assessment: **ACCEPT WITH BOUNDED FOLLOW-UP**, pending independent
review and the full database gate on the intended PostgreSQL 17.6 environment. No
remote CI success or independent acceptance is claimed. The next product move is a
bounded production multimodal adapter producing confirmable proposals, never measured
dimensions. It is not implemented here.

### Founder dogfood

Each viewport created Bedroom without dimensions, uploaded three fictional room
illustrations, received six explicitly fictional proposals, confirmed Black desk,
corrected King bed to Double bed, and rejected Shelving. User-entered Desk wall
width remained **214 cm / 2140 mm**, labelled **Measured by you**. Bed and desk were
marked Keep; an explicitly entered Floor lamp was marked Replace. RoomDesign saved
the warmer/cleaner goal, Rug / Warmer lamp / Wall art additions and four palette
labels. Refresh and a new browser context reproduced it. A real stale-tab write was
rejected while preserving the unsaved input and offering explicit reload.

Keyboard confirmation/correction restores focus to the remaining proposals heading.
Screenshots were visually inspected at desktop and 390px, including close-ups of
confirmed versus measured provenance. No horizontal overflow. The images are original
test illustrations, not user photographs and not a model interpretation.

- [Desktop room](../screenshots/v0-10-spaces/bedroom-1440.png)
- [Mobile room](../screenshots/v0-10-spaces/bedroom-390.png)
- [Mobile first screen](../screenshots/v0-10-spaces/bedroom-mobile-first-screen.png)
- [Confirmed provenance](../screenshots/v0-10-spaces/bedroom-mobile-confirmed.png)
- [Measured provenance](../screenshots/v0-10-spaces/bedroom-mobile-measurements.png)
- [Spaces empty/list page](../screenshots/v0-10-spaces/spaces-initial-1440.png)

The normal runtime still supports photos, manual facts, measurements and design with
no model configured. No production image understanding, generated redesign, inferred
physical dimensions, room-to-shopping integration, cloud object storage or auth is
included. The production adapter is the next product step, not this sprint's claim.

## Local founder operation

Use the existing PostgreSQL configuration and migration command. Configure
`CONSIDER_SPACE_ASSET_DIR` to an absolute, canonical non-temporary directory outside the source
tree before uploading. The directory must be writable by this application only;
back up it and the database together. No credentials or user photos belong in git.
The API works for manual room facts/design even if photo storage is unavailable.
Default `pnpm dev` and `pnpm start` bind to `127.0.0.1`; do not expose them through
a public proxy or override that bind before user authorisation is implemented.
The API also rejects non-loopback Host headers and cross-origin mutation requests.
Host validation alone is not network access control; the local bind matters.
Open `/spaces`, create a room, and add photos at any later time.

`CONSIDER_SPACE_FIXTURE_MODE=1` enables explicitly fictional observations only
when `DATABASE_URL` points to a localhost/127.0.0.1 test-named database. Production
photo understanding is not configured. Fictional origin is persisted on every
fixture fact/gap, including after user confirmation, not inferred from this flag.
The normal UI never passes uploaded images to a remote provider.

Each multipart request carries one file and an expected revision. The browser
submits a multi-selection sequentially, retains unsubmitted files on failure and
reports honest per-photo completion. One failed file does not undo earlier saved
photos. A new unique photo creates one revision; duplicate normalised content is
reused without creating a revision. Ten photos at 12 MB each bound referenced room
storage to 120 MB. Crash-orphaned immutable blobs can remain; automated garbage
collection/deletion is intentionally not provided. No client can name a storage key.

The image normalisation step applies orientation, strips metadata, and rejects
unreadable, animated or over-40-megapixel inputs. Supported signatures and declared
MIME must agree. Storage verifies hashes and refuses symlink reads. Serving checks
same-space metadata, digest, byte size and image signature; it uses private immutable
caching, nosniff, sandbox CSP and same-origin resource policy. No cloud configuration
or thumbnail processing is required. Local-only access is essential until auth exists.

Mutation endpoints accept a strict discriminated operation, not arbitrary snapshots.
Row-lock/CAS serialises updates; model work is outside the transaction and rechecks
revision on return. PostgreSQL prevents snapshot/asset/membership updates and deletes,
backward or skipped head movement, cross-space membership and invalid head pointers.
The application validates full JSONB semantics and source references on every read.
Database JSONB checks are structural, not a claim to reproduce all Zod rules in SQL.

Targeted independent review found and verified fixes for durable fixture provenance,
long fact descriptions versus inventory labels, and rollback-based membership edits.
Model inputs receive detached copies of confirmed facts and measurements: even an
adapter mutating its input objects cannot overwrite authoritative room state.
Measurements retain the entered amount/unit and canonical millimetres without
rounding away fractional measured values. No numeric value originates from imagery.
