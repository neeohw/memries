import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../hooks/useTheme';
import { AppShell } from './AppShell';

function renderShell(props: Partial<React.ComponentProps<typeof AppShell>> = {}): {
  onTabChange: ReturnType<typeof vi.fn>;
} {
  const onTabChange = vi.fn();
  render(
    <ThemeProvider>
      <AppShell tab="memories" onTabChange={onTabChange} {...props}>
        <h1>Your memries</h1>
      </AppShell>
    </ThemeProvider>,
  );
  return { onTabChange };
}

describe('AppShell', () => {
  it('exposes a main landmark and a skip link', () => {
    renderShell();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#main-content',
    );
    expect(screen.getByRole('main')).toContainElement(
      screen.getByRole('heading', { level: 1, name: 'Your memries' }),
    );
  });

  it('keeps the brand out of the heading outline', () => {
    renderShell();
    expect(screen.getAllByText('Memries').length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Memries' })).toBeNull();
  });

  it('names the primary navigation', () => {
    renderShell();
    expect(screen.getAllByRole('navigation', { name: 'Main' }).length).toBeGreaterThan(0);
  });

  // Browsing tabs only. Folders was a nav tab beside Memories and Albums,
  // which put server administration next to browsing (ADR 0024).
  it('keeps administration out of the main navigation', () => {
    renderShell({ admin: true });
    for (const label of ['Memories', 'Favorites', 'Albums']) {
      expect(screen.getAllByRole('button', { name: label }).length).toBeGreaterThan(0);
    }
    expect(screen.queryByRole('button', { name: 'Folders' })).toBeNull();
  });

  it('shows the admin gear only to an admin', () => {
    renderShell({ admin: true });
    expect(screen.getAllByRole('button', { name: 'Server settings' }).length).toBeGreaterThan(0);
  });

  it('hides the admin gear from a reader', () => {
    renderShell();
    expect(screen.queryByRole('button', { name: 'Server settings' })).toBeNull();
  });

  // The gear lands on Folders: adding and scanning folders is what an admin
  // opens this area to do, where the storage path is set once.
  it('opens the admin area at Folders', () => {
    const { onTabChange } = renderShell({ admin: true });
    fireEvent.click(screen.getAllByRole('button', { name: 'Server settings' })[0]);
    expect(onTabChange).toHaveBeenCalledWith('folders');
  });

  it('marks the gear as current while the admin page is open', () => {
    render(
      <ThemeProvider>
        <AppShell tab="folders" admin onTabChange={() => {}}>
          <h1>Admin</h1>
        </AppShell>
      </ThemeProvider>,
    );
    expect(screen.getAllByRole('button', { name: 'Server settings' })[0]).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('always offers the account page', () => {
    renderShell();
    expect(screen.getAllByRole('button', { name: 'Account settings' }).length).toBeGreaterThan(0);
  });
});
