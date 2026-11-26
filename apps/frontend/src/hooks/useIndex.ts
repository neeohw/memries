import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchIndexStatus, startIndex, stopIndex } from '../lib/api';
import {
  canRetryIndex,
  isIndexReady,
  shouldInvalidatePhotos,
  shouldPoll,
  type IndexStatus,
} from '../lib/indexStatus';
import { photoQueryKey } from './usePhotos';
import { timelineHistogramQueryKey } from './useTimelineHistogram';

export const indexQueryKey = ['index', 'status'] as const;

export function useIndex() {
  const queryClient = useQueryClient();
  const prevRef = useRef<IndexStatus | undefined>(undefined);

  const statusQuery = useQuery({
    queryKey: indexQueryKey,
    queryFn: fetchIndexStatus,
    refetchInterval: (query) => (query.state.data && shouldPoll(query.state.data) ? 750 : false),
  });

  const startMutation = useMutation({
    mutationFn: startIndex,
    onSuccess: (next) => {
      queryClient.setQueryData(indexQueryKey, next);
    },
  });

  // The status that comes back still reads `running`: the indexer has been
  // signalled, not reaped. Writing it to the cache keeps the splash polling
  // until the run actually ends (ADR 0004).
  const stopMutation = useMutation({
    mutationFn: stopIndex,
    onSuccess: (next) => {
      queryClient.setQueryData(indexQueryKey, next);
    },
  });

  const status = statusQuery.data;

  useEffect(() => {
    if (!status) return;
    if (shouldInvalidatePhotos(prevRef.current, status)) {
      void queryClient.invalidateQueries({ queryKey: photoQueryKey });
      // The scrubber's month counts moved with the photos, so refresh its
      // track too or it keeps describing the pre-sync library (ADR 0017).
      void queryClient.invalidateQueries({ queryKey: timelineHistogramQueryKey });
    }
    prevRef.current = status;
  }, [queryClient, status]);

  const retry = () => {
    if (statusQuery.isError && !status) {
      void statusQuery.refetch();
      return;
    }
    startMutation.reset();
    startMutation.mutate();
  };

  return {
    status,
    isLoading: statusQuery.isLoading && !status,
    isError: (statusQuery.isError && !status) || startMutation.isError,
    error: startMutation.error ?? statusQuery.error,
    isReadyForPhotos: !!status && isIndexReady(status),
    canRetry:
      (!!status && canRetryIndex(status)) ||
      startMutation.isError ||
      (statusQuery.isError && !status),
    retry,
    retrying: startMutation.isPending,
    stop: () => stopMutation.mutate(),
    stopping: stopMutation.isPending,
    canStop: !!status && shouldPoll(status),
    refetch: statusQuery.refetch,
  };
}
