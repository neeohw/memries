import { formatMonthLabel, formatWeekLabel, isoWeekParts } from './formatDate';
import type { Granularity, Photo, TimelineGroup } from '../models/photo';

export function groupKey(takenAt: string, granularity: Granularity): string {
  if (granularity === 'year') return takenAt.slice(0, 4);
  if (granularity === 'month') return takenAt.slice(0, 7);
  const { year, week } = isoWeekParts(takenAt);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function groupLabel(key: string, granularity: Granularity): string {
  if (granularity === 'year') return key;
  if (granularity === 'month') return formatMonthLabel(key);
  return formatWeekLabel(key);
}

export function groupPhotos(photos: Photo[], granularity: Granularity): TimelineGroup[] {
  const sorted = [...photos].sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  const buckets = new Map<string, Photo[]>();
  for (const photo of sorted) {
    const key = groupKey(photo.takenAt, granularity);
    const list = buckets.get(key);
    if (list) list.push(photo);
    else buckets.set(key, [photo]);
  }
  return [...buckets.entries()].map(([key, groupPhotos]) => ({
    key,
    label: groupLabel(key, granularity),
    sublabel: `${groupPhotos.length} ${groupPhotos.length === 1 ? 'memory' : 'memories'}`,
    photos: groupPhotos,
  }));
}

export function photoFacets(photos: Photo[]): { years: string[] } {
  const years = new Set<string>();
  for (const photo of photos) {
    years.add(photo.takenAt.slice(0, 4));
  }
  return {
    years: [...years].sort((a, b) => b.localeCompare(a)),
  };
}

export function searchPhotos(
  photos: Photo[],
  opts: {
    query: string;
    places?: string[];
    years: string[];
    favoritesOnly: boolean;
  },
): Photo[] {
  const places = opts.places ?? [];
  return photos.filter((photo) => {
    if (opts.favoritesOnly && !photo.favorite) return false;
    if (places.length && photo.location !== undefined && !places.includes(photo.location))
      return false;
    if (places.length && !photo.location) return false;
    if (opts.years.length && !opts.years.includes(photo.takenAt.slice(0, 4))) return false;
    return true;
  });
}

export function nearestGroupIndex(groups: TimelineGroup[], takenAt: string): number {
  if (groups.length === 0) return 0;
  const exact = groups.findIndex((group) =>
    group.photos.some((photo) => photo.takenAt === takenAt),
  );
  if (exact >= 0) return exact;
  const t = takenAt;
  let best = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  groups.forEach((group, index) => {
    const sample = group.photos[0]?.takenAt ?? '';
    const numeric = Math.abs(toStamp(sample) - toStamp(t));
    if (numeric < bestDelta) {
      bestDelta = numeric;
      best = index;
    }
  });
  return best;
}

function toStamp(isoLocal: string): number {
  return Date.parse(`${isoLocal}Z`);
}
