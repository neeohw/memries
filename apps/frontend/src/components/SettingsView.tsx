import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { formatBytes } from '../lib/formatBytes';
import type { ServerSettings } from '../lib/api';
import { PageHeader } from './PageHeader';

/**
 * Server settings (ADR 0022).
 *
 * One setting so far: where thumbnails are written. On the Pi that is the
 * difference between filling an 8GB eMMC card and putting the cache on a USB
 * disk, which is why it is worth changing without editing a unit file.
 */
export function SettingsView({
  settings,
  loading = false,
  loadError = false,
  onSave,
  saving = false,
  saveError,
  moved = false,
}: {
  settings?: ServerSettings;
  loading?: boolean;
  loadError?: boolean;
  /** An empty path restores the install default. */
  onSave: (path: string) => void;
  saving?: boolean;
  /** The server's own message, which says what is wrong with the path. */
  saveError?: string;
  moved?: boolean;
}) {
  const { t, intl } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const current = settings?.thumbnailRoot ?? '';
  const value = draft ?? current;
  const free = formatBytes(settings?.freeBytes ?? 0, intl);
  const isDefault = !!settings && settings.thumbnailRoot === settings.defaultThumbnailRoot;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={t('settings.heading')} />

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-8 min-[640px]:px-5">
        <div className="mx-auto grid w-full max-w-xl gap-6">
          {loadError && <p className="text-sm text-ink">{t('errors.generic')}</p>}

          <section aria-labelledby="settings-thumbs" className="grid gap-2">
            <h2
              id="settings-thumbs"
              className="font-display text-base font-semibold tracking-tight text-plum"
            >
              {t('settings.thumbnailsTitle')}
            </h2>
            <p className="text-sm text-ink">{t('settings.thumbnailsHelp')}</p>

            <form
              className="mt-1 grid gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                onSave(value.trim());
              }}
            >
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-plum">{t('settings.thumbnailsLabel')}</span>
                <input
                  type="text"
                  value={value}
                  disabled={loading || saving}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={settings?.defaultThumbnailRoot}
                  className="min-h-11 rounded-2xl bg-surface/70 px-4 font-mono text-[0.8rem] text-plum outline-none transition placeholder:text-ink/60 focus-visible:bg-surface disabled:opacity-60"
                />
              </label>

              {settings && (
                <p className="text-xs text-ink">
                  {t('settings.current')}{' '}
                  <span className="font-mono text-plum">{settings.thumbnailRoot}</span>
                  {isDefault && <> ({t('settings.usingDefault')})</>}
                  {free && <> · {t('settings.freeSpace', { size: free })}</>}
                </p>
              )}

              {settings && settings.allowedRoots.length > 0 && (
                <p className="text-xs text-ink">
                  {t('settings.allowedRoots', { roots: settings.allowedRoots.join(', ') })}
                </p>
              )}

              {/* The server's own words: it is the only thing that knows the
                  path is unwritable, outside the roots, or inside a folder. */}
              {saveError && (
                <p role="alert" className="text-sm font-medium text-plum">
                  {saveError}
                </p>
              )}

              {moved && (
                <div role="status" className="rounded-2xl bg-surface/70 p-3 text-sm">
                  <p className="font-medium text-plum">{t('settings.movedTitle')}</p>
                  <p className="mt-0.5 text-ink">{t('settings.movedBody')}</p>
                </div>
              )}

              <div className="mt-1 flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={loading || saving || value.trim() === current}
                  className="inline-flex min-h-11 items-center rounded-full bg-plum px-4 text-sm font-medium text-cream transition duration-200 hover:bg-plum/90 disabled:opacity-50"
                >
                  {saving ? t('settings.saving') : t('settings.save')}
                </button>
                {!isDefault && (
                  <button
                    type="button"
                    disabled={loading || saving}
                    onClick={() => {
                      setDraft(null);
                      onSave('');
                    }}
                    className="inline-flex min-h-11 items-center rounded-full bg-surface px-4 text-sm font-medium text-plum transition duration-200 hover:bg-surface/70 disabled:opacity-50"
                  >
                    {t('settings.reset')}
                  </button>
                )}
              </div>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
