import { describe, expect, it } from 'vitest';
import {
  ZOOM_LEVELS,
  ZOOM_STORAGE_KEY,
  ZOOM_WHEEL_THRESHOLD,
  accumulateZoom,
  canZoomIn,
  canZoomOut,
  nextLevelNoun,
  readZoom,
  wheelPixels,
  writeZoom,
  zoomBy,
  zoomDisplayLabel,
  zoomIndex,
  zoomLabel,
} from './zoom';

describe('zoom ladder', () => {
  it('runs widest to closest, with no day level', () => {
    expect([...ZOOM_LEVELS]).toEqual(['year', 'month', 'week']);
  });

  it('steps one level at a time and clamps at both ends', () => {
    expect(zoomBy('month', 1)).toBe('week');
    expect(zoomBy('month', -1)).toBe('year');
    expect(zoomBy('week', 1)).toBe('week');
    expect(zoomBy('year', -1)).toBe('year');
    expect(zoomBy('year', 5)).toBe('week');
  });

  it('reports which directions are open', () => {
    expect(canZoomOut('year')).toBe(false);
    expect(canZoomIn('year')).toBe(true);
    expect(canZoomIn('week')).toBe(false);
    expect(canZoomOut('week')).toBe(true);
    expect(canZoomIn('month') && canZoomOut('month')).toBe(true);
  });

  it('falls back to month for a granularity outside the ladder', () => {
    // A persisted or hand-typed 'day' must not index to -1 and walk backwards.
    expect(zoomIndex('day' as never)).toBe(1);
    expect(zoomBy('day' as never, 1)).toBe('week');
  });

  it('names the grouping for the live announcement', () => {
    expect(zoomLabel('week')).toBe('Grouped by week');
  });

  it('names the level below, for the heading that drills into it', () => {
    expect(nextLevelNoun('year')).toBe('months');
    expect(nextLevelNoun('month')).toBe('weeks');
    // Nothing is closer than a week, so its heading does not drill.
    expect(nextLevelNoun('week')).toBe('');
  });

  it('capitalizes the level shown between the buttons', () => {
    expect(zoomDisplayLabel('year')).toBe('Year');
    expect(zoomDisplayLabel('month')).toBe('Month');
    expect(zoomDisplayLabel('week')).toBe('Week');
  });
});

describe('wheelPixels', () => {
  it('passes pixel deltas through', () => {
    expect(wheelPixels(-120, 0)).toBe(-120);
  });

  it('scales line and page deltas, which Firefox reports instead', () => {
    // Unnormalized, one Firefox notch would be 1px and zoom ~100x less.
    expect(wheelPixels(-3, 1)).toBe(-48);
    expect(wheelPixels(-1, 2)).toBe(-320);
  });
});

describe('accumulateZoom', () => {
  it('zooms in on a delta away from the reader', () => {
    expect(accumulateZoom(0, -120)).toEqual({ pending: 0, steps: 1 });
  });

  it('zooms out on a delta toward the reader', () => {
    expect(accumulateZoom(0, 120)).toEqual({ pending: 0, steps: -1 });
  });

  it('never reports more than one level for a single event', () => {
    // A mouse notch reports 100-120px; dividing by the threshold would make
    // one notch jump two levels.
    expect(accumulateZoom(0, -400).steps).toBe(1);
    expect(accumulateZoom(0, 400).steps).toBe(-1);
  });

  it('adds small pinch deltas up to one level', () => {
    let pending = 0;
    let fired = 0;
    for (let i = 0; i < 6; i += 1) {
      const next = accumulateZoom(pending, -9);
      pending = next.pending;
      fired += next.steps;
    }
    expect(fired).toBe(1);
  });

  it('leaves no charge behind for the next gesture', () => {
    expect(accumulateZoom(-49, -10)).toEqual({ pending: 0, steps: 1 });
  });

  it('holds a delta below the threshold', () => {
    const next = accumulateZoom(0, -(ZOOM_WHEEL_THRESHOLD - 1));
    expect(next.steps).toBe(0);
    expect(next.pending).toBe(-(ZOOM_WHEEL_THRESHOLD - 1));
  });

  it('cancels opposing deltas instead of drifting', () => {
    const half = accumulateZoom(0, -30);
    expect(accumulateZoom(half.pending, 30)).toEqual({ pending: 0, steps: 0 });
  });
});

describe('zoom persistence', () => {
  const store = (value: string | null) =>
    ({
      getItem: () => value,
      setItem: () => {},
    }) as unknown as Storage;

  it('reads back a level it stored', () => {
    expect(readZoom(store('week'))).toBe('week');
  });

  it('ignores a level that is no longer in the ladder', () => {
    // A tab that stored 'day' before that level was removed must fall back to
    // the default rather than index off the end of the list.
    expect(readZoom(store('day'))).toBeNull();
    expect(readZoom(store('fortnight'))).toBeNull();
    expect(readZoom(store(''))).toBeNull();
    expect(readZoom(store(null))).toBeNull();
  });

  it('treats no storage at all as nothing stored', () => {
    expect(readZoom(null)).toBeNull();
  });

  it('survives storage that throws, as a blocked private window does', () => {
    const hostile = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(readZoom(hostile)).toBeNull();
    expect(() => writeZoom(hostile, 'week')).not.toThrow();
    expect(() => writeZoom(null, 'week')).not.toThrow();
  });

  it('writes under one key', () => {
    const written: Record<string, string> = {};
    const spy = {
      getItem: (k: string) => written[k] ?? null,
      setItem: (k: string, v: string) => {
        written[k] = v;
      },
    } as unknown as Storage;
    writeZoom(spy, 'year');
    expect(written[ZOOM_STORAGE_KEY]).toBe('year');
    expect(Object.keys(written)).toEqual([ZOOM_STORAGE_KEY]);
  });
});
