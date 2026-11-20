# [P2] Dry-run a scan and show what it would change

## Problem

A scan is a commitment. Pressing **Scan now** walks every folder and writes
the result, and the only way to learn what it will do is to let it do it. On
a 12k-photo library that is minutes of work, and the interesting cases are
the destructive ones:

- An exclude pattern that matches more than intended. Photos already indexed
  from a newly-excluded folder **leave the library** on the next scan
  ([0020](../adr/0020-server-wide-library.md)), and the way to find out is
  currently to notice they are gone.
- A folder whose path changed, where Sync reconciles by path before content
  hash. Getting this wrong re-adds the library as new photos and loses
  favorites and album membership against the old ids
  ([0005](../adr/0005-capture-time-stable-identity.md)).
- A first scan of a large tree, where the file count alone would say whether
  the right folder was picked.

## Wanted

A dry run that walks and reports but writes nothing, and an overview of what
a real scan would change:

- files that would be **added**
- photos that would **leave** the library, and which exclude pattern or
  missing folder accounts for each — this is the part worth confirming
- files that would be **re-read** because they changed in place
- files that would be **skipped** as unchanged
- files that could not be read, with the reason

Then **Scan now** becomes "here is what will happen, go ahead" rather than a
button with consequences you discover afterwards.

## Seams

- `apps/backend/internal/index/coordinator.go` — `Status` already carries
  discovered / processed / indexed / skipped / failed, which the live progress
  panel reads ([0023](../adr/0023-scan-progress.md)). A dry run needs a
  per-file verdict, not just counts, so this likely wants a sibling result
  type rather than more fields on `Status`.
- `apps/backend/internal/index/` — the walk and the write need separating far
  enough that the walk can run alone.
- `apps/backend/internal/sources/` — exclude matching, so a removal can name
  the pattern responsible.
- `apps/frontend/src/components/ScanProgress.tsx` sits where the summary
  would go.

## Notes

The removal list is the reason this is worth building. Everything else is
reassurance; that one is a confirmation step for something that is otherwise
discovered after the fact.
