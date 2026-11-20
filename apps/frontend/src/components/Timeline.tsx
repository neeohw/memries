import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { VList, type VListHandle } from 'virtua';
import { groupPhotos, nearestGroupIndex } from '../lib/groupPhotos';
import {
  type HistogramBucket,
  buildScrubberScale,
  fractionForDate,
  groupIndexForMonth,
} from '../lib/scrubberScale';
import { PhotoSelectionProvider, useSelectionState } from '../hooks/usePhotoSelection';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { selectionIsAllFavorited } from '../lib/selection';
import { accumulateZoom, canZoomIn, nextLevelNoun, wheelPixels, zoomBy } from '../lib/zoom';
import type { Album, Granularity, Photo, TimelineGroup } from '../models/photo';
import { CurrentPeriod } from './CurrentPeriod';
import { ZoomControl } from './ZoomControl';
import { PhotoSkeleton } from './PhotoSkeleton';
import { Scrubber } from './Scrubber';
import { SelectionToolbar } from './SelectionToolbar';
import { TimelineSection } from './TimelineSection';
import { FilterIcon, SyncIcon, TodayIcon } from './icons';

/**
 * The group whose period the header should name.
 *
 * Normally that is the group at the top of the viewport. At the very bottom of
 * the list it cannot be: the last group has nothing below it to scroll
 * against, so the scroll clamps while an older group is still under the top
 * edge, and `findStartIndex` keeps naming a period the reader has already
 * scrolled past. Reaching the end of a library and being told you are looking
 * at a later month is simply wrong, so name the last group on screen instead.
 */
export function currentGroupIndex(
  handle: Pick<VListHandle, 'scrollSize' | 'viewportSize' | 'scrollOffset' | 'findEndIndex'> | null,
  startIndex: number,
): number {
  if (!handle) return startIndex;
  // A fractional device pixel ratio leaves the arithmetic a hair short of the
  // exact end, so the comparison needs a tolerance rather than equality.
  const atEnd = handle.scrollSize - handle.viewportSize - handle.scrollOffset <= 2;
  if (!atEnd) return startIndex;
  const end = handle.findEndIndex();
  return end > startIndex ? end : startIndex;
}

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
  noFolders,
  onAddFolder,
  onFilter,
  histogram,
  albums = [],
  onSelectionFavorite,
  onSelectionAddToAlbum,
  onSelectionCreateAlbum,
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
  /** No folder feeds this library yet; admins get a shortcut to add one. */
  noFolders?: boolean;
  onAddFolder?: () => void;
  onFilter?: () => void;
  /** Month counts for the whole library, for the date scrubber (ADR 0017). */
  histogram?: HistogramBucket[];
  /** Albums the selection can be added to (ADR 0018). */
  albums?: Album[];
  onSelectionFavorite?: (ids: string[], favorite: boolean) => void;
  onSelectionAddToAlbum?: (ids: string[], albumId: string) => void;
  onSelectionCreateAlbum?: (ids: string[], name: string) => void;
}) {
  const { t, intl } = useI18n();
  const reducedMotion = usePrefersReducedMotion();
  const groups = useMemo(
    () =>
      groupPhotos(photos, granularity, {
        locale: intl,
        memories: (count) => t('favorites.count', { count }),
      }),
    [photos, granularity, intl, t],
  );
  const listRef = useRef<VListHandle>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<string | null>(null);
  const [activeLabel, setActiveLabel] = useState(groups[0]?.label ?? '');
  const [periodDirection, setPeriodDirection] = useState<'older' | 'newer'>('older');
  const [scrolling, setScrolling] = useState(false);
  const [showToday, setShowToday] = useState(false);
  const startIndexRef = useRef(0);
  const lastOffsetRef = useRef(0);
  const scrollIdleRef = useRef<number | undefined>(undefined);

  // Index of the group at the top of the viewport. Kept in state as well as in
  // the ref above because the scrubber thumb has to re-render when it moves.
  const [startIndex, setStartIndex] = useState(0);
  const [seekTarget, setSeekTarget] = useState<string | null>(null);

  const orderedPhotos = useMemo(() => groups.flatMap((group) => group.photos), [groups]);
  const orderedIds = useMemo(() => orderedPhotos.map((photo) => photo.id), [orderedPhotos]);
  const selection = useSelectionState(orderedIds);
  const selectionAllFavorited = selectionIsAllFavorited(selection.selected, orderedPhotos);

  const scale = useMemo(() => buildScrubberScale(histogram ?? []), [histogram]);
  const hasScrubber = scale.segments.length >= 2;
  // The month of each group's newest photo, newest-first.
  const groupMonths = useMemo(
    () => groups.map((group) => (group.photos[0]?.takenAt ?? '').slice(0, 7)),
    [groups],
  );

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
    setStartIndex(0);
    startIndexRef.current = 0;
    lastOffsetRef.current = 0;
    const anchor = anchorRef.current;
    if (!anchor || !listRef.current || current.length === 0) return;
    const index = nearestGroupIndex(current, anchor);
    listRef.current.scrollToIndex(index, { align: 'start' });
    startIndexRef.current = index;
    setStartIndex(index);
    if (index > 0) setShowToday(true);
    anchorRef.current = null;
  }, [granularity]);

  /**
   * Changes the zoom level, keeping the reader where they were.
   *
   * `anchorTakenAt` overrides the default anchor, which is the group at the
   * top of the viewport. A heading that drills into itself passes its own
   * group, so clicking "2026" lands on that year rather than on whatever
   * happened to be at the top.
   */
  const handleGranularity = (next: Granularity, anchorTakenAt?: string) => {
    if (next === granularity) return;
    if (anchorTakenAt) {
      anchorRef.current = anchorTakenAt;
    } else {
      const handle = listRef.current;
      if (handle) {
        const group = groups[Math.min(handle.findStartIndex(), Math.max(0, groups.length - 1))];
        anchorRef.current = group?.photos[0]?.takenAt ?? null;
      }
    }
    onGranularityChange(next);
  };

  // Latest values for the non-passive wheel listener below, which is attached
  // once and must not be torn down and rebuilt on every render.
  const handleGranularityRef = useRef(handleGranularity);
  const granularityRef = useRef(granularity);
  const zoomPendingRef = useRef(0);
  useLayoutEffect(() => {
    handleGranularityRef.current = handleGranularity;
    granularityRef.current = granularity;
  });

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      // A trackpad pinch arrives as exactly this, which is why the gesture
      // needs no separate implementation.
      if (!event.ctrlKey && !event.metaKey) return;
      // Otherwise the browser zooms the whole page. This is why the listener
      // is attached by hand: React marks its own onWheel passive, and a
      // passive listener may not preventDefault.
      event.preventDefault();
      const { pending, steps } = accumulateZoom(
        zoomPendingRef.current,
        wheelPixels(event.deltaY, event.deltaMode),
      );
      zoomPendingRef.current = pending;
      if (steps !== 0) {
        handleGranularityRef.current(zoomBy(granularityRef.current, steps));
      }
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  /**
   * Clicking a period heading zooms one level in, anchored on that group.
   *
   * Reads the same refs as the wheel listener above rather than closing over
   * the render's values: a handler that reached `listRef.current` through
   * `handleGranularity` would be a ref read during render as far as the
   * compiler is concerned, since it is created here and handed down.
   */
  const drillIn = useCallback((group: TimelineGroup) => {
    handleGranularityRef.current(zoomBy(granularityRef.current, 1), group.photos[0]?.takenAt);
  }, []);
  const drillNoun = nextLevelNoun(granularity);
  const canDrill = canZoomIn(granularity);

  const markScrolling = useCallback(() => {
    if (reducedMotion) return;
    setScrolling(true);
    window.clearTimeout(scrollIdleRef.current);
    scrollIdleRef.current = window.setTimeout(() => setScrolling(false), 340);
  }, [reducedMotion]);

  useEffect(() => () => window.clearTimeout(scrollIdleRef.current), []);

  // Escape is the way out of a selection, matching the viewer and the actions
  // sheet. Bound on the window because the click that built the selection may
  // have left focus on any tile.
  useEffect(() => {
    if (!selection.active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') selection.clear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection]);

  const openFrom = (photo: Photo, origin: HTMLElement) => {
    onOpen(photo, origin, orderedPhotos);
  };

  const requestNextPage = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage || fetchError) return;
    fetchNextPage?.();
  }, [fetchError, fetchNextPage, hasNextPage, isFetchingNextPage]);

  const scrollToGroup = useCallback((index: number) => {
    const current = groupsRef.current;
    const next = Math.min(Math.max(0, index), Math.max(0, current.length - 1));
    listRef.current?.scrollToIndex(next, { align: 'start' });
    startIndexRef.current = next;
    setStartIndex(next);
    const label = current[next]?.label;
    if (label) setActiveLabel(label);
    setShowToday(next > 0);
  }, []);

  /**
   * Resolves a scrubber jump, or latches it until the month is loaded.
   *
   * The track covers the whole library but only part of it is loaded (ADR
   * 0017), so a jump to an older month may have to page backwards first. The
   * common case — the month is already loaded — is handled here, in the event
   * handler, so no effect runs at all.
   */
  const seekToMonth = useCallback(
    (monthKey: string) => {
      const index = groupIndexForMonth(groupMonths, monthKey);
      if (index >= 0) {
        scrollToGroup(index);
        return;
      }
      if (!hasNextPage || fetchError) {
        // Nothing older is coming; land on the oldest photo there is rather
        // than leaving the jump unresolved.
        scrollToGroup(groupMonths.length - 1);
        return;
      }
      setSeekTarget(monthKey);
    },
    [fetchError, groupMonths, hasNextPage, scrollToGroup],
  );

  // Only reached while a jump is waiting on pages. Each arriving page re-runs
  // this until the month is reachable or the list is exhausted.
  //
  // set-state-in-effect is disabled deliberately for the two lines that
  // release the latch. Whether newly arrived pages made the target reachable
  // is knowable only after a render, so there is no handler to do it in, and
  // leaving the latch set would re-scroll on every later page and fight the
  // user. The scroll itself goes to an external system (the list handle).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!seekTarget) return;
    const index = groupIndexForMonth(groupMonths, seekTarget);
    if (index >= 0) {
      scrollToGroup(index);
      setSeekTarget(null);
      return;
    }
    if (fetchError || !hasNextPage) {
      scrollToGroup(groupMonths.length - 1);
      setSeekTarget(null);
      return;
    }
    if (!isFetchingNextPage) fetchNextPage?.();
  }, [
    seekTarget,
    groupMonths,
    hasNextPage,
    isFetchingNextPage,
    fetchError,
    fetchNextPage,
    scrollToGroup,
  ]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <PhotoSelectionProvider value={selection}>
      <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
        <h1 className="sr-only">{t('timeline.heading')}</h1>
        {selection.active ? (
          // Takes the header's place while a selection is live, so the count and
          // the way out are always where the period label was (ADR 0018).
          <SelectionToolbar
            count={selection.count}
            allFavorited={selectionAllFavorited}
            albums={albums}
            onClear={selection.clear}
            onFavorite={(favorite) => onSelectionFavorite?.(selection.ids, favorite)}
            onAddToAlbum={(albumId) => onSelectionAddToAlbum?.(selection.ids, albumId)}
            onCreateAlbum={(name) => onSelectionCreateAlbum?.(selection.ids, name)}
          />
        ) : (
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
            <ZoomControl value={granularity} onChange={handleGranularity} />
            {onFilter && (
              <button
                type="button"
                onClick={onFilter}
                aria-label={t('timeline.filter')}
                title={t('timeline.filter')}
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
                aria-label={rescanning ? t('timeline.syncing') : t('timeline.syncFolder')}
                title={rescanning ? t('timeline.syncing') : t('timeline.syncFolder')}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink transition duration-200 hover:bg-surface/70 hover:text-plum active:scale-95 disabled:opacity-50"
              >
                <SyncIcon
                  className={`h-5 w-5 ${rescanning && !reducedMotion ? 'index-spin' : ''}`}
                />
              </button>
            )}
          </div>
        )}

        <div className="relative min-h-0 flex-1 overflow-hidden">
          {groups.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-12 text-center" role="status">
              <p className="text-ink">{noFolders ? t('folders.empty') : t('timeline.empty')}</p>
              {noFolders && !onAddFolder && (
                <p className="mt-2 max-w-xs text-sm text-ink">
                  Ask an admin to add a folder for your account.
                </p>
              )}
              {noFolders && onAddFolder && (
                <button
                  type="button"
                  onClick={onAddFolder}
                  className="mt-5 min-h-11 rounded-full bg-plum px-5 text-sm font-medium text-cream"
                >
                  Add a folder
                </button>
              )}
              {onRescan && !noFolders && (
                <button
                  type="button"
                  onClick={onRescan}
                  disabled={rescanning}
                  className="mt-5 min-h-11 rounded-full bg-plum px-5 text-sm font-medium text-cream disabled:opacity-60"
                >
                  {rescanning ? t('timeline.scanning') : t('timeline.scanFolder')}
                </button>
              )}
            </div>
          ) : (
            <>
              {hasScrubber && (
                // Before the list in DOM order so Tab reaches it without walking
                // every photo first; it is absolutely positioned either way.
                <Scrubber
                  scale={scale}
                  value={fractionForDate(scale, groups[startIndex]?.photos[0]?.takenAt ?? '')}
                  onSeek={seekToMonth}
                  seeking={seekTarget !== null}
                  // `scrolling` is deliberately never set under reduced motion,
                  // so the track would otherwise only ever appear on hover for
                  // those users. Show it permanently instead of fading it in.
                  revealed={scrolling || seekTarget !== null || reducedMotion}
                  reducedMotion={reducedMotion}
                />
              )}
              {/*
                One shared description for every period heading, rather than a
                copy per section: the noun depends only on the current zoom
                level, and there may be hundreds of headings.
              */}
              {drillNoun && (
                <span id="timeline-drill-hint" className="sr-only">
                  Zoom in to {drillNoun}
                </span>
              )}
              <div
                key={granularity}
                data-timeline
                data-group-count={groups.length}
                data-timeline-motion={reducedMotion ? 'none' : 'fade-rise'}
                // Keep tiles out from under the scrubber's track; justifyRows
                // measures the container, so the rows reflow to the new width.
                className={`h-full ${hasScrubber ? 'pr-7' : ''} ${
                  reducedMotion ? '' : 'animate-fade-rise'
                }`}
                ref={(node) => {
                  if (!node) return;
                  // Test seam driven by apps/e2e/steps/fixtures.ts.
                  Object.assign(node, { __scrollToGroup: scrollToGroup });
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
                      setStartIndex(start);
                    }
                    if (Math.abs(offset - lastOffsetRef.current) > 2) markScrolling();
                    lastOffsetRef.current = offset;
                    const label = groups[currentGroupIndex(handle, start)]?.label;
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
                      onDrillIn={canDrill ? drillIn : undefined}
                      drillHintId={canDrill ? 'timeline-drill-hint' : undefined}
                    />
                  ))}
                  <div className="px-3 pb-8 min-[640px]:px-5">
                    <LoadMoreMarker
                      onVisible={requestNextPage}
                      enabled={!!hasNextPage && !isFetchingNextPage && !fetchError}
                    />
                    {isFetchingNextPage && (
                      <p className="py-3 text-center text-sm text-ink" role="status">
                        {t('timeline.loadingMore')}
                      </p>
                    )}
                    {fetchError && (
                      <div
                        className="flex flex-col items-center gap-3 py-4 text-center"
                        role="alert"
                      >
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
            </>
          )}

          {showToday && (
            <button
              type="button"
              onClick={() =>
                listRef.current?.scrollToIndex(0, { align: 'start', smooth: !reducedMotion })
              }
              className={`absolute bottom-4 z-20 flex min-h-11 items-center gap-2 rounded-full bg-plum px-4 py-2 text-sm font-medium text-cream shadow-lift transition duration-200 active:scale-95 min-[800px]:bottom-6 ${
                hasScrubber ? 'right-14 min-[800px]:right-16' : 'right-4 min-[800px]:right-6'
              } ${reducedMotion ? '' : 'animate-fab-in'}`}
              aria-label={t('timeline.backToToday')}
              data-today-fab
            >
              <TodayIcon className="h-4 w-4" />
              Today
            </button>
          )}
        </div>
      </div>
    </PhotoSelectionProvider>
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
