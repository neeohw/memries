import { describe, expect, it } from 'vitest';
import { testPhoto } from '../test/fixtures';
import { justifyRows, targetRowHeight, tileAspect } from './justifyRows';

function photos(count: number, width = 1200, height = 800) {
  return Array.from({ length: count }, (_, i) => testPhoto({ id: `p${i}`, width, height }));
}

describe('justifyRows', () => {
  it('fills each full row to the container width', () => {
    const rows = justifyRows(photos(7), 1000, 200, 4);
    const full = rows.slice(0, -1);
    expect(full.length).toBeGreaterThan(0);
    for (const row of full) {
      const width =
        row.tiles.reduce((sum, tile) => sum + tile.width, 0) + 4 * (row.tiles.length - 1);
      expect(width).toBeCloseTo(1000, 5);
    }
  });

  it('keeps the last row at or below the target height', () => {
    const rows = justifyRows(photos(4), 1000, 200, 4);
    const last = rows[rows.length - 1];
    expect(last.height).toBeLessThanOrEqual(200);
  });

  it('keeps every photo in order', () => {
    const input = photos(11);
    const rows = justifyRows(input, 900, 180, 4);
    expect(rows.flatMap((row) => row.tiles.map((tile) => tile.photo.id))).toEqual(
      input.map((photo) => photo.id),
    );
  });

  it('returns nothing without width or photos', () => {
    expect(justifyRows([], 1000, 200, 4)).toEqual([]);
    expect(justifyRows(photos(3), 0, 200, 4)).toEqual([]);
  });

  it('clamps extreme panoramas and missing sizes', () => {
    expect(tileAspect({ width: 8000, height: 1000 })).toBe(2.4);
    expect(tileAspect({ width: 0, height: 0 })).toBe(1);
  });

  it('grows row height with granularity and viewport', () => {
    expect(targetRowHeight('day', 1440)).toBeGreaterThan(targetRowHeight('week', 1440));
    expect(targetRowHeight('week', 1440)).toBeGreaterThan(targetRowHeight('month', 1440));
    expect(targetRowHeight('month', 1440)).toBeGreaterThan(targetRowHeight('month', 390));
  });
});
