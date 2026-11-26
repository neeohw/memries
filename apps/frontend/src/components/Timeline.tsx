import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { VList, type VListHandle } from 'virtua';
import { groupIndexForPhoto, groupPhotos } from '../lib/groupPhotos';
import {
  type HistogramBucket,
  buildScrubberScale,
  fractionForDate,
  groupIndexForMonth,
} from '../lib/scrubberScale';
import { PhotoSelectionProvider, useSelectionState } from '../hooks/usePhotoSelection';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { selectionIsAllFavorited } from '../lib/selection';
import {
  accumulateZoom,
  canZoomIn,
  levelForOpenedPhoto,
  nextLevelNoun,
  wheelPixels,
  zoomBy,
} from '../lib/zoom';
import type { Album, Granularity, Photo, TimelineGroup } from '../models/photo';
import { CurrentPeriod } from './CurrentPeriod';
import { ZoomControl } from './ZoomControl';
import { PhotoSkeleton } from './PhotoSkeleton';
import { Scrubber } from './Scrubber';
import { SelectionToolbar } from './SelectionToolbar';
import { TimelineSection } from './TimelineSection';
import { FilterIcon, TodayIcon } from './icons';

/**
 * Where a pending jump is headed: a month, from the scrubber's track
 * ([0017](../../../../docs/adr/0017-date-scrubber.md)), or one photo, from
 * drilling out of year view ([0031](../../../../docs/adr/0031-year-view-is-a-summary.md)).
 *
 * Both are resolved against the feed as loaded *so far*, and both answer -1
 * while the list does not reach back that far, which is the signal to fetch
 * another page and ask again.
 */
export type SeekTarget = { month: string } | { takenAt: string };

export function seekIndex(
  target: SeekTarget,
  groups: TimelineGroup[],
  groupMonths: string[],
): number {
  return 'takenAt' in target
    ? groupIndexForPhoto(groups, target.takenAt)
    : groupIndexForMonth(groupMonths, target.month);
}

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
  anchorTakenAt,
  groupTotals,
  onOpen,
  onActions,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  fetchError,
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
  /**
   * `anchorTakenAt` is the photo the reader was looking at when the level
   * changed. It travels up because the feed may have to be refetched around
   * it: drilling into a year scopes `/api/photos` to that year rather than
   * paging back to it (ADR 0031).
   */
  onGranularityChange: (value: Granularity, anchorTakenAt?: string) => void;
  /**
   * The photo to land on at this zoom level, when the level was not reached
   * from inside this component.
   *
   * Drilling out of year view changes the feed's query key, which unmounts
   * the timeline until the first page of the scoped feed arrives — so the
   * anchor the click set cannot be kept in a ref. It comes back in as a prop
   * and is sought the same way: scrolled to if it is loaded, paged towards if
   * it is not (ADR 0031).
   */
  anchorTakenAt?: string;
  /**
   * Real photo count per group key, for when `photos` is a sample rather than
   * the period itself. Year view passes it; month and week have the whole
   * period in hand and pass nothing (ADR 0031).
   */
  groupTotals?: Record<string, number>;
  onOpen: (photo: Photo, origin: HTMLElement, list: Photo[]) => void;
  onActions?: (photo: Photo, origin: HTMLElement) => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: () => void;
  fetchError?: boolean;
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
        totals: groupTotals,
      }),
    [photos, granularity, intl, t, groupTotals],
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
  const [seekTarget, setSeekTarget] = useState<SeekTarget | null>(null);

  const orderedPhotos = useMemo(() => groups.flatMap((group) => group.photos), [groups]);
  const orderedIds = useMemo(() => orderedPhotos.map((photo) => photo.id), [orderedPhotos]);
  const selection = useSelectionState(orderedIds);
  const selectionAllFavorited = selectionIsAllFavorited(selection.selected, orderedPhotos);

  const scale = useMemo(() => buildScrubberScale(histogram ?? []), [histogram]);
  const hasScrubber = scale.segments.length >= 2;
  // The month each group *reaches back to*, newest group first.
  //
  // The group's oldest photo, not its newest: `groupIndexForMonth` takes the
  // first group that starts at or before the month asked for, and in year view
  // a group spans twelve months. Keyed on the newest photo, a jump to June
  // 2026 would skip past the 2026 section — whose newest photo is in
  // November — and land on 2025 (ADR 0031). At month and week level the two
  // are the same month, so nothing else changes.
  const groupMonths = useMemo(
    () => groups.map((group) => (group.photos[group.photos.length - 1]?.takenAt ?? '').slice(0, 7)),
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
    const anchor = anchorRef.current ?? anchorTakenAt ?? null;
    anchorRef.current = null;
    if (!anchor || current.length === 0) return;
    const index = groupIndexForPhoto(current, anchor);
    if (index < 0) {
      // The anchor is older than anything loaded. Drilling out of year view
      // starts the feed at the top of the clicked year rather than at the
      // clicked photo, precisely so the reader can scroll back up through the
      // year — which means landing on a photo from July pages down to it first
      // (ADR 0031). The seek effect below does the paging.
      setSeekTarget({ takenAt: anchor });
      return;
    }
    // Resolved here rather than through the latch so a zoom change with the
    // anchor already loaded — which is every zoom that does not refetch —
    // scrolls in the same frame, without a visible jump from the top.
    listRef.current?.scrollToIndex(index, { align: 'start' });
    startIndexRef.current = index;
    setStartIndex(index);
    if (index > 0) setShowToday(true);
  }, [granularity, anchorTakenAt]);

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
    onGranularityChange(next, anchorRef.current ?? undefined);
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
    // Year view is a sample of the library, so what sits either side of this
    // photo on screen is months away (ADR 0031). Zoom the list behind the
    // viewer down to the week the photo was taken in, anchored on the photo
    // itself, so closing the viewer lands among its neighbours.
    const zoomTo = levelForOpenedPhoto(granularity);
    if (zoomTo) handleGranularity(zoomTo, photo.takenAt);
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
   * Resolves a jump, or latches it until the feed reaches back that far.
   *
   * The scrubber's track covers the whole library but only part of it is
   * loaded (ADR 0017), and a drilled-to photo may be several pages into the
   * year it was clicked in (ADR 0031), so either may have to page first. The
   * common case — it is already loaded — is handled here, in the caller, so no
   * effect runs at all.
   */
  const seekTo = useCallback(
    (target: SeekTarget) => {
      const index = seekIndex(target, groups, groupMonths);
      if (index >= 0) {
        scrollToGroup(index);
        return;
      }
      if (!hasNextPage || fetchError) {
        // Nothing older is coming; land on the oldest photo there is rather
        // than leaving the jump unresolved.
        scrollToGroup(groups.length - 1);
        return;
      }
      setSeekTarget(target);
    },
    [fetchError, groupMonths, groups, hasNextPage, scrollToGroup],
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
    const index = seekIndex(seekTarget, groups, groupMonths);
    if (index >= 0) {
      scrollToGroup(index);
      setSeekTarget(null);
      return;
    }
    if (fetchError || !hasNextPage) {
      scrollToGroup(groups.length - 1);
      setSeekTarget(null);
      return;
    }
    if (!isFetchingNextPage) fetchNextPage?.();
  }, [
    seekTarget,
    groups,
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
            </div>
          ) : (
            <>
              {hasScrubber && (
                // Before the list in DOM order so Tab reaches it without walking
                // every photo first; it is absolutely positioned either way.
                <Scrubber
                  scale={scale}
                  value={fractionForDate(scale, groups[startIndex]?.photos[0]?.takenAt ?? '')}
                  onSeek={(month) => seekTo({ month })}
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
