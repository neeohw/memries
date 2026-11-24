import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testPhoto } from '../test/fixtures';
import { VideoStage } from './VideoStage';

const clip = testPhoto({
  id: 'v1',
  kind: 'video',
  durationMs: 12000,
  imageUrl: '/api/original/v1',
});

describe('VideoStage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('plays the original, with the poster frame up front', () => {
    const { container } = render(<VideoStage photo={clip} />);
    const video = container.querySelector('video');
    expect(video).toBeTruthy();
    expect(video).toHaveAttribute('src', '/api/original/v1');
    expect(video).toHaveAttribute('poster', clip.thumbnailUrl);
    expect(video).toHaveAttribute('controls');
  });

  // Pressing a tile with a play mark on it is a request to watch; making
  // someone press play twice is a tax on the obvious case.
  it('starts playing on its own', async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play);

    const { container } = render(<VideoStage photo={clip} />);
    expect(container.querySelector('video')).toHaveAttribute('autoplay');
    await waitFor(() => expect(play).toHaveBeenCalled());
    // With sound, unless the browser objects.
    expect(container.querySelector('video')!.muted).toBe(false);
  });

  // A browser may refuse a clip with sound, and refuses by rejecting a
  // promise rather than raising an error — which would otherwise read as a
  // frozen poster.
  it('mutes and retries when the browser blocks sound, and says so', async () => {
    let attempt = 0;
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new DOMException('blocked', 'NotAllowedError'))
        : Promise.resolve();
    });

    const { container } = render(<VideoStage photo={clip} />);
    await waitFor(() => expect(attempt).toBe(2));
    await waitFor(() => expect(screen.getByText(/Started muted/)).toBeTruthy());
    expect(container.querySelector('video')!.muted).toBe(true);
  });

  // Blocked twice is the browser's final word: leave the controls to the
  // reader rather than looping.
  it('gives up after the muted retry', async () => {
    let attempt = 0;
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => {
      attempt += 1;
      return Promise.reject(new DOMException('blocked', 'NotAllowedError'));
    });
    render(<VideoStage photo={clip} />);
    await waitFor(() => expect(attempt).toBe(2));
    expect(screen.queryByText(/Started muted/)).toBeNull();
  });

  // canPlayType lies about .mov in Chromium, so the verdict comes from the
  // error event rather than from asking in advance.
  it('offers the original when the browser cannot play it', () => {
    const { container } = render(<VideoStage photo={clip} />);
    fireEvent.error(container.querySelector('video')!);

    expect(screen.getByRole('alert')).toHaveTextContent('cannot play this clip');
    const link = screen.getByRole('link', { name: 'Download the original' });
    expect(link).toHaveAttribute('href', '/api/original/v1');
    expect(link).toHaveAttribute('download');
    expect(container.querySelector('video')).toBeNull();
  });

  // One clip failing says nothing about the next one.
  it('gives the next clip a fresh verdict', () => {
    const { container, rerender } = render(<VideoStage photo={clip} />);
    fireEvent.error(container.querySelector('video')!);
    expect(screen.getByRole('alert')).toBeTruthy();

    rerender(<VideoStage photo={testPhoto({ id: 'v2', kind: 'video' })} />);
    expect(container.querySelector('video')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
