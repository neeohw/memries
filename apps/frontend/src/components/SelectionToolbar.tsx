import { useState } from 'react';
import { selectionLabel } from '../lib/selection';
import type { Album } from '../models/photo';
import { AlbumIcon, CloseIcon, HeartIcon } from './icons';

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
  busy = false,
}: {
  count: number;
  /** Everything selected is already a favorite, so the action removes. */
  allFavorited: boolean;
  albums: Album[];
  onClear: () => void;
  onFavorite: (favorite: boolean) => void;
  onAddToAlbum: (albumId: string) => void;
  busy?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const favoriteLabel = allFavorited ? 'Remove from favorites' : 'Add to favorites';

  return (
    <div
      data-selection-toolbar
      role="toolbar"
      aria-label="Selected photos"
      className="relative z-20 flex items-center gap-2 px-3 py-2 min-[640px]:px-5"
    >
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection"
        title="Clear selection"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink transition duration-200 hover:bg-surface/70 hover:text-plum active:scale-95"
      >
        <CloseIcon className="h-5 w-5" />
      </button>

      {/* The count is the toolbar's heading and its live announcement: a
          screen reader hears the selection grow without moving focus. */}
      <p aria-live="polite" className="min-w-0 flex-1 truncate text-sm font-medium text-plum">
        {selectionLabel(count)}
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
          onClick={() => setPicking((open) => !open)}
          disabled={busy || albums.length === 0}
          aria-label="Add to album"
          title={albums.length === 0 ? 'No albums yet' : 'Add to album'}
          aria-haspopup="menu"
          aria-expanded={picking}
          className="grid h-10 w-10 place-items-center rounded-full text-ink transition duration-200 hover:bg-surface/70 hover:text-plum active:scale-95 disabled:opacity-50"
        >
          <AlbumIcon className="h-5 w-5" />
        </button>

        {picking && albums.length > 0 && (
          <>
            <div className="fixed inset-0 z-30" aria-hidden onClick={() => setPicking(false)} />
            <div
              role="menu"
              aria-label="Albums"
              className="absolute right-0 top-11 z-40 max-h-72 w-60 overflow-y-auto rounded-2xl bg-surface p-1 shadow-lift"
            >
              {albums.map((album) => (
                <button
                  key={album.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setPicking(false);
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
