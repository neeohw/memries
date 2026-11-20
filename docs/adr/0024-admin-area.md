# ADR 0024 — Administration behind the gear, not in the nav

- Status: accepted
- Date: 2026-11-20

## Context

**Folders** was a main nav tab, appended to Memories / Favorites / Albums for
admins ([0013](0013-admin-managed-sources.md)). Adding the thumbnail-folder
page ([0022](0022-admin-settings-thumbnail-location.md)) made the split
obvious: two admin surfaces, one in the nav bar and one behind a gear, with
nothing connecting them.

The nav bar is for browsing a photo library. Connecting a WebDAV share and
choosing a cache directory are not browsing, and an admin's nav bar having a
fourth tab a reader never sees made the bar mean different things to
different people.

## Decision

Both admin pages sit behind the gear, with a strip to move between them:
**Folders** and **Storage**. The nav bar holds the three browsing tabs for
everyone, admin or not.

The gear opens **Folders**, not the first section alphabetically or the newest
one. Adding and scanning folders is the recurring job; the storage path is set
once, usually at install.

Both admin tabs keep the gear marked `aria-current="page"`, since from the
nav's point of view they are one place.

`AdminLayout` wraps whichever page is open rather than each page drawing its
own strip, so the two cannot drift. `SourcesView` and `SettingsView` keep
their own props and know nothing about each other.

## Consequences

- `NavTab` still has `folders` and `settings`; they are now reached only
  through the gear. Keeping them as tabs rather than as state inside one page
  means each page keeps its own query-enabling condition and its own props.
- `NavButtons` and `BottomNavigation` no longer take `admin` — the nav is the
  same for everyone. `AppShell` still takes it, for the gear.
- `nav.folders` is gone from both catalogues, replaced by `admin.folders`.
- Tests pin that the nav has no Folders button even for an admin, that the
  gear is admin-only, and that it opens Folders.
