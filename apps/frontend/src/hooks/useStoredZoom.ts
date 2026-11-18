import { useCallback, useState } from 'react';
import { readZoom, sessionStore, writeZoom } from '../lib/zoom';
import type { Granularity } from '../models/photo';

export const DEFAULT_ZOOM: Granularity = 'month';

/**
 * The timeline zoom level, remembered for this tab (ADR 0019).
 *
 * The write happens in the setter rather than in an effect: an effect that
 * mirrors state into storage runs after a render that has already happened,
 * which is both a round-trip later than needed and the pattern
 * `react-hooks/set-state-in-effect` exists to discourage.
 */
export function useStoredZoom(): [Granularity, (next: Granularity) => void] {
  const [granularity, setGranularity] = useState<Granularity>(
    () => readZoom(sessionStore()) ?? DEFAULT_ZOOM,
  );

  const setZoom = useCallback((next: Granularity) => {
    setGranularity(next);
    writeZoom(sessionStore(), next);
  }, []);

  return [granularity, setZoom];
}
