import { useI18n } from '../i18n/I18nProvider';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { useRevealOnScroll } from '../hooks/useRevealOnScroll';
import type { Granularity, Photo, TimelineGroup } from '../models/photo';
import { PhotoGrid } from './PhotoGrid';

export function TimelineSection({
  group,
  granularity,
  onOpen,
  onActions,
  showHeading,
  onDrillIn,
  drillHintId,
}: {
  group: TimelineGroup;
  granularity: Granularity;
  onOpen: (photo: Photo, origin: HTMLElement) => void;
  onActions?: (photo: Photo, origin: HTMLElement) => void;
  showHeading: boolean;
  /** Zoom one level in, anchored on this group. Absent at the closest level. */
  onDrillIn?: (group: TimelineGroup) => void;
  /** Shared `sr-only` node saying what the heading does (ADR 0019). */
  drillHintId?: string;
}) {
  const { t } = useI18n();
  const reducedMotion = usePrefersReducedMotion();
  const { ref, visible } = useRevealOnScroll<HTMLElement>();
  // Year view is handed a sample of the year, so the grid is not the period
  // (ADR 0031). Saying how many are missing is what makes the sample read as
  // a way in rather than as the whole shelf.
  const hidden = Math.max(0, group.total - group.photos.length);

  return (
    <section className="px-3 pb-6 min-[640px]:px-5" aria-labelledby={`period-${group.key}`}>
      {showHeading && (
        <header
          ref={ref}
          className={`mb-2 flex items-baseline gap-2 pt-1 ${reducedMotion ? '' : visible ? 'reveal-in' : 'reveal'}`}
        >
          {/*
            The heading itself drills in: clicking "2026" shows that year by
            month, anchored where it was clicked (ADR 0019).

            The action is carried by `aria-describedby`, not by the button's
            label, so the heading's accessible name stays the period alone —
            it is what this section is labelled by.
          */}
          <h2
            id={`period-${group.key}`}
            className="font-display text-base font-semibold leading-tight tracking-tight text-plum"
          >
            {onDrillIn ? (
              <button
                type="button"
                onClick={() => onDrillIn(group)}
                aria-describedby={drillHintId}
                className="rounded-sm text-left transition-colors duration-200 hover:text-blush hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {group.label}
              </button>
            ) : (
              group.label
            )}
          </h2>
          <p className="text-xs text-ink">{group.sublabel}</p>
        </header>
      )}
      <PhotoGrid
        photos={group.photos}
        granularity={granularity}
        onOpen={onOpen}
        onActions={onActions}
      />
      {hidden > 0 && onDrillIn && (
        <div className="mt-2 flex">
          <button
            type="button"
            onClick={() => onDrillIn(group)}
            className="min-h-9 rounded-full bg-surface/70 px-4 text-sm font-medium text-plum transition duration-200 hover:bg-surface hover:text-blush focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-95"
          >
            {t('timeline.showAllInPeriod', { count: hidden, period: group.label })}
          </button>
        </div>
      )}
    </section>
  );
}
