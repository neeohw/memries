import { useQuery } from '@tanstack/react-query';
import { SUMMARY_PER_MONTH, fetchYearSummary, isUnauthorized } from '../lib/api';

/**
 * Deliberately not under the `['photos']` root the infinite feed uses.
 *
 * The favorite mutations patch every cache entry under that prefix by mapping
 * `current.pages`, and this query's data is a flat list of years with no
 * `pages` at all. Sharing the root would make a heart press throw. The
 * mutations patch this entry by its own key instead (`patchSummaryFavorite`).
 */
export const yearSummaryQueryKey = ['photos-summary', 'year', SUMMARY_PER_MONTH] as const;

/**
 * The whole library as one sampled overview, for year view (ADR 0031).
 *
 * One request, cached for the session, and it does not change while browsing —
 * the same reasoning as the scrubber's histogram. It is only enabled at year
 * level, so a reader who never zooms out never pays for it.
 */
export function useYearSummary(enabled: boolean) {
  return useQuery({
    queryKey: yearSummaryQueryKey,
    queryFn: () => fetchYearSummary(SUMMARY_PER_MONTH),
    enabled,
    staleTime: 5 * 60_000,
    retry: (count, error) => !isUnauthorized(error) && count < 2,
  });
}
