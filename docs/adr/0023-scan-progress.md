# ADR 0023 — Live scan progress on the Folders page

- Status: accepted
- Date: 2026-11-20

## Context

Pressing **Scan now** replied "Scan queued." and then nothing. On a 12k-photo
library the work runs for minutes, so the page said a job had started and left
no way to tell whether it was still going, had finished, or had died.

The data already existed: `index.Status` carries discovered, processed,
indexed, skipped and failed, and the client already polls it at 750ms while a
job runs. Only the Folders page did not show it.

## Decision

### One panel for the page, not one per card

The coordinator runs **one job for the whole library**
([0020](0020-server-wide-library.md)), not one per folder. A scan started from
one card reports on all of them, so progress belongs at the top of the page.
Putting it on the card whose button was pressed would imply a per-folder job
that does not exist.

### Indeterminate until there is a denominator

Discovery walks the tree before it knows the total, so `discovered` is 0 for
the first stretch of a large scan. A bar pinned at 0% for minutes reads as
stuck, so until there is a denominator the bar shows a short fixed fill, omits
the percentage, and `aria-valuenow` is left off — which is how a progressbar
says "indeterminate" rather than "zero".

Counts go through `Intl.NumberFormat`, so 12k files reads as `12,000` or
`12.000` by language ([0021](0021-interface-languages.md)).

### The line is a live region

A scan runs for minutes. A screen reader that announced "Scanning" once and
then nothing learns no more than a frozen bar, so the counting line is
`role="status"` with `aria-live="polite"`: it announces as the numbers climb,
without interrupting.

### Finished says what happened

On completion the panel stops being a bar and becomes a summary — how many
photos were added, how many were unchanged, and how many files could not be
read, pluralised properly. A failure shows the **server's** message, which
knows it was a permission error, and falls back to its own wording only when
there is none.

### Two bugs found on the way

`indexStatusCopy` returned hard-coded English, so the first-run indexing
screen never translated its main line — missed by the ADR 0021 sweep because
the string lived in `lib/`, not in a component. It now takes the translator.

`SourcesView` had the same problem in six places (the intro paragraph, the add
button, loading and error lines, a fieldset legend, a placeholder), because
`t` was already a loop variable in that file and the sweep aliased it to `tr`
without catching every site. Also fixed: the intro still described photos
appearing "in their owner's Memories", which ADR 0020 removed when the library
became shared.

## Consequences

- The Folders page needs the index status passed in; it is already in `App`
  for the timeline, so no new query.
- `indexStatusCopy` takes a translator, so it cannot be called from a module
  without one.
- Progress is counts, not a per-file log. What a scan **would** change —
  above all the photos an exclude pattern would remove — is a dry run, which
  is `docs/todos/p2-scan-dry-run.md` and not this change.
