import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18nProvider';
import type { ServerSettings } from '../lib/api';
import { SettingsView } from './SettingsView';

const settings: ServerSettings = {
  thumbnailRoot: '/data/cache',
  defaultThumbnailRoot: '/data/cache',
  allowedRoots: ['/data', '/mnt/disk'],
  freeBytes: 7_200_000_000,
};

function renderPage(overrides: Partial<Parameters<typeof SettingsView>[0]> = {}) {
  const props = { settings, onSave: vi.fn(), ...overrides };
  render(<SettingsView {...props} />);
  return props;
}

describe('SettingsView', () => {
  it('shows the current folder, the free space and where a folder may sit', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Server settings' })).toBeTruthy();
    expect(screen.getByDisplayValue('/data/cache')).toBeTruthy();
    expect(screen.getByText(/7\.2 GB free/)).toBeTruthy();
    expect(screen.getByText(/\/data, \/mnt\/disk/)).toBeTruthy();
  });

  it('says when the folder is the install default', () => {
    renderPage();
    expect(screen.getByText(/the install default/)).toBeTruthy();
  });

  it('cannot save until the path differs from the one in use', () => {
    renderPage();
    const save = screen.getByRole('button', { name: 'Save folder' });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Folder on the server'), {
      target: { value: '/mnt/disk/thumbs' },
    });
    expect(save).toBeEnabled();
  });

  it('reports the typed folder', () => {
    const props = renderPage();
    fireEvent.change(screen.getByLabelText('Folder on the server'), {
      target: { value: '  /mnt/disk/thumbs  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save folder' }));
    expect(props.onSave).toHaveBeenCalledWith('/mnt/disk/thumbs');
  });

  // An empty path is how the server restores the default, so the button
  // sends exactly that rather than the default path spelled out again.
  it('offers a way back to the default once the folder has moved', () => {
    const props = renderPage({
      settings: { ...settings, thumbnailRoot: '/mnt/disk/thumbs' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Back to the default' }));
    expect(props.onSave).toHaveBeenCalledWith('');
  });

  // "Back to the default" is not an answer if the default is invisible.
  it('names the default once the folder has been moved away from it', () => {
    renderPage({ settings: { ...settings, thumbnailRoot: '/media/sdhc/thumbs' } });
    expect(screen.getByText('Default: /data/cache')).toBeTruthy();
  });

  it('does not repeat the default while it is in use', () => {
    renderPage();
    expect(screen.queryByText(/^Default: /)).toBeNull();
  });

  it('hides the reset button while the default is in use', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: 'Back to the default' })).toBeNull();
  });

  // The server is the only thing that knows a path is unwritable or sits
  // inside a photo folder, so its words are shown rather than a generic line.
  it('shows the server message when a folder is refused', () => {
    renderPage({ saveError: '/etc is outside the allowed folders (/data)' });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('outside the allowed folders');
  });

  it('says that moving leaves the old thumbnails behind', () => {
    renderPage({ moved: true });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Thumbnails moved');
    expect(status.textContent).toMatch(/Scan a folder to generate them again/);
  });

  it('disables the form while saving', () => {
    renderPage({ saving: true });
    expect(screen.getByLabelText('Folder on the server')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  });

  it('reports a failure to load the settings', () => {
    render(<SettingsView loadError onSave={() => {}} />);
    expect(screen.getByText('Something went wrong.')).toBeTruthy();
  });

  it('renders in Dutch', () => {
    render(
      <I18nProvider locale="nl">
        <SettingsView settings={settings} onSave={() => {}} />
      </I18nProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Serverinstellingen' })).toBeTruthy();
    expect(screen.getByText(/7,2 GB vrij/)).toBeTruthy();
  });
});
