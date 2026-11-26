export type IndexPhase =
  'not_started' | 'queued' | 'running' | 'complete' | 'complete_with_errors' | 'stopped' | 'failed';

export type IndexStatus = {
  status: IndexPhase;
  prefix: string;
  /** Folders feeding this library; 0 means nothing is connected yet. */
  sources?: number;
  discovered: number;
  processed: number;
  indexed: number;
  skipped: number;
  failed: number;
  error?: string;
};

export function shouldPoll(status: IndexStatus): boolean {
  return status.status === 'queued' || status.status === 'running';
}

/**
 * Whether the reader should be let through to the library.
 *
 * Anything but a run in flight, or one that failed. While the splash still
 * started runs by itself, `not_started` meant "a run is about to begin" and
 * waiting on it made sense. Now that only an admin starts one it means
 * "nobody has asked for one yet", and holding a reader on a splash for that
 * is a dead end with no way out (ADR 0004). A `stopped` run is the same: the
 * photos it got through are in the catalog.
 *
 * `failed` is the exception. The splash is where the reason is shown, and an
 * admin's retry is there with it.
 */
export function isIndexReady(status: IndexStatus): boolean {
  return !shouldPoll(status) && status.status !== 'failed';
}

export function canRetryIndex(status: IndexStatus): boolean {
  return status.status === 'failed';
}

export function shouldInvalidatePhotos(prev: IndexStatus | undefined, next: IndexStatus): boolean {
  return !!prev && shouldPoll(prev) && isIndexReady(next);
}

/**
 * The line under the indexing screen's title.
 *
 * Takes the translator rather than returning English: this is the main thing
 * a reader sees while waiting, so it has to speak their language (ADR 0021).
 * The server's own error text is passed through as it comes.
 */
export function indexStatusCopy(
  status: IndexStatus,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (status.status === 'queued') return t('indexing.queued');
  if (status.status === 'running') {
    if (status.discovered === 0) return t('indexing.looking');
    return t('indexing.reading', { processed: status.processed, discovered: status.discovered });
  }
  if (status.status === 'stopped') return t('indexing.stopped');
  if (status.status === 'failed') return status.error || t('indexing.failed');
  if (status.status === 'complete_with_errors') return t('indexing.someFailed');
  return t('indexing.opening');
}

/** Percentage of discovered files processed, or 0 before discovery finishes. */
export function indexProgress(status: IndexStatus): number {
  if (status.discovered <= 0) return 0;
  return Math.min(100, Math.round((status.processed / status.discovered) * 100));
}
