# ADR 0031 — Year view is a summary of the library, not a page of it

- Status: accepted
- Date: 2026-11-24 (revised 2026-11-25)
- Supersedes the zoom-related consequence of [0002](0002-spa-owned-timeline-groups.md)
- Related: [0004](0004-cursor-paginated-photos.md), [0017](0017-date-scrubber.md), [0019](0019-pointer-driven-timeline-zoom.md)

## Context

The library on the Pi passed 11,000 photos, and at that size year view stopped
working in two different ways at once.

**It was not a view of the library.** Memories pages `/api/photos` and buckets
what it has in the SPA ([0002](0002-spa-owned-timeline-groups.md)). The first
page is 500 photos ([0017](0017-date-scrubber.md)), which in an active library
is a few months. Grouping that by year produces *one* heading. Zooming out to
year to get to 2019 showed 2026, and reaching 2019 meant running the feed off
the bottom of the screen some twenty times — each page a cursor round trip
over a 1.9GB single-board computer.

**And a year was not readable at a glance.** The years that *were* loaded
listed every photo in them. Scrolling from 2026 into 2025 meant scrolling past
1,240 tiles. The zoom level that exists to show the most ground was the one
that took longest to cross.

Those are the same bug from two sides: year view had been treated as a denser
grouping of the feed, when what a reader wants from it is a map.

## Decision

### The server answers year view in one request

`GET /api/photos/summary` returns every year the library holds, each with a
sample of its photos and its real count:

```json
{"per_month": 3, "years": [{"year": "2026", "count": 1240, "photos": [ ... ]}]}
```

Two SQL statements, not one. The totals are a `GROUP BY` over the year; the
sample is a `ROW_NUMBER()` window picking the newest rows per month. Fusing
them would either repeat the count on every sampled row or move the grouping
into the handler, and the pair reads as what it is.

**The window partitions by month, not by year.** A year sampled as a whole is
whatever December happened to hold. A few photos per month is what makes the
strip read as a year — the seasons are in it. Three is the default: one per
month is a contact sheet of Januaries, and the bound is twelve, past which a
year is a screenful and the summary has stopped being one.

Rows with no local capture clock are skipped, exactly as `/api/timeline` skips
them. A photo that cannot be placed on a calendar has no year to summarise.

This does not make `/api/timeline` the feed, and it does not move bucketing to
the server. The SPA still groups what it is handed; it is simply handed a
sample of the whole library at this one level instead of the newest page of it.

### The count is the year's, and the gap is said out loud

`TimelineGroup` gains `total`. Everywhere but year view it equals
`photos.length`; in year view it is the server's count, so the sublabel reads
"1,240 memories" under a strip of 36.

Under the strip sits one button: **"1,239 more in 2026 — zoom in"**. It is the
same action as clicking the heading ([0019](0019-pointer-driven-timeline-zoom.md)),
said in words. A sample that does not admit it is a sample is a library that
appears to have lost photos, and the heading's drill-in was discoverable only
to someone who already suspected it was there.

The number is formatted through `Intl.NumberFormat`, because 11000 is not how
anyone writes eleven thousand.

### Drilling out of year view starts the feed where the reader pointed

Clicking "2019" used to hand the anchor to `nearestGroupIndex`, which scrolled
to the nearest group *already loaded* — in practice 2026. The feed now takes
the year with it: `/api/photos` already accepts `to`, so the SPA passes
`to=2020` and the query starts at the end of 2019 instead of at today.

The bound is the year, not the day that was clicked, even when what was clicked
is a single photo. Clamping it to the photo's own day does put that photo on
the first page — and leaves nothing above it, so the week it lands in is the
top of the list and the reader cannot scroll back up through the year they just
opened. The bound exists to skip the twenty years above, not the eleven months.
Landing on the photo is paging's job instead, below.

Paging still works the way it always did — off the bottom, into older photos,
cursor by cursor. Only the start moved. Opening a twenty-year-old year is one
request rather than twenty.

The bound is set **only on the way out of year view**, and cleared on the way
back in. Re-deriving it from whatever is on screen at every zoom change would
alter the query key — and so refetch the feed — every time a reader scrolled
into the previous year and then zoomed.

### Opening a photo from year view zooms the list behind it

A year strip is a sample, so the tiles either side of the one a reader clicks
are months away. Clicking one therefore opens the viewer *and* drills the
timeline underneath to the week that photo was taken in, anchored on the photo
itself. Closing the viewer lands among the photo's neighbours rather than back
on the summary it was reached through.

Week, not one step in: month view of a year that holds a thousand photos is
still a screen the opened photo has to be found in, and the reader has already
said which photo they meant.

### The anchor is paged towards, not clamped to

The scoped feed starts at the top of the year, so a photo from July is several
pages into it. `groupIndexForPhoto` answers -1 while the oldest photo in hand
is still newer than the anchor, which is the signal to fetch another page and
ask again — the same latch the scrubber already used to reach a month that is
not loaded ([0017](0017-date-scrubber.md)), now holding either a month or one
photo. Within a single year that is a few 500-row pages rather than the twenty
the unscoped feed would have cost.

Resolved in the layout effect when the anchor is already loaded, which is every
zoom change that does not refetch, so those scroll in the same frame instead of
showing the top of the list for one.

The anchor also arrives as a **prop**. Changing the bound changes the feed's
query key, which unmounts the timeline until the first page lands, so the ref
the click set cannot carry it across. It survives in the app, next to the bound
it belongs to.

The viewer's own list follows that feed instead of the sample it was clicked
in. Arrowing out of a photo should reach the same neighbours the list behind
it now shows; paging the sample would step months at a time against a week of
tiles. Until the scoped feed arrives holding the photo, the viewer is a list of
one, with its arrows disabled — a viewer that briefly cannot page beats one
that closes itself because the list it was built from went away.

Both halves are decided outside React: `levelForOpenedPhoto` in `lib/zoom.ts`
and `resolveViewerList` in `lib/viewerList.ts`. The timeline's list is
virtualized and renders nothing under jsdom, so a rule that lived in the click
handler could not be tested at all.

### A group's scrubber month is its oldest, not its newest

`groupIndexForMonth` takes the first group that starts at or before the month
asked for, and a year group spans twelve months. Keyed on the group's newest
photo, a scrubber jump to June 2026 would skip the 2026 strip — whose newest
photo is in November — and land on 2025. Keyed on the oldest it lands where it
was pointed. At month and week level the two are the same month, so nothing
else changes.

### The summary is its own cache entry

It lives under `['photos-summary', ...]`, not under the feed's `['photos']`
root. The favorite mutations patch every entry beneath that root by mapping
`current.pages`, and the summary is a flat list of years with no pages at all —
sharing the root would make a heart press throw. They patch the summary by its
own key instead, rather than invalidating it: it is the whole library in one
response, and refetching all of it to flip one boolean is a lot of a Pi's
afternoon.

## Consequences

- **[0002](0002-spa-owned-timeline-groups.md)'s consequence that "a zoom
  change only sees photos already in the infinite query" no longer holds at
  year level**, which is where it hurt. It still holds at month and week, where
  the feed is the only source.
- The summary is enabled only at year level, so a reader who never zooms out
  never pays for it. It is cached for the session, like the scrubber's
  histogram, because it does not change while browsing.
- **Opening a photo at year level changes the zoom level under it.** A reader
  who opens a photo to look at it and closes it again does not come back to
  the year strip they left. That is the point — the strip exists to get to a
  moment, not to be returned to — but it is a view that moves on its own, and
  the only one in the product that does.
- **A selection made at year level selects the sample.** Favoriting "all of
  2026" from the year strip favorites 36 photos, not 1,240.
- `to` is compared against `taken_at`, which is UTC, while a year is bucketed
  from the local capture clock. A photo taken in the last hours of 31 December
  west of Greenwich therefore falls outside `to=<year+1>` and is missing from
  the top of a scoped feed. One photo at the edge of a window, against twenty
  saved round trips; not fixed. Opened from a year strip, such a photo is also
  one the feed will never reach, so the seek pages to the end of the year and
  settles on the oldest group rather than hanging.
- **Drilling to a photo costs pages.** A photo from January in a year that
  holds four thousand is eight requests before the list lands on it, run while
  the viewer is already open and showing the photo. The alternative was a feed
  the reader could not scroll up.
- The scrubber reads as busy while that paging runs, because it is the same
  latch. The track is genuinely mid-jump, so it is not a lie, but the reader
  did not touch the scrubber to start it.
- Nothing newer than the scoped year is reachable without zooming back out to
  year view, which is the navigation this whole change exists to provide.
- A failed summary request falls back to the feed rather than to an empty
  screen. The old behaviour is still a timeline, only a shorter one.
- The e2e fixture library is small enough that the sample *is* every photo, so
  no "more" button appears and the timeline scenarios are unchanged. The
  drill-in scenario still lands on December 2025, now because the feed starts
  there rather than because it happened to be loaded.
