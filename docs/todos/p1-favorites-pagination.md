# [P1] Favorites stops after the first page

## Problem

Favorites renders one `/api/photos` page and stops. Only the Timeline calls
`fetchNextPage()`. With more favorites than the page size, the rest are
unreachable on that tab, and the viewer opened from it is stuck inside that
first page.

## Seams

- `apps/frontend/src/components/FavoritesView.tsx` renders `PhotoGrid`
  directly and never pages.
- `apps/frontend/src/hooks/usePhotos.ts` — the infinite query the Timeline
  already uses, with `{ favorite: true }`.
- `GET /api/photos` takes the same cursor for both
  ([0004](../adr/0004-cursor-paginated-photos.md)).
