import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlbumPage } from './components/AlbumPage';
import { LoginScreen } from './components/LoginScreen';
import { AccountView } from './components/AccountView';
import { AlbumsView } from './components/AlbumsView';
import { AppShell } from './components/AppShell';
import { FavoritesView } from './components/FavoritesView';
import { IndexingScreen } from './components/IndexingScreen';
import { PhotoActionsMenu } from './components/PhotoActionsMenu';
import { PhotoViewer } from './components/PhotoViewer';
import { SourcesView } from './components/SourcesView';
import { Timeline } from './components/Timeline';
import {
  useAddPhotoToAlbum,
  useAddPhotosToAlbum,
  useAlbums,
  useCreateAlbum,
  useDeleteAlbums,
  useRemovePhotoFromAlbum,
} from './hooks/useAlbums';
import { useIndex } from './hooks/useIndex';
import { useStoredZoom } from './hooks/useStoredZoom';
import { useTimelineHistogram } from './hooks/useTimelineHistogram';
import { useYearSummary } from './hooks/useYearSummary';
import {
  meQueryKey,
  useCreateSource,
  useDeleteSource,
  useMe,
  usePreviewSource,
  useScanSource,
  useSources,
  useUpdateSource,
} from './hooks/useSources';
import { I18nProvider, useT } from './i18n/I18nProvider';
import { useLocale } from './hooks/useLocale';
import { isUnauthorized, signIn, signOut } from './lib/api';
import { yearCeiling } from './lib/takenAt';
import { resolveViewerList, type ViewerState } from './lib/viewerList';
import { flattenPhotos, useBatchFavorite, usePhotos, useToggleFavorite } from './hooks/usePhotos';
import type { Granularity, NavTab, Photo } from './models/photo';

/**
 * Auth gate (ADR 0016). `/api/me` answering 401 is what shows the sign-in
 * form; the library and its queries are not mounted until there is a session,
 * so nothing fires a request that is bound to fail.
 */
export default function App() {
  const queryClient = useQueryClient();
  const me = useMe();
  // Resolved before the session is known, so the sign-in form and the error
  // screens are already in the reader's browser language (ADR 0021).
  const { locale } = useLocale(me.data);

  const handleSignIn = useCallback(
    async (login: string, password: string) => {
      const user = await signIn(login, password);
      queryClient.setQueryData(meQueryKey, user);
      // Anything attempted while signed out failed; let it all run again.
      await queryClient.invalidateQueries();
    },
    [queryClient],
  );

  const handleSignOut = useCallback(() => {
    // Drop the cache either way: on a failed sign-out the photos still should
    // not stay on screen.
    void signOut().finally(() => queryClient.clear());
  }, [queryClient]);

  return (
    <I18nProvider locale={locale}>
      <AppRoutes me={me} onSignIn={handleSignIn} onSignOut={handleSignOut} />
    </I18nProvider>
  );
}

function AppRoutes({
  me,
  onSignIn,
  onSignOut,
}: {
  me: ReturnType<typeof useMe>;
  onSignIn: (login: string, password: string) => Promise<void>;
  onSignOut: () => void;
}) {
  const t = useT();

  if (me.isPending) {
    return (
      <div className="grid min-h-dvh place-items-center bg-cream" role="status">
        <span className="sr-only">{t('app.loading')}</span>
        <span
          className="h-10 w-10 animate-pulse rounded-full bg-gradient-to-br from-peach to-blush"
          aria-hidden
        />
      </div>
    );
  }

  if (me.isError) {
    if (isUnauthorized(me.error)) {
      return <LoginScreen onSignIn={onSignIn} />;
    }
    return (
      <div
        className="flex min-h-dvh flex-col items-center justify-center bg-cream px-6 text-center text-plum"
        role="alert"
      >
        <p className="font-display text-2xl font-semibold tracking-tight">
          {t('app.unreachableTitle')}
        </p>
        <p className="mt-2 max-w-xs text-sm text-ink">{t('app.unreachableBody')}</p>
        <button
          type="button"
          onClick={() => void me.refetch()}
          className="mt-5 min-h-11 rounded-full bg-plum px-5 text-sm font-medium text-cream"
        >
          {t('app.retry')}
        </button>
      </div>
    );
  }

  return <Library onSignOut={onSignOut} />;
}

function Library({ onSignOut }: { onSignOut: () => void }) {
  const {
    status: indexStatus,
    isError: indexError,
    isReadyForPhotos,
    retry: indexRetry,
    rescan,
    rescanning,
    retrying: indexRetrying,
  } = useIndex();
  const [tab, setTab] = useState<NavTab>('memories');
  const [granularity, setGranularity] = useStoredZoom();
  /**
   * The feed's exclusive upper bound on capture time, or null for the whole
   * library, with the photo to land on inside it.
   *
   * Both are set by drilling out of year view and cleared by zooming back in.
   * The bound is the start of the year *after* whatever was clicked, so the
   * whole of that year is above the reader and can be scrolled back up
   * through; the anchor is what the timeline pages down to. The feed still
   * pages newest-first and still runs off the bottom into older photos — only
   * where it starts moved, which is what makes opening 2019 a handful of
   * requests instead of twenty pages of them (ADR 0031).
   */
  const [focusTo, setFocusTo] = useState<string | null>(null);
  const [focusAnchor, setFocusAnchor] = useState<string | undefined>(undefined);
  const [lastFocus, setLastFocus] = useState<HTMLElement | null>(null);
  const [viewer, setViewer] = useState<(ViewerState & { origin: DOMRect | null }) | null>(null);
  const [actionsPhoto, setActionsPhoto] = useState<Photo | null>(null);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [indexVisible, setIndexVisible] = useState(true);

  // Year view reads a sampled overview of the whole library instead of the
  // feed: a few photos per month per year, with each year's real count (ADR
  // 0031). Enabled only at that level, so a reader who never zooms out never
  // pays for it.
  const yearMode = granularity === 'year';
  const summaryQuery = useYearSummary(isReadyForPhotos && yearMode);
  const feedFilter = useMemo(() => (focusTo ? { to: focusTo } : undefined), [focusTo]);
  const timelineQuery = usePhotos(isReadyForPhotos, feedFilter);
  // Drives the date scrubber's track. Independent of which tab is open so the
  // scrubber is ready the moment Memories is.
  const histogramQuery = useTimelineHistogram(isReadyForPhotos);
  const favoritesQuery = usePhotos(isReadyForPhotos && tab === 'favorites', { favorite: true });

  const meQuery = useMe();
  const admin = meQuery.data?.admin === true;
  const {
    stored: storedLocale,
    setLocale: changeLocale,
    saving: savingLocale,
  } = useLocale(meQuery.data);
  const sourcesQuery = useSources(admin && tab === 'folders');
  const createSourceMutation = useCreateSource();
  const updateSourceMutation = useUpdateSource();
  const deleteSourceMutation = useDeleteSource();
  const scanSourceMutation = useScanSource();
  const previewSourceMutation = usePreviewSource();

  const albumsQuery = useAlbums();
  const favoriteMutation = useToggleFavorite();
  const createAlbumMutation = useCreateAlbum();
  const deleteAlbumsMutation = useDeleteAlbums();
  const addPhotoMutation = useAddPhotoToAlbum();
  const removePhotoMutation = useRemovePhotoFromAlbum();
  const batchFavoriteMutation = useBatchFavorite();
  const addPhotosMutation = useAddPhotosToAlbum();

  const activeQuery = tab === 'favorites' ? favoritesQuery : timelineQuery;
  const showQueryError = activeQuery.isError && tab !== 'folders';

  const loadSettled = activeQuery.isSuccess || activeQuery.isError;
  const canLeaveIndex = isReadyForPhotos && loadSettled && !rescanning && !indexRetrying;
  const hideIndex = useCallback(() => setIndexVisible(false), []);

  const handleRescan = useCallback(() => {
    setIndexVisible(true);
    rescan();
  }, [rescan]);

  /**
   * Changes the zoom level and, leaving year view, starts the feed at whatever
   * was clicked there.
   *
   * Only on the way out of year view. Zooming between month and week keeps
   * whatever bound is in force: re-deriving it from the group on screen would
   * change the query key — and so refetch the feed — every time a reader
   * scrolled into the previous year and then zoomed (ADR 0031).
   */
  const changeGranularity = useCallback(
    (next: Granularity, anchorTakenAt?: string) => {
      if (next === 'year') {
        setFocusTo(null);
        setFocusAnchor(undefined);
      } else if (granularity === 'year' && anchorTakenAt) {
        setFocusTo(yearCeiling(anchorTakenAt) || null);
        setFocusAnchor(anchorTakenAt);
      }
      setGranularity(next);
    },
    [granularity, setGranularity],
  );

  // The summary, when year view has one. A failed summary request falls back
  // to the feed rather than to an empty screen: the old behaviour is still a
  // timeline, only a shorter one.
  const summary = yearMode ? summaryQuery.data : undefined;
  const summaryPhotos = useMemo(() => (summary ?? []).flatMap((year) => year.photos), [summary]);
  const yearTotals = useMemo(
    () =>
      summary ? Object.fromEntries(summary.map((year) => [year.year, year.count])) : undefined,
    [summary],
  );
  const feedPhotos = flattenPhotos(timelineQuery.data);
  const timelinePhotos = summary ? summaryPhotos : feedPhotos;
  const favoritesPhotos = flattenPhotos(favoritesQuery.data);
  const albums = albumsQuery.data ?? [];

  const tabPhotos = tab === 'favorites' ? favoritesPhotos : timelinePhotos;

  const liveViewerList = viewer ? resolveViewerList(viewer, tabPhotos) : [];

  const liveActionsPhoto = actionsPhoto
    ? (tabPhotos.find((photo) => photo.id === actionsPhoto.id) ?? actionsPhoto)
    : null;

  const openPhoto = (photo: Photo, origin: HTMLElement, list: Photo[]) => {
    setLastFocus(origin);
    // Opening a photo from year view also zooms the timeline to the week
    // around it, so the list to arrow through is the feed that change is
    // fetching rather than the year sample that was clicked (ADR 0031).
    const follow = tab === 'memories' && yearMode;
    setViewer({
      id: photo.id,
      origin: origin.getBoundingClientRect(),
      list: follow ? [photo] : list,
      follow,
    });
  };

  const closeViewer = () => {
    setViewer(null);
    lastFocus?.focus();
  };

  const openActions = (photo: Photo, origin: HTMLElement) => {
    setLastFocus(origin);
    setActionsPhoto(photo);
  };

  const closeActions = () => {
    setActionsPhoto(null);
    lastFocus?.focus();
  };

  const toggleFavorite = (id: string, favorite: boolean) => {
    favoriteMutation.mutate({ id, favorite });
  };

  const addToAlbum = (albumId: string, photoId: string) => {
    addPhotoMutation.mutate({ albumId, photoId });
  };

  const changeTab = (next: NavTab) => {
    if (next === tab && next === 'albums') {
      setSelectedAlbumId(null);
      return;
    }
    setTab(next);
    if (next !== 'albums') setSelectedAlbumId(null);
  };

  const showGallery = !indexVisible || canLeaveIndex;

  return (
    <>
      {showGallery && (
        <AppShell tab={tab} onTabChange={changeTab} admin={admin}>
          {showQueryError && (
            <div
              className="flex flex-1 flex-col items-center justify-center px-6 text-center"
              role="alert"
            >
              <p className="font-display text-2xl font-semibold tracking-tight">
                We could not load your photos
              </p>
              <p className="mt-2 max-w-xs text-sm text-ink">
                Something went quietly wrong. You can try again in a moment.
              </p>
              <button
                type="button"
                onClick={() => void activeQuery.refetch()}
                className="mt-5 min-h-11 rounded-full bg-plum px-5 text-sm font-medium text-cream"
              >
                Try again
              </button>
            </div>
          )}
          {timelineQuery.isSuccess && tab === 'memories' && (
            <Timeline
              photos={timelinePhotos}
              granularity={granularity}
              onGranularityChange={changeGranularity}
              anchorTakenAt={focusAnchor}
              groupTotals={yearTotals}
              onOpen={openPhoto}
              onActions={openActions}
              hasNextPage={summary ? false : timelineQuery.hasNextPage}
              isFetchingNextPage={summary ? false : timelineQuery.isFetchingNextPage}
              fetchNextPage={() => {
                if (summary) return;
                void timelineQuery.fetchNextPage();
              }}
              fetchError={summary ? false : timelineQuery.isFetchNextPageError}
              onRescan={handleRescan}
              rescanning={rescanning}
              noFolders={indexStatus?.sources === 0}
              onAddFolder={admin ? () => changeTab('folders') : undefined}
              histogram={histogramQuery.data}
              albums={albums}
              onSelectionFavorite={(ids, favorite) =>
                batchFavoriteMutation.mutate({ ids, favorite })
              }
              onSelectionCreateAlbum={(ids, name) =>
                createAlbumMutation.mutate({ name, photoIds: ids })
              }
              onSelectionAddToAlbum={(ids, albumId) =>
                addPhotosMutation.mutate({ albumId, photoIds: ids })
              }
            />
          )}
          {tab === 'account' && (
            <AccountView
              email={meQuery.data?.email ?? ''}
              locale={storedLocale}
              onLocaleChange={changeLocale}
              onSignOut={onSignOut}
              saving={savingLocale}
            />
          )}
          {tab === 'folders' && admin && (
            <SourcesView
              sources={sourcesQuery.data?.sources ?? []}
              roots={sourcesQuery.data?.roots ?? []}
              loading={sourcesQuery.isLoading}
              loadError={sourcesQuery.isError}
              onCreate={(input) => createSourceMutation.mutateAsync(input)}
              onUpdate={(id, input) => updateSourceMutation.mutateAsync({ id, input })}
              onDelete={(id) => deleteSourceMutation.mutateAsync(id)}
              onScan={(id) => scanSourceMutation.mutateAsync(id)}
              onPreview={(id, input) => previewSourceMutation.mutateAsync({ id, input })}
              indexStatus={indexStatus}
            />
          )}
          {tab === 'albums' && selectedAlbumId && (
            <AlbumPage
              albumId={selectedAlbumId}
              onBack={() => setSelectedAlbumId(null)}
              onOpen={openPhoto}
              onActions={openActions}
            />
          )}
          {tab === 'albums' && !selectedAlbumId && (
            <AlbumsView
              albums={albums}
              onCreate={(name) => createAlbumMutation.mutate({ name })}
              onDelete={(ids) => deleteAlbumsMutation.mutate(ids)}
              onOpen={(album) => setSelectedAlbumId(album.id)}
              creating={createAlbumMutation.isPending}
            />
          )}
          {favoritesQuery.isSuccess && tab === 'favorites' && (
            <FavoritesView photos={favoritesPhotos} onOpen={openPhoto} onActions={openActions} />
          )}

          {viewer && liveViewerList.length > 0 && (
            <PhotoViewer
              photos={liveViewerList}
              activeId={viewer.id}
              origin={viewer.origin}
              onClose={closeViewer}
              onChange={(id) => setViewer({ ...viewer, id })}
              onToggleFavorite={toggleFavorite}
              albums={albums}
              onAddToAlbum={addToAlbum}
            />
          )}

          {liveActionsPhoto && !viewer && (
            <>
              <div
                className="fixed inset-0 z-[55] bg-black/40"
                aria-hidden
                onClick={closeActions}
              />
              <PhotoActionsMenu
                photo={liveActionsPhoto}
                albums={albums}
                mode={selectedAlbumId ? 'album' : 'library'}
                onClose={closeActions}
                onToggleFavorite={toggleFavorite}
                onAddToAlbum={addToAlbum}
                onRemoveFromAlbum={
                  selectedAlbumId
                    ? () =>
                        removePhotoMutation.mutate({
                          albumId: selectedAlbumId,
                          photoId: liveActionsPhoto.id,
                        })
                    : undefined
                }
              />
            </>
          )}
        </AppShell>
      )}
      {indexVisible && (
        <IndexingScreen
          status={indexStatus}
          leaving={canLeaveIndex}
          onExited={hideIndex}
          onRetry={indexRetry}
          retrying={indexRetrying}
          loadError={indexError && !indexStatus}
        />
      )}
    </>
  );
}
