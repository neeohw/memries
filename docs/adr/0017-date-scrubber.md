# ADR 0017 — Right-edge date scrubber

- Status: accepted
- Date: 2026-11-18
- Amends: [0002](0002-spa-owned-timeline-groups.md) (`/api/timeline` now has a consumer)
- Related: [0004](0004-cursor-paginated-photos.md), [0005](0005-capture-time-stable-identity.md), [0007](0007-viewport-forced-compact-thumbs.md), [0014](0014-pluggable-sql-store.md)

## Context

Memories should browse like Google Photos, and the piece that makes a large
library navigable there is the scrubber down the right edge: a track covering
the whole library, labelled by year, that you drag to land on a month.

Two properties of the existing timeline shape the design, and neither was
obvious before looking:

**The track cannot be derived from what is loaded.** `/api/photos` is keyset
paginated, newest first ([0004](0004-cursor-paginated-photos.md)),
and `groupPhotos` buckets whatever has arrived
([0002](0002-spa-owned-timeline-groups.md)). A scrubber built from loaded
photos would start as a one-month track and grow as the reader scrolled, so its
meaning would shift under them and unvisited years would be unreachable — which
is the opposite of the feature's purpose.

**The track cannot be derived from pixels either.** The obvious model is
Google's: compute the total scroll height from the histogram, then map the
scrubber linearly onto it. That does not work here, because `justifyRows` packs
rows from each photo's real aspect ratio. A bucket's rendered height is a
function of its photos' shapes, not of its count, so there is no height to
compute before the photos are loaded.

What does exist is `GET /api/timeline`, which
[0002](0002-spa-owned-timeline-groups.md) deliberately left unused: it returns
one row per calendar bucket with `count`, `cover_photo_id`, `first` and `last`,
ordered newest first. That was the wrong shape to render an album from. It is
exactly the right shape for a scrubber track.

## Decision

### The track is a date↔position mapping, not a scroll model

`lib/scrubberScale.ts` builds the track from the month histogram and offers
`fractionForDate`, `keyAtFraction` and `yearTicks`. It models no pixels at all.
Both the thumb's position and a jump's target go through the same mapping,
which is what keeps them consistent with each other even though neither is tied
to scroll height.

The histogram is always fetched at **month** granularity, whatever the
timeline's own granularity selector says. The scrubber's vocabulary is months
and years; `day` would return thousands of rows for a library this size. One
row per month is a few hundred rows at most, so this is a single cheap request,
cached for the session and invalidated when an Index run moves the photos.

### Track share is `sqrt(count)`, not `count`

Proportional weighting lets one holiday month with 10,000 photos take 99% of
the track and makes a quiet year impossible to point at. Square root keeps busy
periods wider, where the extra precision is actually wanted, without starving
sparse ones. A test pins that a 100x difference in count becomes less than a
20x difference in track share, and that the sparse month keeps at least 5% of
the track.

This is a departure from "the scrubber is proportional to scroll height", which
is only coherent in a design that knows its scroll height. The cost is that the
thumb moves at a varying rate as the reader scrolls; the benefit is that every
month is reachable.

### A jump pages backwards when it has to

`onSeek` resolves in the event handler when the month is already loaded, which
is the common case and runs no effect at all. Otherwise it latches the target
and pages: each arriving page re-checks, and the jump resolves when the month
becomes reachable. When the list is exhausted it lands on the oldest photo
there is, so a jump never hangs.

`groupIndexForMonth` picks the newest group **at or older than** the target,
not the nearest by distance. Nearest is wrong: jumping to March with photos on
28 February and 31 March would choose February, because 1 March is one day from
one and a month from the other.

**The page size went from 50 to 500**, the server's cap
(`db.ClampPhotoLimit`). This is the arithmetic that makes the fetch-forward
approach tolerable: reaching the oldest photo in a 12k library was ~240
requests at 50 and is ~24 at 500. Photo rows are metadata only — thumbs load
lazily per tile — so a page is roughly 100KB of JSON.

Two alternatives were considered and rejected for now. Re-anchoring the query
to `local_to=<date>` on each jump makes any jump a single request, but turns
the list into a window and needs new rules for scrolling back toward newer
photos. Full date-windowed virtualization is the real Google Photos model, and
is what would remove the fetch-forward entirely, but it needs the per-bucket
heights that `justifyRows` makes unavailable.

### Interaction and accessibility

- `role="slider"`, `aria-orientation="vertical"`, with `aria-valuetext` set to
  the **month name**. A raw fraction announces nothing useful.
- Keyboard: arrows step one month, `PageUp`/`PageDown` a year, `Home`/`End` the
  newest and oldest. Up is newer, because the track runs newest-first. Steps
  clamp rather than wrap.
- The track renders before the list in DOM order, so Tab reaches it without
  walking several hundred photos first. It is absolutely positioned, so the
  visual order is unchanged.
- `aria-busy` while a jump is still paging.
- Dragging **previews** and commits on release. A live seek would start a
  fetch-forward for every month the pointer crossed. This is the one place the
  behaviour is deliberately less fluid than Google Photos, and it is reversible
  once jumps are cheap.
- The track is **always visible**, and scrolling, hovering, focus and dragging
  only deepen it. It used to fade in on hover or scroll, which left the one
  control for moving through years invisible until you happened to find it —
  and meant `prefers-reduced-motion` readers needed a special case to see it
  at all. They no longer do.
- Both ends of the track are inset by half a label. Everything on it is
  centred on its position, so the newest year sat half above the top edge and
  was cut off. The pointer mapping uses the same inset, so a drag still lands
  where the labels say.
- Nothing renders at all for a library spanning fewer than two months.

## Consequences

- **`/api/timeline` has its first consumer.** [0002](0002-spa-owned-timeline-groups.md)
  says the SPA does not call it and that it cannot render the album; both
  remain true. The feed is still `/api/photos`, and grouping still happens in
  the SPA. The histogram is a navigation aid, not the album.
- **No backend change.** The endpoint, its granularity handling and
  `db.Timeline` were already right. The only server-side edit in this
  workstream was none at all.
- **The first page is now 500 photos** instead of 50, for every consumer of
  `fetchPhotosPage`, including Favorites. Fewer, larger requests.
- **Far jumps still visibly load.** A jump to the oldest month of a large,
  freshly opened library pages its way there behind an `aria-busy` track. This
  is the known weak point of the chosen model.
- The Today button shifts left when a track is present, and the list gets right
  padding so tiles do not sit under it. `justifyRows` measures the container, so
  rows reflow to the narrower width on their own.
- `__scrollToGroup`, the seam `apps/e2e/steps/fixtures.ts` drives, is now the
  same `scrollToGroup` the scrubber uses, so the two cannot drift apart.
- **No e2e scenario yet.** The scrubber is covered by 21 unit tests on the
  scale, 17 on the component and 5 on the timeline's seek behaviour, but the
  Playwright suite has not been extended or run.
