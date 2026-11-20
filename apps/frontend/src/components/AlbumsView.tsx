import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { useSelectionState } from '../hooks/usePhotoSelection';
import { compactThumbSize, thumbUrl } from '../lib/photoSrc';
import { useViewportWidth } from '../hooks/useViewportWidth';
import type { Album } from '../models/photo';
import { CheckIcon, CloseIcon, FoldersIcon, PlusIcon, TrashIcon } from './icons';
import { PageHeader } from './PageHeader';

export function AlbumsView({
  albums,
  onCreate,
  onOpen,
  onDelete,
  creating,
}: {
  albums: Album[];
  onCreate: (name: string) => void;
  onOpen: (album: Album) => void;
  onDelete?: (ids: string[]) => void;
  creating: boolean;
}) {
  const { t } = useI18n();
  const [drafting, setDrafting] = useState(false);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // The same selection machinery the photo grid uses, so shift-click ranges
  // behave identically here (ADR 0018).
  const albumIds = useMemo(() => albums.map((album) => album.id), [albums]);
  const selection = useSelectionState(albumIds);

  useEffect(() => {
    if (drafting) inputRef.current?.focus();
  }, [drafting]);

  // Escape clears, bound on the window because the click that built the
  // selection may have left focus on any card.
  useEffect(() => {
    if (!selection.active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') selection.clear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    onCreate(trimmed);
    setName('');
    setDrafting(false);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {selection.active ? (
        <AlbumSelectionBar
          count={selection.count}
          onClear={selection.clear}
          onDelete={() => {
            onDelete?.(selection.ids);
            selection.clear();
          }}
        />
      ) : (
        <PageHeader
          title={t('albums.heading')}
          actions={
            <button
              type="button"
              onClick={() => setDrafting(true)}
              disabled={drafting}
              className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-ink transition duration-200 hover:bg-surface/70 hover:text-plum disabled:opacity-40"
            >
              <PlusIcon className="h-4 w-4" />
              {t('albums.newAlbum')}
            </button>
          }
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-8 min-[640px]:px-5">
        {creating && (
          <p className="sr-only" role="status">
            {t('albums.creating')}
          </p>
        )}

        {albums.length === 0 && !drafting && (
          <p className="mt-10 text-center text-sm text-ink" role="status">
            {t('albums.empty')}
          </p>
        )}

        <ul className="grid list-none grid-cols-2 gap-3 p-0 min-[800px]:grid-cols-3 min-[1280px]:grid-cols-4 min-[1600px]:grid-cols-5 min-[2000px]:grid-cols-6">
          {drafting && (
            <li className="col-span-2 min-[800px]:col-span-1">
              <form
                data-album-form
                className="animate-form-in flex h-full min-h-[11rem] flex-col justify-between rounded-xl bg-surface/70 p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  submit();
                }}
              >
                <label className="text-sm font-medium text-plum">
                  Album name
                  <input
                    ref={inputRef}
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={t('albums.namePlaceholder')}
                    className="mt-2 h-11 w-full rounded-xl bg-cream px-3 text-sm text-plum outline-none ring-1 ring-plum/10 placeholder:text-ink"
                  />
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="submit"
                    disabled={!name.trim() || creating}
                    className="min-h-10 rounded-full bg-plum px-4 text-sm font-medium text-cream disabled:opacity-40"
                  >
                    {creating ? 'Creating…' : 'Create'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDrafting(false);
                      setName('');
                    }}
                    className="min-h-10 rounded-full bg-surface px-4 text-sm font-medium text-ink"
                  >
                    {t('albums.cancel')}
                  </button>
                </div>
              </form>
            </li>
          )}

          {albums.map((album) => (
            <li key={album.id}>
              <AlbumCard
                album={album}
                onOpen={onOpen}
                selectable={!!onDelete}
                selected={selection.selected.has(album.id)}
                selectionActive={selection.active}
                onToggle={(opts) => selection.toggle(album.id, opts)}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * The bar that takes the header's place while albums are selected.
 *
 * Deleting is two steps. It is the only destructive action in the app that
 * can take several things at once, and an album is slow to rebuild even
 * though its photos are untouched.
 */
function AlbumSelectionBar({
  count,
  onClear,
  onDelete,
}: {
  count: number;
  onClear: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const deleteLabel = t('albums.deleteCount', { count });

  return (
    <div
      data-album-selection-bar
      role="toolbar"
      aria-label={t('albums.toolbar')}
      className="relative z-20 flex items-center gap-2 px-3 py-2 min-[640px]:px-5"
    >
      <button
        type="button"
        onClick={onClear}
        aria-label={t('selection.clear')}
        title={t('selection.clear')}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink transition duration-200 hover:bg-surface/70 hover:text-plum active:scale-95"
      >
        <CloseIcon className="h-5 w-5" />
      </button>

      <p aria-live="polite" className="min-w-0 flex-1 truncate text-sm font-medium text-plum">
        {t('selection.count', { count })}
      </p>

      {confirming ? (
        <>
          <button
            type="button"
            onClick={onDelete}
            className="min-h-10 shrink-0 rounded-full bg-plum px-4 text-sm font-medium text-cream transition hover:bg-plum/90"
          >
            {deleteLabel}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="min-h-10 shrink-0 rounded-full px-3 text-sm font-medium text-ink transition hover:bg-surface/70"
          >
            {t('albums.cancel')}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={deleteLabel}
          title={deleteLabel}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink transition duration-200 hover:bg-surface/70 hover:text-plum active:scale-95"
        >
          <TrashIcon className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}

function AlbumCard({
  album,
  onOpen,
  selectable,
  selected,
  selectionActive,
  onToggle,
}: {
  album: Album;
  onOpen: (album: Album) => void;
  selectable: boolean;
  selected: boolean;
  selectionActive: boolean;
  onToggle: (opts?: { shiftKey?: boolean }) => void;
}) {
  const { t } = useI18n();
  const coverId = album.coverPhotoId ?? album.photoIds[0];
  const count = album.photoCount;
  const countLabel = t('albums.photoCount', { count });
  const coverSize = compactThumbSize(useViewportWidth());

  return (
    <article
      data-album-card
      data-selected={selected ? 'true' : undefined}
      className="album-card group relative overflow-hidden rounded-xl"
    >
      {selectable && (
        // The same control as a photo tile's, down to the classes: one way to
        // select a thing in this app (ADR 0018). A sibling of the open
        // button, not a child, because that is a button and buttons cannot
        // nest.
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={
            selected
              ? t('albums.deselect', { name: album.name })
              : t('albums.select', { name: album.name })
          }
          data-select-album
          onClick={(event) => {
            event.stopPropagation();
            onToggle({ shiftKey: event.shiftKey });
          }}
          className={`absolute left-1.5 top-1.5 z-10 grid h-6 w-6 place-items-center rounded-full border transition ${
            selected
              ? 'border-plum bg-plum text-cream'
              : 'border-cream/80 bg-black/25 text-transparent hover:text-cream/90'
          } ${
            selected || selectionActive
              ? 'opacity-100'
              : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100'
          }`}
        >
          <CheckIcon className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={(event) => {
          // Once a selection is running, a plain click extends it rather than
          // opening the album — the same rule the photo grid follows.
          if (selectionActive) {
            onToggle({ shiftKey: event.shiftKey });
            return;
          }
          onOpen(album);
        }}
        className="block w-full text-left transition duration-200 active:scale-[0.99]"
        aria-label={
          selectionActive
            ? t(selected ? 'albums.deselectWithCount' : 'albums.selectWithCount', {
                name: album.name,
                count: countLabel,
              })
            : t('albums.open', { name: album.name, count: countLabel })
        }
      >
        <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-blush/50">
          {selected && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 z-[1] rounded-[inherit] bg-plum/30 ring-2 ring-inset ring-plum"
            />
          )}
          {coverId ? (
            <img
              src={thumbUrl(coverId, coverSize)}
              alt=""
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="grid h-full place-items-center text-peach">
              <FoldersIcon className="h-8 w-8" />
            </div>
          )}
        </div>
        <div className="px-1 py-2">
          <p className="truncate text-sm font-semibold text-plum">{album.name}</p>
          <p className="mt-0.5 text-xs text-ink">{countLabel}</p>
        </div>
      </button>
    </article>
  );
}
