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
} from '../lib/api';
import type { Photo } from '../models/photo';

export const photoQueryKey = ['photos'] as const;

export function photosQueryKey(filter?: PhotoFilter) {
  if (!filter || Object.keys(filter).length === 0) return photoQueryKey;
  return [...photoQueryKey, filter] as const;
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
      return { snapshots };
    },
    onError: (_error, _vars, context) => {
      for (const [key, data] of context?.snapshots ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
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
      return { snapshots };
    },
    onError: (_error, _vars, context) => {
      for (const [key, data] of context?.snapshots ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
  });
}
