# ADR 0020 — One server-wide library, admin-managed folders

- Status: accepted
- Date: 2026-11-18
- Supersedes the owner-scoped parts of [0004](0004-cursor-paginated-photos.md),
  [0013](0013-admin-managed-sources.md) and [0014](0014-pluggable-sql-store.md)

## Context

Folders were per Owner: a Source named which user's library it fed, Photos
carried an `owner_id`, the Index ran once per Owner, and dedup was scoped so
the same file in two libraries stayed two Photos.

That shape belongs to a service with tenants. This is one person's server with
a handful of accounts on it, where the folders are a property of the machine —
whoever administers the box decides what is indexed, and everyone who signs in
is looking at the same shelf of photographs.

## Decision

### The library is server-wide

`photos` has no owner. Every signed-in reader sees the same timeline, and
`/api/photos` scopes nothing. Sources lose `owner_id` and `owner_email`
entirely; they are configured under `/api/admin/*`, which already refuses
anyone outside `MEMRIES_ADMIN_EMAILS`.

Two things fall out rather than being built:

- **Dedup is a unique index on `hash` alone.** The same bytes cannot be two
  Photos, so `freeKeyFor` — which existed only to find a second key when
  another Owner held the content-hash key — is gone.
- **There is one Index run**, keyed `library`, not one per Owner. The
  Coordinator's job map, its queued/running state and its rerun flag all stay;
  only the key became a constant.

### What stays personal

Favorites and Albums. A heart is the reader's, and so is how they file things.

Favorites moved from a **column on the photo** to a `favorites(user_key,
photo_key)` **table**, because the photo is now shared and the flag is not.
Every read of a Photo therefore takes a viewer, and `favorite` is projected as
an `EXISTS` against that reader's rows. That is why `GetPhoto`, `Photos` and
`PhotosFiltered` all grew a `viewer` parameter: the favorite flag is a fact
about a reader, and the signature now says so. The indexer passes `""`, which
matches nothing and reads false, rather than needing a second query shape.

Albums keep `owner_id`. Any Photo may go into any Album — the library is
shared — but the Album itself is owned, so `AddPhotoToAlbum` checks the Album
and only that.

### SMB is gone; browsing never shipped

Network shares are mounted by whoever runs the server and added as a local
folder. That deletes the SMB backend, its credentials path, and the go-smb2
dependency. WebDAV stays: it is plain HTTP and needs no kernel mount.

A server-side folder picker and mDNS discovery were built and then removed
before release. They are recorded here only so the absence is not mistaken for
an oversight.

### Exclude patterns

A Source carries regular expressions matched against each directory's path
below its root. They are compiled in `OpenStore` and handed to the storage
backend as a `SkipDirFunc`, so an excluded tree is never walked and the
indexer needs no knowledge of them.

Removal then costs nothing: a tree that is not walked is absent from the
scan's `seen` set, and the existing prune pass soft-deletes what an earlier
run indexed. Patterns are validated when the Source is saved, so a pattern
that will not compile is reported to the reader looking at the form rather
than hours later in a log.

The Source's own root is never skippable. A pattern like `.*` would otherwise
make a Source silently index nothing.

## Consequences

- **The catalog is not migrated.** This is pre-release; the schema is edited in
  place and an existing database is deleted and reindexed.
- `MEMRIES_ADMIN_EMAILS` is now the only thing separating an administrator
  from a reader. There is no second credential and no sudo prompt.
- Anyone who can sign in can see every photo. Accounts are a door, not a
  partition.
- The Coordinator has no default `ScopeResolver` any more. One built without
  `WithScopes` reports that rather than panicking, which is how the missing
  default was found.
- `indexer` lost its `-owner` flag; there is one library to index.
- Rows written with `type: smb` are refused with a message naming the fix
  rather than reported as an unknown type.
- **The e2e suite's worker isolation is weakened.** ADR 0012 gives each
  Playwright worker its own account, which isolated photos *because* photos
  were owner-scoped. Favorites and Albums are still per-worker, but the photo
  set is now shared, and three scenarios mutate fixtures on disk. That is not
  yet resolved.
