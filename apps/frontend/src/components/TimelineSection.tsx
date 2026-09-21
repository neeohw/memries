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
}: {
  group: TimelineGroup;
  granularity: Granularity;
  onOpen: (photo: Photo, origin: HTMLElement) => void;
  onActions?: (photo: Photo, origin: HTMLElement) => void;
  showHeading: boolean;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const { ref, visible } = useRevealOnScroll<HTMLElement>();

  return (
    <section className="px-3 pb-6 min-[640px]:px-5" aria-labelledby={`period-${group.key}`}>
      {showHeading && (
        <header
          ref={ref}
          className={`mb-2 flex items-baseline gap-2 pt-1 ${reducedMotion ? '' : visible ? 'reveal-in' : 'reveal'}`}
        >
          <h2
            id={`period-${group.key}`}
            className="font-display text-base font-semibold leading-tight tracking-tight text-plum"
          >
            {group.label}
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
    </section>
  );
}
