import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addPhotoToAlbum,
  deleteAlbums,
  addPhotosToAlbum,
  createAlbum,
  fetchAlbum,
  fetchAlbums,
  removePhotoFromAlbum,
} from '../lib/api';
import type { Album, Photo } from '../models/photo';

export const albumQueryKey = ['albums'] as const;

export function albumDetailQueryKey(id: string) {
  return ['albums', id] as const;
}

export function useAlbums() {
  return useQuery({
    queryKey: albumQueryKey,
    queryFn: fetchAlbums,
    staleTime: 5 * 60_000,
  });
}

export function useAlbum(id: string | null) {
  return useQuery({
    queryKey: albumDetailQueryKey(id ?? ''),
    queryFn: () => fetchAlbum(id!),
    enabled: Boolean(id),
    staleTime: 5 * 60_000,
  });
}

export function useCreateAlbum() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, photoIds }: { name: string; photoIds?: string[] }) =>
      createAlbum(name, photoIds),
    onMutate: async ({ name, photoIds }) => {
      await queryClient.cancelQueries({ queryKey: albumQueryKey });
      const previous = queryClient.getQueryData<Album[]>(albumQueryKey);
      const ids = photoIds ?? [];
      const optimistic: Album = {
        id: `temp-${Date.now()}`,
        name: name.trim(),
        createdAt: new Date().toISOString(),
        photoCount: ids.length,
        photoIds: ids,
        // The cover is the newest of the selection, which is the first id:
        // the toolbar sends them in library order (ADR 0018).
        coverPhotoId: ids[0],
      };
      queryClient.setQueryData<Album[]>(albumQueryKey, (current) => [
        optimistic,
        ...(current ?? []),
      ]);
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(albumQueryKey, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: albumQueryKey });
    },
  });
}

/**
 * Deletes a selection of albums.
 *
 * The server refuses a batch holding an album the reader does not own, so
 * there is no half-deleted state: the optimistic removal is either right or
 * rolled back whole.
 */
export function useDeleteAlbums() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => deleteAlbums(ids),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: albumQueryKey });
      const previous = queryClient.getQueryData<Album[]>(albumQueryKey);
      const gone = new Set(ids);
      queryClient.setQueryData<Album[]>(albumQueryKey, (current) =>
        (current ?? []).filter((album) => !gone.has(album.id)),
      );
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(albumQueryKey, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: albumQueryKey });
    },
  });
}

export function useAddPhotoToAlbum() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ albumId, photoId }: { albumId: string; photoId: string }) =>
      addPhotoToAlbum(albumId, photoId),
    onMutate: async ({ albumId, photoId }) => {
      await queryClient.cancelQueries({ queryKey: albumQueryKey });
      const previous = queryClient.getQueryData<Album[]>(albumQueryKey);
      queryClient.setQueryData<Album[]>(albumQueryKey, (current) =>
        (current ?? []).map((album) => {
          if (album.id !== albumId || album.photoIds.includes(photoId)) return album;
          return {
            ...album,
            photoCount: album.photoCount + 1,
            photoIds: [...album.photoIds, photoId],
            coverPhotoId: album.coverPhotoId ?? photoId,
          };
        }),
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(albumQueryKey, context.previous);
    },
    onSettled: (_data, _error, { albumId }) => {
      void queryClient.invalidateQueries({ queryKey: albumQueryKey });
      void queryClient.invalidateQueries({ queryKey: albumDetailQueryKey(albumId) });
    },
  });
}

export function useRemovePhotoFromAlbum() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ albumId, photoId }: { albumId: string; photoId: string }) =>
      removePhotoFromAlbum(albumId, photoId),
    onMutate: async ({ albumId, photoId }) => {
      await queryClient.cancelQueries({ queryKey: albumQueryKey });
      await queryClient.cancelQueries({ queryKey: albumDetailQueryKey(albumId) });
      const previous = queryClient.getQueryData<Album[]>(albumQueryKey);
      const previousDetail = queryClient.getQueryData<{ album: Album; photos: Photo[] }>(
        albumDetailQueryKey(albumId),
      );
      queryClient.setQueryData<Album[]>(albumQueryKey, (current) =>
        (current ?? []).map((album) => {
          if (album.id !== albumId || !album.photoIds.includes(photoId)) return album;
          const photoIds = album.photoIds.filter((id) => id !== photoId);
          return {
            ...album,
            photoCount: Math.max(0, album.photoCount - 1),
            photoIds,
            coverPhotoId: album.coverPhotoId === photoId ? photoIds[0] : album.coverPhotoId,
          };
        }),
      );
      queryClient.setQueryData<{ album: Album; photos: Photo[] }>(
        albumDetailQueryKey(albumId),
        (current) => {
          if (!current) return current;
          const photoIds = current.album.photoIds.filter((id) => id !== photoId);
          return {
            album: {
              ...current.album,
              photoCount: Math.max(0, current.album.photoCount - 1),
              photoIds,
              coverPhotoId:
                current.album.coverPhotoId === photoId ? photoIds[0] : current.album.coverPhotoId,
            },
            photos: current.photos.filter((photo) => photo.id !== photoId),
          };
        },
      );
      return { previous, previousDetail };
    },
    onError: (_error, { albumId }, context) => {
      if (context?.previous) queryClient.setQueryData(albumQueryKey, context.previous);
      if (context?.previousDetail) {
        queryClient.setQueryData(albumDetailQueryKey(albumId), context.previousDetail);
      }
    },
    onSettled: (_data, _error, { albumId }) => {
      void queryClient.invalidateQueries({ queryKey: albumQueryKey });
      void queryClient.invalidateQueries({ queryKey: albumDetailQueryKey(albumId) });
    },
  });
}

/** Adds a selection to one album (ADR 0018). */
export function useAddPhotosToAlbum() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ albumId, photoIds }: { albumId: string; photoIds: string[] }) =>
      addPhotosToAlbum(albumId, photoIds),
    onMutate: async ({ albumId, photoIds }) => {
      await queryClient.cancelQueries({ queryKey: albumQueryKey });
      const previous = queryClient.getQueryData<Album[]>(albumQueryKey);
      queryClient.setQueryData<Album[]>(albumQueryKey, (current) =>
        (current ?? []).map((album) => {
          if (album.id !== albumId) return album;
          // Membership is idempotent server-side, so only count the new ones.
          const added = photoIds.filter((id) => !album.photoIds.includes(id));
          if (added.length === 0) return album;
          return {
            ...album,
            photoCount: album.photoCount + added.length,
            photoIds: [...album.photoIds, ...added],
            coverPhotoId: album.coverPhotoId ?? added[0],
          };
        }),
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(albumQueryKey, context.previous);
    },
    onSettled: (_data, _error, { albumId }) => {
      void queryClient.invalidateQueries({ queryKey: albumQueryKey });
      void queryClient.invalidateQueries({ queryKey: albumDetailQueryKey(albumId) });
    },
  });
}
