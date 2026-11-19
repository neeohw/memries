# ADR 0013 — Admin-managed Sources

- Status: accepted
- Date: 2026-09-22 (revised 2026-11-18)
- Amends: [0004](0004-cursor-paginated-photos.md) (which folders an Index run walks)

## Context

The library is fed by **Sources**: folders an admin adds in the Folders tab.
Originals are read in place; Thumbs are always generated into the local cache,
so a slow or read-only Source never becomes the thumbnail store.

## Decision

- **Who.** Only emails in `MEMRIES_ADMIN_EMAILS` may list, add, edit, remove
  or scan Sources (`/api/admin/sources…`). Sources are server-wide and name
  nobody ([0020](0020-server-wide-library.md)).
- **Keys.** `sources.Registry` implements `storage.Storage` over every Source.
  A Photo's `storage.path` is `<source key>/<path inside the Source>` and
  `storage.backend` is `source`, so identity, prune and `/api/original` work
  on those keys unchanged.
- **Backends.** `storage.OpenLocal` requires an existing directory, so an
  unmounted disk is an error rather than an empty library that prunes
  everything. `storage.WebDAV` is read-only. Network shares are mounted on the
  server and added as a local path.
- **Local paths** must be absolute and inside `MEMRIES_LOCAL_ROOT` or a
  `MEMRIES_SOURCE_ROOTS` entry, checked both literally and after resolving
  symlinks — a link inside an allowed root must not point the indexer
  elsewhere.
- **Credentials** go in the username and password fields; userinfo in the
  location is rejected. They are sealed with AES-256-GCM keyed from
  `MEMRIES_SESSION_KEY` and never returned, only `has_password`.
- **Probe before save.** Creating or editing a Source opens it and lists until
  the first file, with a 15s budget. A typo, a bad password or an unreachable
  host comes back as a 400 while the admin is still looking at the form.
- **Excludes.** A Source carries regex patterns matched against each
  directory's path below its root; a matching tree is never walked
  ([0020](0020-server-wide-library.md)).
- **Index run.** The coordinator resolves Sources into scopes and walks each.
  A Source whose walk fails counts as one failure (`complete_with_errors`) and
  **its photos are not pruned** — a sleeping NAS must not empty the library.
  The run fails only if every Source fails. Files are read once, and a file
  whose size and mtime match is skipped without reading.
- **Status probes** count media on local Sources only; remote ones rescan when
  an admin adds, edits, removes or scans them.

## Consequences

- With no Sources the reader sees "No photo folders are connected yet", and an
  admin gets an "Add a folder" shortcut.
- Rotating `MEMRIES_SESSION_KEY` means re-entering Source passwords.
- NFS and SMB are supported by mounting on the host and adding the path.
- Size + mtime skipping trusts the remote clock. Use `indexer -force` after
  restoring files with preserved mtimes but different bytes.
- One process-wide index slot; large remote Sources are walked sequentially.
- No change notifications from WebDAV; rescans are admin- or login-triggered.
