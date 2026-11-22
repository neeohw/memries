# ADR 0022 — Server settings, starting with the thumbnail folder

- Status: accepted
- Date: 2026-11-20

## Context

The target is an OrangePi 3 LTS with **8GB of eMMC**. A 12k-photo library
generates three thumbnails per photo, which does not fit beside the OS. The
cache has to live on external storage.

`MEMRIES_CACHE_ROOT` could already move it, but only by editing a unit file
or Compose env and restarting. That is the wrong shape for the one setting
most likely to need changing after the disk fills.

## Decision

### A settings table, not more env

`settings` is a key/value table: a handful of rows, read individually by
name, never queried together. A stored value overrides the env default, so
`MEMRIES_CACHE_ROOT` remains the install default rather than becoming dead
configuration.

Both binaries read it at startup — the server to serve from the right place,
the indexer to write there. If a stored folder is unusable the process
**exits** rather than falling back to the env default, because silently
serving an empty cache looks like data loss.

### Moving the root rewrites nothing

Thumb paths on a Photo are already relative (`ab/abcdef/512.jpg`); the root
is joined at read time. So moving the cache changes one field and no catalog
row. `thumb.Generator` holds that field behind an `RWMutex` and resolves each
path in a single read-lock, so a save cannot split one operation across two
roots.

What a move does **not** do is carry the existing files. Copying 12k ladders
across a device boundary inside an HTTP request is the wrong place for that
work, so the response says `needs_reindex` and the page says the old
thumbnails stayed behind and a scan regenerates them. An honest sentence
beats a progress bar that cannot be cancelled.

### Validation is the substance of this change

An admin reaches this over HTTP, so a path is not taken at its word:

- **Absolute**, then `filepath.Clean`.
- **Confined to `MEMRIES_CACHE_ROOTS`**, the same shape as a Source's
  `MEMRIES_SOURCE_ROOTS` ([0013](0013-admin-managed-sources.md)). The cache
  root's own parent is always allowed, so a default install can move the
  cache beside itself with no configuration.
- **Not inside a Source, and not containing one.** A cache under a photo
  folder would be walked by the next scan, so the indexer would index its own
  thumbnails as photos; a cache above one would put the ladder on top of the
  library. Neither is recoverable without a wipe, so both are refused with a
  message that says which folder and why.
- **Writable**, proven by creating and removing a probe file. `MkdirAll`
  succeeds on a directory this user cannot write, and a read-only mount is
  exactly the mistake worth catching before an index run fails on every
  photo.

The confinement check could not reuse `sources.withinRoots`. That function
resolves symlinks on the path itself, which is right for a Source — it must
already exist — but the thumbnail folder is about to be created. Resolving a
non-existent path yields the literal path, which then gets compared against a
*resolved* root and fails wherever the root sits under a symlink: `/var` on
macOS, or a symlinked mount point on the Pi. `withinAllowedRoots` instead
resolves the **deepest existing ancestor**, which is the part someone could
have repointed, and requires both the literal and resolved forms to land in
the same root. Tests cover a root behind a symlink, a symlink escaping the
root, and `..` traversal.

### An admin gear, separate from the account

The settings live behind their own gear icon, rendered only for admins, next
to the account button in the rail and the mobile header. Server settings and
personal preferences are different things: one changes what the household
sees, the other changes what one reader sees
([0021](0021-interface-languages.md)). The routes sit behind the existing
admin middleware with Sources.

Free space on the holding filesystem is shown beside the current folder,
since getting off a full disk is the reason to open this page. `Bavail`, not
`Bfree`: blocks reserved for root are not space the server can write into. A
`0` means unknown and the figure is left out rather than shown as a full disk.

### The default follows XDG, not the working directory

The default was `./data/cache` — relative, so a service started from `/`
would scatter a `data/cache` wherever it happened to be. Thumbnails are a
regenerable cache (reindexing rebuilds them), so they belong under the XDG
cache directory rather than in a data directory a reader would miss.

`defaultCacheRoot()` resolves, in order:

1. `$CACHE_DIRECTORY`, which systemd sets from `CacheDirectory=memries`. That
   gives `/var/cache/memries` for a system unit and `~/.cache/memries` under
   `systemd --user` — the FHS answer in both cases, and it matters because a
   system account often has no usable home at all.
2. `$XDG_CACHE_HOME/memries`, when the spec is honoured and the value is
   absolute (a relative one is invalid per the spec and ignored).
3. `~/.cache/memries`, the spec's own default.

`MEMRIES_CACHE_ROOT` overrides all of it, which is what the dev Compose file
relies on. Whatever the source, the result is made absolute.

The page names the default path whenever it is **not** in use: "Back to the
default" is not an answer if the default is invisible.

## Consequences

- `settings` is a new table, so an existing catalog needs `make db-clear`.
- A moved cache leaves its old files behind. Nothing deletes them; an admin
  who wants the space back removes the old folder themselves.
- Only the thumbnail folder is settable. Anything else stays env until it has
  the same "needs changing on a live box" character.
- `MEMRIES_CACHE_ROOTS` is new and optional; without it an admin can still
  move the cache anywhere under the default root's parent.
