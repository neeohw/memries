import { useState } from 'react';
import { CloseIcon } from './icons';

/**
 * Edits a Source's exclude patterns (ADR 0020).
 *
 * Each pattern is a regular expression matched against a folder's path below
 * the source root, so `^2019/` pins to one place and `(^|/)\.thumbs$` catches
 * every occurrence. An excluded tree is never read during a scan.
 */
export function ExcludeEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const add = () => {
    const pattern = draft.trim();
    if (!pattern) return;
    // Compiled here as well as on the server, so a typo is caught while the
    // reader is still looking at what they typed.
    try {
      new RegExp(pattern);
    } catch {
      setError('That is not a valid expression.');
      return;
    }
    if (value.includes(pattern)) {
      setError('That pattern is already in the list.');
      return;
    }
    setError('');
    setDraft('');
    onChange([...value, pattern]);
  };

  return (
    <div data-exclude-editor className="grid gap-2">
      <p className="text-sm font-medium text-plum">Skip folders</p>
      <p className="text-xs text-ink">
        Regular expressions, matched against each folder&rsquo;s path inside this source. A matching
        folder is never read, and photos already indexed from it leave the library on the next scan.
      </p>

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
                aria-label={`Stop skipping ${pattern}`}
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
          <span className="sr-only">Pattern to skip</span>
          <input
            type="text"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
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
          Add
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
