import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildScrubberScale, fractionForKey } from '../lib/scrubberScale';
import { Scrubber } from './Scrubber';

const BUCKETS = [
  { key: '2026-03', count: 10 },
  { key: '2026-02', count: 10 },
  { key: '2026-01', count: 10 },
  { key: '2025-12', count: 10 },
];

const scale = buildScrubberScale(BUCKETS);

/** The track reads its own box to turn a pointer position into a fraction. */
function stubTrackRect(top = 0, height = 400) {
  const slider = screen.getByRole('slider');
  vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
    top,
    height,
    bottom: top + height,
    left: 0,
    right: 32,
    width: 32,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect);
  return slider;
}

describe('Scrubber', () => {
  it('is a vertical slider that announces the month it is on', () => {
    render(<Scrubber scale={scale} value={fractionForKey(scale, '2026-02')} onSeek={() => {}} />);
    const slider = screen.getByRole('slider', { name: 'Jump to date' });
    expect(slider.getAttribute('aria-orientation')).toBe('vertical');
    expect(slider.getAttribute('aria-valuemin')).toBe('0');
    expect(slider.getAttribute('aria-valuemax')).toBe('3');
    expect(slider.getAttribute('aria-valuenow')).toBe('1');
    // A raw fraction means nothing read aloud; the month does.
    expect(slider.getAttribute('aria-valuetext')).toBe('February 2026');
  });

  it('renders one label per year, not per month', () => {
    render(<Scrubber scale={scale} value={0} onSeek={() => {}} revealed />);
    expect(screen.getByText('2026')).toBeTruthy();
    expect(screen.getByText('2025')).toBeTruthy();
    expect(screen.queryByText('2024')).toBeNull();
  });

  it('does not render for a library with a single month', () => {
    const { container } = render(
      <Scrubber
        scale={buildScrubberScale([{ key: '2026-01', count: 5 }])}
        value={0}
        onSeek={() => {}}
      />,
    );
    expect(container.querySelector('[data-scrubber]')).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
  });

  describe('keyboard', () => {
    // Up is newer. The track runs newest-first, so up means a lower index.
    it.each([
      ['ArrowUp', '2026-03'],
      ['ArrowDown', '2026-01'],
      ['Home', '2026-03'],
      ['End', '2025-12'],
      ['PageUp', '2026-03'],
      ['PageDown', '2025-12'],
    ])('%s seeks to %s', (key, expected) => {
      const onSeek = vi.fn();
      render(<Scrubber scale={scale} value={fractionForKey(scale, '2026-02')} onSeek={onSeek} />);
      fireEvent.keyDown(screen.getByRole('slider'), { key });
      expect(onSeek).toHaveBeenCalledWith(expected);
    });

    it('clamps at the ends instead of wrapping', () => {
      const onSeek = vi.fn();
      render(<Scrubber scale={scale} value={fractionForKey(scale, '2026-03')} onSeek={onSeek} />);
      fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowUp' });
      expect(onSeek).toHaveBeenCalledWith('2026-03');
    });

    it('ignores keys it does not own', () => {
      const onSeek = vi.fn();
      render(<Scrubber scale={scale} value={0} onSeek={onSeek} />);
      fireEvent.keyDown(screen.getByRole('slider'), { key: 'a' });
      fireEvent.keyDown(screen.getByRole('slider'), { key: 'Enter' });
      expect(onSeek).not.toHaveBeenCalled();
    });
  });

  describe('pointer', () => {
    it('seeks to the month under the pointer on release', () => {
      const onSeek = vi.fn();
      render(<Scrubber scale={scale} value={0} onSeek={onSeek} />);
      const slider = stubTrackRect(0, 400);
      slider.setPointerCapture = vi.fn();

      // 380 of 400 is 95% down a four-month track, so the oldest month.
      fireEvent.pointerDown(slider, { pointerId: 1, clientY: 380 });
      fireEvent.pointerUp(slider, { pointerId: 1, clientY: 380 });

      expect(onSeek).toHaveBeenCalledWith('2025-12');
    });

    // A live seek would kick off a fetch-forward for every month the pointer
    // crosses, so dragging only previews.
    it('previews while dragging and commits once on release', () => {
      const onSeek = vi.fn();
      render(<Scrubber scale={scale} value={0} onSeek={onSeek} />);
      const slider = stubTrackRect(0, 400);
      slider.setPointerCapture = vi.fn();

      fireEvent.pointerDown(slider, { pointerId: 1, clientY: 10 });
      fireEvent.pointerMove(slider, { pointerId: 1, clientY: 200 });
      fireEvent.pointerMove(slider, { pointerId: 1, clientY: 380 });
      expect(onSeek).not.toHaveBeenCalled();
      // The bubble follows the pointer, so the user sees where they are headed.
      expect(screen.getByText('December 2025')).toBeTruthy();

      fireEvent.pointerUp(slider, { pointerId: 1, clientY: 380 });
      expect(onSeek).toHaveBeenCalledTimes(1);
      expect(onSeek).toHaveBeenCalledWith('2025-12');
    });

    it('ignores a move that never started as a drag', () => {
      const onSeek = vi.fn();
      render(<Scrubber scale={scale} value={0} onSeek={onSeek} />);
      const slider = stubTrackRect();
      fireEvent.pointerMove(slider, { pointerId: 1, clientY: 200 });
      fireEvent.pointerUp(slider, { pointerId: 1, clientY: 200 });
      expect(onSeek).not.toHaveBeenCalled();
    });

    it('clamps a pointer dragged past either end', () => {
      const onSeek = vi.fn();
      render(<Scrubber scale={scale} value={0} onSeek={onSeek} />);
      const slider = stubTrackRect(0, 400);
      slider.setPointerCapture = vi.fn();

      fireEvent.pointerDown(slider, { pointerId: 1, clientY: -500 });
      fireEvent.pointerUp(slider, { pointerId: 1, clientY: -500 });
      expect(onSeek).toHaveBeenLastCalledWith('2026-03');

      fireEvent.pointerDown(slider, { pointerId: 1, clientY: 9999 });
      fireEvent.pointerUp(slider, { pointerId: 1, clientY: 9999 });
      expect(onSeek).toHaveBeenLastCalledWith('2025-12');
    });
  });

  it('marks itself busy while a jump is still loading photos', () => {
    render(<Scrubber scale={scale} value={0} onSeek={() => {}} seeking revealed />);
    expect(screen.getByRole('slider').getAttribute('aria-busy')).toBe('true');
  });

  it('drops the reveal transition under reduced motion', () => {
    const { container } = render(
      <Scrubber scale={scale} value={0} onSeek={() => {}} reducedMotion />,
    );
    const root = container.querySelector('[data-scrubber]');
    expect(root?.className).not.toContain('transition-opacity');
  });
});
