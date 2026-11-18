import { canZoomIn, canZoomOut, zoomBy, zoomDisplayLabel, zoomLabel } from '../lib/zoom';
import type { Granularity } from '../models/photo';
import { MinusIcon, PlusIcon } from './icons';

/**
 * Zoom in and out of the timeline (ADR 0019).
 *
 * Replaces the Year / Month / Week radiogroup. Ctrl/Cmd + wheel is the primary
 * way to zoom, but a gesture cannot be the only way: there would be nothing
 * for a keyboard or a screen reader to reach, and nothing to discover. These
 * two buttons are that control, at about a third of the row's width.
 *
 * Each button says what it does *and* where it lands, since "Zoom in" alone
 * tells a screen-reader user nothing about the grouping they are moving to.
 */
export function ZoomControl({
  value,
  onChange,
  className = '',
}: {
  value: Granularity;
  onChange: (value: Granularity) => void;
  className?: string;
}) {
  const inAvailable = canZoomIn(value);
  const outAvailable = canZoomOut(value);

  return (
    <div
      data-zoom-control
      data-granularity={value}
      role="group"
      aria-label="Timeline zoom"
      // Below 640px the period label is absolutely positioned under the
      // header, so this control and the two icon buttons are the whole row.
      // Stretching it keeps those buttons on the right edge where they were,
      // instead of leaving the row left-aligned with dead space, and spreads
      // −, level and + evenly like the segmented control it replaces.
      className={`relative flex shrink-0 items-center gap-0.5 rounded-full bg-surface/55 p-0.5 shadow-inner backdrop-blur-md max-[639px]:flex-1 max-[639px]:justify-between ${className}`}
    >
      <button
        type="button"
        onClick={() => onChange(zoomBy(value, -1))}
        disabled={!outAvailable}
        aria-label="Zoom out, group by a longer period"
        title="Zoom out (Ctrl + scroll)"
        className="grid h-9 w-9 place-items-center rounded-full text-ink transition duration-200 hover:bg-surface hover:text-plum active:scale-95 disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <MinusIcon className="h-4 w-4" />
      </button>

      {/*
        The level sits between the buttons, so −/+ read as moving along a
        named ladder rather than changing something unstated.

        Fixed width: Year, Month and Week are different lengths, and letting
        the box resize would shift both buttons under the pointer on every
        press — the one place a reader is most likely to click again.

        aria-hidden, with the announcement in the live region below: a screen
        reader hearing a bare "Month" learns nothing about what changed, and
        announcing both would say it twice.
      */}
      <span
        aria-hidden
        className="w-14 shrink-0 select-none text-center text-xs font-medium text-plum min-[640px]:text-sm"
      >
        {zoomDisplayLabel(value)}
      </span>
      <p aria-live="polite" className="sr-only">
        {zoomLabel(value)}
      </p>

      <button
        type="button"
        onClick={() => onChange(zoomBy(value, 1))}
        disabled={!inAvailable}
        aria-label="Zoom in, group by a shorter period"
        title="Zoom in (Ctrl + scroll)"
        className="grid h-9 w-9 place-items-center rounded-full text-ink transition duration-200 hover:bg-surface hover:text-plum active:scale-95 disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <PlusIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
