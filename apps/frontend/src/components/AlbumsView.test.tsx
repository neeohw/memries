import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { testAlbum } from '../test/fixtures';
import { AlbumsView } from './AlbumsView';

describe('AlbumsView', () => {
  it('uses a page heading and names Album cards', () => {
    render(
      <AlbumsView
        albums={[testAlbum({ name: 'Summer', photoCount: 2 })]}
        onCreate={() => {}}
        onOpen={() => {}}
        creating={false}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Albums' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New album' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open album Summer, 2 photos' })).toBeTruthy();
    expect(screen.getByRole('list')).toContainElement(
      screen.getByRole('button', { name: 'Open album Summer, 2 photos' }),
    );
  });

  it('announces when there are no Albums yet', () => {
    render(<AlbumsView albums={[]} onCreate={() => {}} onOpen={() => {}} creating={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('No albums yet.');
  });
});

describe('AlbumsView selection', () => {
  const albums = [
    testAlbum({ id: 'a1', name: 'Summer', photoCount: 2 }),
    testAlbum({ id: 'a2', name: 'Winter', photoCount: 1 }),
    testAlbum({ id: 'a3', name: 'Spring', photoCount: 3 }),
  ];

  function renderView(onDelete = vi.fn()) {
    render(
      <AlbumsView
        albums={albums}
        onCreate={() => {}}
        onOpen={vi.fn()}
        onDelete={onDelete}
        creating={false}
      />,
    );
    return onDelete;
  }

  function select(name: string) {
    fireEvent.click(screen.getByLabelText(`Select album ${name}`));
  }

  it('uses the same selector control as a photo tile', () => {
    // One way to select a thing in this app: a role=checkbox button with a
    // tick, not a raw input with a browser-drawn box.
    renderView();
    const box = screen.getByRole('checkbox', { name: 'Select album Summer' });
    expect(box.tagName).toBe('BUTTON');
    expect(box).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(box);
    expect(screen.getByRole('checkbox', { name: 'Deselect album Summer' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('keeps the selector out of the open button, which cannot nest', () => {
    renderView();
    const open = screen.getByRole('button', { name: 'Open album Summer, 2 photos' });
    expect(open.querySelector('[data-select-album]')).toBeNull();
  });

  it('offers no checkbox when deleting is not available', () => {
    render(<AlbumsView albums={albums} onCreate={() => {}} onOpen={() => {}} creating={false} />);
    expect(screen.queryByLabelText('Select album Summer')).toBeNull();
  });

  it('replaces the header with a count once something is selected', () => {
    renderView();
    expect(screen.getByRole('heading', { level: 1, name: 'Albums' })).toBeTruthy();

    select('Summer');
    expect(screen.getByRole('toolbar', { name: 'Selected albums' })).toBeTruthy();
    expect(screen.getByText('1 selected')).toBeTruthy();
    // The header's own action is gone while the selection is live.
    expect(screen.queryByRole('button', { name: 'New album' })).toBeNull();
  });

  it('asks before deleting, and names how many', () => {
    const onDelete = renderView();
    select('Summer');
    select('Winter');

    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 albums' }));
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 albums' }));
    expect(onDelete).toHaveBeenCalledWith(['a1', 'a2']);
  });

  it('backs out of the confirmation without deleting', () => {
    const onDelete = renderView();
    select('Summer');
    fireEvent.click(screen.getByRole('button', { name: 'Delete 1 album' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onDelete).not.toHaveBeenCalled();
    // Still selected, so a mis-click costs nothing.
    expect(screen.getByText('1 selected')).toBeTruthy();
  });

  it('clears the selection and puts the header back', () => {
    renderView();
    select('Summer');
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Albums' })).toBeTruthy();
  });

  it('clears on Escape', () => {
    renderView();
    select('Summer');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('toolbar', { name: 'Selected albums' })).toBeNull();
  });

  it('opens an album normally, but extends the selection once one is running', () => {
    const onOpen = vi.fn();
    render(
      <AlbumsView
        albums={albums}
        onCreate={() => {}}
        onOpen={onOpen}
        onDelete={vi.fn()}
        creating={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open album Summer, 2 photos' }));
    expect(onOpen).toHaveBeenCalledTimes(1);

    select('Winter');
    // The card's label now says what the click will do, rather than lying
    // about opening it.
    fireEvent.click(screen.getByRole('button', { name: 'Select album Summer, 2 photos' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByText('2 selected')).toBeTruthy();
  });

  it('sends the ids in list order, whatever order they were picked in', () => {
    const onDelete = renderView();
    select('Spring');
    select('Summer');
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 albums' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 albums' }));
    expect(onDelete).toHaveBeenCalledWith(['a1', 'a3']);
  });
});
