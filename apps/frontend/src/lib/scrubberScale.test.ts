import { describe, expect, it } from 'vitest';
import {
  buildScrubberScale,
  fractionForDate,
  fractionForKey,
  groupIndexForMonth,
  keyAtFraction,
  yearTicks,
} from './scrubberScale';

describe('buildScrubberScale', () => {
  it('orders the track newest-first and spans exactly 0 to 1', () => {
    const scale = buildScrubberScale([
      { key: '2025-01', count: 10 },
      { key: '2026-08', count: 10 },
      { key: '2026-01', count: 10 },
    ]);

    expect(scale.segments.map((s) => s.key)).toEqual(['2026-08', '2026-01', '2025-01']);
    expect(scale.segments[0].start).toBe(0);
    expect(scale.segments[scale.segments.length - 1].end).toBeCloseTo(1, 10);
    // Segments tile the track with no gaps.
    for (let i = 1; i < scale.segments.length; i++) {
      expect(scale.segments[i].start).toBeCloseTo(scale.segments[i - 1].end, 10);
    }
  });

  it('gives a denser month more of the track', () => {
    const scale = buildScrubberScale([
      { key: '2026-02', count: 400 },
      { key: '2026-01', count: 4 },
    ]);
    const [dense, sparse] = scale.segments;
    expect(dense.end - dense.start).toBeGreaterThan(sparse.end - sparse.start);
  });

  // Purely proportional weighting lets one holiday month swallow the track and
  // makes a sparse year impossible to hit. Compressing by square root keeps
  // busy periods larger while leaving quiet ones reachable.
  it('compresses density so a huge month cannot swallow the track', () => {
    const scale = buildScrubberScale([
      { key: '2026-02', count: 10_000 },
      { key: '2026-01', count: 100 },
    ]);
    const [dense, sparse] = scale.segments;
    const ratio = (dense.end - dense.start) / (sparse.end - sparse.start);
    // Proportional weighting would make this 100x.
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(20);
    expect(sparse.end - sparse.start).toBeGreaterThan(0.05);
  });

  it('drops empty buckets and survives an empty library', () => {
    const scale = buildScrubberScale([
      { key: '2026-02', count: 0 },
      { key: '2026-01', count: 5 },
    ]);
    expect(scale.segments.map((s) => s.key)).toEqual(['2026-01']);

    const empty = buildScrubberScale([]);
    expect(empty.segments).toEqual([]);
    expect(empty.total).toBe(0);
  });

  it('handles a single bucket as the whole track', () => {
    const scale = buildScrubberScale([{ key: '2026-01', count: 7 }]);
    expect(scale.segments).toHaveLength(1);
    expect(scale.segments[0].start).toBe(0);
    expect(scale.segments[0].end).toBeCloseTo(1, 10);
  });
});

describe('fractionForKey', () => {
  const scale = buildScrubberScale([
    { key: '2026-03', count: 10 },
    { key: '2026-02', count: 10 },
    { key: '2026-01', count: 10 },
  ]);

  it('returns the midpoint of the bucket', () => {
    expect(fractionForKey(scale, '2026-03')).toBeCloseTo(1 / 6, 6);
    expect(fractionForKey(scale, '2026-02')).toBeCloseTo(3 / 6, 6);
    expect(fractionForKey(scale, '2026-01')).toBeCloseTo(5 / 6, 6);
  });

  it('falls back to the nearest known bucket', () => {
    // A month with no photos sits between two that have some.
    expect(fractionForKey(scale, '2026-02-bogus')).toBeGreaterThanOrEqual(0);
    // Newer than everything clamps to the top, older clamps to the bottom.
    expect(fractionForKey(scale, '2030-01')).toBeCloseTo(fractionForKey(scale, '2026-03'), 6);
    expect(fractionForKey(scale, '1999-01')).toBeCloseTo(fractionForKey(scale, '2026-01'), 6);
  });

  it('is 0 for an empty scale', () => {
    expect(fractionForKey(buildScrubberScale([]), '2026-01')).toBe(0);
  });
});

describe('fractionForDate', () => {
  const scale = buildScrubberScale([
    { key: '2026-03', count: 10 },
    { key: '2026-01', count: 10 },
  ]);

  it('reads the month out of a local capture clock', () => {
    expect(fractionForDate(scale, '2026-03-14T09:30:00')).toBeCloseTo(
      fractionForKey(scale, '2026-03'),
      6,
    );
  });

  it('ignores a blank date', () => {
    expect(fractionForDate(scale, '')).toBe(0);
  });
});

describe('keyAtFraction', () => {
  const scale = buildScrubberScale([
    { key: '2026-03', count: 10 },
    { key: '2026-02', count: 10 },
    { key: '2026-01', count: 10 },
  ]);

  it('maps a position on the track back to a bucket', () => {
    expect(keyAtFraction(scale, 0)).toBe('2026-03');
    expect(keyAtFraction(scale, 0.5)).toBe('2026-02');
    expect(keyAtFraction(scale, 1)).toBe('2026-01');
  });

  it('clamps out-of-range positions instead of failing', () => {
    expect(keyAtFraction(scale, -3)).toBe('2026-03');
    expect(keyAtFraction(scale, 42)).toBe('2026-01');
  });

  it('round-trips with fractionForKey', () => {
    for (const segment of scale.segments) {
      expect(keyAtFraction(scale, fractionForKey(scale, segment.key))).toBe(segment.key);
    }
  });

  it('returns an empty string for an empty scale', () => {
    expect(keyAtFraction(buildScrubberScale([]), 0.5)).toBe('');
  });
});

describe('yearTicks', () => {
  it('marks each year once, at its newest bucket', () => {
    const scale = buildScrubberScale([
      { key: '2026-08', count: 10 },
      { key: '2026-02', count: 10 },
      { key: '2025-11', count: 10 },
      { key: '2024-01', count: 10 },
    ]);
    const ticks = yearTicks(scale);
    expect(ticks.map((t) => t.year)).toEqual(['2026', '2025', '2024']);
    // Ticks run top to bottom, newest first.
    expect(ticks[0].fraction).toBeLessThan(ticks[1].fraction);
    expect(ticks[1].fraction).toBeLessThan(ticks[2].fraction);
    // The 2026 tick sits at the very top of the 2026-08 segment.
    expect(ticks[0].fraction).toBe(0);
  });

  it('is empty for an empty scale', () => {
    expect(yearTicks(buildScrubberScale([]))).toEqual([]);
  });
});

describe('groupIndexForMonth', () => {
  // Groups are newest-first, holding the month of each group's newest photo.
  const months = ['2026-08', '2026-03', '2025-11', '2024-01'];

  it('lands on an exact month', () => {
    expect(groupIndexForMonth(months, '2026-03')).toBe(1);
    expect(groupIndexForMonth(months, '2024-01')).toBe(3);
  });

  it('lands on the newest group that is not newer than the target', () => {
    // Nothing was shot in 2026-06, so June falls back to March.
    expect(groupIndexForMonth(months, '2026-06')).toBe(1);
    expect(groupIndexForMonth(months, '2025-01')).toBe(3);
  });

  // The signal that the caller must page further back before it can scroll.
  it('reports -1 when every loaded group is newer than the target', () => {
    expect(groupIndexForMonth(months, '2020-01')).toBe(-1);
    expect(groupIndexForMonth([], '2026-01')).toBe(-1);
    expect(groupIndexForMonth(months, '')).toBe(-1);
  });

  it('clamps a target newer than everything to the newest group', () => {
    expect(groupIndexForMonth(months, '2030-01')).toBe(0);
  });

  it('skips groups with no capture clock', () => {
    expect(groupIndexForMonth(['', '2026-03'], '2026-03')).toBe(1);
  });
});
