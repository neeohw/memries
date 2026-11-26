# ADR 0004 — Browser-started indexing and cursor-paginated photos

- Status: accepted
- Date: 2026-08-26 (revised 2026-11-26)

## Context

The splash screen has to show a library that may not be indexed yet, and the
timeline has to page through it without skipping or repeating a photo.

## Decision

### An admin starts the index run, and nothing else does

`GET /api/index/status` is session-authenticated. `POST /api/index` is
**admin-only**, and the body cannot name a folder — the folders come from the
Sources an admin configured ([0013](0013-admin-managed-sources.md)), never
from the client.

The splash used to start a run by itself whenever the status read came back
`not_started`. That was right for an empty box and wrong for everything after:
on a library of 11,000 files, any condition that reported `not_started` — a
changed Source set, a missing original, a partial `discovered` from an
interrupted run — made **every page load** walk the whole library again. The
reader had not asked for it and could not tell it was happening beyond a
splash that would not go away.

So the only trigger in the interface is **Scan on the Folders page**. The
timeline's sync button is gone and the splash's auto-start with it; the splash
reports a run and no longer causes one. `not_started` became something to
display rather than something to act on, and the heuristics behind it
(`shouldRescan`, below) now only decide what the splash *says*.

Admin-only because starting a run walks every Source and renders thumbnails
for what it finds, which on a single-board computer is minutes of the machine.
That is not a reader's decision to make. The check sits in the handler rather
than in `requireAdmin`, which also refuses when no Source store is configured
— the right answer for the Sources routes and the wrong one for this.

A first run therefore needs a deliberate press, by someone who can also add
the folder it reads. An empty library shows the splash with nothing happening
until then, which is honest about a machine that will be busy for an hour.

State persists as a single `index_runs` row ([0020](0020-server-wide-library.md)),
through `not_started`, `queued`, `running`, `complete`,
`complete_with_errors`, `stopped`, `failed`. An empty successful scan is persisted too,
so the splash does not loop on a library that is genuinely empty. A library
that already holds photos is treated as complete unless a folder grew or
recent originals have gone missing.

Interrupted `queued` or `running` rows are marked failed on process start and
on the next status read: a run cannot survive the process that was running it,
and leaving the row as `running` would hang the splash forever.

### A run can be stopped, and stopping is not failing

`POST /api/index/stop` is admin-only for the same reason starting is: one
reader should not be able to cut short a scan someone else asked for. It
cancels a context belonging to that run, not the server's, so the child is
signalled and the API is untouched.

It returns as soon as the request is in. The status still reads `running`
while libvips puts down the frame it was on, and the splash polls its way to
`stopped` from there — waiting in the handler would hold an HTTP request open
for however long that takes. Stopping when nothing is running is not an error:
the current status comes back and a second press has nothing to cancel.

A queued follow-up run is dropped. An admin pressing stop does not mean "and
then go again".

**`stopped` is its own state, and it reads as ready.** A stopped run is not a
failure: the photos it got through are in the catalog, so the library is
browsable and the splash lets the reader past. The counts it reached are kept
on the row — stopping is not undoing. `failed` is the one state that still
holds the splash, because that is where the reason is shown and where an
admin's retry sits.

For the same reason, `isIndexReady` now means "no run in flight, and not
failed" rather than "complete". `not_started` used to mean "a run is about to
begin", because the splash was about to begin one; now it means "nobody has
asked for one", and holding a reader on a splash for that is a dead end with
no way out.

"The library grew since the last run" is also now only asked of a run that
*finished*. A stopped run's `discovered` is a partial count, so it always
looks like growth, and the splash would have reported a library that was
never indexed.

### The run happens in a child process

The coordinator's `JobRunner` is satisfied by `index.ExecRunner`, which spawns
the `memries-indexer` binary instead of calling `index.Indexer` in this
process. Everything above that seam is unchanged: the coordinator still writes
`index_runs`, `/api/index/status` still reports from it, and the splash still
polls.

**Why.** Indexing in process means four concurrent 12MP decodes inside the API
on a 1.9GB board with no swap, so a scan could take the server out, and a
crash in cgo or libvips took it with it. As a child, the scan is the thing that
dies and the library stays browsable. `GOMEMLIMIT` in the unit applies per
process, so the child gets its own ceiling rather than sharing the server's.

[0025](0025-heic-and-the-cgo-build.md) weighed this and declined it, "at the
cost of process management and of the in-process status the progress panel
reads". The second cost turned out to be avoidable, which is what changed the
answer.

**Progress crosses the boundary on stdout.** `--progress json` makes the
indexer write one object per update, the same `Result` the in-process callback
received; `ExecRunner` parses each line and calls `OnProgress` with it, so the
splash's live counters are unaffected. The indexer's own logging already went
to stderr, so the two streams were already separate. A line that is not a
progress object is skipped rather than failing the run, and the final `Result`
is written as the last line whether or not a tick landed on the last file.

**The binary is found beside the server**, by filename, from `os.Executable`
with symlinks resolved. Not through `PATH`: `exec.Command` with a bare name
searches it, and a `memries-indexer` earlier in `PATH` would then run as the
server's user. Not from configuration either — one fewer path to get wrong,
and the package installs the pair together, which is why `make build-pi` emits
them under their installed names rather than cmd/'s.

**Cancelling means signalling.** The child is put in its own process group and
gets `SIGTERM`, escalating to a kill after ten seconds, because the indexer
runs ffmpeg per clip and signalling only the indexer would orphan a transcode.
A run killed this way lands as `failed`, not as a `running` row that never
finishes — which is the stuck row that used to latch the heuristic below.

`--source` is repeated once per Source rather than joined, so the child walks
exactly the set the parent resolved and recorded.

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
