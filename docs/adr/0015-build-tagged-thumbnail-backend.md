# ADR 0015 — Build-tagged thumbnail backend

- Status: accepted
- Date: 2026-11-17
- Supersedes: nothing
- Related: [0005](0005-capture-time-stable-identity.md), [0007](0007-viewport-forced-compact-thumbs.md), [0014](0014-pluggable-sql-store.md)

## Context

Thumbnailing is the slowest part of indexing, and the target device is an
OrangePi 3 LTS: Allwinner H6, four Cortex-A53 cores, 2GB LPDDR3. A 12k-photo
library has to be indexable in one sitting, and the binary has to keep
cross-compiling from a developer machine with `CGO_ENABLED=0`.

Measured on an M1 Pro against a 4000x3000 frame whose content compresses like a
photograph (uniform noise is JPEG's worst case and overstates decode):

| Stage | Cost |
| --- | --- |
| `image.Decode` | 82ms |
| One full-frame Lanczos pass per size (256/512/1024) | 76ms |
| Largest pass, then halve twice | 35ms |

Two findings follow. First, resampling was roughly half the wall clock and most
of it was waste: the full frame was resampled once per rung of the ladder.
Second, decode is the other half, and Go's `image/jpeg` exposes no scaled-decode
entry point, so no amount of pure-Go work removes it. libjpeg-turbo's
`scale_denom` — the mechanism behind both epeg and libvips — decodes straight
from the DCT coefficients at 1/2 or 1/4 size and is where the remaining win is.

The ladder tops out at 1024 while originals are commonly 4000px wide, so a
scaled decode discards detail that is thrown away moments later anyway.

## Decision

Split `internal/thumb` into a backend-independent part and one build-tagged
renderer:

- `generator.go` — no build tag. Owns the cache layout, the sharded path
  (`<key[:2]>/<key>/{s,m,l}.jpg`), atomic writes, `Open`, and `HasAll`.
- `pure.go` — `//go:build !vips`. The default. Pure Go, no cgo, cross-compiles
  with `GOOS=linux GOARCH=arm64` and no toolchain.
- `vips.go` — `//go:build vips`. cgo over libvips, built where libvips exists.

The seam is one unexported function, implemented once per tag:

```go
func render(data []byte, orientation int, sizes []int,
    emit func(size int, jpg []byte) error) (width, height int, err error)
```

`emit` streams one encoded JPEG per rung instead of returning a map, so the
accelerated backend can hand over libvips' own buffer and nothing holds the
whole set in memory. `Backend` is an exported string per tag, logged at indexer
start, so a `-tags vips` build is verifiable at runtime rather than by trust.

Only `cmd/indexer` ever needs the accelerated build. `Generate` is called from
exactly one place (`index/indexer.go`), never from a request handler; the server
only ever calls `Open`. So the cgo dependency never reaches the HTTP path, and
`go build ./cmd/server` stays pure regardless.

Three changes land in the default backend:

1. **`Generate` takes `[]byte`, not `io.Reader`.** The indexer already holds the
   whole file to compute its sha256 and was handing over a `bytes.Reader` that
   `Generate` immediately drained into a second buffer. Every original was held
   twice.
2. **The ladder is chained.** The largest thumb is resampled from the full
   frame; each smaller one is resampled from the rung above it, so the full
   frame is touched once instead of once per rung.

   Chaining applies only when the top rung is at most half the original
   (`max(w, h) >= 2*1024`). A 12MP frame always qualifies, and that is where
   the entire saving lives. When the original is only slightly larger than the
   top rung, a near-unity first step would run the Lanczos kernel twice for
   almost no saving, so those frames — small by definition, under 3MP —
   resample every rung straight from the original. Originals below 1024 are
   unaffected either way, since `imaging.Fit` never upscales.
3. **Writes are atomic.** `HasAll` only stats, so a thumb truncated by a power
   cut would be accepted forever and the Photo would keep a broken thumb. Each
   file is now written to a sibling temp file and renamed. This matters more
   here than on a server: the device is a Pi on an SD card with no UPS.

Result at the `Generate` level, same frame: **185ms -> 144ms (22% faster), 67MB
-> 56MB allocated.**

### Verifying that chaining is invisible

"Every step is a halving, so quality holds" deserves a measurement rather than
an assertion, and the first two metrics tried were both misleading. Mean
absolute difference against a direct resize tends to zero as the reduction gets
more aggressive whether or not the method is any good, because both paths
converge on flat grey. Gradient energy swung between 85% and 116% of the direct
resize on synthetic patterns, because aliasing inflates it as readily as detail
does.

What settled it was running the comparison over 139 real photographs, using the
1024px thumbs already in the local cache as the source and comparing a chained
1024 -> 512 -> 256 against a direct 1024 -> 256:

| Metric | min | median | max |
| --- | --- | --- | --- |
| Mean abs channel difference | 0.088/255 | **0.236/255** | 0.332/255 |
| Gradient energy vs direct | 100.0% | **100.3%** | 101.9% |

Quality 88 quantization is itself worth one to two units of channel noise, so a
median of 0.24 sits beneath the encoder's own floor, and detail energy never
fell below the direct resize. Chaining is not softening anything.

Hard-edged synthetic patterns near the Nyquist limit do diverge further, up to
~2/255, and ~4/255 before the halving guard above was added. That is a property
of content which cannot be represented at thumbnail scale at all — the two
paths simply alias it differently — not a defect. The committed regression test
therefore asserts on photo-like content, where it reproduces the real-photo
figures closely (0.15-0.27/255), and the reasoning behind its tolerance is
recorded in the test.

## Indexer sizing

`BenchmarkGenerateParallel` under `/usr/bin/time`, 12MP frames, GOMAXPROCS
pinned so both backends are compared at the same core count:

| Workers | pure ns/photo | vips ns/photo | speedup | pure RSS | vips RSS |
| --- | --- | --- | --- | --- | --- |
| 1 | 340ms | 94.8ms | 3.6x | 125 MiB | 173 MiB |
| 2 | 180ms | 51.7ms | 3.5x | 156 MiB | 182 MiB |
| 4 | **92.2ms** | **28.2ms** | **3.3x** | 233 MiB | 245 MiB |

Pinning GOMAXPROCS matters: `imaging` parallelises internally, so a pure-Go
run left at the host's default core count reports 143ms and looks only 1.5x
behind libvips. Its true single-core cost is 340ms, and the honest comparison
is per-core, where libvips is **3.3x faster at the four workers the board will
use** — while its internal threadpool is pinned to one thread, so the figure is
not borrowed parallelism.

Throughput scales 3.7x across four workers on the pure backend and peak RSS
stays near 230 MiB, so the default concurrency stays at **4**, matching the
board's four cores. An earlier draft of this plan proposed dropping to 2
workers for memory headroom; the measurement does not support it — on 2GB it
would halve indexing throughput to save ~80 MiB. The accelerated backend costs
only ~12 MiB more at four workers, so the same sizing holds for both.

`GOMEMLIMIT=512MiB` is set for the backend service. It sits comfortably above
the pure backend's measured peak while stopping the heap from doubling freely,
which is the failure mode that actually hurts on a 2GB board. See the
consequences below for why it does not bound the accelerated backend.

## Keeping the two backends honest

A second rendering path is only safe if it behaves identically, and the way
that breaks in practice is orientation: a mirrored or quarter-turned transform
is easy to get backwards in an unfamiliar API and would silently mis-orient an
entire library.

`TestGenerateAppliesEveryEXIFOrientation` is therefore backend-agnostic. It
renders a source whose four quadrants are distinctly coloured and asserts where
each one lands, for all eight EXIF orientations — a permutation that is unique
per orientation, so a wrong rotation direction cannot pass. Running the suite
twice, with and without `-tags vips`, is what establishes equivalence:

```sh
go test ./internal/thumb/
PKG_CONFIG_PATH="$(brew --prefix libarchive)/lib/pkgconfig" \
  go test -tags vips ./internal/thumb/
```

Both pass. Two differences are deliberate and documented in the tests: libvips
rounds a fitted dimension where `imaging` truncates, so a rendered thumb can
differ by one pixel (the dimensions written to the catalog are the original's,
exact in both), and the two report undecodable input with different wording, so
only `Generate`'s own error prefix is asserted.

Three things were found by actually running it rather than by reading the API:

1. **libvips' JPEG loader is a sequential-access source.** Rotating one forces
   a random read and fails the pipeline with `out of order read at line N`.
   The thumbnail is copied to memory before any orientation is applied; it is
   at most 1024px by then, so the copy is cheap.
2. **EXIF orientation is applied by this package, not by the loader.**
   `no_rotate` is passed to `vips_thumbnail_buffer` so libvips does not also
   apply the file's own EXIF tag. Otherwise a frame would be turned twice
   whenever the loader and `internal/exif` agree, and the dimensions recorded
   in the catalog would disagree with the pixels whenever they did not.
3. **No leak.** Hand-written cgo has to free `VipsImage` references and the
   save buffer by hand, so RSS was compared across a 10x change in iteration
   count: 266 MiB at 30 iterations against 278 MiB at 300. A per-iteration leak
   would have scaled with the count.

## Consequences

- The default build has no cgo and no system libraries. Packaging (W3) is
  unaffected by this ADR.
- The accelerated backend is libvips, chosen over libjpeg-turbo alone because it
  covers every format rather than only JPEG and resamples in C as well as
  decoding there — the measurements below show resampling is half the work, so
  a decode-only accelerator would have left most of the win on the table.
- It is bound directly rather than through govips. The whole backend is one
  libvips operation (`vips_thumbnail_buffer`) plus a save, so a wrapper library
  would have added a dependency and a layer of its own lifecycle management for
  no benefit. This matches the reasoning that dropped goose in ADR 0014.
- `GOMEMLIMIT` does not bound the accelerated backend. It caps the Go heap, and
  under `-tags vips` almost nothing is on the Go heap: allocations fall from
  56MB and ~1,000,000 per photo to 117KB and 76, because the pixels live in C.
  What bounds C memory instead is libvips' own operation cache, disabled at
  init (`vips_cache_set_max(0)`), since no image is ever rendered twice and the
  cache would otherwise be pure resident memory.
- libvips' internal threadpool is pinned to one thread
  (`vips_concurrency_set(1)`). The indexer already runs one goroutine per core,
  so leaving libvips to spawn its own pool per call would oversubscribe four
  cores several times over.
- `internal/thumb` previously had no tests. It now has eight (eleven counting
  subcases), covering the ladder's dimensions and sharded paths, orientation,
  the no-upscale rule, non-JPEG sources, idempotency, input rejection,
  `Open`/`HasAll`, and the ladder's fidelity against a direct resize. The tests
  pin behavior both backends must share; the benchmarks are what distinguish
  them.
- A one-character photo key used to panic in `Generate` (`photoKey[:2]` on a
  short string). It now returns an error, with a test.
