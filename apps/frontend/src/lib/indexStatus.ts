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

export function indexStatusCopy(status: IndexStatus): string {
  if (status.status === 'queued') return 'Waiting to open your folder…';
  if (status.status === 'running') {
    if (status.discovered === 0) return 'Looking through your folder…';
    return `Reading ${status.processed} of ${status.discovered}…`;
  }
  if (status.status === 'failed') return status.error || 'Indexing stopped before it finished.';
  if (status.status === 'complete_with_errors')
    return 'Some files could not be read. Opening what we have…';
  return 'Opening your album…';
}
