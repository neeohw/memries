import { useQuery } from '@tanstack/react-query';
import { fetchTimelineHistogram, isUnauthorized } from '../lib/api';

export const timelineHistogramQueryKey = ['timeline', 'histogram', 'month'] as const;

/**
 * Month counts for the whole library, used to build the date scrubber's track
 * (ADR 0017).
 *
 * One request, one row per month, and it does not change while browsing, so it
 * is cached for the session and refetched only when an Index run invalidates
 * it. The key is independent of the timeline's granularity selector on
 * purpose: the scrubber always speaks months.
 */
export function useTimelineHistogram(enabled: boolean) {
  return useQuery({
    queryKey: timelineHistogramQueryKey,
    queryFn: fetchTimelineHistogram,
    enabled,
    staleTime: 5 * 60_000,
    retry: (count, error) => !isUnauthorized(error) && count < 2,
  });
}
