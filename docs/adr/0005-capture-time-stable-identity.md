# 0005. Capture time, stable Photo identity, and persisted owner library

- Status: Accepted
- Date: 2026-08-26
- Source type: Internal decision (implementation + domain language)

## Key thesis

A Photo’s place on the timeline is its capture clock, not the day it was indexed. The Photo’s `_key` is a stable identity so favorites and Album membership survive a folder Sync when the file at the same owner path changes. “Album” is the only name for a user-made set of Photos.

## Context

Phase 1 already browsed a date-scroll timeline and indexed from local Storage. Capture time was loosely “EXIF, else mtime, else now,” and `_key` was treated as the content hash. That pairing breaks two product rules we locked in while adding search, favorites, Albums, and real-stack BDD:

1. Resync must refresh metadata when EXIF or filesystem times change, without creating a second Photo.
2. Favorite and Album membership are owner-scoped facts about that Photo, not about a hash that changes when the bytes change.

UI copy may say “memory.” The domain word is **Photo**. A date bucket is a **Timeline Group**, not an Album.

## Decision

### Capture time

`ResolveCaptureTime` writes UTC `taken_at`, wall-clock `taken_at_local`, optional `tz_offset`, and `taken_at_source`:

1. EXIF `DateTimeOriginal` (then digitized / `DateTime`), with offset when present
2. Filesystem creation / birth time when the OS exposes it (`taken_at_source = birth`)
3. File modification time (`mtime`)

The Memories timeline, Search year facet, and period headings use `taken_at_local`. Weeks are ISO Monday–Sunday. The sticky **Current period** label is the first visible Timeline Group.

### Photo identity on Sync

`ResolveIdentity` is path-first, then hash:

| Lookup | Action | `_key` |
| ------ | ------ | ------ |
| Owner + Storage path matches | Update | Existing key (favorite / `in_album` kept) |
| Path unknown, hash matches | Relocate | Existing key; path refreshed |
| Neither | Create | Content hash |

Sync is not a delete-and-reimport. Content hash remains a unique fingerprint; it is no longer the definition of Photo identity after the first insert.

### Owner library

Favorites and Albums persist in Arango for the signed-in Owner (`PUT /api/photos/{id}/favorite`, `GET|POST /api/albums`, `POST /api/albums/{id}/photos`). Add-to-Album is idempotent. The long-press / viewer menu lists Albums with the name on the left and the Photo count on the right.

### Query window

Default `/api/photos` and `/api/timeline` range is **unbounded below** through 2100-01-01 UTC so a capture clock a few days (or years) ahead of “now” is not dropped. Cameras and EXIF are often wrong; a one-day future cutoff hid valid Photos.

There is deliberately no lower bound. Unix time is an encoding, not a product floor: a scanned family negative carries an EXIF `DateTimeOriginal` from the 1950s or 1960s, and an omitted `from` therefore stays the zero time rather than 1970-01-01. The originals probe in `index/library.go` uses the same window, so a library consisting only of pre-epoch scans is sampled instead of looking empty and leaving the Owner at `not_started` (ADR 0004). Under ADR 0014 these instants are negative microseconds in a `BIGINT`, which stores and orders correctly; `store_test.go` proves the round trip and the ordering against a real database.

### Proof

Owner-scoped behavior is covered by Go tests at the index/API seams and by Playwright BDD against an isolated Compose project (`memries-e2e`, ports 18080 / 18529 / 15556). That stack does not share volumes with `make up`.

## Key findings

1. **EXIF must be a TIFF APP1 `DateTimeOriginal` that goexif can decode.** jpeg-js + piexifjs produced files the indexer hashed but did not date; those Photos sorted as `mtime` (the index day). Fixture JPEGs now inject a hand-rolled APP1.
2. **A one-day future `to` bound is a product bug, not a filter.** On 2026-08-26, a Photo with `taken_at` 2026-08-31 never appeared in `/api/photos` even though it was indexed.
3. **Empty Albums did not clear on E2E reset** when edge-delete and album-delete were one nested AQL `FOR` (no edges → album row never removed). Reset is two statements: edges, then albums.
4. **Virtualized Timeline Groups are not native overflow.** BDD scroll must drive `VList.scrollToIndex` (the `data-timeline` hook) or period headings and the Current period label will not move.

## Methodology

Decisions were made by implementing the public seams (`internal/index`, `internal/exif`, `internal/api`, `internal/db`) test-first, then proving the same rules in the browser against Dex + Arango + bind-mounted fixtures. Evidence is the passing package tests and the 20 Playwright scenarios (chromium 1280 and touch).

## Consequences

- Glossary: Photo `_key` is stable identity; `hash` may change on update. TakenAt is the three-step capture clock above, not “mtime unless EXIF.”
- Linux containers usually have no birth time; `no-exif` fixtures must set mtime (and Windows birth when the host writes the file).
- Week month abbreviations are fixed English (`Sep`, not locale `Sept`) so Timeline Group labels stay stable in BDD (`en-GB` day labels stay “31 August”).
- Isolated E2E is mandatory for anything that mutates albums, favorites, or fixture bytes.

## Limitations

- Birth time is best-effort (`created_windows.go` / `created_darwin.go`; other OS → zero → mtime).
- Relocate-by-hash does not merge two live paths that later become the same bytes.
- Default range has a far-future ceiling (2100), not “unbounded.” The lower bound was removed (see Query window); the ceiling stays so a camera clock set to 2200 cannot stretch the timeline.
- Sharing graph remains schema-only; Albums are owner-private.

## Actionable takeaways

- When changing capture or Sync behavior, extend `index/capture_test.go` and `index/identity_test.go` before the indexer.
- When adding a dated fixture, give it a decodeable `DateTimeOriginal` and do not assume “tomorrow” is past the API window.
- Say **Album** in UI and code; never “group” for membership.

## Quality

| Dimension    | Rating | Note |
| ------------ | ------ | ---- |
| Credibility  | High   | First-party decision, coded and tested in this repo |
| Evidence     | High   | Unit tests + isolated real-stack BDD |
| Recency      | High   | Accepted 2026-08-26 |
| Objectivity  | High   | Product rules, not a vendor comparison |

**Overall:** Strong — cite as the capture / identity / Album source of truth.

## References

- Domain language: [CONTEXT.md](../../CONTEXT.md)
- Seams: [backend/internal/index/capture.go](../../backend/internal/index/capture.go), [identity.go](../../backend/internal/index/identity.go), [backend/internal/api/api.go](../../backend/internal/api/api.go) (`parseRange`)
- Compact thumbs (unrelated): [0007-viewport-forced-compact-thumbs.md](0007-viewport-forced-compact-thumbs.md)
- E2E ops: [e2e/README.md](../../e2e/README.md)

## Amendment (ADR 0014)

Content `hash` uniqueness is **owner-scoped**: the unique index is
`(owner_id, hash)`, not `hash`. Relocate-by-hash is therefore intra-owner only
— the hash lookup takes an `ownerID`.

The path-first table above is unchanged. One addition: a Photo key is still the
content hash on create, but keys are table-unique, so when another Owner
already holds that key the indexer derives a distinct one
(`sha256(ownerID + ":" + hash)`). Identical bytes in two libraries stay two
Photos.
