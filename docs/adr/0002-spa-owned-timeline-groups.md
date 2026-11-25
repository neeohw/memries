# ADR 0002 — Timeline Groups are built in the SPA

- Status: accepted
- Date: 2026-08-26 (revised 2026-11-24)

## Context

The Memories tab is a photo album you scroll, not a bucket report.

The API exposes `GET /api/timeline`, which collects photos into calendar
buckets and returns a count, a cover id, and the first and last capture time.
That is a summary. The album needs the opposite: enough photos on screen to
feel like pages, with the zoom level changing how densely they are shown
([0019](0019-pointer-driven-timeline-zoom.md)).

A **Timeline Group** is a date bucket. It is not an Album.

## Decision

Memories and Favorites page photos from `GET /api/photos`. The SPA
buckets them itself: `groupPhotos` sorts by `taken_at_local` and groups by the
current zoom level, and `justifyRows` packs each group into rows from the real
aspect ratios.

`virtua` virtualizes **Timeline Groups**, not individual photos, so a long
library scrolls without mounting every card.

The SPA does not call `/api/timeline` for the feed. Binding the feed to it
would freeze density at one cover per bucket and force a second fetch the
moment a reader opened a period.

`/api/timeline` is still used for one thing: the date scrubber's histogram
([0017](0017-date-scrubber.md)) wants exactly a count per month over the whole
library, which is the summary that endpoint already returns.

Year view is the one level that is **not** fed from the feed. It reads
`/api/photos/summary`, which samples the whole library rather than paging it
([0031](0031-year-view-is-a-summary.md)). That does not move bucketing to the
server — the SPA still groups what it is handed — but it does mean the widest
zoom level sees every year the library holds rather than only the newest page
of it.

## Consequences

- Grouping is a UI decision and can change without a new endpoint shape.
- Favorites and a zoom change only see photos already in the infinite
  query. With a page size of 500 ([0017](0017-date-scrubber.md)) that is
  usually the visible era, but it is not a global index. At year level that
  was the whole problem, and year view no longer reads the feed
  ([0031](0031-year-view-is-a-summary.md)); at month and week it still holds.
- Because `virtua` renders nothing in jsdom, Timeline composition cannot be
  unit tested. It is covered by the Playwright suite instead, and tests that
  need a rendered tile assert at the `PhotoCard` level.
