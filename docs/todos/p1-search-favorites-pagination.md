# [P1] Search and Favorites stop after the first page

## Problem

Search and Favorites render one `/api/photos` page and stop. Only the Timeline
calls `fetchNextPage()`. With more matches than the page size, the rest are
unreachable on those tabs, and the viewer opened from them is stuck inside
that first page.

The Search year chips have the same shape of bug: they are derived from the
photos already loaded on the Timeline, so a year that exists in the library
but is not on the loaded pages has no chip.
[ADR 0008](../adr/0008-smart-date-search.md) names this as a known limitation.

## Seams

- `apps/frontend/src/components/SearchView.tsx`,
  `apps/frontend/src/components/FavoritesView.tsx` — both render `PhotoGrid`
  directly and never page.
- `apps/frontend/src/hooks/usePhotos.ts` — the infinite query the Timeline
  already uses.
- `GET /api/photos` takes the same cursor and filters for all three
  ([0004](../adr/0004-cursor-paginated-photos.md)).

## Notes

The year facets want a count per year over the whole library, which is what
`/api/timeline` returns at year granularity — the same endpoint the date
scrubber reads for its histogram ([0017](../adr/0017-date-scrubber.md)).
Deriving them from loaded photos is the bug; a second in-memory catalog is not
the fix.
