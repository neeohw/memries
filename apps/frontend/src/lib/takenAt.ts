/**
 * Capture-time helpers. Prefer EXIF wall-clock strings and never run them
 * through `Date` / the machine timezone (that shifts e.g. 17:34 into 15:34Z).
 *
 * Tag order used when reading EXIF wall clocks:
 *   1. DateTimeOriginal
 *   2. CreateDate
 *   3. DateTimeDigitized
 *   4. DateCreated (XMP)
 *   5. PNG tEXt "Creation Time"
 *   6. file mtime (UTC components) — last resort only
 */
export const TAKEN_AT_TAG_ORDER = [
  'DateTimeOriginal',
  'CreateDate',
  'DateTimeDigitized',
  'DateCreated',
  'Creation Time',
] as const;

const EXIF_CLOCK = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
const RFC_CLOCK =
  /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\b/i;

const MONTHS: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** `2024:08:25 18:30:01` → `2024-08-25T18:30:01` (subseconds dropped). */
export function wallClockFromExifValue(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  const iso = text.match(EXIF_CLOCK);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}T${iso[4]}:${iso[5]}:${iso[6]}`;
  }
  const rfc = text.match(RFC_CLOCK);
  if (!rfc) return null;
  const month = MONTHS[rfc[2].slice(0, 3).toLowerCase()];
  if (!month) return null;
  return `${rfc[3]}-${month}-${rfc[1].padStart(2, '0')}T${rfc[4]}:${rfc[5]}:${rfc[6]}`;
}

export function takenAtFromUtcDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

/**
 * The 1 January after the year a wall clock falls in, as `YYYY-01-01`, or `''`
 * when there is no year to read.
 *
 * This is the feed's upper bound when drilling out of year view (ADR 0031).
 * The whole of the clicked year sits above the reader, so a week reached by
 * opening a photo from July can still be scrolled back up to December. Landing
 * on the photo is paging's job, not the bound's.
 *
 * No arithmetic on `Date`: four digits in, four digits out, so the machine
 * timezone cannot shift a year boundary the way it shifts a clock.
 */
export function yearCeiling(takenAt: string): string {
  const head = takenAt.slice(0, 4);
  if (!/^\d{4}$/.test(head)) return '';
  const year = Number(head);
  // The server's own ceiling is the year 2100 (`parseRange`), and a bound it
  // cannot parse is a 400 rather than a wider feed.
  if (year >= 9999) return '';
  return `${year + 1}-01-01`;
}
