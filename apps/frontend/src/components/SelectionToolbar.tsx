import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import type { Album } from '../models/photo';
import { AlbumIcon, CloseIcon, HeartIcon, PlusIcon } from './icons';

/**
 * Actions for the current multi-selection (ADR 0018).
 *
 * Replaces the timeline's own header while a selection is live, the way
 * Google Photos does, so the count and the way out are always in the same
 * place.
 */
export function SelectionToolbar({
  count,
  allFavorited,
  albums,
  onClear,
  onFavorite,
  onAddToAlbum,
  onCreateAlbum,
  busy = false,
}: {
  count: number;
  /** Everything selected is already a favorite, so the action removes. */
  allFavorited: boolean;
  albums: Album[];
  onClear: () => void;
  onFavorite: (favorite: boolean) => void;
  onAddToAlbum: (albumId: string) => void;
  /** Makes a new album holding exactly this selection. */
  onCreateAlbum: (name: string) => void;
  busy?: boolean;
}) {
  const { t } = useI18n();
  const [picking, setPicking] = useState(false);
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState('');
  const favoriteLabel = allFavorited
    ? t('selection.removeFromFavorites')
    : t('selection.addToFavorites');

  return (
    <div
      data-selection-toolbar
      role="toolbar"
      aria-label={t('selection.toolbar')}
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

      {/* The count is the toolbar's heading and its live announcement: a
          screen reader hears the selection grow without moving focus. */}
      <p aria-live="polite" className="min-w-0 flex-1 truncate text-sm font-medium text-plum">
        {t('selection.count', { count })}
      </p>

      <button
        type="button"
        onClick={() => onFavorite(!allFavorited)}
        disabled={busy}
        aria-label={favoriteLabel}
        title={favoriteLabel}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink transition duration-200 hover:bg-surface/70 hover:text-plum active:scale-95 disabled:opacity-50"
      >
        <HeartIcon className="h-5 w-5" filled={allFavorited} />
      </button>

      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => {
            setPicking((open) => !open);
            setNaming(false);
          }}
          disabled={busy}
          aria-label={t('selection.addToAlbum')}
          title={t('selection.addToAlbum')}
          aria-haspopup="menu"
          aria-expanded={picking}
          className="grid h-10 w-10 place-items-center rounded-full text-ink transition duration-200 hover:bg-surface/70 hover:text-plum active:scale-95 disabled:opacity-50"
        >
          <AlbumIcon className="h-5 w-5" />
        </button>

        {picking && (
          <>
            <div
              className="fixed inset-0 z-30"
              aria-hidden
              onClick={() => {
                setPicking(false);
                setNaming(false);
              }}
            />
            <div
              role="menu"
              aria-label={t('nav.albums')}
              className="absolute right-0 top-11 z-40 max-h-72 w-64 overflow-y-auto rounded-2xl bg-surface p-1 shadow-lift"
            >
              {naming ? (
                // The name is asked for here rather than in a dialog: the
                // selection is the subject, and a modal over it would hide
                // what is about to go in.
                <form
                  className="flex items-center gap-1 p-1"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const name = draft.trim();
                    if (!name) return;
                    setPicking(false);
                    setNaming(false);
                    setDraft('');
                    onCreateAlbum(name);
                  }}
                >
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">{t('selection.newAlbumName')}</span>
                    <input
                      autoFocus
                      type="text"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        // Escape backs out of naming without closing the menu
                        // and losing the selection behind it.
                        if (event.key === 'Escape') {
                          event.stopPropagation();
                          setNaming(false);
                          setDraft('');
                        }
                      }}
                      placeholder={t('selection.albumOfPhotos', { count })}
                      maxLength={80}
                      className="h-10 w-full rounded-xl bg-cream px-3 text-sm text-plum outline-none ring-1 ring-plum/10 placeholder:text-ink/60 focus-visible:ring-2 focus-visible:ring-peach"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={!draft.trim()}
                    className="h-10 shrink-0 rounded-xl px-3 text-sm font-medium text-plum transition hover:bg-blush/40 disabled:opacity-40"
                  >
                    {t('selection.create')}
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => setNaming(true)}
                  className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm font-medium text-plum transition hover:bg-blush/40"
                >
                  <PlusIcon className="h-4 w-4 shrink-0" />
                  {t('selection.newAlbum')}
                </button>
              )}

              {albums.length > 0 && <div className="my-1 border-t border-plum/10" aria-hidden />}

              {albums.map((album) => (
                <button
                  key={album.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setPicking(false);
                    setNaming(false);
                    onAddToAlbum(album.id);
                  }}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-sm text-plum transition hover:bg-blush/40"
                >
                  <span className="min-w-0 truncate">{album.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-ink">{album.photoCount}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
