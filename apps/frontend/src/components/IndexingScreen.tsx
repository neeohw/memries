import { useEffect } from 'react';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { canRetryIndex, indexStatusCopy, type IndexStatus } from '../lib/indexStatus';

export function IndexingScreen({
  status,
  leaving,
  onExited,
  onRetry,
  retrying,
  loadError,
}: {
  status?: IndexStatus;
  leaving: boolean;
  onExited: () => void;
  onRetry?: () => void;
  retrying?: boolean;
  loadError?: boolean;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const copy = loadError
    ? 'We could not reach the library.'
    : status
      ? indexStatusCopy(status)
      : 'Opening your album…';
  const showRetry = loadError || (!!status && canRetryIndex(status));
  const discovered = status?.discovered ?? 0;
  const processed = status?.processed ?? 0;
  const progress = discovered > 0 ? Math.min(100, Math.round((processed / discovered) * 100)) : 0;

  useEffect(() => {
    if (!leaving) return;
    if (reducedMotion) {
      onExited();
      return;
    }
    const timer = window.setTimeout(onExited, 420);
    return () => window.clearTimeout(timer);
  }, [leaving, reducedMotion, onExited]);

  return (
    <div
      // `pointer-events-none` once it starts fading: for the 420ms between the
      // fade and the unmount this is a full-screen z-40 overlay, and without
      // it a click in that window lands on something invisible and is lost.
      // The unmount is not guaranteed to be prompt either — `leaving` is
      // derived from the index status, and a flip back inside the window
      // clears the timer and leaves the splash mounted at opacity-0.
      className={`fixed inset-0 z-40 grid place-items-center bg-cream px-6 text-plum transition-opacity duration-300 ease-out ${
        leaving && !reducedMotion ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
      data-indexing-splash
      role="status"
      aria-live="polite"
      aria-busy={!leaving && !showRetry}
    >
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <div className="relative grid h-20 w-20 place-items-center" aria-hidden>
          <span className="index-spin absolute inset-0 rounded-full border-2 border-plum/10 border-t-peach" />
          <span className="index-pulse h-8 w-8 rounded-full bg-gradient-to-br from-peach to-blush" />
        </div>
        <p className="sr-only">Indexing files on disk</p>
        <h2 className="mt-8 font-display text-2xl font-semibold tracking-tight">
          Indexing your files
        </h2>
        <p className="mt-3 min-h-6 text-sm leading-relaxed text-ink/70">{copy}</p>
        {discovered > 0 && !showRetry && (
          <div
            className="mt-6 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-plum/10"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={discovered}
            aria-valuenow={processed}
            aria-label="Indexing progress"
          >
            <div
              className="h-full rounded-full bg-peach transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
        {showRetry && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="mt-6 min-h-11 rounded-full bg-plum px-5 text-sm font-medium text-cream disabled:opacity-40"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
