# ADR 0018 — Multi-select and batch actions

- Status: accepted
- Date: 2026-11-18
- Related: [0005](0005-capture-time-stable-identity.md), [0013](0013-admin-managed-sources.md), [0017](0017-date-scrubber.md)

## Context

Favoriting or filing a holiday one photo at a time is the main thing that makes
a large library tedious, and it is the second half of what makes Google Photos
feel like a tool rather than a viewer. Every per-photo action already existed;
none of them took more than one photo.

The API was single-photo throughout: `PUT /api/photos/{id}/favorite` and
`POST /api/albums/{id}/photos` with a `photo_id`. Doing a selection of forty
photos from the client would have meant forty requests, forty chances to half
fail, and forty rows of log.

## Decision

### The API takes batches, on the routes it already had where it can

- `POST /api/albums/{id}/photos` now accepts **either** `photo_id` (a string,
  what the single-photo menu has always sent) **or** `photo_ids` (an array).
  One route, one response shape, and the existing client path keeps working
  untouched.
- Favorites needed a second route, because the single one carries the id in the
  path: `PUT /api/photos/favorite` with `{"ids": [...], "favorite": bool}`. It
  does not shadow `PUT /api/photos/{id}/favorite` — chi matches on segment
  count — and a test pins that both still work.

### A batch is all or nothing

Both store methods verify ownership of every id **before** writing anything,
and `AddPhotosToAlbum` does its inserts in one transaction. A batch containing
one id the reader does not own adds nothing at all and answers `403`.

The alternative — apply the valid part, report the rest — was rejected. The ids
come from a grid the reader is looking at, so a foreign id is a bug, not a
routine condition, and a partial success leaves them unable to tell which half
took.

`SetFavorites` scopes its `UPDATE` to `owner_id` in SQL, so a foreign id cannot
be written even if the ownership check were wrong, and then compares affected
rows to the request size to detect that it was. Ids are deduplicated first,
because duplicates would make that comparison disagree with the request and
look like a permission failure.

The fakes in `internal/api` mirror this all-or-nothing rule deliberately. A
fake that applied the valid half would be more permissive than production and
would hide exactly the bug these handlers exist to prevent — the same trap that
ADR 0014's cross-owner key collision was found through.

`MaxBatchPhotos` is 500, generous for a grid and enough to stop one request
building an unbounded SQL statement.

### Selection lives in a context, not in props

The tile that needs the selection sits three components below the component
that owns it (`Timeline` → `TimelineSection` → `PhotoGrid` → `PhotoCard`), and
several views render grids. A context means anything not wrapped in a provider
gets an inert selection and behaves exactly as before, so Favorites, Search and
Album pages are untouched by this change.

`useSelectionState` is split from `PhotoSelectionProvider` because the
component that owns the state also has to read it: the toolbar and the tiles
sit on opposite sides of the same subtree.

### A selection can become a new album

`POST /api/albums` takes an optional `photo_ids`, and the store creates the
Album and fills it in one transaction.

Not a create followed by an add: if the fill failed halfway, the reader would
be left with an album they never asked for, holding part of a selection. The
same all-or-nothing rule applies to the ids — one that is not a live Photo and
no album is created at all.

The name is asked for inside the album menu rather than in a dialog. The
selection is the subject of the action, and a modal over the grid would hide
what is about to go into the album. Escape there backs out of naming without
closing the menu, because Escape at the window level clears the whole
selection (below) and losing it to a mistyped name would be rude.

The album button is no longer disabled when there are no albums yet: making
the first one from a selection is exactly what this adds.

### Albums are selected and deleted the same way

The album overview reuses `useSelectionState`, which is generic over ids, so
shift-click ranges and "a click extends the selection once one is running"
behave identically to the photo grid without a second implementation. The
checkbox is a sibling of the open button for the same reason as on a tile.

`DELETE /api/albums` takes repeated `id` query parameters rather than a body.
A DELETE body is legal but proxies are allowed to drop it, and albums are few
enough that a URL holds them. The batch is all or nothing: ownership of every
id is checked before anything is deleted, so one foreign id deletes nothing.

Deleting asks first. It is the only destructive action that can take several
things at once, and while the photos survive — an Album groups the library, it
does not own it — rebuilding an album by hand is slow.

### Interaction

- A checkbox appears on each tile on hover or focus, and stays visible once
  anything is selected. It is a **sibling** of the tile, not a child: the tile
  is itself a `<button>` and buttons cannot nest. A test pins that.
- Once a selection is running, a plain tile click extends it rather than
  opening the viewer — Google Photos' modal behaviour — and the tile's
  `aria-label` changes to say so, because a label that still says "Open photo"
  would be lying about what the click does.
- Shift-click selects the range between the anchor and the target, unioned with
  what was already selected, so a second range extends rather than replaces.
  The anchor stays put so dragging further extends from the same origin.
- The toolbar takes the header's place while a selection is live, so the count
  and the way out are where the period label was. The count is `aria-live`, so
  a screen reader hears the selection grow without focus moving.
- The favorite action flips to "Remove from favorites" once everything selected
  is already a favorite, so the button is never a no-op.
- Escape clears, bound on the window because the click that built the selection
  may have left focus on any tile.
- Ids are sent in **library order**, not click order, so a request is
  predictable in a log.

## Consequences

- Favorites, Search and the Album page render grids with no provider, so they
  have no selection yet. Extending them is a provider and a toolbar each, not
  new plumbing.
- **Timeline-level composition is not unit tested.** `virtua` renders nothing
  in jsdom, which is why the pre-existing Timeline tests only ever asserted on
  its header. The selection behaviour is covered against a real provider at the
  `PhotoCard` level (8 tests), the toolbar separately (7), and the arithmetic
  directly (15); the header-swap, Escape handling and provider wiring are
  covered only by the Playwright suite.
- The optimistic cache patch for a batch favorite reuses the single-photo
  shape, so badges flip with the click and roll back together on failure.
- No delete, download or share in the toolbar. Delete is not in Phase 1 at all,
  and the rest were not asked for.
