import { useEffect, useRef } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import type { Album, Photo } from '../models/photo';
import { AlbumIcon, ChevronRightIcon } from './icons';

export function PhotoActionsMenu({
  photo,
  albums,
  mode = 'library',
  onClose,
  onToggleFavorite,
  onAddToAlbum,
  onRemoveFromAlbum,
}: {
  photo: Photo;
  albums: Album[];
  mode?: 'library' | 'album';
  onClose: () => void;
  onToggleFavorite: (id: string, favorite: boolean) => void;
  onAddToAlbum: (albumId: string, photoId: string) => void;
  onRemoveFromAlbum?: () => void;
}) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstItemRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !menuRef.current) return;
      const focusable = [
        ...menuRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'),
      ];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [onClose]);

  const nextFavorite = !photo.favorite;

  return (
    <div
      ref={menuRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="photo-actions-title"
      className="fixed inset-x-0 bottom-0 z-[60] rounded-t-[1.6rem] bg-surface px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-lift min-[640px]:inset-auto min-[640px]:bottom-auto min-[640px]:left-1/2 min-[640px]:top-1/2 min-[640px]:w-[min(22rem,calc(100vw-2rem))] min-[640px]:-translate-x-1/2 min-[640px]:-translate-y-1/2 min-[640px]:rounded-[1.4rem] min-[640px]:pb-4"
    >
      <div
        className="mx-auto mb-3 h-1 w-10 rounded-full bg-ink/15 min-[640px]:hidden"
        aria-hidden
      />
      <h2 id="photo-actions-title" className="px-3 pb-1 text-sm font-semibold text-plum">
        Photo actions
      </h2>
      <button
        ref={firstItemRef}
        type="button"
        onClick={() => {
          onToggleFavorite(photo.id, nextFavorite);
          onClose();
        }}
        className="flex min-h-12 w-full items-center rounded-2xl px-3 text-left text-sm font-medium text-plum transition hover:bg-cream/80"
      >
        {nextFavorite ? t('selection.addToFavorites') : t('selection.removeFromFavorites')}
      </button>

      {mode === 'album' ? (
        <div
          role="group"
          aria-label={t('albums.removeFromAlbum')}
          className="mt-1 border-t border-plum/10 pt-1"
        >
          <button
            type="button"
            onClick={() => {
              onRemoveFromAlbum?.();
              onClose();
            }}
            className="flex min-h-12 w-full items-center rounded-2xl px-3 text-left text-sm font-medium text-plum transition hover:bg-cream/80"
          >
            Remove from this album
          </button>
        </div>
      ) : (
        <div
          role="group"
          aria-label={t('selection.addToAlbum')}
          className="mt-1 border-t border-plum/10 pt-1"
        >
          <p className="px-3 py-2 text-xs font-medium uppercase tracking-[0.12em] text-ink">
            Add to album
          </p>
          {albums.length === 0 ? (
            <p className="px-3 pb-2 text-sm text-ink">
              No albums yet. Create one from the Albums tab.
            </p>
          ) : (
            <ul className="max-h-52 overflow-y-auto">
              {albums.map((album) => (
                <li key={album.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onAddToAlbum(album.id, photo.id);
                      onClose();
                    }}
                    aria-label={`Add to album ${album.name}, ${album.photoCount} ${album.photoCount === 1 ? 'photo' : 'photos'}`}
                    className="flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl px-3 text-left text-sm text-plum transition hover:bg-cream/80"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <AlbumIcon className="h-4 w-4 shrink-0 text-ink" />
                      <span className="truncate">{album.name}</span>
                    </span>
                    <span className="shrink-0 text-xs text-ink">{album.photoCount}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onClose}
        className="mt-2 flex min-h-11 w-full items-center justify-center gap-1 rounded-full bg-cream text-sm font-medium text-ink"
      >
        Close
        <ChevronRightIcon className="h-4 w-4 rotate-90 min-[640px]:hidden" />
      </button>
    </div>
  );
}
