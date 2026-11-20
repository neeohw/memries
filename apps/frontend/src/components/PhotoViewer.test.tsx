import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createTranslator } from '../i18n/I18nProvider';
import { intlLocale } from '../i18n/locale';
import { formatCompactDate, formatTime } from '../lib/formatDate';
import { photoViewerAlt } from '../lib/photoName';
import { testPhoto } from '../test/fixtures';
import { PhotoViewer } from './PhotoViewer';

const photo = testPhoto();

describe('PhotoViewer', () => {
  it('names the dialog from TakenAt and describes the Original', () => {
    render(
      <PhotoViewer
        photos={[photo]}
        activeId={photo.id}
        origin={null}
        onClose={() => {}}
        onChange={() => {}}
        onToggleFavorite={() => {}}
        albums={[]}
        onAddToAlbum={() => {}}
      />,
    );
    const title = `${formatCompactDate(photo.takenAt)} · ${formatTime(photo.takenAt)}`;
    const dialog = screen.getByRole('dialog', { name: title });
    expect(dialog).toBeTruthy();
    expect(dialog).toHaveAttribute('aria-describedby', 'viewer-position');
    expect(screen.getByRole('heading', { level: 2, name: title })).toBeTruthy();
    expect(screen.getByRole('img')).toHaveAttribute(
      'alt',
      photoViewerAlt(photo, createTranslator('en'), intlLocale('en')),
    );
    expect(screen.getByRole('status')).toHaveTextContent('1 of 1');
    expect(screen.getByRole('button', { name: 'Close photo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add to favorites' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});
