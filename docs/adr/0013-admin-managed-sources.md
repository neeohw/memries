# 0013. Admin-managed Sources (local, SMB, WebDAV)

- Status: Accepted
- Date: 2026-09-22
- Source type: Internal decision (implementation + domain language)
- Amends: [0004](0004-owner-scoped-index-job-and-cursor-photos.md) (which folder an Index run walks)

## Key thesis

An Owner's library is fed by **Sources**: folders an admin adds in the Folders tab — a path on the server, an SMB2/3 share, or a WebDAV collection. The implicit `data/photos/<email>` folder is replaced; an existing one becomes a Source on first run. Originals are read in place; Thumbs are always generated into the local cache.

## Decision

- **Who:** only emails in `MEMRIES_ADMIN_EMAILS` may list, add, edit, remove, or scan Sources (`/api/admin/sources…`). Each Source names one Owner (`owner_id` = sha1 of the email). The Owner is immutable; moving a folder between Owners is remove + add, so Photo identity and ACL never straddle Owners.
- **Keys:** `sources.Registry` implements `storage.Storage` over all Sources. Photo `storage.path` is `<source _key>/<path inside the Source>`, `storage.backend` is `source`. Identity, prune, and `/api/original` work on those keys unchanged.
- **Backends:** `storage.OpenLocal` (existing dir only, so an unmounted disk is an error, not an empty library), `storage.SMB` (native go-smb2, NTLMv2, lazy dial + one redial), `storage.WebDAV` (gowebdav). Remote backends are read-only.
- **Local paths** must be absolute and inside `MEMRIES_LOCAL_ROOT` or a `MEMRIES_SOURCE_ROOTS` entry, checked both literally and after resolving symlinks.
- **Credentials** go in username/password fields (userinfo in the location is rejected), sealed with AES-256-GCM keyed from `MEMRIES_SESSION_KEY`, and never returned (`has_password` only).
- **Probe before save:** create/edit opens the Source and lists until the first file (15 s budget); failures come back as 400 with the reason.
- **Index run:** the coordinator resolves the Owner's Sources into scopes and walks each. A Source whose walk fails counts as one failure (`complete_with_errors`) and its Photos are **not** pruned; the run fails only if every Source fails. Files are read once (hash, EXIF, thumbs share the bytes), and a file whose size and mtime match `storage.mtime` is skipped without reading.
- **Status probes** count media only on local Sources; remote Sources rescan when an admin adds/edits/removes/scans them (`Coordinator.Rescan` queues a follow-up run if one is in flight).
- **Legacy migration:** the first scope resolution for an Owner creates a local Source for `<LocalRoot>/<email>` if it exists, rewrites that Owner's `email/…` paths to `<source id>/…`, and sets `users.sources_migrated`. It is idempotent (reuses a Source with the same location after `make db-clear`).

## Consequences

- A fresh Owner without Sources sees "No photo folders are connected yet"; admins get an "Add a folder" shortcut.
- The CLI takes `-owner` and optional `-source <id>`; `-prefix` is gone.
- Rotating `MEMRIES_SESSION_KEY` requires re-entering Source passwords.
- NFS is supported by mounting on the host and adding the path as a server folder.

## Limitations

- Photo `hash` is still globally unique (see `docs/todos/p1-owner-scoped-dedup.md`): the same file in two Sources is one Photo that follows whichever path was indexed last; across Owners it is not duplicated.
- Size + mtime skip trusts the remote clock; use `indexer -force` after restoring files with preserved mtimes but different bytes.
- One process-wide index slot; large remote Sources are walked sequentially.
- No change notifications from SMB/WebDAV; rescans are admin- or login-triggered.
