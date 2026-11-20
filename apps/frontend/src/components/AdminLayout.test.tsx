import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18nProvider';
import { AdminLayout } from './AdminLayout';

describe('AdminLayout', () => {
  it('offers both admin pages, Folders first', () => {
    render(
      <AdminLayout tab="folders" onTabChange={() => {}}>
        <p>page</p>
      </AdminLayout>,
    );
    const nav = screen.getByRole('navigation', { name: 'Admin sections' });
    const labels = Array.from(nav.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).toEqual(['Folders', 'Storage']);
  });

  it('marks the open section, and only that one', () => {
    render(
      <AdminLayout tab="settings" onTabChange={() => {}}>
        <p>page</p>
      </AdminLayout>,
    );
    expect(screen.getByRole('button', { name: 'Storage' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Folders' })).not.toHaveAttribute('aria-current');
  });

  it('reports the section the admin picked', () => {
    const onTabChange = vi.fn();
    render(
      <AdminLayout tab="folders" onTabChange={onTabChange}>
        <p>page</p>
      </AdminLayout>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Storage' }));
    expect(onTabChange).toHaveBeenCalledWith('settings');
  });

  it('renders the page below the strip', () => {
    render(
      <AdminLayout tab="folders" onTabChange={() => {}}>
        <h1>Folders</h1>
      </AdminLayout>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Folders' })).toBeTruthy();
  });

  it('renders in Dutch', () => {
    render(
      <I18nProvider locale="nl">
        <AdminLayout tab="folders" onTabChange={() => {}}>
          <p>page</p>
        </AdminLayout>
      </I18nProvider>,
    );
    expect(screen.getByRole('navigation', { name: 'Beheeronderdelen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mappen' })).toBeTruthy();
  });
});
