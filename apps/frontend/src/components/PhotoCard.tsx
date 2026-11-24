import { useRef, useState } from 'react';
import { usePhotoPress } from '../hooks/usePhotoPress';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { useRevealOnScroll } from '../hooks/useRevealOnScroll';
import { useViewportWidth } from '../hooks/useViewportWidth';
import { useI18n } from '../i18n/I18nProvider';
import { usePhotoSelection } from '../hooks/usePhotoSelection';
import { photoOpenLabel, photoSelectLabel } from '../lib/photoName';
import { compactThumbSize, sizedThumbUrl, timelineSrc, type PhotoDensity } from '../lib/photoSrc';
import type { Photo } from '../models/photo';
import { formatDuration } from '../lib/duration';
import { FavoriteBadge } from './FavoriteBadge';
import { CheckIcon, PlayIcon } from './icons';

export type { PhotoDensity };

export function PhotoCard({
  photo,
  density,
  showImage = true,
  size,
  revealIndex = 0,
  onOpen,
  onActions,
}: {
  photo: Photo;
  density: PhotoDensity;
  /** Fixed tile box from the justified layout; overrides the density aspect rules. */
  size?: { width: number; height: number };
  showImage?: boolean;
  revealIndex?: number;
  onOpen: (photo: Photo, origin: HTMLElement) => void;
  onActions?: (photo: Photo, origin: HTMLElement) => void;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const { ref: revealRef, visible } = useRevealOnScroll<HTMLElement>();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [loaded, setLoaded] = useState(false);
  const viewportWidth = useViewportWidth();
  const compact = density === 'thumb' || density === 'medium';
  const box = compact ? compactThumbSize(viewportWidth) : undefined;
  const src = size
    ? sizedThumbUrl(photo.id, Math.max(size.width, size.height), photo.hash)
    : timelineSrc(photo, density, viewportWidth);

  const { t, intl } = useI18n();
  const selection = usePhotoSelection();
  const selected = selection.selected.has(photo.id);

  const press = usePhotoPress({
    onOpen: () => {
      // Once anything is selected, a plain click extends the selection rather
      // than opening the viewer — the same modal behaviour as Google Photos.
      if (selection.active) {
        selection.toggle(photo.id);
        return;
      }
      if (buttonRef.current) onOpen(photo, buttonRef.current);
    },
    onActions: onActions
      ? () => {
          if (buttonRef.current) onActions(photo, buttonRef.current);
        }
      : undefined,
  });

  const imageKey = `${photo.id}:${src}:${density}:${showImage}`;
  const [seenImageKey, setSeenImageKey] = useState(imageKey);
  if (seenImageKey !== imageKey) {
    setSeenImageKey(imageKey);
    setLoaded(false);
  }

  const radius = density === 'thumb' || size ? 'rounded-md' : 'rounded-2xl';
  // A small tile wants a smaller glyph, or the play mark covers the picture.
  const tiny = density === 'thumb' || (size ? Math.min(size.width, size.height) < 160 : false);

  // The label has to say what the click will actually do.
  const ariaLabel = selection.active
    ? photoSelectLabel(photo, selected, t, intl)
    : photoOpenLabel(photo, t, intl);

  return (
    <figure
      ref={revealRef}
      className={`group relative ${size ? 'shrink-0' : 'h-full'} ${reducedMotion ? '' : visible ? 'reveal-in' : 'reveal'}`}
      style={{
        ['--reveal-delay' as string]: `${Math.min(revealIndex, 8) * 40}ms`,
        width: size?.width,
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={press.onClick}
        onPointerDown={press.onPointerDown}
        onPointerMove={press.onPointerMove}
        onPointerUp={press.onPointerUp}
        onPointerCancel={press.onPointerCancel}
        onContextMenu={press.onContextMenu}
        onKeyDown={press.onKeyDown}
        className={`relative block w-full overflow-hidden ${radius} bg-blush/40 transition duration-300 ease-out active:scale-[0.985]`}
        style={
          size
            ? { width: size.width, height: size.height }
            : {
                aspectRatio: density === 'thumb' ? '1 / 1' : `${photo.width} / ${photo.height}`,
                maxHeight:
                  density === 'day'
                    ? 'min(70vh, 760px)'
                    : density === 'featured'
                      ? 'min(52vh, 560px)'
                      : undefined,
              }
        }
        aria-label={ariaLabel}
        aria-haspopup={onActions ? 'dialog' : undefined}
      >
        {showImage && !loaded && <span className="skeleton absolute inset-0" aria-hidden />}
        {showImage && (
          <img
            src={src}
            alt=""
            width={box ?? photo.width}
            height={box ?? photo.height}
            loading="lazy"
            decoding="async"
            className={`h-full w-full object-cover transition duration-300 ease-out ${
              loaded ? 'opacity-100' : 'opacity-0'
            } ${reducedMotion ? '' : 'group-hover:scale-[1.02]'}`}
            sizes={
              size
                ? `${Math.round(size.width)}px`
                : density === 'thumb'
                  ? '(max-width: 640px) 25vw, (max-width: 800px) 18vw, 140px'
                  : density === 'day' || density === 'featured'
                    ? '(max-width: 800px) 92vw, 720px'
                    : '(max-width: 640px) 48vw, 360px'
            }
            onLoad={() => setLoaded(true)}
          />
        )}
        {photo.favorite && (
          <FavoriteBadge compact={density === 'thumb' || (size ? size.height < 200 : false)} />
        )}
        {/* A poster frame is just a photo until something says otherwise, so
            a clip has to announce itself on the tile (ADR 0029). A play glyph
            in the middle is the shape everyone already reads as "this moves";
            a mark in a corner was too easy to miss. The label is on the
            button's aria-label, so all of this is decoration. */}
        {photo.kind === 'video' && (
          <span aria-hidden data-video-badge className="pointer-events-none">
            <span
              className={`absolute left-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white shadow-lift backdrop-blur-[2px] transition duration-200 group-hover:bg-black/60 ${
                tiny ? 'h-7 w-7' : 'h-10 w-10'
              }`}
            >
              {/* Nudged right: a triangle's visual centre is left of its box. */}
              <PlayIcon className={tiny ? 'h-3.5 w-3.5 pl-px' : 'h-5 w-5 pl-0.5'} />
            </span>
            {formatDuration(photo.durationMs) && (
              <span className="absolute bottom-1.5 right-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
                {formatDuration(photo.durationMs)}
              </span>
            )}
          </span>
        )}
        {selected && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[inherit] bg-plum/30 ring-2 ring-inset ring-plum"
          />
        )}
      </button>

      {/* A sibling of the tile, not a child: the tile is itself a button and
          buttons cannot nest. Hidden until hover or focus unless a selection
          is already running, which is when it becomes the primary control. */}
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={photoSelectLabel(photo, selected, t, intl)}
        data-select-photo
        onClick={(event) => {
          event.stopPropagation();
          selection.toggle(photo.id, { shiftKey: event.shiftKey });
        }}
        className={`absolute left-1.5 top-1.5 z-10 grid h-6 w-6 place-items-center rounded-full border transition ${
          selected
            ? 'border-plum bg-plum text-cream'
            : 'border-cream/80 bg-black/25 text-transparent hover:text-cream/90'
        } ${
          selected || selection.active
            ? 'opacity-100'
            : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100'
        }`}
      >
        <CheckIcon className="h-3.5 w-3.5" />
      </button>
    </figure>
  );
}
