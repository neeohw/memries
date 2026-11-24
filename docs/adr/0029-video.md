# ADR 0029 — Video, played rather than converted

- Status: accepted
- Date: 2026-11-24

## Context

Video was out of scope for Phase 1 and is now asked for. The library that
prompted it is an iPhone XS backup: 24 clips, **18 HEVC and 6 H.264**, all
1920×1080, 2.5s to 373s, 3.5MB to **528MB**. They were being walked past in
silence, because `IsMedia` took only stills.

Three facts shaped every decision here, and two of them were measured rather
than assumed.

**Measured, in Brave** (a real Chromium with proprietary codecs; Playwright's
own Chromium has none and reports a false negative):

| file | Brave | Playwright Chromium |
|---|---|---|
| HEVC in `.mov` | plays 1080×1920 | no picture |
| HEVC in `.mp4` | plays | no picture |
| H.264 in `.mov` | plays | plays |

So a current Chromium on hardware that has an HEVC decoder plays this library
as it stands, container included. Safari does too. The earlier claim that
"Chrome refuses HEVC" was wrong, and it was load-bearing: it had justified
rewriting every file.

Also measured: Brave answers `canPlayType('video/quicktime')` with `""` and
then plays the file anyway.

**Not measurable here**: Firefox, which is not installed. Its HEVC support is
recent and platform-dependent and it has historically refused
`video/quicktime` outright.

## Decision

### ffmpeg reads video, as libvips reads HEIC

There is no usable pure-Go H.264 or HEVC decoder, and this library is mostly
HEVC. `internal/video` shells out to `ffprobe` for metadata and `ffmpeg` for
one frame. It is a runtime dependency of the same kind as libvips
([0025](0025-heic-and-the-cgo-build.md)) — `apt install ffmpeg` on the box —
but a looser one: a program that is run, not a library that is linked, so it
needs no sysroot, no cgo and no matched build container. The pure-Go build
can make video thumbnails, because ffmpeg does the decoding.

Missing ffmpeg is a **warning at startup**, not a refusal. A library with no
video runs perfectly well without it, and the alternative — a failure per
clip, discovered hours into a scan — is the trap ADR 0025 described.

### The poster frame joins the existing ladder

`ffmpeg` writes one JPEG to stdout and those bytes go into
`thumb.Generate` unchanged, so a clip ends up with the same 256/512/1024 set
as a photo. The timeline, the scrubber, the album grid and the justified
layout need to know nothing about video at all: they are handed a photo-shaped
row with a thumbnail.

The frame is taken a second in, not at zero: the first frame of a phone video
is often the lens still adjusting, or black. A clip shorter than that uses its
midpoint. ffmpeg applies the display matrix itself, so a portrait clip yields
a portrait poster without the catalog knowing about rotation.

### Nothing is transcoded, and nothing is rewritten

The measurement above removed the reason to. Remuxing all 24 clips to `.mp4`
would have duplicated ~2.5GB on a 29GB card to help one browser that is not
installed and that could not be tested.

Transcoding was weighed and rejected for the box specifically: the Pi is four
Cortex-A53s with no usable hardware encoder, where 1080p HEVC→H.264 runs many
times slower than realtime. Converting this library would be hours of a
blocked indexer, and every new clip would repeat it. An explicit per-clip
"convert this one" stays possible and is deliberately left for later.

So `/api/original` streams the original bytes, and the viewer plays them.

### Support is decided by trying, not by asking

`canPlayType` says `""` for a `.mov` that Brave plays. Gating playback on it
would hide working video. The player therefore renders `<video>` and listens
for the `error` event; only then does it show "this browser cannot play this
clip" with a download link. The verdict is per clip, so one failure does not
condemn the next.

### Opening a clip plays it

Pressing a tile with a play mark on it is a request to watch. Making someone
press play again is a tax on the obvious case, so the viewer autoplays.

This ADR first said the opposite, on the grounds that a browser blocks a clip
with sound and leaves a paused frame that reads as broken. The blocking is
real; the conclusion was not. A refusal arrives as a **rejected promise**, not
an `error` event, so it is something the player can see and answer: the clip
is muted and started again, and a line says why, with the unmute control
already on screen where play would have been. A silent clip that plays beats a
still frame that looks broken, and the reader is one click from sound either
way.

Two details that are easy to get wrong. `play()` predates promises and still
returns `undefined` in some browsers, so the result is normalised before it is
chained — otherwise the first autoplay throws a `TypeError` and nothing plays
at all. And the retry happens once: blocked twice is the browser's final word,
and a loop would fight it in front of the reader.

`preload="auto"` follows from autoplaying. Byte ranges make that a stream
rather than a half-gigabyte download up front.

### A play glyph in the middle of the tile

A poster frame is indistinguishable from a photo. The mark started in a
corner, which was too easy to miss on a wall of tiles; it is now a circular
play glyph in the centre — the shape everyone already reads as "this moves" —
with the length in the corner instead. Small tiles get a smaller glyph, or the
mark covers the picture it is meant to describe.

### Byte ranges, because a scrubber is a seek

`/api/original` used `io.Copy`. Dragging a player's scrubber is a request for
the middle of the file; without `206` a browser either refuses to seek or
refetches the whole clip, which for 528MB is the difference between playable
and not. The handler now uses `http.ServeContent` when the backend's reader
can seek — local files can — and advertises `Accept-Ranges: none` when it
cannot, rather than letting a player believe it may seek.

### The indexer never holds a clip

`indexOne` read every file into memory to hash it. Four workers × one 528MB
clip is more than the box has. The hash is now streamed, and ffmpeg is handed
a **path** through an optional `LocalPath` on the storage backend — one frame
is not worth a second copy of half a gigabyte on a card with a finite write
budget. A Source with no local path (WebDAV) indexes the clip without a
poster and says so, rather than downloading it to make a thumbnail.

Splitting `indexOne` into `gather` and `record` fell out of this: what differs
between a photo and a clip is how the facts are read, not what is done with
them, so identity, dedup, the skip path and the row write stay one piece of
code.

### Capture time comes from the container

`com.apple.quicktime.creationdate` carries the **offset** (`+0200`);
`creation_time` is normalised to UTC. Preferring the latter would file an
evening clip earlier in the day — precisely the bug
[0026](0026-heic-capture-time-and-orientation.md) fixed for stills. The
source is recorded as `container` rather than `exif`, and the fall back to
file times is the one stills already use.

### `.mov`, `.mp4`, `.m4v`, `.webm`

What phones and cameras write, plus the one web-native container. `.mkv`,
`.avi` and the rest stay out: ffmpeg would happily index them and then no
browser would play them, which is a worse answer than leaving them alone.

## Consequences

- **`duration_ms` is a new column**, so an existing catalog wants
  `make db-clear` (the schema is edited in place while pre-release, ADR 0020).
  `kind` already existed and was always `photo`.
- **The box needs `apt install ffmpeg`** beside libvips, and the Compose image
  grows by ffmpeg and its dependencies.
- **Firefox is untested.** It will get the H.264 clips and probably not the
  HEVC ones, and will see the download fallback. Nothing here is Firefox's
  fault that a remux could not fix later if it matters.
- **A video has no display rendition.** `IsWebSafe` returns false for clips so
  they never get the 2048px JPEG stand-in, which exists for stills a browser
  cannot show.
- **Indexing a clip costs one probe and one frame grab**, seconds, and a
  rescan of an unchanged clip costs nothing: size and mtime still decide.
- Albums, favorites, selection and the lightbox treat clips as photos,
  because at the catalog level they are rows with thumbnails.

## Verification

`internal/video` tests parse real ffprobe output — the Apple offset preferred
over UTC, rotation normalised, a missing duration, a file with no video
stream — and drive the real tools against clips ffmpeg generates, so no
fixture and no personal video is committed. `internal/index` indexes a
generated clip end to end: kind, duration, the poster through the ordinary
ladder, no display rendition, capture time from the container, a rescan that
skips, a mixed folder, and a corrupt `.mp4` that fails alone beside a photo
that succeeds. `internal/api` asserts `206` with the right `Content-Range` for
a byte range, `Accept-Ranges` on both kinds of backend. On the client,
`VideoStage` covers the poster, autoplay, the muted retry when a browser
blocks sound, giving up after that retry, the error-driven fallback and its
per-clip reset; `PhotoCard` covers the glyph, the length, and a clip whose
container never said how long it is.
