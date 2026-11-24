import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PhotoSelectionProvider, useSelectionState } from '../hooks/usePhotoSelection';
import { testPhoto } from '../test/fixtures';
import type { Photo } from '../models/photo';
import { PhotoCard } from './PhotoCard';

function Harness({ photo }: { photo: Photo }) {
  const selection = useSelectionState([photo.id]);
  return (
    <PhotoSelectionProvider value={selection}>
      <PhotoCard photo={photo} density="medium" onOpen={() => {}} />
    </PhotoSelectionProvider>
  );
}

function renderCard(photo: Photo) {
  return render(<Harness photo={photo} />);
}

describe('PhotoCard video badge', () => {
  // A poster frame is just a photo until something says otherwise.
  it('marks a clip and says how long it is', () => {
    const { container } = renderCard(testPhoto({ kind: 'video', durationMs: 222_000 }));
    const badge = container.querySelector('[data-video-badge]');
    expect(badge).toBeTruthy();
    expect(badge).toHaveTextContent('3:42');
    // A play glyph in the middle, where everyone already looks for one.
    expect(badge?.querySelector('svg')).toBeTruthy();
  });

  it('leaves a still alone', () => {
    const { container } = renderCard(testPhoto());
    expect(container.querySelector('[data-video-badge]')).toBeNull();
  });

  // A container that did not say how long it is still gets the play mark,
  // rather than a badge reading 0:00.
  it('shows the mark without a length when there is none', () => {
    const { container } = renderCard(testPhoto({ kind: 'video', durationMs: 0 }));
    const badge = container.querySelector('[data-video-badge]');
    expect(badge).toBeTruthy();
    expect(badge?.textContent?.trim()).toBe('');
  });
});
