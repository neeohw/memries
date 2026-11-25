# ADR 0004 — Browser-started indexing and cursor-paginated photos

- Status: accepted
- Date: 2026-08-26 (revised 2026-11-24)

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

### "A folder grew" is measured against the last run, not against the catalog

A `complete` row is reported as `not_started` — which the splash answers by
starting a run on its own — when recent originals have gone missing, or when a
folder has grown. The second test compared the media files on disk against
`COUNT(*) FROM photos`.

**Those two counts are not supposed to be equal.** Dedup is a unique index on
`hash` alone ([0020](0020-server-wide-library.md)), so the same bytes in two
folders are one row. A file that cannot be imported is no row at all. A
soft-deleted row whose file is still on disk is another. Each of those makes
disk exceed rows *permanently*, so the heuristic latched on: a real library of
11,000 photos with duplicates in it reported `not_started` on **every status
read** and reindexed itself on every page load. The restart that exposed it
only forced the browser to ask again.

The baseline is now `index_runs.discovered`, the number of media files the
last run actually walked — the same quantity being counted, duplicates and
failures included. A run that walked 11,008 files is not stale because the
catalog holds 11,000 rows; it is stale when the 11,008 becomes 11,009.

Two cases stand the probe down rather than let it guess:

- **No run row.** There is no baseline. A library indexed by `cmd/indexer`
  reports what it holds instead of rescanning forever over its own duplicates.
- **Any remote Source.** A WebDAV folder is deliberately not listed on every
  status read — that is a full network listing per page load — but the last run
  *did* walk it and counted it in `discovered`, so the two numbers are no
  longer comparable. Growth inside a remote Source was never detected here
  anyway; the Sync button is how a reader asks for that.

A changed Source set is still caught separately, by `run.Prefix != prefix`.

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
- A partial run leaves a `discovered` below the real file count, so the next
  status read sees growth and rescans. That is correct: the run did not finish.
- A run row written before `discovered` was meaningful reads as a baseline of
  zero, which buys exactly one more full resync before the row is rewritten
  with the right number.
- Growth in a local folder goes unnoticed while a remote Source is configured.
  Pressing Sync is the way to ask, and it always was for the remote folder
  itself.
- Changing the page order means changing the cursor, and the cursor tests are
  where that breaks first.
