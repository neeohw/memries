# ADR 0004 — Browser-started indexing and cursor-paginated photos

- Status: accepted
- Date: 2026-08-26 (revised 2026-11-18)

## Context

The splash screen has to show a library that may not be indexed yet, and the
timeline has to page through it without skipping or repeating a photo.

## Decision

### The browser starts the index run

`GET /api/index/status` and `POST /api/index` are session-authenticated, and
the body cannot name a folder — the folders come from the Sources an admin
configured ([0013](0013-admin-managed-sources.md)), never from the client.

State persists as a single `index_runs` row ([0020](0020-server-wide-library.md)),
through `not_started`, `queued`, `running`, `complete`,
`complete_with_errors`, `failed`. An empty successful scan is persisted too,
so the splash does not loop on a library that is genuinely empty. A library
that already holds photos is treated as complete unless a folder grew or
recent originals have gone missing.

Interrupted `queued` or `running` rows are marked failed on process start and
on the next status read: a run cannot survive the process that was running it,
and leaving the row as `running` would hang the splash forever.

`cmd/indexer` is the same indexer for when the browser cannot run.

### The page cursor is composite

`GET /api/photos` sorts `(taken_at DESC, key DESC)` and the opaque cursor is
`RFC3339Nano|key`.

`taken_at` alone is not a keyset. Photos sharing a capture clock — a burst, or
a folder of scans all dated to the same day — would skip or repeat across
pages. The key is the tiebreaker, and `db/cursor_test.go` is the proof.

The query fetches `limit + 1` and emits `next_cursor` only when the extra row
comes back, so "is there another page" is answered by the same query rather
than a second count.

## Consequences

- Favorites uses this cursor with a filter rather than a second in-memory
  catalog.
- There are no WebSockets; the splash polls while a run is active.
- An interrupted run is failed, not resumed. The reader retries.
- Changing the page order means changing the cursor, and the cursor tests are
  where that breaks first.
