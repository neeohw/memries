import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IndexingScreen } from './IndexingScreen';

function splash(): HTMLElement {
  return screen.getByRole('status');
}

describe('IndexingScreen', () => {
  it('stops eating clicks as soon as it starts fading', () => {
    // It stays mounted for 420ms after the fade, as a full-screen z-40
    // overlay. Without this, a click in that window is swallowed by something
    // the reader cannot see — which is exactly how it failed under load.
    render(<IndexingScreen leaving onExited={() => {}} />);
    expect(splash()).toHaveClass('pointer-events-none');
    expect(splash()).toHaveClass('opacity-0');
  });

  it('keeps accepting clicks while it is still the whole screen', () => {
    const onRetry = vi.fn();
    render(<IndexingScreen leaving={false} onExited={() => {}} onRetry={onRetry} loadError />);
    expect(splash()).not.toHaveClass('pointer-events-none');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  // A scan is minutes of a single-board computer, so whoever started it can
  // call it off from the screen that is showing it (ADR 0004).
  it('offers a way to stop the run it is showing', () => {
    const onStop = vi.fn();
    render(<IndexingScreen leaving={false} onExited={() => {}} onStop={onStop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop the scan' }));
    expect(onStop).toHaveBeenCalled();
  });

  it('says so while the stop is in flight, and does not ask twice', () => {
    const onStop = vi.fn();
    render(<IndexingScreen leaving={false} onExited={() => {}} onStop={onStop} stopping />);
    const button = screen.getByRole('button', { name: 'Stopping…' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onStop).not.toHaveBeenCalled();
  });

  // Nothing running, nothing to stop: App withholds the handler rather than
  // showing a button that would do nothing.
  it('shows no stop button without a handler', () => {
    render(<IndexingScreen leaving={false} onExited={() => {}} />);
    expect(screen.queryByRole('button', { name: /stop/i })).toBeNull();
  });

  it('waits for the fade before exiting, rather than exiting at once', () => {
    const onExited = vi.fn();
    render(<IndexingScreen leaving onExited={onExited} />);
    // The gap between this and the unmount is the window the class above
    // exists to cover.
    expect(onExited).not.toHaveBeenCalled();
    expect(splash()).toHaveClass('opacity-0');
  });
});
