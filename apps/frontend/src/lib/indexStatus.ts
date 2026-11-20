export type IndexPhase =
  'not_started' | 'queued' | 'running' | 'complete' | 'complete_with_errors' | 'failed';

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

export function shouldAutoStart(status: IndexStatus): boolean {
  return status.status === 'not_started';
}

export function shouldPoll(status: IndexStatus): boolean {
  return status.status === 'queued' || status.status === 'running';
}

export function isIndexReady(status: IndexStatus): boolean {
  return status.status === 'complete' || status.status === 'complete_with_errors';
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
  if (status.status === 'failed') return status.error || t('indexing.stopped');
  if (status.status === 'complete_with_errors') return t('indexing.someFailed');
  return t('indexing.opening');
}

/** Percentage of discovered files processed, or 0 before discovery finishes. */
export function indexProgress(status: IndexStatus): number {
  if (status.discovered <= 0) return 0;
  return Math.min(100, Math.round((status.processed / status.discovered) * 100));
}
