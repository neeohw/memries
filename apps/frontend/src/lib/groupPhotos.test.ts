import { describe, expect, it } from 'vitest';
import type { Photo } from '../models/photo';
import { groupIndexForPhoto, groupPhotos, nearestGroupIndex } from './groupPhotos';

const FIXTURE_DATES = {
  aug31: '2026-08-31T10:00:00',
  aug26: '2026-08-26T10:00:00',
  aug24: '2026-08-24T10:00:00',
  jul15: '2026-07-15T10:00:00',
  dec20: '2025-12-20T10:00:00',
} as const;

function photo(id: string, takenAt: string): Photo {
  return {
    id,
    kind: 'photo',
    durationMs: 0,
    hash: `${id}hash`,
    imageUrl: `/api/media/${id}`,
    thumbnailUrl: `/api/thumb/${id}`,
    takenAt,
    width: 1000,
    height: 800,
    favorite: false,
    alt: '',
  };
}

const fixturePhotos = [
  photo('aug31', FIXTURE_DATES.aug31),
  photo('aug26', FIXTURE_DATES.aug26),
  photo('aug24', FIXTURE_DATES.aug24),
  photo('jul15', FIXTURE_DATES.jul15),
  photo('dec20', FIXTURE_DATES.dec20),
];

describe('groupPhotos with totals', () => {
  it('reports the real period count, not the photos in hand', () => {
    // Year view is handed a sample of each year (ADR 0031), so the count has
    // to come from the server rather than from the array's length.
    const groups = groupPhotos(fixturePhotos, 'year', {
      totals: { '2026': 1240, '2025': 87 },
      memories: (count) => `${count} memories`,
    });
    const y2026 = groups.find((group) => group.key === '2026');
    const y2025 = groups.find((group) => group.key === '2025');
    expect(y2026?.photos).toHaveLength(4);
    expect(y2026?.total).toBe(1240);
    expect(y2026?.sublabel).toBe('1240 memories');
    expect(y2025?.total).toBe(87);
  });

  it('falls back to the photos in hand where no total is given', () => {
    const groups = groupPhotos(fixturePhotos, 'year');
    expect(groups.find((group) => group.key === '2026')?.total).toBe(4);
    expect(groups.find((group) => group.key === '2026')?.sublabel).toBe('4 memories');
  });

  it('ignores a total for a period that is not in the feed', () => {
    const groups = groupPhotos(fixturePhotos, 'year', { totals: { '1998': 12 } });
    expect(groups.map((group) => group.key)).toEqual(['2026', '2025']);
  });
});

describe('groupPhotos', () => {
  it('orders photos newest-first by takenAt within each group', () => {
    const groups = groupPhotos(fixturePhotos, 'month');
    const august = groups.find((group) => group.label === 'August 2026');
    expect(august?.photos.map((p) => p.takenAt)).toEqual([
      FIXTURE_DATES.aug31,
      FIXTURE_DATES.aug26,
      FIXTURE_DATES.aug24,
    ]);
  });

  it('groups by year with newest-first labels', () => {
    const groups = groupPhotos(fixturePhotos, 'year');
    expect(groups.map((group) => group.label)).toEqual(['2026', '2025']);
  });

  it('groups by month with newest-first formatMonthLabel output', () => {
    const groups = groupPhotos(fixturePhotos, 'month');
    expect(groups.map((group) => group.label)).toEqual([
      'August 2026',
      'July 2026',
      'December 2025',
    ]);
  });

  it('groups same ISO week photos together with the Monday–Sunday label', () => {
    const groups = groupPhotos(fixturePhotos, 'week');
    const sharedWeek = groups.find((group) => group.photos.some((p) => p.id === 'aug24'));
    expect(sharedWeek?.photos.map((p) => p.id)).toEqual(['aug26', 'aug24']);
    expect(sharedWeek?.label).toBe('24–30 Aug 2026');
  });

  it('labels the week of 2026-08-31 as 31 Aug – 6 Sep 2026', () => {
    const groups = groupPhotos(fixturePhotos, 'week');
    const lastWeekOfAugust = groups.find((group) => group.photos.some((p) => p.id === 'aug31'));
    expect(lastWeekOfAugust?.label).toBe('31 Aug – 6 Sep 2026');
  });
});

describe('nearestGroupIndex', () => {
  it('finds the group containing a given takenAt', () => {
    const groups = groupPhotos(fixturePhotos, 'month');
    expect(nearestGroupIndex(groups, FIXTURE_DATES.jul15)).toBe(
      groups.findIndex((group) => group.label === 'July 2026'),
    );
    expect(nearestGroupIndex(groups, FIXTURE_DATES.aug26)).toBe(
      groups.findIndex((group) => group.label === 'August 2026'),
    );
  });

  it('finds the nearest group when takenAt is not an exact photo timestamp', () => {
    const groups = groupPhotos(fixturePhotos, 'month');
    expect(nearestGroupIndex(groups, '2026-07-20T10:00:00')).toBe(
      groups.findIndex((group) => group.label === 'July 2026'),
    );
  });
});

describe('groupIndexForPhoto', () => {
  const groups = groupPhotos(
    [
      photo('a', '2019-12-20T10:00:00'),
      photo('b', '2019-12-02T10:00:00'),
      photo('c', '2019-11-04T10:00:00'),
    ],
    'week',
  );

  it('names the group the photo is in', () => {
    expect(groupIndexForPhoto(groups, '2019-12-02T10:00:00')).toBe(1);
    expect(groupIndexForPhoto(groups, '2019-11-04T10:00:00')).toBe(2);
  });

  it('names the nearest group for a photo the feed does not hold', () => {
    // Inside the loaded range but not in the feed — a soft-deleted row, or one
    // the window's UTC edge left out. Landing nearby beats not landing.
    expect(groupIndexForPhoto(groups, '2019-12-03T10:00:00')).toBe(1);
  });

  it('answers -1 while the feed has not paged back that far', () => {
    expect(groupIndexForPhoto(groups, '2019-10-01T10:00:00')).toBe(-1);
  });

  it('answers -1 with nothing loaded and nothing asked for', () => {
    expect(groupIndexForPhoto([], '2019-12-02T10:00:00')).toBe(-1);
    expect(groupIndexForPhoto(groups, '')).toBe(-1);
  });
});
