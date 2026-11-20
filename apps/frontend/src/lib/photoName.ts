import { formatDayLabel, formatTime } from './formatDate';

/**
 * "Wednesday, 15 March 2023, 09:00" in the reader's language.
 *
 * These labels are what a screen reader announces for every tile, so they
 * follow the interface language rather than staying English (ADR 0021).
 */
export function photoWhen(photo: { takenAt: string }, locale?: string): string {
  return `${formatDayLabel(photo.takenAt, locale)}, ${formatTime(photo.takenAt, locale)}`;
}

type T = (key: string, values?: Record<string, string | number>) => string;

export function photoOpenLabel(
  photo: { takenAt: string; favorite: boolean },
  t: T,
  locale?: string,
): string {
  const when = photoWhen(photo, locale);
  return t(photo.favorite ? 'photo.openFavorited' : 'photo.open', { when });
}

export function photoViewerAlt(
  photo: { takenAt: string; favorite: boolean; alt?: string },
  t: T,
  locale?: string,
): string {
  const name = photo.alt?.trim() ? photo.alt.trim() : t('photo.fallbackName');
  const when = photoWhen(photo, locale);
  return photo.favorite ? `${name}, ${when}, ${t('photo.favorited')}` : `${name}, ${when}`;
}

/**
 * Label for a tile's selection checkbox.
 *
 * Carries the capture time like the open label does. Several hundred
 * checkboxes reading "Select photo" would be indistinguishable to anything
 * navigating by label.
 */
export function photoSelectLabel(
  photo: { takenAt: string },
  selected: boolean,
  t: T,
  locale?: string,
): string {
  return t(selected ? 'photo.deselect' : 'photo.select', { when: photoWhen(photo, locale) });
}
