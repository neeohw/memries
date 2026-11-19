# 0008. Smart dates on Search, structured photo filters

- Status: Accepted
- Date: 2026-08-26
- Source type: Internal decision (implementation + domain language)

## Key thesis

Search interprets calendar phrases against TakenAt (`taken_at_local`). The SPA parses the phrase; `/api/photos` applies structured filters. The Filter control on Memories only opens Search.

## Context

Year facets and a substring `q` on `taken_at_local` could not answer “yesterday”, “last winter”, or “a day in June”. Putting a second in-memory catalog in the SPA would break cursor pagination ([0004](0004-cursor-paginated-photos.md)).

## Decision

1. `parseSmartDate` in the SPA turns a query plus “now” into years, month-of-year, and/or an inclusive/exclusive local day window, plus a status label.
2. `/api/photos` accepts `month`, `local_from`, and `local_to` in addition to `year`, `favorite`, and leftover `q`. Bounds match `taken_at_local`, not UTC `taken_at`.
3. Filter on Memories navigates to Search. Filters and smart-date suggestions live on Search.

Seasons are northern-hemisphere meteorological. Bare month names match that month in any year. `last` / `previous` mean the most recent period that has already started.

## Consequences

- Relative phrases in e2e freeze the library clock at 26 August 2026 before navigation.
- Client-side substring matching on the typed query is not a search implementation.

## Limitations

- Year chips come from Photos already loaded on Memories, not a separate facet API.
- Southern-hemisphere seasons are out of scope.
