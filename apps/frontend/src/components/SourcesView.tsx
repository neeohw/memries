import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import type { Source, SourceInput, SourceType } from '../models/source';
import { ExcludeEditor } from './ExcludeEditor';
import { DriveIcon, PlusIcon, SyncIcon } from './icons';
import { PageHeader } from './PageHeader';
import { ScanProgress } from './ScanProgress';
import type { IndexStatus } from '../lib/indexStatus';

const TYPES: Array<{
  id: SourceType;
  label: string;
  locationLabel: string;
  placeholder: string;
  hint: string;
}> = [
  {
    id: 'local',
    label: 'folders.typeLocal',
    locationLabel: 'folders.locationLocal',
    placeholder: '/data/photos/family',
    hint: 'folders.hintLocal',
  },
  {
    id: 'webdav',
    label: 'folders.typeWebdav',
    locationLabel: 'folders.locationWebdav',
    placeholder: 'https://cloud.example.com/remote.php/dav/files/me/Photos',
    hint: 'folders.hintWebdav',
  },
];

const TYPE_LABEL: Record<SourceType, string> = {
  local: 'folders.labelLocal',
  webdav: 'folders.labelWebdav',
};

const inputClass =
  'mt-1.5 h-11 w-full rounded-xl bg-cream px-3 text-sm text-plum outline-none ring-1 ring-plum/10 placeholder:text-ink/60 focus-visible:ring-2 focus-visible:ring-peach disabled:opacity-60';

type Draft = SourceInput & { password: string };

function emptyDraft(): Draft {
  return { name: '', type: 'local', location: '', username: '', password: '', excludes: [] };
}

function draftFrom(source: Source): Draft {
  return {
    name: source.name,
    type: source.type,
    location: source.location,
    username: source.username ?? '',
    password: '',
    excludes: source.excludes,
  };
}

function errorText(error: unknown): string {
  // The server's own words where it gave any; the caller supplies a fallback
  // in the reader's language when it did not.
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^invalid source:\s*/i, '').trim() || '';
}

export function SourcesView({
  sources,
  loading,
  loadError,
  onCreate,
  onUpdate,
  onDelete,
  onScan,
  indexStatus,
}: {
  sources: Source[];
  loading: boolean;
  loadError: boolean;
  onCreate: (input: SourceInput) => Promise<unknown>;
  onUpdate: (id: string, input: SourceInput) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
  onScan: (id: string) => Promise<unknown>;
  /** Live progress for a scan in flight (ADR 0023). */
  indexStatus?: IndexStatus;
}) {
  const { t: tr } = useI18n();
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={tr('folders.heading')}
        meta={sources.length > 0 ? tr('folders.connected', { count: sources.length }) : undefined}
        actions={
          <button
            type="button"
            onClick={() => setEditing('new')}
            disabled={editing === 'new'}
            className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-ink transition duration-200 hover:bg-surface/70 hover:text-plum disabled:opacity-40"
          >
            <PlusIcon className="h-4 w-4" />
            {tr('folders.add')}
          </button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-8 min-[640px]:px-5">
        <p className="mb-4 max-w-2xl text-sm leading-relaxed text-ink">{tr('folders.intro')}</p>

        <ScanProgress status={indexStatus} />

        {editing === 'new' && (
          <SourceForm
            initial={emptyDraft()}
            onSubmit={async (input) => {
              await onCreate(input);
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        )}

        {loading && (
          <p className="mt-10 text-center text-sm text-ink" role="status">
            {tr('folders.loading')}
          </p>
        )}
        {loadError && (
          <p className="mt-10 text-center text-sm text-ink" role="alert">
            {tr('folders.loadError')}
          </p>
        )}
        {!loading && !loadError && sources.length === 0 && editing !== 'new' && (
          <p className="mt-10 text-center text-sm text-ink" role="status">
            {tr('folders.empty')}
          </p>
        )}

        <ul className="mt-3 grid list-none gap-3 p-0 min-[1100px]:grid-cols-2">
          {sources.map((source) =>
            editing === source.id ? (
              <li key={source.id}>
                <SourceForm
                  initial={draftFrom(source)}
                  existing={source}
                  onSubmit={async (input) => {
                    await onUpdate(source.id, input);
                    setEditing(null);
                  }}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={source.id}>
                <SourceCard
                  source={source}
                  onEdit={() => setEditing(source.id)}
                  onDelete={() => onDelete(source.id)}
                  onScan={() => onScan(source.id)}
                />
              </li>
            ),
          )}
        </ul>
      </div>
    </div>
  );
}

function SourceCard({
  source,
  onEdit,
  onDelete,
  onScan,
}: {
  source: Source;
  onEdit: () => void;
  onDelete: () => Promise<unknown>;
  onScan: () => Promise<unknown>;
}) {
  const { t: tr } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<'scan' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: 'scan' | 'delete', action: () => Promise<unknown>) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
      setConfirming(false);
    }
  };

  return (
    <article
      className="flex h-full flex-col gap-3 rounded-xl bg-surface/70 p-4"
      aria-label={source.name}
    >
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cream text-plum">
          <DriveIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-medium text-plum">{source.name}</h2>
          <p className="truncate text-xs text-ink" title={source.location}>
            {tr(TYPE_LABEL[source.type])} · <span className="font-mono">{source.location}</span>
          </p>
          {source.username && (
            <p className="mt-0.5 truncate text-xs text-ink">
              {tr('folders.signedInAs', { username: source.username })}
            </p>
          )}
        </div>
      </div>
      {error && (
        <p className="text-sm text-plum" role="alert">
          {error}
        </p>
      )}
      <div className="mt-auto flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void run('scan', onScan)}
          disabled={busy !== null}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-cream px-4 text-sm font-medium text-plum disabled:opacity-50"
        >
          <SyncIcon className="h-4 w-4" />
          {busy === 'scan' ? tr('folders.scanning') : tr('folders.scanNow')}
        </button>
        <button
          type="button"
          onClick={onEdit}
          disabled={busy !== null}
          className="min-h-10 rounded-full bg-cream px-4 text-sm font-medium text-plum disabled:opacity-50"
        >
          Edit
        </button>
        {confirming ? (
          <>
            <button
              type="button"
              onClick={() => void run('delete', onDelete)}
              disabled={busy !== null}
              className="min-h-10 rounded-full bg-plum px-4 text-sm font-medium text-cream disabled:opacity-50"
            >
              {busy === 'delete' ? tr('folders.removing') : tr('folders.removeConfirm')}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy !== null}
              className="min-h-10 rounded-full px-3 text-sm font-medium text-ink"
            >
              Keep
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy !== null}
            className="min-h-10 rounded-full px-3 text-sm font-medium text-ink hover:text-plum disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </div>
    </article>
  );
}

function SourceForm({
  initial,
  existing,
  onSubmit,
  onCancel,
}: {
  initial: Draft;
  existing?: Source;
  onSubmit: (input: SourceInput) => Promise<void>;
  onCancel: () => void;
}) {
  const { t: tr } = useI18n();
  const [draft, setDraft] = useState<Draft>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locationRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const errorId = useId();
  const type = TYPES.find((t) => t.id === draft.type) ?? TYPES[0];
  const remote = draft.type !== 'local';

  useEffect(() => {
    locationRef.current?.focus();
  }, [draft.type]);

  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  const submit = async () => {
    if (!draft.location.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      await onSubmit({
        ...draft,
        password: remote && draft.password ? draft.password : undefined,
      });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      data-source-form
      className="animate-form-in mb-3 flex max-w-2xl flex-col gap-4 rounded-xl bg-surface/70 p-4"
      aria-label={existing ? tr('folders.editNamed', { name: existing.name }) : tr('folders.add')}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset>
        <legend className="text-sm font-medium text-plum">{tr('folders.whereLegend')}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {TYPES.map((t) => (
            <label
              key={t.id}
              className={`inline-flex min-h-10 cursor-pointer items-center rounded-full px-4 text-sm font-medium ring-1 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-peach ${
                draft.type === t.id
                  ? 'bg-plum text-cream ring-plum'
                  : 'bg-cream text-ink ring-plum/10 hover:text-plum'
              }`}
            >
              <input
                type="radio"
                name="source-type"
                value={t.id}
                checked={draft.type === t.id}
                onChange={() => set({ type: t.id })}
                className="sr-only"
              />
              {tr(t.label)}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="text-sm font-medium text-plum">
        {tr(type.locationLabel)}
        <input
          ref={locationRef}
          type="text"
          required
          value={draft.location}
          onChange={(event) => set({ location: event.target.value })}
          placeholder={type.placeholder}
          aria-describedby={error ? `${hintId} ${errorId}` : hintId}
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          spellCheck={false}
          className={`${inputClass} font-mono`}
        />
        <span id={hintId} className="mt-1.5 block text-xs font-normal text-ink">
          {tr(type.hint)}
        </span>
      </label>

      {remote && (
        <div className="grid gap-4 min-[640px]:grid-cols-2">
          <label className="text-sm font-medium text-plum">
            Username
            <input
              type="text"
              value={draft.username}
              onChange={(event) => set({ username: event.target.value })}
              placeholder={tr('folders.usernamePlaceholder')}
              autoComplete="off"
              spellCheck={false}
              className={inputClass}
            />
          </label>
          <label className="text-sm font-medium text-plum">
            Password
            <input
              type="password"
              value={draft.password}
              onChange={(event) => set({ password: event.target.value })}
              placeholder={existing?.hasPassword ? tr('folders.passwordKeep') : ''}
              autoComplete="new-password"
              className={inputClass}
            />
          </label>
        </div>
      )}

      <ExcludeEditor value={draft.excludes ?? []} onChange={(excludes) => set({ excludes })} />

      <div className="grid gap-4">
        <label className="text-sm font-medium text-plum">
          Name <span className="font-normal text-ink">(optional)</span>
          <input
            type="text"
            value={draft.name}
            onChange={(event) => set({ name: event.target.value })}
            placeholder={tr('folders.namePlaceholder')}
            maxLength={80}
            className={inputClass}
          />
        </label>
      </div>

      {error && (
        <p id={errorId} className="text-sm text-plum" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={!draft.location.trim() || pending}
          className="min-h-10 rounded-full bg-plum px-4 text-sm font-medium text-cream disabled:opacity-40"
        >
          {pending ? tr('folders.checking') : existing ? tr('folders.save') : tr('folders.connect')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="min-h-10 rounded-full bg-surface px-4 text-sm font-medium text-ink"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
