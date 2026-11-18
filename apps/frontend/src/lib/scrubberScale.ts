/**
 * Maps dates to positions on the date scrubber's track, and back (ADR 0017).
 *
 * The track is built from the server's month histogram (`GET /api/timeline`),
 * so it spans the whole library rather than only the photos that happen to be
 * loaded. Top of the track is the newest month.
 *
 * It deliberately does not model pixel scroll height. Row heights come from
 * `justifyRows`, which packs by real photo aspect ratios, so a bucket's
 * rendered height is not derivable from its count. The scrubber is therefore a
 * date↔position mapping, and both the thumb position and a jump target go
 * through this same scale, which is what keeps them consistent with each
 * other.
 */

export interface HistogramBucket {
  /** Month key, `YYYY-MM`. */
  key: string;
  count: number;
}

export interface ScrubberSegment {
  key: string;
  count: number;
  /** Fraction of the track where this bucket begins. 0 is the newest end. */
  start: number;
  end: number;
}

export interface ScrubberScale {
  segments: ScrubberSegment[];
  /** Sum of the weights, not of the counts. Zero means an empty library. */
  total: number;
}

export interface YearTick {
  year: string;
  fraction: number;
}

/**
 * Track share per bucket.
 *
 * Square root, not the raw count: one holiday month with 10,000 photos would
 * otherwise take 99% of the track and make a quiet year impossible to point
 * at. Compressing keeps busy periods wider, where the extra precision is
 * actually wanted, without starving the sparse ones.
 */
function weigh(count: number): number {
  return Math.sqrt(count);
}

export function buildScrubberScale(buckets: HistogramBucket[]): ScrubberScale {
  const usable = buckets
    .filter((bucket) => bucket.count > 0 && bucket.key !== '')
    // Newest first, matching the timeline's own order.
    .sort((a, b) => b.key.localeCompare(a.key));

  const total = usable.reduce((sum, bucket) => sum + weigh(bucket.count), 0);
  if (total === 0) return { segments: [], total: 0 };

  let cursor = 0;
  const segments = usable.map((bucket) => {
    const start = cursor;
    cursor += weigh(bucket.count) / total;
    return { key: bucket.key, count: bucket.count, start, end: cursor };
  });
  // Absorb floating-point drift so the last segment ends exactly at 1.
  segments[segments.length - 1].end = 1;
  return { segments, total };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Midpoint of the bucket holding `key`, or of the nearest one that exists. */
export function fractionForKey(scale: ScrubberScale, key: string): number {
  const { segments } = scale;
  if (segments.length === 0) return 0;

  const exact = segments.find((segment) => segment.key === key);
  if (exact) return (exact.start + exact.end) / 2;

  // Segments are sorted newest-first, so the first key that is not newer than
  // the target is the nearest older bucket. Clamps at both ends.
  const older = segments.find((segment) => segment.key.localeCompare(key) <= 0);
  const target = older ?? segments[segments.length - 1];
  return (target.start + target.end) / 2;
}

/** Same, from a local capture clock such as `2026-03-14T09:30:00`. */
export function fractionForDate(scale: ScrubberScale, takenAtLocal: string): number {
  if (!takenAtLocal) return 0;
  return fractionForKey(scale, takenAtLocal.slice(0, 7));
}

/** The bucket under a position on the track. */
export function keyAtFraction(scale: ScrubberScale, fraction: number): string {
  const { segments } = scale;
  if (segments.length === 0) return '';
  const f = clamp01(fraction);
  const hit = segments.find((segment) => f >= segment.start && f < segment.end);
  // f === 1 falls past every half-open range, so it belongs to the oldest.
  return (hit ?? segments[segments.length - 1]).key;
}

/** One tick per year, at the top of that year's newest month. */
export function yearTicks(scale: ScrubberScale): YearTick[] {
  const ticks: YearTick[] = [];
  let lastYear = '';
  for (const segment of scale.segments) {
    const year = segment.key.slice(0, 4);
    if (year === lastYear) continue;
    lastYear = year;
    ticks.push({ year, fraction: segment.start });
  }
  return ticks;
}

/** Index of the segment under a position, for keyboard stepping. */
export function segmentIndexAtFraction(scale: ScrubberScale, fraction: number): number {
  const key = keyAtFraction(scale, fraction);
  const index = scale.segments.findIndex((segment) => segment.key === key);
  return index < 0 ? 0 : index;
}

/**
 * Which loaded Timeline Group a jump should land on.
 *
 * `groupMonths` is the month of each group's newest photo, newest-first.
 * Returns the newest group that is at or older than `monthKey`, or -1 when
 * every loaded group is newer — which is the caller's signal that it has to
 * page further back before it can scroll there.
 *
 * Nearest-by-distance is wrong here. Jumping to March with photos on 28
 * February and 31 March would pick February, because 1 March is a day from one
 * and a month from the other. "At or older than" is what the user asked for.
 */
export function groupIndexForMonth(groupMonths: string[], monthKey: string): number {
  if (!monthKey) return -1;
  return groupMonths.findIndex((month) => month !== '' && month.localeCompare(monthKey) <= 0);
}
