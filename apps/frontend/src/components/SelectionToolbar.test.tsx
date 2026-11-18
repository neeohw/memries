import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { testAlbum } from '../test/fixtures';
import { SelectionToolbar } from './SelectionToolbar';

const albums = [testAlbum({ id: 'a1', name: 'Summer' }), testAlbum({ id: 'a2', name: 'Winter' })];

function renderToolbar(overrides: Partial<Parameters<typeof SelectionToolbar>[0]> = {}) {
  const props = {
    count: 3,
    allFavorited: false,
    albums,
    onClear: vi.fn(),
    onFavorite: vi.fn(),
    onAddToAlbum: vi.fn(),
    ...overrides,
  };
  render(<SelectionToolbar {...props} />);
  return props;
}

describe('SelectionToolbar', () => {
  it('is a labelled toolbar that announces the count', () => {
    renderToolbar({ count: 3 });
    expect(screen.getByRole('toolbar', { name: 'Selected photos' })).toBeTruthy();
    const count = screen.getByText('3 selected');
    // Announced without moving focus, which a click on a tile would not do.
    expect(count.getAttribute('aria-live')).toBe('polite');
  });

  it('clears the selection', () => {
    const props = renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(props.onClear).toHaveBeenCalled();
  });

  // The control flips once everything selected is a favorite, so it is never
  // a no-op.
  it('adds favorites when some are not favorited', () => {
    const props = renderToolbar({ allFavorited: false });
    fireEvent.click(screen.getByRole('button', { name: 'Add to favorites' }));
    expect(props.onFavorite).toHaveBeenCalledWith(true);
  });

  it('removes favorites when all are already favorited', () => {
    const props = renderToolbar({ allFavorited: true });
    fireEvent.click(screen.getByRole('button', { name: 'Remove from favorites' }));
    expect(props.onFavorite).toHaveBeenCalledWith(false);
  });

  it('adds the selection to a chosen album', () => {
    const props = renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: 'Add to album' }));
    const menu = screen.getByRole('menu', { name: 'Albums' });
    expect(menu).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: /Winter/ }));
    expect(props.onAddToAlbum).toHaveBeenCalledWith('a2');
    // The menu closes behind the choice.
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('offers no album menu when there are no albums', () => {
    renderToolbar({ albums: [] });
    const button = screen.getByRole('button', { name: 'Add to album' });
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.click(button);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('disables the actions while a batch is in flight', () => {
    renderToolbar({ busy: true });
    expect(screen.getByRole('button', { name: 'Add to favorites' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: 'Add to album' }).hasAttribute('disabled')).toBe(
      true,
    );
    // Clearing must stay available, or a stuck batch traps the reader.
    expect(screen.getByRole('button', { name: 'Clear selection' }).hasAttribute('disabled')).toBe(
      false,
    );
  });
});
