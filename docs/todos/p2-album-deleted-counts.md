# [P2] Album photo_count includes soft-deleted photos

## Problem

`ListAlbums` counts every row in `album_photos`, including photos that have
been soft-deleted. `GetAlbumView` excludes them. So an album card can say 12
while opening it shows 11.

The behaviour is deliberate today and marked in the code
(`apps/backend/internal/db/albums.go`), rather than an accident: it was left
alone through the SQL port so the port could be proven behaviour-for-behaviour
identical.

## Fix

Join `photos` in the `ListAlbums` count and exclude `deleted_at IS NOT NULL`,
the way `GetAlbumView` already does. The cover photo should skip soft-deleted
rows too, or an album can show a cover that is not in it.

## Seam

`apps/backend/internal/db/albums.go`, with a test in
`apps/backend/internal/db/store_test.go` next to the existing album tests.
