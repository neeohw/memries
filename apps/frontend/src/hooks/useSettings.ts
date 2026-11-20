import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchSettings, setThumbnailRoot } from '../lib/api';

export const settingsQueryKey = ['settings'] as const;

/** Server-wide settings. Admin only, so this is disabled for readers. */
export function useSettings(enabled: boolean) {
  return useQuery({
    queryKey: settingsQueryKey,
    queryFn: fetchSettings,
    enabled,
    staleTime: 60_000,
  });
}

export function useSetThumbnailRoot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setThumbnailRoot,
    onSuccess: (next) => {
      queryClient.setQueryData(settingsQueryKey, {
        thumbnailRoot: next.thumbnailRoot,
        defaultThumbnailRoot: next.defaultThumbnailRoot,
        allowedRoots: next.allowedRoots,
        freeBytes: next.freeBytes,
      });
      // Thumb URLs are unchanged, but the files behind them may now be
      // missing, so drop the image caches rather than leave broken tiles.
      void queryClient.invalidateQueries({ queryKey: ['photos'] });
    },
  });
}
