/**
 * Dates rendered in the reader's language (ADR 0021).
 *
 * Every formatter takes an optional BCP 47 `locale`. Passing it explicitly
 * rather than reading a module-level "current language" keeps these pure:
 * a label is a function of its inputs, and a test does not depend on what
 * some other test set last.
 *
 * Omitted, the locale is the browser's, which is what these did before a
 * language could be chosen.
 */

export function addMinutes(isoLocal: string, minutes: number): string {
  const [datePart, timePart] = isoLocal.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.slice(0, 5).split(':').map(Number);
  let total = hour * 60 + minute + minutes;
  const dayDelta = Math.floor(total / 1440);
  total = ((total % 1440) + 1440) % 1440;
  const utc = Date.UTC(year, month - 1, day + dayDelta);
  const next = new Date(utc);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}T${pad(hh)}:${pad(mm)}:00`;
}

export function formatDayLabel(isoDate: string, locale?: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatMonthLabel(yearMonth: string, locale?: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatTime(takenAt: string, locale?: string): string {
  return new Date(`${takenAt}Z`).toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

export function formatCompactDate(takenAt: string, locale?: string): string {
  const [y, m, d] = takenAt.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function isoWeekParts(isoLocal: string): { year: number; week: number } {
  const [y, m, d] = isoLocal.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const year = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year, week };
}

export function mondayOfIsoWeek(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (day - 1) + (week - 1) * 7);
  return monday;
}

export function formatWeekLabel(key: string, locale?: string): string {
  const [yearStr, weekStr] = key.split('-W');
  const year = Number(yearStr);
  const week = Number(weekStr);
  const start = mondayOfIsoWeek(year, week);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const startDay = start.getUTCDate();
  const endDay = end.getUTCDate();
  // Month names come from Intl rather than a hard-coded English list, so a
  // week range reads as "13–19 mrt 2023" in Dutch.
  const month = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
  const startMonth = month.format(start);
  const endMonth = month.format(end);
  if (
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCFullYear() === end.getUTCFullYear()
  ) {
    return `${startDay}–${endDay} ${startMonth} ${year}`;
  }
  if (start.getUTCFullYear() === end.getUTCFullYear()) {
    return `${startDay} ${startMonth} – ${endDay} ${endMonth} ${year}`;
  }
  return `${startDay} ${startMonth} ${start.getUTCFullYear()} – ${endDay} ${endMonth} ${end.getUTCFullYear()}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
