# ADR 0019 — Pointer-driven timeline zoom

- Status: accepted
- Date: 2026-11-18 (revised 2026-11-25)
- Related: [0002](0002-spa-owned-timeline-groups.md), [0007](0007-viewport-forced-compact-thumbs.md), [0017](0017-date-scrubber.md), [0031](0031-year-view-is-a-summary.md)

## Context

Granularity was a four-option radiogroup: Year / Month / Week / Day. It was
never only a grouping — `targetRowHeight` keys off the same value, so each
option also sets how large the tiles are. Choosing "Week" both regroups the
timeline and roughly doubles the row height.

That is a zoom control wearing the clothes of a filter. A reader who wants to
see more at once reaches for the gesture every other visual tool has trained
them to use, and found four labelled buttons instead.

Day was also the odd one out. It made each tile 280–620px tall, so a day of
holiday photos filled several screens, and the grouping it produced was the one
the pinned period label already states for whatever is on screen.

## Decision

### Granularity is a zoom ladder of three

`Granularity` loses `'day'` and becomes `'year' | 'month' | 'week'`, widest
first. `lib/zoom.ts` owns the ladder, the stepping and the clamping, with no
React in it, because the wheel arithmetic is the part that is easy to get
wrong and worth testing directly.

Each level's row height is about 0.7 of the one closer in, so every notch
changes the tiles visibly as well as the grouping. Year and month shared a row
height at first, which made zooming out from month regroup without resizing —
the control read as one that had not worked.

### Ctrl/Cmd + wheel, which is also pinch

The gesture is Ctrl/Cmd + wheel. Browsers deliver a trackpad pinch as exactly
that event, so pinch-to-zoom works with no second implementation and no
gesture library. A plain wheel still scrolls, untouched.

The listener is attached by hand with `{ passive: false }` rather than through
React's `onWheel`, because React marks its own wheel listener passive and a
passive listener may not call `preventDefault` — without which the browser
zooms the whole page instead of the timeline.

It is attached to the timeline's root, not to the virtualized list, for two
reasons: the list's container is keyed by granularity and so is replaced by the
very change the gesture triggers, and the gesture should work over the header
too.

### One level per event, accumulated

`accumulateZoom` folds deltas into a pending total, fires at a threshold of
50px, caps the result at one level per event, and resets the total when it
fires.

All three of those matter. A mouse notch reports 100–120px, so dividing by the
threshold would make one notch jump two levels. A pinch reports a stream of
single-digit deltas, so firing on every event would race through the whole
ladder in one gesture. Keeping the remainder rather than resetting would leave
a charge behind that makes the next gesture fire early.

`wheelPixels` normalizes the delta first: Firefox reports lines for a mouse
wheel and pages when there is no scrollable ancestor, which unnormalized would
zoom roughly a hundred times less per notch than Chrome.

### A two-button control stays

A gesture cannot be the only way in. `ZoomControl` replaces the radiogroup with
−/+ at about a third of the width. Each button is labelled with where it lands
("Zoom in, group by a shorter period"), not just that it zooms, and the one
with nowhere to go is disabled rather than silently inert.

The current level sits **between** the two buttons, so −/+ read as moving along
a named ladder rather than changing something unstated. Its box is a fixed
width: Year, Month and Week are different lengths, and letting it resize would
shift both buttons out from under the pointer on every press — the one place a
reader is most likely to click again.

That visible level is `aria-hidden`, with the announcement left to an `sr-only`
live region. A screen reader hearing a bare "Month" learns nothing about what
changed, and announcing both would say it twice.

Below 640px the control stretches and spreads its three items. The period label
is absolutely positioned under the header at that width, so this control and
the two icon buttons are the whole row; a shrink-to-fit control left the row
left-aligned with dead space and pulled filter and sync off the right edge.

### The period header slides only while the list is moving

The header swaps labels with a slide, which makes the period feel attached to
the list while scrolling. A zoom change was being animated the same way: the
header is remounted on a granularity change, so it mounts holding the label
from the old grouping and is handed the new one once the list has settled.
The slide then played "April 2026" against "2026", both on screen at once.

The slide now happens only when the change arrives while `scrolling` is set —
which is what the animation has always meant. A zoom correction arrives with
the list still, so the label is simply replaced.

The tempting fix was to compute the new label during the render that changes
the granularity, from the group the reader is about to be scrolled to. That
removed the overlap and introduced something worse: when the whole library
fits on screen there is nothing to scroll, so the header named the anchored
period while the list showed the newest one. A header that disagrees with the
list under it is a worse bug than a 380ms overlap, and predicting where the
list will land is not the header's job.

### A period heading drills into itself

Clicking "2026" in year view shows that year by month; clicking "August 2026"
shows that month by week. At week level the heading is plain text, because
there is nowhere closer to go.

It anchors on the group that was clicked, not on the group at the top of the
viewport, which is what the −/+ buttons and the wheel do. The anchor machinery
already existed to keep a reader's place across a granularity change; this
passes the clicked group's newest photo into it instead of reading the
viewport.

The anchor also leaves the component. `onGranularityChange` carries it up,
because landing on an old year is not only a scroll: drilling out of year view
scopes the feed to the year that was clicked, so the photos to land among are
fetched rather than paged back to ([0031](0031-year-view-is-a-summary.md)).

The action rides on `aria-describedby`, not on the button's label. The heading
is what its `<section>` is labelled by, so naming the button "2026, zoom in to
months" would rename the section too — and the e2e suite matches heading names
exactly. One shared `sr-only` hint serves every heading, since the noun depends
only on the current level and a library can have hundreds of groups.

## Consequences

### The level is remembered per tab

`useStoredZoom` keeps the level in `sessionStorage`, not `localStorage`: two
windows open on different parts of a library are two different trains of
thought, and the level should not follow a reader into a new session either.

The write happens in the setter rather than in an effect. An effect that
mirrors state into storage runs a round-trip later than needed, and is the
shape `react-hooks/set-state-in-effect` exists to discourage.

The stored string is validated against the ladder rather than cast. A tab that
stored `day` before that level existed no longer must fall back to the default,
not index off the end of the list. Reading `window.sessionStorage` can itself
throw in a private window with site data blocked, so every access is guarded
and a failed write costs the reader nothing but the memory.
- Drill-in is Timeline-only. Favorites and the Album page render `PhotoGrid`
  directly with a fixed granularity and have no headings to click.
- In year view a photo tile drills in too, straight to week and anchored on
  itself, because the strip there is a sample rather than the year
  ([0031](0031-year-view-is-a-summary.md)). It is the one place a zoom change
  is not something the reader asked for by name.
- `drillIn` is a `useCallback` reading the same refs as the wheel listener. A
  handler that reached `listRef.current` through `handleGranularity` counts as
  a ref read during render (`react-hooks/refs`), because it is created in
  render and handed down the tree.
- `PhotoDensity`'s `'day'` member was already dead — nothing passed it — and is
  left alone rather than removed in the same change.
- `useSlidingHighlight` survives: `BottomNavigation` still uses it. The
  `data-granularity-indicator` seam and the e2e step that measured the pill's
  position against the selected radio are gone with the radiogroup.
- The e2e step `I group memories by "..."` reads as it always did but now
  presses the real control one level at a time, so the scenarios describe the
  same intent through the interface a reader actually has. The scenarios that
  used `"Day"` assert on week labels instead.
- Nothing is persisted or sent to the backend: `/api/timeline` still only ever
  receives `granularity=month`, for the scrubber's histogram ([0017](0017-date-scrubber.md)).
