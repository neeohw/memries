import { describe, expect, it } from 'vitest';
import type { Photo } from '../models/photo';
import { groupPhotos, nearestGroupIndex } from './groupPhotos';

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
