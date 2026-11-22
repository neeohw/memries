# ADR 0025 — HEIC, and the cgo indexer it requires

- Status: accepted
- Date: 2026-11-22

## Context

Modern iPhones shoot HEIC by default, so a photo library that skips it is
missing the newest half of itself. `IsMedia` took only
`.jpg/.jpeg/.png/.webp/.gif`, and anything else was passed over silently.

Decoding HEIC is the problem, not reading it. Measured on the box itself
(Debian 13 trixie, 4×Cortex-A53, 1.9GB RAM, no swap), one 12MP frame:

| decoder | trivial content | photo-realistic |
|---|---|---|
| pure Go (`gen2brain/heic`, wazero) | 4,574ms | 24,650ms |
| native (libde265) | ~700ms | ~810ms |

Pure Go is 5–30× slower. At ~10s for a real photo, a first index of 12k
photos is 30+ hours; native puts it near 40 minutes across four cores. The
pure-Go route was the one worth wanting, because it would have kept every
binary `CGO_ENABLED=0`, and the measurement ruled it out.

## Decision

### The indexer becomes a cgo build; the server does not

ADR 0015 built a seam for this — pure Go by default, `-tags vips` for the
indexer, bound directly to libvips — and nothing had ever used it. HEIC turns
it from an optional speed-up into the only way the indexer works.

So the two binaries now differ in linkage:

- **`server`** — pure Go, `CGO_ENABLED=0`, static. It decodes nothing.
- **`indexer`** — cgo, `-tags vips`, dynamically linked against libvips.

The box needs `apt install libvips42t64`, which pulls `libheif1` itself.
Nothing is compiled from source: Debian trixie's libvips 8.16.1 already ships
the HEIF loader (`heifload_buffer`, which is what `vips_thumbnail_buffer`
dispatches to), so there is no libvips build to maintain.

Keeping the server pure-Go is what makes the rest of this design fall out.
It cannot decode a HEIC, so it cannot transcode one on demand — which is why
the viewer is served a rendition made at index time instead.

### Built in a matched container, not with a cross toolchain

cgo cannot cross-compile without a sysroot carrying the target's libvips,
glib and libheif. Assembling one is work, and worse, drift between it and the
box stays invisible until a runtime symbol error.

Instead `docker/Dockerfile.pi-indexer` builds inside `debian:trixie` — the
same release as the box — so glibc 2.41 and the libvips soname match **by
construction**. On an arm64 Mac, Docker runs linux/arm64 natively, so this is
a native-arch build in a matched container rather than a cross-compile, and
costs no emulation. The same recipe runs unchanged on the box or any Debian
machine, which is how building from source stays possible.

The base image is therefore part of the contract, not a convenience: building
on a newer Debian would link a newer glibc and fail on the box.

`apps/scripts/build-pi/` drives both halves, with one `--platform` deriving
`GOOS`/`GOARCH` for the Go build so the two cannot disagree about the target.
The Dockerfile hardcodes no architecture; the toolchain follows the
container's own. (`Dockerfile.backend` still fetches `linux-amd64`, which is
why *that* image cannot build on an arm64 Mac — a known W3 bug, untouched
here.)

### The Compose image builds the same indexer

The dev stack built the pure Go indexer, so adding a HEIC to a folder failed
per file with `render pure: image: unknown format`. Accepting HEIC in
`IsMedia` for every build while only one build could decode it was a trap,
and claiming it would "surface the misconfiguration" was wrong: what it
surfaced was an error per photo in the stack most likely to be used.

So `Dockerfile.backend` now builds the indexer the same way the box does.
Three things had to move with it:

- The final stage is `debian:trixie-slim`, not `alpine`. A cgo binary linked
  against glibc does not run on musl, and `libvips42t64` brings `libheif1`.
  The image grows from roughly 60MB to 275MB, which is a dev and e2e cost
  only — the box runs no containers.
- The builder is `node:22-trixie`, matching the runtime so the sonames agree,
  and the Go toolchain now follows the image's architecture instead of
  hardcoding `linux-amd64` — which is why that image could not build on an
  arm64 Mac.
- `build.mjs` turns cgo and `-tags vips` on for the **indexer alone** when
  `MEMRIES_INDEXER_VIPS=1`. The server stays pure Go in every build. The flag
  is declared in `turbo.json`'s `env` for the build task rather than
  `passThroughEnv`: Turbo prunes task environments, so it would not otherwise
  reach the script, and it has to be part of the cache key or Turbo hands back
  a pure binary after the flag changes.

A plain `go build` still produces the pure indexer with nothing installed. It
will refuse a HEIC, but now says which build is needed rather than "unknown
format".

### A display rendition, because the viewer cannot open a HEIC

Chrome and Firefox will not render HEIC, and `/api/original` streams the
original bytes. Without something more, HEIC photos would appear correctly in
the timeline and open as a broken image everywhere except Safari.

The indexer writes a **2048px JPEG** for originals a browser cannot display,
stored in `thumb_2048`, and `/api/original` serves it instead. Its presence
*is* the rule — the column is only ever populated for such originals — so the
handler needs no MIME reasoning and still decodes nothing.

The rendition is a rung on the existing ladder rather than a second pass.
Both backends' `render` works from the largest size down, deriving each from
the previous, so 2048 costs one extra JPEG encode and makes the 1024
*cheaper* than it would have been from the full frame. A separate
`GenerateDisplay` call would have decoded the HEIC twice, at ~0.8s a go.

Two details that are easy to get wrong:

- `HasAll` treats an empty path as missing, so expecting `thumb_2048`
  unconditionally would make every JPEG look incomplete and regenerate its
  whole ladder on every scan. `expectedThumbs` asks for it only where one is
  written.
- `sizeName(2048)` would otherwise have fallen through to the generic
  `x.jpg`, which any future rung would also claim, and the two would
  overwrite each other. It is named `d.jpg` explicitly.

### The missing-original fallback tries every rendition

`largestThumb` returned one path, so a rendition recorded in the catalog but
absent from the cache produced a 500 even when a smaller one was on disk.
Adding `thumb_2048` at the top of that preference made it more likely, since
that rung exists only for HEIC — but the hole predated this change (a missing
1024 with a present 256 did the same). `thumbCandidates` now lists the written
renditions largest first and the handler takes the first that opens. A reader
gets a smaller image rather than an error.

## Consequences

- **`thumb_2048` is a new column**, so an existing catalog needs
  `make db-clear`. The schema is edited in place while the product is
  pre-release (ADR 0020).
- **Disk**: ~400KB per HEIC photo. 12k photos is roughly 5GB, which does not
  fit the 3.0GB free on the box's eMMC — the cache belongs on the 29GB card,
  via `MEMRIES_CACHE_ROOT` (ADR 0022).
- **HEIC capture time** was listed here as a known limitation, which was the
  wrong call — capture-date ordering is the product. Fixed in
  [0026](0026-heic-capture-time-and-orientation.md), along with two bugs found
  on the way: the offset-time tags were never read for any photo, and HEIF was
  being rotated twice.
- **`IsMedia` is the same list in both builds**, deliberately. A pure-Go
  indexer will now accept a HEIC and fail to decode it — once per file. The
  alternative, a format set that varies by build tag, hides the
  misconfiguration instead of surfacing it, and the shipped indexer is the
  vips one.
- **Docker is needed to build the indexer**, not the server;
  `build-pi --server-only` skips it.
- `.avif` is decodable by the same loader but stays out, along with
  `.tif`/`.bmp` and raw formats.

## Verification

The claim that matters is that the shipped build decodes HEIC, and only the
tagged build can be asked. `internal/thumb/heic_vips_test.go` is
`//go:build vips` and decodes an 873-byte HEIC fixture through the full
ladder; it runs inside the container, where the whole suite also passes under
`-tags vips` on arm64. The pure-Go `CGO_ENABLED=0 GOOS=linux GOARCH=arm64`
build of `./cmd/...` still passes untouched.
