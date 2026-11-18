import type { Granularity } from '../models/photo';

/**
 * Timeline zoom (ADR 0019).
 *
 * Granularity was never only a grouping: it also sets the justified row
 * height, so each level is a zoom level in everything but name. Treating it as
 * one lets a pointer drive it — Ctrl/Cmd + wheel, which is also how a browser
 * reports a trackpad pinch, so the gesture comes for free.
 *
 * Widest first. Zooming in walks toward the right of this list.
 */
export const ZOOM_LEVELS: readonly Granularity[] = ['year', 'month', 'week'] as const;

/**
 * One wheel notch is about 100px in a mouse, but a trackpad pinch arrives as a
 * stream of much smaller deltas. Accumulating against a threshold means a
 * mouse notch is one level and a pinch is proportional to the fingers, instead
 * of a pinch racing through every level at once.
 */
export const ZOOM_WHEEL_THRESHOLD = 50;

/** Lines-mode wheels report ~1 per notch; treat a line as this many pixels. */
const LINE_HEIGHT = 16;

export function zoomIndex(granularity: Granularity): number {
  const at = ZOOM_LEVELS.indexOf(granularity);
  return at < 0 ? ZOOM_LEVELS.indexOf('month') : at;
}

/** Clamps to the ends: there is nothing wider than a year or closer than a week. */
export function zoomBy(granularity: Granularity, steps: number): Granularity {
  const next = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, zoomIndex(granularity) + steps));
  return ZOOM_LEVELS[next];
}

export function canZoomIn(granularity: Granularity): boolean {
  return zoomIndex(granularity) < ZOOM_LEVELS.length - 1;
}

export function canZoomOut(granularity: Granularity): boolean {
  return zoomIndex(granularity) > 0;
}

/**
 * Normalizes a wheel delta to pixels.
 *
 * Firefox reports lines rather than pixels for a mouse wheel, and pages for a
 * wheel with no scrollable ancestor; unnormalized, the same notch would zoom a
 * hundred times less in one browser than another.
 */
export function wheelPixels(deltaY: number, deltaMode: number): number {
  if (deltaMode === 1) return deltaY * LINE_HEIGHT;
  if (deltaMode === 2) return deltaY * LINE_HEIGHT * 20;
  return deltaY;
}

/**
 * Folds a wheel delta into a pending total and reports a zoom step.
 *
 * `steps` is positive to zoom in, so the sign is flipped from the delta: a
 * wheel pushed away from the reader reports a negative `deltaY` and means
 * closer, as it does everywhere else that zooms.
 *
 * At most one level per event, and the total resets once it fires. A mouse
 * notch is one level even though it reports 100-120px, which dividing would
 * turn into two; a pinch is a stream of small deltas that add up to a level at
 * a time. Resetting rather than keeping the remainder also stops a gesture
 * from leaving a charge behind that makes the next one fire early.
 */
export function accumulateZoom(
  pending: number,
  deltaPixels: number,
): { pending: number; steps: number } {
  const total = pending + deltaPixels;
  if (Math.abs(total) < ZOOM_WHEEL_THRESHOLD) return { pending: total, steps: 0 };
  return { pending: 0, steps: total < 0 ? 1 : -1 };
}

export const ZOOM_STORAGE_KEY = 'memries:timeline-zoom';

/**
 * `sessionStorage`, or null wherever it cannot be reached.
 *
 * Reading the property itself throws in a private window with site data
 * blocked, so this is not merely a null check.
 */
export function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * The zoom level kept for this tab, or null if there is none to trust.
 *
 * The stored string is validated against the ladder rather than cast: a tab
 * that stored `day` before that level was removed must fall back to the
 * default, not index off the end of the list.
 */
export function readZoom(store: Storage | null): Granularity | null {
  if (!store) return null;
  try {
    const raw = store.getItem(ZOOM_STORAGE_KEY);
    return ZOOM_LEVELS.includes(raw as Granularity) ? (raw as Granularity) : null;
  } catch {
    return null;
  }
}

/**
 * Remembers the zoom level for this tab.
 *
 * Per tab, not per browser: two windows open on different parts of a library
 * are two different trains of thought, and a write that fails is not worth
 * telling anyone about.
 */
export function writeZoom(store: Storage | null, granularity: Granularity): void {
  if (!store) return;
  try {
    store.setItem(ZOOM_STORAGE_KEY, granularity);
  } catch {
    // A full or blocked quota costs the reader nothing here: the level simply
    // is not remembered.
  }
}

/** "Grouped by month", for the zoom control's live announcement. */
export function zoomLabel(granularity: Granularity): string {
  return `Grouped by ${granularity}`;
}

/**
 * Plural noun for the level one step closer, for the hint on a period heading
 * that drills into it. Empty at the closest level, which does not drill.
 */
export function nextLevelNoun(granularity: Granularity): string {
  if (!canZoomIn(granularity)) return '';
  return `${zoomBy(granularity, 1)}s`;
}

/** "Month", for the level shown between the zoom buttons. */
export function zoomDisplayLabel(granularity: Granularity): string {
  return granularity.charAt(0).toUpperCase() + granularity.slice(1);
}
