# ADR 0005 — Capture time and stable photo identity

- Status: accepted
- Date: 2026-08-26 (revised 2026-11-18)

## Context

A Photo's place on the timeline is its capture clock, not the day it was
indexed. And a scan has to refresh metadata when EXIF or filesystem times
change without creating a second Photo, or favorites and Album membership
would be lost every time a file was touched.

UI copy may say "memory". The domain word is **Photo**. A date bucket is a
**Timeline Group**, not an Album.

## Decision

### Capture time

`ResolveCaptureTime` writes UTC `taken_at`, wall-clock `taken_at_local`, an
optional `tz_offset`, and `taken_at_source`, in this order:

1. EXIF `DateTimeOriginal` (then digitized, then `DateTime`), with its offset
   when present
2. Filesystem creation / birth time where the OS exposes it
3. File modification time

The timeline and the period headings read
`taken_at_local`, never `taken_at`: the reader thinks in the clock the camera
showed, and a photo taken at 23:00 must not move to the next day because the
server is in another timezone. Weeks are ISO, Monday to Sunday.

### Identity on a rescan

`ResolveIdentity` is path first, then hash:

| Lookup | Action | key |
| --- | --- | --- |
| Storage path matches | Update | existing key, album membership kept |
| Path unknown, hash matches | Relocate | existing key, path refreshed |
| Neither | Create | content hash |

A scan is not a delete-and-reimport. The content hash stays a unique
fingerprint — one copy of a file in the library
([0020](0020-server-wide-library.md)) — but after the first insert it is no
longer the definition of identity, because the bytes can change while the
photograph does not.

### Timestamps on disk

Unix **microseconds in BIGINT**, which sorts correctly, keeps the composite
cursor comparison exact ([0004](0004-cursor-paginated-photos.md)) and leaves
no timezone ambiguity. Negative values are ordinary: scanned film carries
pre-epoch EXIF. `taken_at_local` stays TEXT, because the date filters
substring it.

## Consequences

- Moving a file inside a Source keeps its favorites and albums.
- Re-exporting a photo so its bytes change keeps its identity, as long as the
  path is the same.
- The catalog window is unbounded below. Do not reintroduce a 1970 floor.
