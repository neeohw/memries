import { useCallback, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { formatMonthLabel } from '../lib/formatDate';
import {
  type ScrubberScale,
  fractionForKey,
  keyAtFraction,
  segmentIndexAtFraction,
  yearTicks,
} from '../lib/scrubberScale';

/** Months per PageUp / PageDown step. */
const YEAR_STEP = 12;

export function Scrubber({
  scale,
  value,
  onSeek,
  seeking = false,
  revealed = false,
  reducedMotion = false,
}: {
  scale: ScrubberScale;
  /** Position of the timeline's current month on the track, 0 (newest) to 1. */
  value: number;
  onSeek: (monthKey: string) => void;
  /** A jump is paging older photos into view. */
  seeking?: boolean;
  /** The list is scrolling, so show the track without needing a hover. */
  revealed?: boolean;
  reducedMotion?: boolean;
}) {
  const { t } = useI18n();
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragFraction, setDragFraction] = useState<number | null>(null);
  const [active, setActive] = useState(false);

  const fractionFromClientY = useCallback((clientY: number) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    if (rect.height <= 0) return 0;
    return Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
  }, []);

  const segments = scale.segments;
  // One month is not a timeline worth scrubbing. Below every hook, so the
  // render order stays identical whether or not the track is shown.
  if (segments.length < 2) return null;

  const index = segmentIndexAtFraction(scale, value);
  // While dragging, the bubble follows the pointer; the thumb still shows where
  // the list actually is, so the two are visibly reconciled on release.
  const previewFraction = dragFraction ?? value;
  const previewKey = keyAtFraction(scale, previewFraction);
  const currentKey = keyAtFraction(scale, value);

  const seekToIndex = (next: number) => {
    const clamped = Math.min(segments.length - 1, Math.max(0, next));
    onSeek(segments[clamped].key);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    // Up is newer, which is a lower index: the track runs newest-first.
    const moves: Record<string, number | undefined> = {
      ArrowUp: index - 1,
      ArrowLeft: index - 1,
      ArrowDown: index + 1,
      ArrowRight: index + 1,
      PageUp: index - YEAR_STEP,
      PageDown: index + YEAR_STEP,
      Home: 0,
      End: segments.length - 1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    seekToIndex(next);
  };

  // Dragging previews rather than seeking on every frame. A live seek would
  // start a fetch-forward for each month crossed; the commit on release does
  // it once.
  const onPointerDown = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragFraction(fractionFromClientY(event.clientY));
    setActive(true);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (dragFraction === null) return;
    setDragFraction(fractionFromClientY(event.clientY));
  };

  const endDrag = (event: React.PointerEvent) => {
    if (dragFraction === null) return;
    const key = keyAtFraction(scale, fractionFromClientY(event.clientY));
    setDragFraction(null);
    if (key) onSeek(key);
  };

  const show = revealed || active || dragFraction !== null;
  const motion = reducedMotion ? '' : 'transition-opacity duration-200';

  return (
    <div
      data-scrubber
      className={`absolute right-0 top-0 z-30 flex h-full w-12 justify-end ${motion} ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
      onPointerEnter={() => setActive(true)}
      onPointerLeave={() => dragFraction === null && setActive(false)}
    >
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={t('timeline.jumpToDate')}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={segments.length - 1}
        aria-valuenow={index}
        aria-valuetext={currentKey ? formatMonthLabel(currentKey) : undefined}
        aria-busy={seeking || undefined}
        onKeyDown={onKeyDown}
        onFocus={() => setActive(true)}
        onBlur={() => dragFraction === null && setActive(false)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative h-full w-8 cursor-pointer touch-none outline-none focus-visible:ring-2 focus-visible:ring-plum/40"
      >
        {/* Year labels. aria-hidden because the slider already announces the
            month through aria-valuetext. */}
        <div aria-hidden className="absolute inset-y-0 right-0 w-8">
          {yearTicks(scale).map((tick) => (
            <div
              key={tick.year}
              className="absolute right-1 flex translate-y-[-50%] items-center gap-1"
              style={{ top: `${tick.fraction * 100}%` }}
            >
              <span className="text-[10px] font-medium tabular-nums text-ink/70">{tick.year}</span>
              <span className="h-px w-2 bg-plum/30" />
            </div>
          ))}
        </div>

        {/* Thumb: where the list actually is. */}
        <div
          aria-hidden
          data-scrubber-thumb
          className="absolute right-1 h-1 w-5 translate-y-[-50%] rounded-full bg-plum"
          style={{ top: `${fractionForKey(scale, currentKey) * 100}%` }}
        />

        {(active || dragFraction !== null) && previewKey && (
          <div
            aria-hidden
            data-scrubber-bubble
            className="absolute right-9 translate-y-[-50%] whitespace-nowrap rounded-full bg-plum px-3 py-1 text-xs font-medium text-cream shadow-lift"
            style={{ top: `${previewFraction * 100}%` }}
          >
            {formatMonthLabel(previewKey)}
            {seeking && <span className="ml-1 opacity-70">…</span>}
          </div>
        )}
      </div>
    </div>
  );
}
