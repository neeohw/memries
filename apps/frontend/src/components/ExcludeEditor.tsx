import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { CloseIcon } from './icons';

/**
 * Edits one folder's exclude patterns (ADR 0020).
 *
 * Each pattern is a regular expression matched against a subfolder's path
 * below *this* folder, so `^2019/` pins to one place and `(^|/)\.thumbs$`
 * catches every occurrence. The patterns belong to this folder alone and are
 * never applied to another — which the copy now says, because the panel gave
 * no reason to believe it.
 */
/**
 * Appends a typed-but-unadded pattern to the list.
 *
 * The input is a staging area with its own Add button, so a pattern typed and
 * then saved straight away used to be dropped on the floor: the folder came
 * back with no filter and nothing said why. The form commits whatever is in
 * the box when it submits, and this is that rule — in one place, because the
 * dry run has to agree with the save about what the patterns are.
 *
 * An unusable or duplicate pattern is left out rather than refused here; the
 * editor has already said so on screen.
 */
export function withPendingPattern(value: string[], pending: string): string[] {
  const pattern = pending.trim();
  if (!pattern || value.includes(pattern)) return value;
  try {
    new RegExp(pattern);
  } catch {
    return value;
  }
  return [...value, pattern];
}

export function ExcludeEditor({
  value,
  onChange,
  pending,
  onPendingChange,
  folder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  /**
   * The half-typed pattern. Held by the form rather than here, so pressing
   * Save commits it instead of discarding it.
   */
  pending: string;
  onPendingChange: (next: string) => void;
  /** The folder these patterns belong to, named in the heading when known. */
  folder?: string;
}) {
  const { t } = useI18n();
  const [error, setError] = useState('');

  const add = () => {
    const pattern = pending.trim();
    if (!pattern) return;
    // Compiled here as well as on the server, so a typo is caught while the
    // reader is still looking at what they typed.
    try {
      new RegExp(pattern);
    } catch {
      setError(t('folders.excludeInvalid'));
      return;
    }
    if (value.includes(pattern)) {
      setError(t('folders.excludeDuplicate'));
      return;
    }
    setError('');
    onPendingChange('');
    onChange([...value, pattern]);
  };

  return (
    <div data-exclude-editor className="grid gap-2">
      <p className="text-sm font-medium text-plum">
        {folder ? t('folders.excludeTitleNamed', { folder }) : t('folders.excludeTitle')}
      </p>
      <p className="text-xs text-ink">{t('folders.excludeHelp')}</p>

      {value.length > 0 && (
        <ul className="grid gap-1">
          {value.map((pattern) => (
            <li
              key={pattern}
              className="flex items-center gap-2 rounded-xl bg-surface/60 px-3 py-1.5"
            >
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-plum">{pattern}</code>
              <button
                type="button"
                onClick={() => onChange(value.filter((p) => p !== pattern))}
                aria-label={t('folders.excludeStop', { pattern })}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink transition hover:bg-surface hover:text-plum"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-start gap-2">
        <label className="min-w-0 flex-1 text-sm">
          <span className="sr-only">{t('folders.excludeField')}</span>
          <input
            type="text"
            value={pending}
            onChange={(event) => {
              onPendingChange(event.target.value);
              setError('');
            }}
            onKeyDown={(event) => {
              // Enter adds the pattern rather than submitting the form, which
              // would save a Source the reader was still describing.
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
            placeholder="(^|/)\.thumbs$"
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-xl border border-plum/15 bg-cream px-3 py-2 font-mono text-xs text-plum outline-none transition focus:border-plum/40"
          />
        </label>
        <button
          type="button"
          onClick={add}
          className="min-h-11 shrink-0 rounded-full bg-surface px-4 text-sm font-medium text-plum transition hover:bg-surface/70"
        >
          {t('folders.excludeAdd')}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-xs text-plum">
          {error}
        </p>
      )}
    </div>
  );
}
