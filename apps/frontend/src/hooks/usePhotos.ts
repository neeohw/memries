import {
  useMutation,
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import {
  fetchPhotosPage,
  flattenPhotoPages,
  setPhotoFavorite,
  setPhotosFavorite,
  type PhotoFilter,
  type PhotosPage,
  type YearSummary,
} from '../lib/api';
import { yearSummaryQueryKey } from './useYearSummary';
import type { Photo } from '../models/photo';

export const photoQueryKey = ['photos'] as const;

export function photosQueryKey(filter?: PhotoFilter) {
  if (!filter || Object.keys(filter).length === 0) return photoQueryKey;
  return [...photoQueryKey, filter] as const;
}

/**
 * Marks every list whose membership depends on favorites as stale.
 *
 * Patching the cache flips the flag on rows a query already holds, but it
 * cannot add a photo to a list it was never in: favoriting from the Timeline
 * leaves the Favorites page exactly as it was fetched. So those lists are
 * invalidated and refetched.
 *
 * The unfiltered Timeline query is deliberately left alone. It was patched
 * correctly in place, and refetching every loaded page of a 500-per-page
 * infinite query would be an expensive way to learn nothing.
 */
function invalidateFavoriteLists(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({
    predicate: (query) => {
      const [root, filter] = query.queryKey as [string, PhotoFilter | undefined];
      return root === photoQueryKey[0] && filter?.favorite !== undefined;
    },
  });
}

/**
 * Flips the flag on the year summary too, which is a separate cache entry
 * with a shape of its own (see `yearSummaryQueryKey`).
 *
 * Patched rather than invalidated: the summary is the whole library in one
 * response, and refetching all of it to change one boolean is a lot of a Pi's
 * afternoon.
 */
function patchSummaryFavorite(
  queryClient: ReturnType<typeof useQueryClient>,
  ids: Set<string>,
  favorite: boolean,
) {
  queryClient.setQueryData<YearSummary[]>(yearSummaryQueryKey, (current) => {
    if (!current) return current;
    return current.map((year) => ({
      ...year,
      photos: year.photos.map((photo) => (ids.has(photo.id) ? { ...photo, favorite } : photo)),
    }));
  });
}

export function usePhotos(enabled: boolean, filter?: PhotoFilter) {
  const key = photosQueryKey(filter);
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => fetchPhotosPage(pageParam, filter),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function flattenPhotos(data: InfiniteData<PhotosPage> | undefined): Photo[] {
  return flattenPhotoPages(data?.pages ?? []);
}

export function useToggleFavorite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, favorite }: { id: string; favorite: boolean }) => {
      await setPhotoFavorite(id, favorite);
    },
    onMutate: async ({ id, favorite }) => {
      await queryClient.cancelQueries({ queryKey: photoQueryKey });
      const snapshots = queryClient.getQueriesData<InfiniteData<PhotosPage>>({
        queryKey: photoQueryKey,
      });
      queryClient.setQueriesData<InfiniteData<PhotosPage>>(
        { queryKey: photoQueryKey },
        (current) => {
          if (!current) return current;
          return {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              photos: page.photos.map((photo) =>
                photo.id === id ? { ...photo, favorite } : photo,
              ),
            })),
          };
        },
      );
      const summary = queryClient.getQueryData<YearSummary[]>(yearSummaryQueryKey);
      patchSummaryFavorite(queryClient, new Set([id]), favorite);
      return { snapshots, summary };
    },
    onError: (_error, _vars, context) => {
      for (const [key, data] of context?.snapshots ?? []) {
        queryClient.setQueryData(key, data);
      }
      if (context?.summary) queryClient.setQueryData(yearSummaryQueryKey, context.summary);
    },
    onSettled: () => invalidateFavoriteLists(queryClient),
  });
}

/**
 * Favorites or unfavorites a selection (ADR 0018).
 *
 * Patches the cache first so the badges flip with the click, and rolls the
 * snapshot back on failure. The server refuses a batch containing a foreign
 * id outright, so there is no half-applied state to untangle.
 */
export function useBatchFavorite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, favorite }: { ids: string[]; favorite: boolean }) =>
      setPhotosFavorite(ids, favorite),
    onMutate: async ({ ids, favorite }) => {
      await queryClient.cancelQueries({ queryKey: photoQueryKey });
      const snapshots = queryClient.getQueriesData<InfiniteData<PhotosPage>>({
        queryKey: photoQueryKey,
      });
      const chosen = new Set(ids);
      queryClient.setQueriesData<InfiniteData<PhotosPage>>(
        { queryKey: photoQueryKey },
        (current) => {
          if (!current) return current;
          return {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              photos: page.photos.map((photo) =>
                chosen.has(photo.id) ? { ...photo, favorite } : photo,
              ),
            })),
          };
        },
      );
      const summary = queryClient.getQueryData<YearSummary[]>(yearSummaryQueryKey);
      patchSummaryFavorite(queryClient, chosen, favorite);
      return { snapshots, summary };
    },
    onError: (_error, _vars, context) => {
      for (const [key, data] of context?.snapshots ?? []) {
        queryClient.setQueryData(key, data);
      }
      if (context?.summary) queryClient.setQueryData(yearSummaryQueryKey, context.summary);
    },
    onSettled: () => invalidateFavoriteLists(queryClient),
  });
}
