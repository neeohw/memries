import { describe, expect, it } from 'vitest';
import {
  EMPTY_SELECTION,
  allSelected,
  isSelected,
  orderedSelection,
  selectRange,
  selectionIsAllFavorited,
  selectionLabel,
  toggleSelection,
} from './selection';

const IDS = ['a', 'b', 'c', 'd', 'e'];

describe('toggleSelection', () => {
  it('adds then removes', () => {
    const one = toggleSelection(EMPTY_SELECTION, 'b');
    expect([...one]).toEqual(['b']);
    expect([...toggleSelection(one, 'b')]).toEqual([]);
  });

  it('does not mutate what it was given', () => {
    const before = new Set(['a']);
    toggleSelection(before, 'b');
    expect([...before]).toEqual(['a']);
  });
});

describe('selectRange', () => {
  it('includes both ends, whichever way round they are', () => {
    expect([...selectRange(EMPTY_SELECTION, IDS, 'b', 'd')]).toEqual(['b', 'c', 'd']);
    expect([...selectRange(EMPTY_SELECTION, IDS, 'd', 'b')]).toEqual(['b', 'c', 'd']);
  });

  it('is a single photo when the ends are the same', () => {
    expect([...selectRange(EMPTY_SELECTION, IDS, 'c', 'c')]).toEqual(['c']);
  });

  // Extending, not replacing: shift-clicking a second range must keep the
  // first, as every file manager does.
  it('unions with what was already selected', () => {
    const first = selectRange(EMPTY_SELECTION, IDS, 'a', 'b');
    const both = selectRange(first, IDS, 'd', 'e');
    expect([...both].sort()).toEqual(['a', 'b', 'd', 'e']);
  });

  it('falls back to a plain toggle without a usable anchor', () => {
    expect([...selectRange(EMPTY_SELECTION, IDS, null, 'c')]).toEqual(['c']);
    // An anchor whose page was dropped must not select from the library's start.
    expect([...selectRange(EMPTY_SELECTION, IDS, 'gone', 'c')]).toEqual(['c']);
  });

  it('ignores a target that is not in the list', () => {
    expect([...selectRange(EMPTY_SELECTION, IDS, 'a', 'ghost')]).toEqual(['ghost']);
  });
});

describe('allSelected', () => {
  it('needs every id and at least one', () => {
    expect(allSelected(new Set(['a', 'b']), ['a', 'b'])).toBe(true);
    expect(allSelected(new Set(['a']), ['a', 'b'])).toBe(false);
    expect(allSelected(new Set(['a']), [])).toBe(false);
  });
});

describe('selectionIsAllFavorited', () => {
  const photos = [
    { id: 'a', favorite: true },
    { id: 'b', favorite: true },
    { id: 'c', favorite: false },
  ];

  // The control flips so the button is never a no-op.
  it('is true only when every selected photo is already a favorite', () => {
    expect(selectionIsAllFavorited(new Set(['a', 'b']), photos)).toBe(true);
    expect(selectionIsAllFavorited(new Set(['a', 'c']), photos)).toBe(false);
  });

  it('is false for an empty selection', () => {
    expect(selectionIsAllFavorited(EMPTY_SELECTION, photos)).toBe(false);
  });

  it('ignores ids that are not loaded', () => {
    expect(selectionIsAllFavorited(new Set(['a', 'ghost']), photos)).toBe(true);
  });
});

describe('orderedSelection', () => {
  // Insertion order would send ids to the server in whatever order the reader
  // happened to click, which makes a batch harder to reason about in a log.
  it('returns library order, not click order', () => {
    const picked = toggleSelection(toggleSelection(EMPTY_SELECTION, 'd'), 'b');
    expect(orderedSelection(picked, IDS)).toEqual(['b', 'd']);
  });

  it('drops ids that are no longer loaded', () => {
    expect(orderedSelection(new Set(['b', 'ghost']), IDS)).toEqual(['b']);
  });
});

describe('isSelected and selectionLabel', () => {
  it('reads membership', () => {
    expect(isSelected(new Set(['a']), 'a')).toBe(true);
    expect(isSelected(new Set(['a']), 'b')).toBe(false);
  });

  it('labels the count', () => {
    expect(selectionLabel(1)).toBe('1 selected');
    expect(selectionLabel(12)).toBe('12 selected');
  });
});
