# ADR 0027 — A dry run before a folder is connected

- Status: accepted
- Date: 2026-11-23

## Context

Adding a folder was a commitment made blind. The form took a path, probed it
by listing until the first file, and saved. Everything a reader actually wants
to know — is this the right folder, how many photos are in there, did that
exclude pattern match more than I meant — was only answered by connecting it
and watching a scan run for minutes
([0023](0023-scan-progress.md)).

The exclude patterns make this worse than slow. A matching folder is never
walked, and photos already indexed from it **leave the library** on the next
scan ([0020](0020-server-wide-library.md)). A pattern that matches more than
intended is therefore discovered by noticing photos are gone.

`docs/todos/p2-scan-dry-run.md` asked for the whole of it: added, removed,
re-read and skipped per file, for a saved Source. This ADR covers the part
that belongs to the form — what a folder holds, before it is connected.

## Decision

### `POST /api/admin/sources[/{id}]/preview`, carrying the unsaved form

The dry run takes the same body as create and update, so it runs against what
is typed rather than against what is stored: a path not yet saved, an exclude
not yet applied. It writes nothing — no Source row, no catalog row, no
thumbnail — so it is safe to press repeatedly, which is what makes it useful
while an exclude pattern is being tuned.

A POST because it carries a form, not because it changes anything. Two routes
for one handler: a folder being added has no id, and a folder being edited
needs one, because the password field left blank means "keep the stored one"
and only the id can recover it. That is the same rule `Update` follows, kept
in `previewSecret` so the two cannot drift.

On the client it is deliberately **not** a `useSourceMutation`. Every other
source mutation invalidates the source list and the index status; this one
changes neither, and refetching both over a read would be a lie about what
happened.

### A folder tree with a count per folder, not a file list

The question is "did I pick the right folder", and a tree of folders with
counts answers it in a glance where twelve thousand filenames do not. Each
node carries both its own count and its subtree's total, so a collapsed
folder still says what is inside it.

Folders holding no photo anywhere below them are dropped. In a real tree they
are the majority — every parent directory on the way down — and none of them
is an answer to what would be added. Folders that hold no photo *directly* are
kept, because the shape has to read as the filesystem and not as a list of
leaves.

The top two levels arrive open: that is the level the first question is
settled at, and deeper is browsing.

### The walk visits what the excludes skip, and names the pattern

This is the one place the dry run deliberately does more work than a real
scan. `OpenStore` compiles a Source's excludes into its backend's `SkipDir`,
so an excluded tree costs nothing to read — and is invisible. The preview
opens the store with **no** excludes and applies the patterns itself while
building the tree, so each excluded folder appears, struck through, labelled
with the pattern responsible, and its photos counted under *skipped* rather
than added.

A folder quietly missing from the answer is exactly what a dry run exists to
prevent, and the excludes are the half of a scan that removes photos. Hence
`ExcludeMatcher`, which is `CompileExcludes` reporting the pattern instead of
a bool; the bool version is now written in terms of it. A child of an excluded
folder inherits the ancestor's pattern rather than being re-tested, because a
real scan never reaches it to test.

The cost is real for WebDAV, where a folder is a PROPFIND, and bounded by the
timeout below.

### Three bounds, and a partial answer rather than an error

The folder an admin types is unverified; it may be the whole disk.

- **20s timeout**, under the server's own 30s request timeout, so the bound
  that fires is this one and the answer is a truncated tree rather than a
  cut-off request. A local walk of a 12k-photo library is well under a
  second; WebDAV is where this matters.
- **200,000 files** counted, which stops a mistyped root walking a filesystem
  to the end.
- **1,000 nodes** returned. The tree is trimmed breadth-first, so what
  survives is the top — the part that gets read — and each parent says how
  many children were dropped.

Hitting any of them marks the result truncated and the counts are presented as
a floor. Half an answer beats an error: the reader usually learns what they
needed from the first level anyway.

## Consequences

- **Nothing is validated twice.** The preview runs `normalizeLocation` and
  `ValidateExcludes`, the same checks `apply` runs, so a path outside
  `MEMRIES_SOURCE_ROOTS` or an uncompilable pattern is refused here with the
  same message it would get on save.
- **Non-media files are counted but not placed.** One *other files* figure,
  tallied before the empty folders are pruned, so a folder holding only
  documents still contributes to it while staying out of a tree about photos.
- **An edit's dry run can hit the network with a stored password.** It is an
  admin-only route behind `requireAdmin`, like every other source route.
- **The removal list is still missing**, which is the part of
  `docs/todos/p2-scan-dry-run.md` worth building next: what a scan would take
  *out* of the library. That needs a saved Source and the catalog to compare
  against, not a form, so it is a different surface — a confirmation on
  **Scan now**, not a button beside **Connect folder**.

## Verification

`internal/sources/preview_test.go` walks a real tree: counts per folder,
ancestors kept and photo-less folders dropped, the exclude pattern named on
the folder it skips and inherited by its children, a blank password on an edit
falling back to the stored one, and `capNodes` trimming breadth-first. The API
test asserts the dry run queues **no** index run, which is the property that
makes it safe to press. `FolderPreview.test.tsx` covers the tree, the counts,
expanding and collapsing, the exclude label and the truncation notice.
