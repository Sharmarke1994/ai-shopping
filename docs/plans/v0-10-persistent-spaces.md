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

Implementation and founder verification results will be recorded at completion.
