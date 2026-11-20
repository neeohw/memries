import { useId, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';

/**
 * Sign-in form for local password auth (ADR 0016).
 *
 * The field names are `login` and `password` because the server accepts a
 * plain form post as well as JSON, so this markup still works with JavaScript
 * disabled, and because the e2e suite already drives those names.
 */
export function LoginScreen({
  onSignIn,
}: {
  onSignIn: (login: string, password: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const loginId = useId();
  const passwordId = useId();
  const errorId = useId();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSignIn(login, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('signIn.failed'));
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  };

  const fieldClass =
    'min-h-11 w-full rounded-2xl border border-plum/15 bg-surface px-4 text-base text-plum outline-none placeholder:text-ink/50 focus-visible:border-plum/40 focus-visible:ring-2 focus-visible:ring-plum/30';

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-cream px-4 py-10 text-plum">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span
            className="h-10 w-10 rounded-full bg-gradient-to-br from-peach to-blush"
            aria-hidden
          />
          <h1 className="font-display text-3xl font-semibold tracking-tight">Memries</h1>
          <p className="text-sm text-ink">Sign in to see your photos.</p>
        </div>

        <form
          onSubmit={submit}
          method="post"
          action="/auth/login"
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor={loginId} className="text-sm font-medium">
              Email
            </label>
            <input
              id={loginId}
              name="login"
              type="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              // The form is the only thing on screen, so taking focus costs no
              // orientation and saves a tap on a phone.
              autoFocus
              value={login}
              onChange={(event) => setLogin(event.target.value)}
              aria-invalid={error != null}
              aria-describedby={error ? errorId : undefined}
              className={fieldClass}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={passwordId} className="text-sm font-medium">
              Password
            </label>
            <input
              id={passwordId}
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={error != null}
              aria-describedby={error ? errorId : undefined}
              className={fieldClass}
            />
          </div>

          {/* Always rendered so assistive tech is already observing it when a
              message appears. */}
          <p id={errorId} role="alert" className="min-h-5 text-sm text-red-700 dark:text-red-400">
            {error}
          </p>

          <button
            type="submit"
            disabled={submitting}
            className="min-h-11 rounded-full bg-plum px-5 text-sm font-medium text-cream disabled:opacity-60"
          >
            {submitting ? t('signIn.submitting') : t('signIn.submit')}
          </button>
        </form>
      </div>
    </div>
  );
}
