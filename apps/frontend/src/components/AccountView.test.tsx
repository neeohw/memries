import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18nProvider';
import { AccountView } from './AccountView';
import { FavoritesView } from './FavoritesView';

function renderPage(overrides: Partial<Parameters<typeof AccountView>[0]> = {}) {
  const props = {
    email: 'maarten@example.com',
    locale: '',
    onLocaleChange: vi.fn(),
    onSignOut: vi.fn(),
    ...overrides,
  };
  render(<AccountView {...props} />);
  return props;
}

describe('AccountView', () => {
  it('is a page with a heading, not a control in the chrome', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Account' })).toBeTruthy();
  });

  it('offers the browser default first, then each language in its own name', () => {
    renderPage();
    const options = screen.getAllByRole('radio').map((o) => o.textContent);
    // "Nederlands", not "Dutch": someone looking for their own language
    // scans for the word they would write themselves.
    expect(options).toEqual(['Match my browser', 'English', 'Nederlands']);
  });

  it('marks the current choice, and the browser default counts as a choice', () => {
    renderPage({ locale: '' });
    expect(screen.getByRole('radio', { name: 'Match my browser' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: 'Nederlands' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('reports the chosen language, and the empty value for the browser default', () => {
    const props = renderPage({ locale: 'nl' });
    fireEvent.click(screen.getByRole('radio', { name: 'English' }));
    expect(props.onLocaleChange).toHaveBeenCalledWith('en');

    fireEvent.click(screen.getByRole('radio', { name: 'Match my browser' }));
    expect(props.onLocaleChange).toHaveBeenLastCalledWith('');
  });

  it('says what the language affects beyond the words', () => {
    renderPage();
    expect(screen.getByText(/Dates and times follow the language/)).toBeTruthy();
  });

  it('names who is signed in and offers the way out', () => {
    const props = renderPage();
    expect(screen.getAllByText(/maarten@example\.com/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Sign out/ }));
    expect(props.onSignOut).toHaveBeenCalled();
  });

  it('disables the choices while one is saving', () => {
    renderPage({ saving: true });
    expect(screen.getByRole('radio', { name: 'English' })).toBeDisabled();
  });

  it('renders in the chosen language', () => {
    render(
      <I18nProvider locale="nl">
        <AccountView email="a@b" locale="nl" onLocaleChange={() => {}} />
      </I18nProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Account' })).toBeTruthy();
    expect(screen.getByText(/Datums en tijden volgen de taal/)).toBeTruthy();
  });
});

describe('switching language', () => {
  it('changes the words a surface renders', () => {
    const { rerender } = render(
      <I18nProvider locale="en">
        <FavoritesView photos={[]} onOpen={() => {}} />
      </I18nProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Favorites' })).toBeTruthy();
    expect(screen.getByText('Nothing favorited yet')).toBeTruthy();

    rerender(
      <I18nProvider locale="nl">
        <FavoritesView photos={[]} onOpen={() => {}} />
      </I18nProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Favorieten' })).toBeTruthy();
    expect(screen.getByText('Nog niets als favoriet')).toBeTruthy();
  });
});
