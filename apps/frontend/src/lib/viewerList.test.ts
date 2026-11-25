import { describe, expect, it } from 'vitest';
import { resolveViewerList } from './viewerList';
import type { Photo } from '../models/photo';

function photo(id: string, takenAt: string, favorite = false): Photo {
  return {
    id,
    kind: 'photo',
    durationMs: 0,
    hash: `h-${id}`,
    imageUrl: `/api/original/${id}`,
    thumbnailUrl: `/api/thumb/${id}`,
    takenAt,
    width: 100,
    height: 100,
    favorite,
    alt: 'Photo',
  };
}

describe('resolveViewerList', () => {
  const one = photo('a', '2026-03-01T10:00:00');
  const two = photo('b', '2026-02-01T10:00:00');

  it('keeps the strip that was clicked, refreshed from the tab', () => {
    const list = resolveViewerList({ id: 'a', list: [one, two] }, [
      photo('a', '2026-03-01T10:00:00', true),
      photo('c', '2026-01-01T10:00:00'),
    ]);
    expect(list.map((item) => item.id)).toEqual(['a', 'b']);
    // Favorited elsewhere while the viewer was open.
    expect(list[0].favorite).toBe(true);
    // Dropped from the tab, so it keeps the values it was opened with.
    expect(list[1]).toBe(two);
  });

  it('pages the tab instead once the drilled feed holds the photo', () => {
    const feed = [photo('x', '2026-03-02T10:00:00'), one, photo('y', '2026-02-28T10:00:00')];
    expect(resolveViewerList({ id: 'a', list: [one], follow: true }, feed)).toBe(feed);
  });

  it('holds the one photo until that feed arrives', () => {
    expect(resolveViewerList({ id: 'a', list: [one], follow: true }, [])).toEqual([one]);
    expect(resolveViewerList({ id: 'a', list: [one], follow: true }, [two])).toEqual([one]);
  });
});
