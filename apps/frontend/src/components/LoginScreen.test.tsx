import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LoginScreen } from './LoginScreen';

function fillAndSubmit(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /sign/i }));
}

describe('LoginScreen', () => {
  it('uses the field names the server and the e2e suite drive', () => {
    render(<LoginScreen onSignIn={async () => {}} />);

    // These two names are a contract: the server accepts a plain form post on
    // them, and apps/e2e/steps/fixtures.ts fills them by name.
    const login = document.querySelector('input[name="login"]');
    const password = document.querySelector('input[name="password"]');
    expect(login).toBeTruthy();
    expect(password).toBeTruthy();
    expect(password?.getAttribute('type')).toBe('password');
    expect(document.querySelector('[type="submit"]')).toBeTruthy();
  });

  it('labels both fields and titles the page', () => {
    render(<LoginScreen onSignIn={async () => {}} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Memries' })).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('submits what was typed', async () => {
    const onSignIn = vi.fn().mockResolvedValue(undefined);
    render(<LoginScreen onSignIn={onSignIn} />);

    fillAndSubmit('admin@example.com', 'password');

    await waitFor(() => {
      expect(onSignIn).toHaveBeenCalledWith('admin@example.com', 'password');
    });
  });

  it('announces a rejection and clears only the password', async () => {
    const onSignIn = vi.fn().mockRejectedValue(new Error('That login and password did not match.'));
    render(<LoginScreen onSignIn={onSignIn} />);

    fillAndSubmit('admin@example.com', 'wrong');

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('That login and password did not match.');
    });
    // The address survives so it need not be retyped; the password does not.
    expect(screen.getByLabelText<HTMLInputElement>('Email').value).toBe('admin@example.com');
    expect(screen.getByLabelText<HTMLInputElement>('Password').value).toBe('');
    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBe('true');
  });

  it('does not submit twice while a sign-in is in flight', async () => {
    let release = () => {};
    const onSignIn = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    render(<LoginScreen onSignIn={onSignIn} />);

    fillAndSubmit('admin@example.com', 'password');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Signing in…' }).hasAttribute('disabled')).toBe(
        true,
      );
    });
    fireEvent.click(screen.getByRole('button', { name: 'Signing in…' }));
    expect(onSignIn).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
    });
  });

  it('posts to the login endpoint when submitted without JavaScript', () => {
    render(<LoginScreen onSignIn={async () => {}} />);
    const form = document.querySelector('form');
    // method/action are the no-JS fallback; the handler normally intercepts.
    expect(form?.getAttribute('method')).toBe('post');
    expect(form?.getAttribute('action')).toBe('/auth/login');
  });
});
