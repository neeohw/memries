# 0002. SPA-owned Timeline Groups (ignore `/api/timeline`)

- Status: Accepted
- Date: 2026-08-26
- Source type: Internal decision (implementation + product brief)

## Key thesis

The Memories tab is a Photo album you scroll, not a bucket report. Granularity changes how Photos are grouped and shown in the SPA. `/api/timeline` count/cover buckets are not that feed.

## Context

The Go API already exposes `GET /api/timeline`: AQL collects Photos into Granularity buckets and returns `count`, `cover_photo_id`, `first`, and `last`. That shape is a summary.

The family-album design needs the opposite: enough Photos on screen to feel like pages in an album, with Year as compact thumbs, Month and Week as mixed editorial rows, and Day as larger frames with metadata. Switching Granularity must keep the reader in the same era (nearest TakenAt), and a long library must scroll without mounting every card.

A Timeline Group is a date bucket on Memories. It is not an Album. Binding the feed to `/api/timeline` would freeze density to “one cover per bucket” and force a second fetch the moment the reader opens a period.

## Decision

### Catalog

Memories, Search, and Favorites page Photos from `GET /api/photos` (TanStack infinite query, cookie `credentials: "include"`). The SPA maps `_key` → `id`, `/api/thumb/{id}` → Thumb, `/api/original/{id}` → Original. The viewer is the only place that loads the Original.

### Grouping and layout

`groupPhotos` sorts by `takenAt` (`taken_at_local`) and buckets by Granularity (`year` / `month` / `week` / `day`; week is ISO year-week). `layoutPhotos` turns each Timeline Group into mixed rows: thumbs, feature, landscape, pair, triple, or day — not a uniform grid. virtua virtualizes Timeline Groups, not individual Photos.

Switching Granularity stores the TakenAt of the first visible Timeline Group, re-buckets, and `scrollToIndex` on `nearestGroupIndex`. Tabs and the viewer stay in React state; there is no router.

### Explicit no

The SPA does not call `/api/timeline`. Compact Thumb size vs device pixel ratio is [0007](0007-viewport-forced-compact-thumbs.md). Capture time and Photo identity are [0005](0005-capture-time-stable-identity.md).

## Key findings

1. **`/api/timeline` cannot render the album.** Buckets carry a cover id and a count. Year thumbs, Week features, and Day captions all need the Photo list for that period, which `/api/photos` already pages.
2. **AQL already knows ISO week; the SPA still groups.** Week keys stay comparable (`YYYY-Www`), but layout density is a UI decision. Changing Year→Day must not require a new endpoint shape.
3. **The virtualized item is a Timeline Group.** Overflow is virtua’s, not the document. Period headings and the Current period label only move if the list scrolls (`VList.scrollToIndex` / the `data-timeline` hook). See also 0005, finding 4.
4. **Loaded pages are the catalog the UI can group.** Search, Favorites, and Granularity switches only see Photos already in the infinite query. That is acceptable while the library is owner-scoped and paged at 50; it is not a global index.
5. **“Group” is not Album.** UI copy may say “memory.” Date buckets are Timeline Groups. Named sets are Albums (`in_album`).

## Methodology

The album chrome (shell, Granularity selector, editorial rows, viewer, Favorites, Search) was built as a SPA over a seeded Photo list, then the seed was replaced by authenticated `/api/photos` without moving grouping to AQL. Evidence is the current seams: no frontend fetch of `/timeline`, `groupPhotos` / `layoutPhotos` as the only Granularity pipeline, and `Timeline` restoring TakenAt on selector change.

## Consequences

- `/api/timeline` remains a live handler with no UI consumer. Do not delete it from a drive-by cleanup; do not wire Memories to it to “use the API.”
- Granularity is React state, not `localStorage`. A refresh returns to month.
- Compact grids still follow 0007 for Thumb bytes; this ADR only decides *which Photos are on screen* and *how they are grouped*.

## Limitations

- Grouping quality degrades if the infinite query has not loaded the era the reader switched into.
- Relocate/merge of Photos is 0005; this ADR does not change `_key`.
- Sharing remains schema-only; the feed is Owner-private.

## Actionable takeaways

- When changing Memories density, edit `layoutPhotos` / `PhotoGrid`, not `GET /api/timeline`.
- When changing Granularity restore, keep nearest TakenAt — do not reset to the newest group.
- In UI and tests, say **Timeline Group** for a date bucket and **Album** for membership.

## Quality

| Dimension    | Rating | Note |
| ------------ | ------ | ---- |
| Credibility  | High   | First-party decision, coded in this repo |
| Evidence     | High   | SPA has no `/timeline` client; grouping and layout are dedicated modules |
| Recency      | High   | Accepted 2026-08-26 |
| Objectivity  | High   | Product trade-off against an existing API, not a vendor comparison |

**Overall:** Strong — cite as the Memories feed / Granularity source of truth.

## Amendment (ADR 0017)

`/api/timeline` now has one consumer: the date scrubber reads it as a month
histogram to build its track ([0017](0017-date-scrubber.md)).

Everything this ADR decided still holds. The Memories feed is still
`/api/photos`, grouping still happens in `groupPhotos`, Granularity is still
the SPA's, and `/api/timeline` still cannot render the album for exactly the
reason given in finding 1 — a cover id and a count are not a Photo list. The
histogram is used as a navigation aid, not as a feed, which is the distinction
this ADR was drawing.

## References

- Domain language: [CONTEXT.md](../../CONTEXT.md)
- SPA seams: [frontend/src/lib/groupPhotos.ts](../../frontend/src/lib/groupPhotos.ts), [layoutPhotos.ts](../../frontend/src/lib/layoutPhotos.ts), [frontend/src/components/Timeline.tsx](../../frontend/src/components/Timeline.tsx), [frontend/src/lib/api.ts](../../frontend/src/lib/api.ts)
- Unused bucket API: [backend/internal/api/api.go](../../backend/internal/api/api.go) (`timeline`), [backend/internal/db/photos.go](../../backend/internal/db/photos.go) (`Timeline`)
- Capture clock and identity: [0005-capture-time-stable-identity.md](0005-capture-time-stable-identity.md)
- Compact Thumbs: [0007-viewport-forced-compact-thumbs.md](0007-viewport-forced-compact-thumbs.md)
