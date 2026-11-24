# ADR 0024 — Administration behind the gear, not in the nav

- Status: accepted
- Date: 2026-11-20 (revised 2026-11-24)

## Context

**Folders** was a main nav tab, appended to Memories / Favorites / Albums for
admins ([0013](0013-admin-managed-sources.md)). A second admin surface — the
thumbnail-folder page — sat behind a gear, with nothing connecting the two.

The nav bar is for browsing a photo library. Connecting a WebDAV share is not
browsing, and an admin's nav bar having a fourth tab a reader never sees made
the bar mean different things to different people.

## Decision

Administration sits behind the gear. The nav bar holds the three browsing
tabs for everyone, admin or not.

There is one admin page, **Folders**, so the gear opens it directly. The
section strip this ADR introduced is gone with the page it was there to reach:
the thumbnail folder is a line in `memries.yaml` now, not a setting an admin
changes while the server runs ([0028](0028-yaml-configuration.md)). A strip
over a single tab is a navigation control that navigates nowhere.

The gear keeps `aria-current="page"` while the admin page is open.

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
