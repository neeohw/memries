import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { VList, type VListHandle } from 'virtua';
import { groupPhotos, nearestGroupIndex } from '../lib/groupPhotos';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import type { Granularity, Photo } from '../models/photo';
import { CurrentPeriod } from './CurrentPeriod';
import { GranularitySelector } from './GranularitySelector';
import { PhotoSkeleton } from './PhotoSkeleton';
import { TimelineSection } from './TimelineSection';
import { FilterIcon, SyncIcon, TodayIcon } from './icons';

export function Timeline({
  photos,
  granularity,
  onGranularityChange,
  onOpen,
  onActions,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  fetchError,
  onRescan,
  rescanning,
  onFilter,
}: {
  photos: Photo[];
  granularity: Granularity;
  onGranularityChange: (value: Granularity) => void;
  onOpen: (photo: Photo, origin: HTMLElement, list: Photo[]) => void;
  onActions?: (photo: Photo, origin: HTMLElement) => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: () => void;
  fetchError?: boolean;
  onRescan?: () => void;
  rescanning?: boolean;
  onFilter?: () => void;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const groups = useMemo(() => groupPhotos(photos, granularity), [photos, granularity]);
  const listRef = useRef<VListHandle>(null);
  const anchorRef = useRef<string | null>(null);
  const [activeLabel, setActiveLabel] = useState(groups[0]?.label ?? '');
  const [periodDirection, setPeriodDirection] = useState<'older' | 'newer'>('older');
  const [scrolling, setScrolling] = useState(false);
  const [showToday, setShowToday] = useState(false);
  const startIndexRef = useRef(0);
  const lastOffsetRef = useRef(0);
  const scrollIdleRef = useRef<number | undefined>(undefined);

  const orderedPhotos = useMemo(() => groups.flatMap((group) => group.photos), [groups]);

  const groupsRef = useRef(groups);

  useLayoutEffect(() => {
    groupsRef.current = groups;
  });

  useLayoutEffect(() => {
    const current = groupsRef.current;
    const nextLabel = current[0]?.label ?? '';
    setActiveLabel(nextLabel);
    setPeriodDirection('older');
    setScrolling(false);
    setShowToday(false);
    startIndexRef.current = 0;
    lastOffsetRef.current = 0;
    const anchor = anchorRef.current;
    if (!anchor || !listRef.current || current.length === 0) return;
    const index = nearestGroupIndex(current, anchor);
    listRef.current.scrollToIndex(index, { align: 'start' });
    if (index > 0) setShowToday(true);
    anchorRef.current = null;
  }, [granularity]);

  const handleGranularity = (next: Granularity) => {
    if (next === granularity) return;
    const handle = listRef.current;
    if (handle) {
      const group = groups[Math.min(handle.findStartIndex(), Math.max(0, groups.length - 1))];
      anchorRef.current = group?.photos[0]?.takenAt ?? null;
    }
    onGranularityChange(next);
  };

  const markScrolling = useCallback(() => {
    if (reducedMotion) return;
    setScrolling(true);
    window.clearTimeout(scrollIdleRef.current);
    scrollIdleRef.current = window.setTimeout(() => setScrolling(false), 340);
  }, [reducedMotion]);

  useEffect(() => () => window.clearTimeout(scrollIdleRef.current), []);

  const openFrom = (photo: Photo, origin: HTMLElement) => {
    onOpen(photo, origin, orderedPhotos);
  };

  const requestNextPage = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage || fetchError) return;
    fetchNextPage?.();
  }, [fetchError, fetchNextPage, hasNextPage, isFetchingNextPage]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h1 className="sr-only">Your memries</h1>
      <div className="relative z-20 flex items-center gap-2 px-3 py-2 min-[640px]:px-5">
        {/* Narrow screens: the period floats over the photos as a pill while scrolling. */}
        <div
          className={`min-w-0 flex-1 max-[639px]:pointer-events-none max-[639px]:absolute max-[639px]:inset-x-0 max-[639px]:top-full max-[639px]:flex max-[639px]:justify-center max-[639px]:transition-opacity max-[639px]:duration-300 ${
            scrolling ? '' : 'max-[639px]:opacity-0'
          }`}
        >
          <div className="min-w-0 max-[639px]:rounded-full max-[639px]:bg-surface/90 max-[639px]:px-4 max-[639px]:shadow-lift max-[639px]:backdrop-blur-md">
            {activeLabel && (
              <CurrentPeriod
                key={granularity}
                label={activeLabel}
                scrolling={scrolling}
                direction={periodDirection}
                reducedMotion={reducedMotion}
              />
            )}
          </div>
        </div>
        <GranularitySelector
          value={granularity}
          onChange={handleGranularity}
          className="max-[639px]:flex-1"
        />
        {onFilter && (
          <button
            type="button"
            onClick={onFilter}
            aria-label="Filter"
            title="Filter"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink transition duration-200 hover:bg-surface/70 hover:text-plum active:scale-95"
          >
            <FilterIcon className="h-5 w-5" />
          </button>
        )}
        {onRescan && (
          <button
            type="button"
            onClick={onRescan}
            disabled={rescanning}
            aria-label={rescanning ? 'Syncing…' : 'Sync folder'}
            title={rescanning ? 'Syncing…' : 'Sync folder'}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink transition duration-200 hover:bg-surface/70 hover:text-plum active:scale-95 disabled:opacity-50"
          >
            <SyncIcon className={`h-5 w-5 ${rescanning && !reducedMotion ? 'index-spin' : ''}`} />
          </button>
        )}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center" role="status">
            <p className="text-ink">No memories here yet.</p>
            {onRescan && (
              <button
                type="button"
                onClick={onRescan}
                disabled={rescanning}
                className="mt-5 min-h-11 rounded-full bg-plum px-5 text-sm font-medium text-cream disabled:opacity-60"
              >
                {rescanning ? 'Scanning your folder…' : 'Scan your folder'}
              </button>
            )}
          </div>
        ) : (
          <div
            key={granularity}
            data-timeline
            data-group-count={groups.length}
            data-timeline-motion={reducedMotion ? 'none' : 'fade-rise'}
            className={`h-full ${reducedMotion ? '' : 'animate-fade-rise'}`}
            ref={(node) => {
              if (!node) return;
              Object.assign(node, {
                __scrollToGroup(index: number) {
                  const current = groupsRef.current;
                  const max = Math.max(0, current.length - 1);
                  const next = Math.min(Math.max(0, index), max);
                  listRef.current?.scrollToIndex(next, { align: 'start' });
                  const label = current[next]?.label;
                  if (label) setActiveLabel(label);
                  setShowToday(next > 0);
                },
              });
            }}
          >
            <VList
              ref={listRef}
              style={{ height: '100%' }}
              onScroll={(offset) => {
                const handle = listRef.current;
                const start = handle?.findStartIndex() ?? 0;
                setShowToday(offset > 280 && start > 0);
                if (start !== startIndexRef.current) {
                  setPeriodDirection(start > startIndexRef.current ? 'older' : 'newer');
                  startIndexRef.current = start;
                }
                if (Math.abs(offset - lastOffsetRef.current) > 2) markScrolling();
                lastOffsetRef.current = offset;
                const label = groups[start]?.label;
                if (label) setActiveLabel(label);
                if (start >= Math.max(0, groups.length - 2)) requestNextPage();
              }}
            >
              {groups.map((group) => (
                <TimelineSection
                  key={`${granularity}-${group.key}`}
                  group={group}
                  granularity={granularity}
                  onOpen={openFrom}
                  onActions={onActions}
                  showHeading
                />
              ))}
              <div className="px-3 pb-8 min-[640px]:px-5">
                <LoadMoreMarker
                  onVisible={requestNextPage}
                  enabled={!!hasNextPage && !isFetchingNextPage && !fetchError}
                />
                {isFetchingNextPage && (
                  <p className="py-3 text-center text-sm text-ink" role="status">
                    Loading more memories…
                  </p>
                )}
                {fetchError && (
                  <div className="flex flex-col items-center gap-3 py-4 text-center" role="alert">
                    <p className="text-sm text-ink">More memories did not load.</p>
                    <button
                      type="button"
                      onClick={() => fetchNextPage?.()}
                      className="min-h-11 rounded-full bg-plum px-5 text-sm font-medium text-cream"
                    >
                      Try again
                    </button>
                  </div>
                )}
                {!hasNextPage && !isFetchingNextPage && <div className="h-8" />}
              </div>
            </VList>
          </div>
        )}

        {showToday && (
          <button
            type="button"
            onClick={() =>
              listRef.current?.scrollToIndex(0, { align: 'start', smooth: !reducedMotion })
            }
            className={`absolute bottom-4 right-4 z-20 flex min-h-11 items-center gap-2 rounded-full bg-plum px-4 py-2 text-sm font-medium text-cream shadow-lift transition duration-200 active:scale-95 min-[800px]:bottom-6 min-[800px]:right-6 ${
              reducedMotion ? '' : 'animate-fab-in'
            }`}
            aria-label="Back to today"
            data-today-fab
          >
            <TodayIcon className="h-4 w-4" />
            Today
          </button>
        )}
      </div>
    </div>
  );
}

function LoadMoreMarker({ onVisible, enabled }: { onVisible: () => void; enabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onVisible();
      },
      { rootMargin: '320px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, onVisible]);
  return <div ref={ref} className="h-px w-full" aria-hidden />;
}

export function TimelineLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pb-4 min-[640px]:px-6">
        <div className="skeleton mb-2 h-3 w-24 rounded-full" />
        <div className="skeleton h-8 w-48 rounded-full" />
      </div>
      <div className="px-4 min-[640px]:px-6">
        <div className="skeleton mb-6 h-12 w-full rounded-full" />
        <PhotoSkeleton />
      </div>
    </div>
  );
}
