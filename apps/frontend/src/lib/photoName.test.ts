import { describe, expect, it } from 'vitest';
import { createTranslator } from '../i18n/I18nProvider';
import { formatDayLabel, formatTime } from './formatDate';
import { photoOpenLabel, photoViewerAlt, photoWhen } from './photoName';

const photo = { takenAt: '2026-08-26T10:00:00', favorite: false, alt: 'Photo' };

const t = createTranslator('en');

describe('photoName', () => {
  it('joins the capture day and time', () => {
    expect(photoWhen(photo)).toBe(`${formatDayLabel(photo.takenAt)}, ${formatTime(photo.takenAt)}`);
  });

  it('names a timeline Photo control from TakenAt', () => {
    expect(photoOpenLabel(photo, t)).toBe(`Open photo, ${photoWhen(photo)}`);
    expect(photoOpenLabel({ ...photo, favorite: true }, t)).toBe(
      `Open favorited photo, ${photoWhen(photo)}`,
    );
  });

  it('describes the Original in the photo viewer', () => {
    expect(photoViewerAlt(photo, t)).toBe(`Photo, ${photoWhen(photo)}`);
    expect(photoViewerAlt({ ...photo, favorite: true }, t)).toBe(
      `Photo, ${photoWhen(photo)}, favorited`,
    );
  });
});
