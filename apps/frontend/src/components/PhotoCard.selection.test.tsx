import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PhotoSelectionProvider, useSelectionState } from '../hooks/usePhotoSelection';
import { testPhoto } from '../test/fixtures';
import { PhotoCard } from './PhotoCard';

const PHOTOS = [
  testPhoto({ id: 'p1', takenAt: '2026-03-03T10:00:00' }),
  testPhoto({ id: 'p2', takenAt: '2026-03-02T10:00:00' }),
  testPhoto({ id: 'p3', takenAt: '2026-03-01T10:00:00' }),
];

/**
 * Timeline composes these through virtua, which renders nothing in jsdom, so
 * the selection behaviour is exercised here against a real provider instead.
 */
function Harness({ onOpen }: { onOpen?: (photo: unknown, origin: HTMLElement) => void }) {
  const selection = useSelectionState(PHOTOS.map((p) => p.id));
  return (
    <PhotoSelectionProvider value={selection}>
      <p data-testid="count">{selection.count}</p>
      <p data-testid="ids">{selection.ids.join(',')}</p>
      {PHOTOS.map((photo) => (
        <PhotoCard
          key={photo.id}
          photo={photo}
          density="medium"
          size={{ width: 100, height: 80 }}
          onOpen={onOpen ?? (() => {})}
        />
      ))}
    </PhotoSelectionProvider>
  );
}

const boxes = () => screen.getAllByRole('checkbox');
const count = () => screen.getByTestId('count').textContent;

describe('PhotoCard selection', () => {
  it('offers an unchecked checkbox per tile', () => {
    render(<Harness />);
    expect(boxes()).toHaveLength(3);
    for (const box of boxes()) {
      expect(box.getAttribute('aria-checked')).toBe('false');
      // Each label carries the capture time, so several hundred checkboxes
      // are not all called the same thing.
      expect(box.getAttribute('aria-label')).toMatch(/^Select photo, /);
    }
  });

  it('checks and unchecks a tile', () => {
    render(<Harness />);
    fireEvent.click(boxes()[0]);
    expect(count()).toBe('1');
    expect(boxes()[0].getAttribute('aria-checked')).toBe('true');
    expect(boxes()[0].getAttribute('aria-label')).toMatch(/^Deselect photo, /);

    fireEvent.click(boxes()[0]);
    expect(count()).toBe('0');
  });

  it('selects a range on shift-click', () => {
    render(<Harness />);
    fireEvent.click(boxes()[0]);
    fireEvent.click(boxes()[2], { shiftKey: true });
    expect(count()).toBe('3');
  });

  // Library order, not click order, so the batch request is predictable.
  it('reports the selection in library order', () => {
    render(<Harness />);
    fireEvent.click(boxes()[2]);
    fireEvent.click(boxes()[0]);
    expect(screen.getByTestId('ids').textContent).toBe('p1,p3');
  });

  it('opens the viewer on a tile click when nothing is selected', () => {
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} />);
    fireEvent.click(screen.getAllByRole('button', { name: /Open photo/ })[0]);
    expect(onOpen).toHaveBeenCalled();
    expect(count()).toBe('0');
  });

  // Once a selection is running a plain tile click extends it, which is the
  // modal behaviour Google Photos has.
  it('toggles instead of opening once a selection is running', () => {
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} />);
    fireEvent.click(boxes()[0]);

    const tiles = screen.getAllByRole('button', { name: /^Select photo, / });
    fireEvent.click(tiles[0]);
    expect(count()).toBe('2');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('relabels the tile to say what the click will do', () => {
    render(<Harness />);
    expect(screen.getAllByRole('button', { name: /Open photo/ })).toHaveLength(3);
    fireEvent.click(boxes()[0]);
    // One tile is now deselectable, the other two selectable.
    expect(screen.getAllByRole('button', { name: /^Deselect photo, / }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /^Select photo, / }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Open photo/ })).toBeNull();
  });

  it('keeps the checkbox out of the tile button, which cannot nest', () => {
    render(<Harness />);
    const box = boxes()[0];
    expect(box.closest('button[aria-label^="Open photo"]')).toBeNull();
  });
});
