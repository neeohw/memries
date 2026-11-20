import { useI18n } from '../i18n/I18nProvider';
import { LOCALES } from '../i18n/locale';
import { PageHeader } from './PageHeader';
import { CheckIcon, SignOutIcon } from './icons';

/**
 * Account settings (ADR 0021).
 *
 * The language was a dropdown in the chrome, which put a browser-drawn
 * control next to hand-made ones and gave a per-reader setting the same
 * weight as a toolbar button. It lives here instead, as a proper choice with
 * room to say what it affects.
 */
export function AccountView({
  email,
  locale,
  onLocaleChange,
  onSignOut,
  saving = false,
}: {
  email: string;
  /** '' follows the browser. */
  locale: string;
  onLocaleChange: (next: string) => void;
  onSignOut?: () => void;
  saving?: boolean;
}) {
  const { t } = useI18n();
  const options = ['', ...LOCALES];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={t('account.heading')} meta={email || undefined} />

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-8 min-[640px]:px-5">
        <div className="mx-auto grid w-full max-w-xl gap-6">
          <section aria-labelledby="account-language" className="grid gap-2">
            <h2
              id="account-language"
              className="font-display text-base font-semibold tracking-tight text-plum"
            >
              {t('account.languageTitle')}
            </h2>
            <p className="text-sm text-ink">{t('account.languageHelp')}</p>

            {/* A radiogroup rather than a select: three options is a choice to
                show, not to hide behind a control that opens. */}
            <div
              role="radiogroup"
              aria-labelledby="account-language"
              data-language-choices
              className="mt-1 grid gap-1.5"
            >
              {options.map((option) => {
                const selected = option === locale;
                return (
                  <button
                    key={option || 'system'}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={saving}
                    onClick={() => onLocaleChange(option)}
                    className={`flex min-h-12 items-center justify-between gap-3 rounded-2xl px-4 text-left text-sm transition duration-200 disabled:opacity-60 ${
                      selected ? 'bg-plum text-cream' : 'bg-surface/70 text-plum hover:bg-surface'
                    }`}
                  >
                    <span className="min-w-0 truncate font-medium">
                      {option ? t(`language.${option}`) : t('language.system')}
                    </span>
                    {selected && <CheckIcon className="h-4 w-4 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </section>

          {onSignOut && (
            <section aria-labelledby="account-session" className="grid gap-2">
              <h2
                id="account-session"
                className="font-display text-base font-semibold tracking-tight text-plum"
              >
                {t('account.signOutTitle')}
              </h2>
              <p className="text-sm text-ink">
                {t('account.signedInAs')} <span className="font-medium text-plum">{email}</span>
              </p>
              <button
                type="button"
                onClick={onSignOut}
                className="mt-1 inline-flex min-h-11 w-fit items-center gap-2 rounded-full bg-surface px-4 text-sm font-medium text-plum transition duration-200 hover:bg-surface/70"
              >
                <SignOutIcon className="h-4 w-4" />
                {t('app.signOut')}
              </button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
