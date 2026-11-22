# ADR 0026 — Reading a HEIC's capture time, and not rotating it twice

- Status: accepted
- Date: 2026-11-22

## Context

ADR 0025 shipped HEIC indexing and recorded, as a known limitation, that a
HEIC had no capture time: `goexif` reads JPEG and TIFF APP1 only, so a HEIC
fell through `ResolveCaptureTime` to the file's mtime.

That was the wrong call. **Capture-date ordering is the product** — ADR 0005
makes capture time the stable identity and ADR 0019 builds the whole timeline
on it — and the failure is worse than "sorts by file date": a library copied
onto the box in one go gives every HEIC the same mtime, so they collapse onto
the day of the copy. Not a limitation. A bug.

Looking properly turned up two more, both affecting photos that were already
working.

## Decision

### HEIC EXIF is read from the container's Exif item

HEIF does not put EXIF in a leading segment the way JPEG does. `meta` holds an
`iinf` listing the file's items and an `iloc` saying where each lives, and the
item whose type is `Exif` has a payload that is an ordinary TIFF block
(ISO/IEC 23008-12 Annex A): a four-byte count of bytes before the TIFF header,
then usually `Exif\0\0`, then the header.

So `internal/exif/heif.go` parses no EXIF at all. It walks the boxes, finds
that block, and hands it to the same reader JPEG uses. Measured on a real
iPhone XS file: `2026-04-09T19:48:18`, camera `iPhone XS`.

`ParseAny` dispatches on a **sniff of the bytes**, not the extension — a
`.jpg` that is really a HEIC should still get its capture time.

Two things the parser must get right, because it runs over whatever is on the
disk:

- **The whole file, not a window.** EXIF was read from the first 64KB, which
  is right for JPEG (APP1 is at the front) and wrong for HEIF, where the Exif
  item can sit after the image data. The indexer already holds every byte to
  hash it, so HEIF gets the full slice.
- **No panics.** Every box size, item count and extent offset is
  bounds-checked, and box nesting is depth-limited. A truncated or corrupt
  photo must be "no EXIF here", not a dead index run. Tests truncate the
  fixture at every length and flip every byte to three values.

### The offset-time tags are read from the raw IFDs

`readCaptureClock` asked goexif for `OffsetTimeOriginal`. goexif registers no
field name for it — the tag arrived with EXIF 2.31 in 2016 and the library
predates it — so the lookup silently never matched and **every photo in the
library was stored as if shot in UTC**, JPEG as much as HEIC.

The iPhone file carries `+02:00` in all three of 0x9010, 0x9011 and 0x9012.
Rather than fork goexif for three tags, `internal/exif/offsettime.go` walks
the raw IFDs for them, preferring the one that belongs to DateTimeOriginal
since that is the timestamp the timeline reads. Everything else still comes
from goexif.

This only moves `TakenAt`, the UTC instant; `taken_at_local` was already
right, which is why nothing looked wrong. Ordering stayed self-consistent
because *every* photo was equally wrong — and would have skewed the moment one
photo got a correct offset. An older camera that writes no offset at all, like
the Sony ILCE-5000 in this library, is unaffected and correct.

### HEIF rotation is applied by the decoder, so we must not apply it again

HEIF records rotation **twice**: in the container's `irot` box and in the EXIF
orientation tag, saying the same thing. libheif applies `irot` while decoding,
and `no_rotate` on `vips_thumbnail_buffer` only suppresses libvips' own
EXIF autorotation — not `irot`.

So libvips handed over an already-upright image and this package rotated it
again. Measured on the same iPhone file: decoded 3024x4032, then turned into
4032x3024. **Every portrait HEIC would have been sideways in the timeline.**

For HEIF the decoder's output is final, whatever the EXIF says. JPEG is
untouched: it has no `irot`, and both backends still apply the tag there, so
they continue to agree.

`Photo.Orientation` still records what the file said rather than what remains
to be applied. The renderer is the single place that decides rotation, and
that stays true as long as nothing else reads the field — nothing does today.

## Consequences

- HEIC photos sort by when they were taken. Existing rows were indexed before
  this, so the catalog needs `make db-clear` and a reindex.
- `TakenAt` changes for every photo whose file records an offset, since it was
  previously stored as UTC. Same reindex covers it.
- The HEIF parser is ours to maintain. It is confined to finding one byte
  range, which is the smallest version of that job.
- The orientation fix can only be checked where libvips exists:
  `internal/thumb/orientation_vips_test.go` is `//go:build vips` and takes a
  real HEIC from `MEMRIES_HEIC_SAMPLE`, since the shape of the bug needs a
  portrait photo from a real camera. The fixtures in the repo are synthetic
  and carry no personal data.
- Still not read from a HEIC: nothing. Camera, lens, ISO, aperture, shutter
  and GPS all come through the same TIFF block.
