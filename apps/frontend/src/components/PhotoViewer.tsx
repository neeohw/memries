import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { formatCompactDate, formatDayLabel, formatTime } from '../lib/formatDate';
import { photoViewerAlt } from '../lib/photoName';
import { VideoStage } from './VideoStage';
import { viewerFallbackSrc } from '../lib/photoSrc';
import { resolveViewerGesture } from '../lib/viewerGesture';
import type { Album, Photo } from '../models/photo';
import {
  AlbumIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  HeartIcon,
  NewTabIcon,
} from './icons';
import { PhotoActionsMenu } from './PhotoActionsMenu';

type ViewerMotion = 'opening' | 'open' | 'navigating' | 'closing' | 'reduced';

export function PhotoViewer({
  photos,
  activeId,
  origin,
  onClose,
  onChange,
  onToggleFavorite,
  albums,
  onAddToAlbum,
}: {
  photos: Photo[];
  activeId: string;
  origin: DOMRect | null;
  onClose: () => void;
  onChange: (id: string) => void;
  onToggleFavorite: (id: string, favorite: boolean) => void;
  albums: Album[];
  onAddToAlbum: (albumId: string, photoId: string) => void;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const { t, intl } = useI18n();
  const index = Math.max(
    0,
    photos.findIndex((photo) => photo.id === activeId),
  );
  const photo = photos[index];
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const originRef = useRef(origin);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef({ x: 0, y: 0 });
  const closingRef = useRef(false);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const favoriteLabel = photo?.favorite
    ? t('selection.removeFromFavorites')
    : t('selection.addToFavorites');
  const nextSrc = photo?.imageUrl ?? '';
  const imageIdentity = `${photo?.id ?? ''}:${nextSrc}`;
  const [src, setSrc] = useState(nextSrc);
  const [seenImageIdentity, setSeenImageIdentity] = useState(imageIdentity);
  const [albumPickerOpen, setAlbumPickerOpen] = useState(false);
  const [motion, setMotion] = useState<ViewerMotion>(reducedMotion ? 'reduced' : 'opening');
  const [motionPhotoId, setMotionPhotoId] = useState(photo?.id);

  if (seenImageIdentity !== imageIdentity) {
    setSeenImageIdentity(imageIdentity);
    setSrc(nextSrc);
    setAlbumPickerOpen(false);
  }

  if (photo?.id !== motionPhotoId) {
    setMotionPhotoId(photo?.id);
    if (!reducedMotion) setMotion('navigating');
  }

  useEffect(() => {
    if (motion !== 'navigating') return;
    const timer = window.setTimeout(() => {
      setMotion((current) => (current === 'navigating' ? 'open' : current));
    }, 280);
    return () => window.clearTimeout(timer);
  }, [motion, photo?.id]);

  useEffect(() => {
    closeRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (albumPickerOpen) setAlbumPickerOpen(false);
    if (reducedMotion) {
      onClose();
      return;
    }
    setMotion('closing');
    const img = imgRef.current;
    const card = originRef.current;
    if (img && card) {
      const dest = img.getBoundingClientRect();
      if (dest.width > 0 && dest.height > 0) {
        const scaleX = card.width / dest.width;
        const scaleY = card.height / dest.height;
        const dx = card.left + card.width / 2 - (dest.left + dest.width / 2);
        const dy = card.top + card.height / 2 - (dest.top + dest.height / 2);
        img.style.transition = 'transform 280ms ease, opacity 240ms ease';
        img.style.transform = `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`;
        img.style.opacity = '0.45';
      }
    }
    window.setTimeout(onClose, 280);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (albumPickerOpen) setAlbumPickerOpen(false);
        else close();
      }
      if (event.key === 'ArrowLeft' && index > 0) onChange(photos[index - 1].id);
      if (event.key === 'ArrowRight' && index < photos.length - 1) onChange(photos[index + 1].id);
      if ((event.key === 'f' || event.key === 'F') && photo)
        onToggleFavorite(photo.id, !photo.favorite);
      if (event.key === 'Tab' && dialogRef.current && !albumPickerOpen) {
        const focusable = [
          ...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'),
        ];
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[lastIndex(focusable)];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useLayoutEffect(() => {
    const img = imgRef.current;
    const card = originRef.current;
    if (!img || !card || reducedMotion) {
      setMotion(reducedMotion ? 'reduced' : 'open');
      return;
    }
    const dest = img.getBoundingClientRect();
    if (dest.width === 0 || dest.height === 0) {
      setMotion('open');
      return;
    }
    const scaleX = card.width / dest.width;
    const scaleY = card.height / dest.height;
    const dx = card.left + card.width / 2 - (dest.left + dest.width / 2);
    const dy = card.top + card.height / 2 - (dest.top + dest.height / 2);
    img.style.transform = `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`;
    img.style.transition = 'none';
    const frame = requestAnimationFrame(() => {
      img.style.transition = 'transform 280ms ease';
      img.style.transform = 'none';
    });
    const done = window.setTimeout(() => setMotion('open'), 280);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(done);
    };
    // Open FLIP runs once from the card that launched the viewer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!photo) return null;

  const go = (delta: number) => {
    const next = index + delta;
    if (next < 0 || next >= photos.length) return;
    onChange(photos[next].id);
    setDrag({ x: 0, y: 0 });
  };

  const canPrev = index > 0;
  const canNext = index < photos.length - 1;
  const dismiss = Math.min(1, Math.max(0, drag.y) / 280);
  const backdrop = 0.8 * (1 - dismiss * 0.65);
  const dragTransform = drag.y
    ? `translateY(${drag.y}px) scale(${Math.max(0.88, 1 - drag.y / 900)})`
    : drag.x
      ? `translateX(${drag.x}px)`
      : undefined;

  return (
    <>
      <div
        ref={dialogRef}
        className={`fixed inset-0 z-50 flex flex-col overflow-x-hidden backdrop-blur-xl ${
          reducedMotion ? '' : motion === 'opening' ? 'viewer-backdrop-in' : ''
        } ${!reducedMotion && motion === 'closing' ? 'viewer-backdrop-out' : ''}`}
        style={{ backgroundColor: `rgba(0, 0, 0, ${motion === 'closing' ? 0 : backdrop})` }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="viewer-title"
        aria-describedby="viewer-position"
        aria-hidden={albumPickerOpen || undefined}
        data-viewer-motion={motion}
        data-viewer-day={formatDayLabel(photo.takenAt)}
        data-viewer-favorite={photo.favorite ? 'true' : 'false'}
        data-reduced-motion={reducedMotion ? 'true' : 'false'}
        data-origin={origin ? 'card' : 'none'}
        onClick={close}
      >
        <div
          className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-3 py-3 min-[800px]:px-8 min-[800px]:py-6 ${
            reducedMotion ? '' : 'viewer-chrome-in'
          }`}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 text-white">
            <button
              ref={closeRef}
              type="button"
              onClick={close}
              className="grid h-11 w-11 min-h-11 min-w-11 place-items-center rounded-full bg-white/10 transition duration-200 hover:bg-white/20 active:scale-95"
              aria-label={t('photo.close')}
            >
              <CloseIcon className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              {/*
                A real link, not a button that calls window.open: it honours
                cmd-click and middle-click, needs no popup-blocker exception,
                and the file is served by the same origin either way. For a
                format no browser can show, /api/original answers with the 2048
                display rendition rather than the raw bytes (ADR 0025), so what
                opens is always something that renders.
              */}
              <a
                href={photo.imageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="grid h-11 w-11 min-h-11 min-w-11 place-items-center rounded-full bg-white/10 transition duration-200 hover:bg-white/20 active:scale-95"
                aria-label={t('photo.openOriginal')}
                title={t('photo.openOriginal')}
              >
                <NewTabIcon className="h-5 w-5" />
              </a>
              <button
                type="button"
                onClick={() => setAlbumPickerOpen(true)}
                className="grid h-11 w-11 min-h-11 min-w-11 place-items-center rounded-full bg-white/10 transition duration-200 hover:bg-white/20 active:scale-95"
                aria-label={t('selection.addToAlbum')}
                title={t('selection.addToAlbum')}
              >
                <AlbumIcon className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => onToggleFavorite(photo.id, !photo.favorite)}
                className="grid h-11 w-11 min-h-11 min-w-11 place-items-center rounded-full bg-white/10 transition duration-200 hover:bg-white/20 active:scale-95"
                // Was hardcoded English, the one label in this dialog that
                // never reached the catalogue (ADR 0021). Same words, so
                // nothing that matches on the name changes.
                aria-label={favoriteLabel}
                title={favoriteLabel}
                aria-pressed={photo.favorite}
              >
                <HeartIcon
                  className={`h-5 w-5 ${photo.favorite ? 'text-peach heart-pop' : ''}`}
                  filled={photo.favorite}
                />
              </button>
            </div>
          </div>

          <h2
            id="viewer-title"
            className="mt-3 shrink-0 text-center text-xs uppercase tracking-[0.16em] text-white/80"
          >
            {formatCompactDate(photo.takenAt)} · {formatTime(photo.takenAt)}
          </h2>

          <div className="flex min-h-0 min-w-0 flex-1 items-stretch gap-1 py-3 min-[640px]:gap-3">
            <button
              type="button"
              onClick={() => go(-1)}
              disabled={!canPrev}
              className="grid h-11 w-11 min-h-11 min-w-11 shrink-0 self-center place-items-center rounded-full bg-white/10 text-white transition duration-200 hover:bg-white/20 disabled:opacity-30"
              aria-label={t('photo.previous')}
            >
              <ChevronLeftIcon className="h-5 w-5" />
            </button>
            <div
              data-viewer-stage
              className="relative flex min-h-0 min-w-0 flex-1 touch-none items-center justify-center overflow-hidden"
              onPointerDown={(event) => {
                if (closingRef.current) return;
                startRef.current = { x: event.clientX, y: event.clientY };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (!startRef.current) return;
                const next = {
                  x: event.clientX - startRef.current.x,
                  y: event.clientY - startRef.current.y,
                };
                dragRef.current = next;
                setDrag(next);
              }}
              onPointerUp={() => {
                const gesture = resolveViewerGesture(dragRef.current.x, dragRef.current.y);
                if (gesture === 'dismiss') close();
                else if (gesture === 'next') go(1);
                else if (gesture === 'prev') go(-1);
                startRef.current = null;
                dragRef.current = { x: 0, y: 0 };
                setDrag({ x: 0, y: 0 });
              }}
              onPointerCancel={() => {
                startRef.current = null;
                dragRef.current = { x: 0, y: 0 };
                setDrag({ x: 0, y: 0 });
              }}
            >
              {photo.kind === 'video' ? (
                <VideoStage photo={photo} />
              ) : (
                <img
                  key={photo.id}
                  ref={imgRef}
                  src={src}
                  alt={photoViewerAlt(photo, t, intl)}
                  draggable={false}
                  className={`max-h-[min(100%,calc(100dvh-12rem))] max-w-full rounded-2xl object-contain shadow-lift ${
                    !reducedMotion && motion === 'navigating' ? 'photo-crossfade' : ''
                  }`}
                  style={{ transform: dragTransform }}
                  onError={() => {
                    const fallback = viewerFallbackSrc(photo);
                    if (src !== fallback) setSrc(fallback);
                  }}
                />
              )}
            </div>
            <button
              type="button"
              onClick={() => go(1)}
              disabled={!canNext}
              className="grid h-11 w-11 min-h-11 min-w-11 shrink-0 self-center place-items-center rounded-full bg-white/10 text-white transition duration-200 hover:bg-white/20 disabled:opacity-30"
              aria-label={t('photo.next')}
            >
              <ChevronRightIcon className="h-5 w-5" />
            </button>
          </div>

          <p
            id="viewer-position"
            className="shrink-0 text-center text-xs text-white/80"
            role="status"
          >
            {index + 1} of {photos.length}
          </p>
        </div>
      </div>

      {albumPickerOpen && (
        <>
          <div
            className="fixed inset-0 z-[55] bg-black/40"
            aria-hidden
            onClick={() => setAlbumPickerOpen(false)}
          />
          <PhotoActionsMenu
            photo={photo}
            albums={albums}
            onClose={() => setAlbumPickerOpen(false)}
            onToggleFavorite={onToggleFavorite}
            onAddToAlbum={onAddToAlbum}
          />
        </>
      )}
    </>
  );
}

function lastIndex<T>(list: T[]): number {
  return list.length - 1;
}
