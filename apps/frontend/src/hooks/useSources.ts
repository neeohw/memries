import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createSource,
  deleteSource,
  fetchMe,
  fetchSources,
  isUnauthorized,
  scanSource,
  updateSource,
} from '../lib/api';
import type { SourceInput } from '../models/source';
import { indexQueryKey } from './useIndex';

export const meQueryKey = ['me'] as const;
export const sourcesQueryKey = ['admin', 'sources'] as const;

/**
 * The signed-in user, and the app's auth gate (ADR 0016): a 401 here is what
 * tells App to show the sign-in form.
 *
 * Retrying an unauthorized response is pointless — the answer will not change
 * until a password is submitted — so only transport failures are retried.
 */
export function useMe() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: fetchMe,
    staleTime: Infinity,
    retry: (count, error) => !isUnauthorized(error) && count < 2,
  });
}

export function useSources(enabled: boolean) {
  return useQuery({ queryKey: sourcesQueryKey, queryFn: fetchSources, enabled });
}

/** Source changes queue an Index run on the server; refetch status so the library follows. */
function useSourceMutation<T>(mutationFn: (vars: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sourcesQueryKey });
      void queryClient.invalidateQueries({ queryKey: indexQueryKey });
    },
  });
}

export function useCreateSource() {
  return useSourceMutation((input: SourceInput) => createSource(input));
}

export function useUpdateSource() {
  return useSourceMutation(({ id, input }: { id: string; input: SourceInput }) =>
    updateSource(id, input),
  );
}

export function useDeleteSource() {
  return useSourceMutation((id: string) => deleteSource(id));
}

export function useScanSource() {
  return useSourceMutation((id: string) => scanSource(id));
}
