import { formatDayLabel, formatTime } from './formatDate';

export function photoWhen(photo: { takenAt: string }): string {
  return `${formatDayLabel(photo.takenAt)}, ${formatTime(photo.takenAt)}`;
}

export function photoOpenLabel(photo: { takenAt: string; favorite: boolean }): string {
  const when = photoWhen(photo);
  return photo.favorite ? `Open favorited photo, ${when}` : `Open photo, ${when}`;
}

export function photoViewerAlt(photo: {
  takenAt: string;
  favorite: boolean;
  alt?: string;
}): string {
  const name = photo.alt?.trim() ? photo.alt.trim() : 'Photo';
  const when = photoWhen(photo);
  return photo.favorite ? `${name}, ${when}, favorited` : `${name}, ${when}`;
}

/**
 * Label for a tile's selection checkbox.
 *
 * Carries the capture time like the open label does. Several hundred
 * checkboxes reading "Select photo" would be indistinguishable to anything
 * navigating by label.
 */
export function photoSelectLabel(photo: { takenAt: string }, selected: boolean): string {
  return `${selected ? 'Deselect' : 'Select'} photo, ${photoWhen(photo)}`;
}
