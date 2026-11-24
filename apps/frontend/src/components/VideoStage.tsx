import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import type { Photo } from '../models/photo';

/**
 * Plays a clip in the viewer (ADR 0029).
 *
 * Opening a clip plays it. Pressing a tile with a play mark on it is a
 * request to watch, and making someone press play twice is a tax on the
 * obvious case.
 *
 * Autoplay policies make that less simple than it sounds. A browser may
 * refuse to start a clip with sound, and the refusal is a rejected promise
 * rather than an error event, so it would otherwise read as a frozen poster.
 * When that happens the clip is muted and started again: a silent clip with
 * its controls right there beats a still frame that looks broken. The unmute
 * is one click away, where play would have been.
 *
 * Support is decided by trying, not by asking. `canPlayType('video/quicktime')`
 * answers "" in Chromium browsers that play .mov perfectly well, so the honest
 * test is the `error` event — measured, not assumed.
 */
/** Normalises play(), which predates promises and can still return nothing. */
function start(el: HTMLVideoElement): Promise<void> {
  try {
    return Promise.resolve(el.play());
  } catch (err) {
    return Promise.reject(err);
  }
}

export function VideoStage({ photo, className }: { photo: Photo; className?: string }) {
  const { t } = useI18n();
  const ref = useRef<HTMLVideoElement>(null);
  const [mutedByPolicy, setMutedByPolicy] = useState(false);
  const [failed, setFailed] = useState(false);
  // A new clip deserves a fresh verdict: the previous one failing says
  // nothing about this one. Reset during render rather than in an effect, so
  // the new clip never paints behind the old one's error for a frame — the
  // same shape PhotoCard uses to forget a loaded image.
  const [seenId, setSeenId] = useState(photo.id);
  if (seenId !== photo.id) {
    setSeenId(photo.id);
    setFailed(false);
  }

  // Starting playback is talking to the element, not React state, which is
  // what an effect is for. The clip id is the dependency: the viewer keeps
  // one element and swaps the source as you move through the library.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    setMutedByPolicy(false);
    el.muted = false;
    // play() returns a promise in every browser that matters and undefined in
    // the ones that do not, so the result is normalised rather than trusted.
    start(el).catch(() => {
      if (cancelled || !ref.current) return;
      // Blocked for having sound. Mute and try once more rather than leaving
      // a poster that looks like a broken player.
      ref.current.muted = true;
      start(ref.current).then(
        () => {
          if (!cancelled) setMutedByPolicy(true);
        },
        () => undefined,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [photo.id]);

  if (failed) {
    return (
      <div
        data-video-unsupported
        className={`grid max-w-md gap-3 rounded-2xl bg-white/10 p-6 text-center text-white ${className ?? ''}`}
        role="alert"
      >
        <p className="text-sm">{t('photo.videoUnsupported')}</p>
        <a
          href={photo.imageUrl}
          download
          className="mx-auto min-h-10 rounded-full bg-white/15 px-4 py-2 text-sm font-medium text-white hover:bg-white/25"
        >
          {t('photo.videoDownload')}
        </a>
      </div>
    );
  }

  return (
    <div className="relative flex max-h-full max-w-full items-center justify-center">
      <video
        key={photo.id}
        ref={ref}
        src={photo.imageUrl}
        poster={photo.thumbnailUrl}
        controls
        autoPlay
        playsInline
        // The clip starts playing, so the browser fetches what it needs as it
        // goes — byte ranges mean that is a stream, not a half-gigabyte
        // download up front (ADR 0029).
        preload="auto"
        onError={() => setFailed(true)}
        // The viewer navigates on a drag, and dragging a scrubber is not a
        // swipe to the next photo.
        onPointerDown={(event) => event.stopPropagation()}
        onPointerMove={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        className={`max-h-[min(100%,calc(100dvh-12rem))] max-w-full rounded-2xl bg-black object-contain shadow-lift ${className ?? ''}`}
      />
      {mutedByPolicy && (
        <p
          data-muted-note
          className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/65 px-3 py-1 text-xs text-white"
        >
          {t('photo.videoMuted')}
        </p>
      )}
    </div>
  );
}
