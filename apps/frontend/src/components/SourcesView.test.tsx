import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Source } from '../models/source';
import { SourcesView } from './SourcesView';

const nas: Source = {
  id: '7',
  name: 'NAS',
  type: 'webdav',
  location: 'https://dav.example.com/photos',
  username: 'me',
  hasPassword: true,
  excludes: [],
  updatedAt: '2026-09-22T10:00:00Z',
};

function renderView(overrides: Partial<Parameters<typeof SourcesView>[0]> = {}) {
  const props = {
    sources: [nas],
    loading: false,
    loadError: false,
    onCreate: vi.fn(async () => {}),
    onUpdate: vi.fn(async () => {}),
    onDelete: vi.fn(async () => {}),
    onScan: vi.fn(async () => {}),
    ...overrides,
  };
  render(<SourcesView {...props} />);
  return props;
}

describe('SourcesView', () => {
  it('lists connected folders under a page heading', () => {
    renderView();
    expect(screen.getByRole('heading', { level: 1, name: 'Folders' })).toBeTruthy();
    expect(screen.getByRole('article', { name: 'NAS' })).toHaveTextContent(
      'https://dav.example.com/photos',
    );
    expect(screen.getByRole('button', { name: 'Scan now' })).toBeTruthy();
  });

  it('announces an empty list', () => {
    renderView({ sources: [] });
    expect(screen.getByRole('status')).toHaveTextContent('No photo folders are connected yet.');
  });

  it('adds a WebDAV folder with credentials for the signed-in owner', async () => {
    const props = renderView({ sources: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
    fireEvent.click(screen.getByRole('radio', { name: 'WebDAV' }));
    fireEvent.change(screen.getByRole('textbox', { name: /URL/ }), {
      target: { value: 'https://dav.example.com/Photos' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Username' }), {
      target: { value: 'me' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect folder' }));
    await waitFor(() => expect(props.onCreate).toHaveBeenCalledTimes(1));
    expect(props.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'webdav',
        location: 'https://dav.example.com/Photos',
        username: 'me',
        password: 'pw',
      }),
    );
  });

  it('shows the server reason when a connection check fails', async () => {
    renderView({
      sources: [],
      onCreate: vi.fn(async () => {
        throw new Error('invalid source: cannot read https://dav/x: access denied');
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
    fireEvent.click(screen.getByRole('radio', { name: 'WebDAV' }));
    fireEvent.change(screen.getByRole('textbox', { name: /URL/ }), {
      target: { value: 'https://dav/x' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect folder' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'cannot read https://dav/x: access denied',
    );
  });

  it('confirms before removing a folder', async () => {
    const props = renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(props.onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove and hide its photos' }));
    await waitFor(() => expect(props.onDelete).toHaveBeenCalledWith('7'));
  });

  it('keeps the stored password when editing without typing one', async () => {
    const props = renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('placeholder', 'Leave blank to keep');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledTimes(1));
    expect(props.onUpdate).toHaveBeenCalledWith(
      '7',
      expect.objectContaining({ password: undefined }),
    );
  });
});
