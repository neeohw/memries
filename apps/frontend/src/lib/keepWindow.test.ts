import { describe, expect, it } from 'vitest';
import {
  chunkIntoRows,
  rowWindow,
  searchGridColumns,
  shouldMountThumb,
  thumbsGridColumns,
} from './keepWindow';

describe('grid columns', () => {
  it('adds thumb columns as the viewport widens', () => {
    expect(thumbsGridColumns(390)).toBe(4);
    expect(thumbsGridColumns(640)).toBe(5);
    expect(thumbsGridColumns(680)).toBe(6);
    expect(thumbsGridColumns(800)).toBe(7);
    expect(thumbsGridColumns(1280)).toBe(8);
    expect(thumbsGridColumns(1500)).toBe(10);
    expect(thumbsGridColumns(1920)).toBe(12);
    expect(thumbsGridColumns(2560)).toBe(14);
  });

  it('adds search columns as the viewport widens', () => {
    expect(searchGridColumns(390)).toBe(2);
    expect(searchGridColumns(640)).toBe(3);
    expect(searchGridColumns(800)).toBe(4);
    expect(searchGridColumns(1024)).toBe(5);
    expect(searchGridColumns(1440)).toBe(6);
    expect(searchGridColumns(1920)).toBe(8);
  });
});

describe('rowWindow', () => {
  it('keeps visible rows plus 10 before and after', () => {
    expect(rowWindow(50, 20, 22, 10)).toEqual({ start: 10, end: 33 });
  });

  it('clamps to the list', () => {
    expect(rowWindow(6, 2, 3, 10)).toEqual({ start: 0, end: 6 });
  });

  it('handles an empty list', () => {
    expect(rowWindow(0, 0, 0, 10)).toEqual({ start: 0, end: 0 });
  });
});

describe('shouldMountThumb', () => {
  it('mounts only photos in the keep-window rows', () => {
    expect(shouldMountThumb(40, 4, 20, 22, 10)).toBe(true);
    expect(shouldMountThumb(39, 4, 20, 22, 10)).toBe(false);
    expect(shouldMountThumb(131, 4, 20, 22, 10)).toBe(true);
    expect(shouldMountThumb(132, 4, 20, 22, 10)).toBe(false);
  });
});

describe('chunkIntoRows', () => {
  it('splits 10 items into rows of 4', () => {
    expect(chunkIntoRows(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], 4)).toEqual([
      ['a', 'b', 'c', 'd'],
      ['e', 'f', 'g', 'h'],
      ['i', 'j'],
    ]);
  });
});
