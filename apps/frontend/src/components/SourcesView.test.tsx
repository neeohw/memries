import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FolderPreview, Source } from '../models/source';
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

const emptyPreview: FolderPreview = {
  name: 'Photos',
  location: '/data/photos',
  photos: 0,
  skipped: 0,
  others: 0,
  folders: 0,
  truncated: false,
  tree: null,
};

function renderView(overrides: Partial<Parameters<typeof SourcesView>[0]> = {}) {
  const props = {
    sources: [nas],
    roots: ['/data/photos'],
    loading: false,
    loadError: false,
    onCreate: vi.fn(async () => {}),
    onUpdate: vi.fn(async () => {}),
    onDelete: vi.fn(async () => {}),
    onScan: vi.fn(async () => {}),
    onPreview: vi.fn(async () => emptyPreview),
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
  // The dry run is the step before connecting: it reports, and nothing else
  // happens (ADR 0027).
  it('previews a folder without connecting it', async () => {
    const props = renderView({
      sources: [],
      onPreview: vi.fn(async () => ({
        ...emptyPreview,
        photos: 42,
        folders: 2,
        tree: {
          name: 'photos',
          path: '',
          photos: 0,
          total: 42,
          children: [{ name: '2019', path: '2019', photos: 42, total: 42, children: [], more: 0 }],
          more: 0,
        },
      })),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Folder/ }), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(await screen.findByRole('region', { name: 'What a scan would add' })).toHaveTextContent(
      '42',
    );
    expect(props.onPreview).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ location: '/data/photos' }),
    );
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  it('previews the folder being edited, so the stored password is reused', async () => {
    const props = renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() =>
      expect(props.onPreview).toHaveBeenCalledWith(
        '7',
        expect.objectContaining({ password: undefined }),
      ),
    );
    expect(props.onUpdate).not.toHaveBeenCalled();
  });

  it('shows the server reason when a dry run cannot read the folder', async () => {
    renderView({
      sources: [],
      onPreview: vi.fn(async () => {
        throw new Error('invalid source: cannot read /data/photos/nope: no such folder');
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Folder/ }), {
      target: { value: 'nope' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no such folder');
  });
  // The folder is written relative to a server root, which the form shows
  // rather than asks for: a path outside it used to be a rejection you only
  // met after pressing Connect (ADR 0013).
  it('writes a local folder under the server root it shows', async () => {
    const props = renderView({ sources: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));

    const form = screen.getByRole('form', { name: 'Add folder' });
    expect(form.querySelector('[data-source-root]')).toHaveTextContent('/data/photos/');
    expect(form).toHaveTextContent('This server reads photos under /data/photos and nowhere else.');

    fireEvent.change(screen.getByRole('textbox', { name: /Folder/ }), {
      target: { value: 'backup iPhone XS' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect folder' }));
    await waitFor(() => expect(props.onCreate).toHaveBeenCalledTimes(1));
    expect(props.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ location: '/data/photos/backup iPhone XS' }),
    );
  });

  // Pasting the whole path into a field that already shows the prefix is the
  // obvious mistake; it must not double the root.
  it('absorbs a pasted absolute path', async () => {
    const props = renderView({ sources: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Folder/ }), {
      target: { value: '/data/photos/2019' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect folder' }));
    await waitFor(() =>
      expect(props.onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ location: '/data/photos/2019' }),
      ),
    );
  });

  // An empty field is the root itself, so Connect stays available — the
  // common case of "index everything in there" needs nothing typed.
  it('reads an empty folder field as the whole root', async () => {
    const props = renderView({ sources: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
    const connect = screen.getByRole('button', { name: 'Connect folder' });
    expect(connect).not.toBeDisabled();
    fireEvent.click(connect);
    await waitFor(() =>
      expect(props.onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ location: '/data/photos' }),
      ),
    );
  });

  it('shows the folder under its own root when editing', () => {
    renderView({
      sources: [{ ...nas, type: 'local', location: '/media/sdhc/2019', hasPassword: false }],
      roots: ['/data/photos', '/media/sdhc'],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit NAS' });
    expect(form.querySelector('[data-source-root]')).toHaveTextContent('/media/sdhc/');
    expect(screen.getByRole('textbox', { name: /Folder/ })).toHaveValue('2019');
    // With more than one root, which one is in use is a choice, not a label.
    expect(screen.getByRole('button', { name: '/media/sdhc' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  // A folder saved before the roots changed still has to be editable, so it
  // falls back to a plain absolute field that says what is wrong.
  it('falls back to an absolute field for a folder outside every root', () => {
    renderView({
      sources: [{ ...nas, type: 'local', location: '/srv/old', hasPassword: false }],
      roots: ['/data/photos'],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit NAS' });
    expect(form.querySelector('[data-source-root]')).toBeNull();
    expect(screen.getByRole('textbox', { name: /Folder/ })).toHaveValue('/srv/old');
    expect(form).toHaveTextContent('outside /data/photos');
  });

  // Nothing to be relative to: the field is the whole path, as it was.
  it('takes an absolute path when the server configured no roots', async () => {
    const props = renderView({ sources: [], roots: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
    expect(screen.getByRole('button', { name: 'Connect folder' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: /Folder/ }), {
      target: { value: '/srv/photos' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect folder' }));
    await waitFor(() =>
      expect(props.onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ location: '/srv/photos' }),
      ),
    );
  });
  // The two location fields hold different things, so switching type must not
  // leave a server path sitting in the URL box over its example.
  it('clears the location when the kind of folder changes', () => {
    renderView({ sources: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Folder/ }), {
      target: { value: 'holidays' },
    });

    fireEvent.click(screen.getByRole('radio', { name: 'WebDAV' }));
    const url = screen.getByRole('textbox', { name: /URL/ });
    expect(url).toHaveValue('');
    expect(url).toHaveAttribute(
      'placeholder',
      'https://cloud.example.com/remote.php/dav/files/me/Photos',
    );

    fireEvent.change(url, { target: { value: 'https://dav.example.com/Photos' } });
    fireEvent.click(screen.getByRole('radio', { name: 'On this server' }));
    expect(screen.getByRole('textbox', { name: /Folder/ })).toHaveValue('');
  });
});
