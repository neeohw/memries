import { describe, expect, it } from 'vitest';
import {
  canRetryIndex,
  indexProgress,
  indexStatusCopy,
  isIndexReady,
  shouldInvalidatePhotos,
  shouldPoll,
  type IndexStatus,
} from './indexStatus';
import { createTranslator } from '../i18n/I18nProvider';

/** Like status(), but for the cases that care about the counts too. */
function counted(overrides: Partial<IndexStatus> = {}): IndexStatus {
  return { ...status('running'), ...overrides };
}

function status(phase: IndexStatus['status']): IndexStatus {
  return {
    status: phase,
    prefix: 'admin@example.com',
    discovered: 0,
    processed: 0,
    indexed: 0,
    skipped: 0,
    failed: 0,
  };
}

describe('index status decisions', () => {
  // Nothing here starts a run any more: loading the page must not put a
  // 1.9GB box through an 11,000-file walk, and the only trigger in the
  // interface is Scan on the Folders page (ADR 0004). `not_started` is
  // something the splash reports, not something it acts on.
  it('polls only while queued or running', () => {
    expect(shouldPoll(status('queued'))).toBe(true);
    expect(shouldPoll(status('running'))).toBe(true);
    expect(shouldPoll(status('complete'))).toBe(false);
    expect(shouldPoll(status('failed'))).toBe(false);
  });

  // The splash is for a run in flight. Holding a reader on it when nothing is
  // running — and nothing will start by itself any more — is a dead end.
  it('lets the reader through unless a run is in flight or failed', () => {
    expect(isIndexReady(status('not_started'))).toBe(true);
    expect(isIndexReady(status('stopped'))).toBe(true);
    expect(isIndexReady(status('queued'))).toBe(false);
    expect(isIndexReady(status('running'))).toBe(false);
    expect(isIndexReady(status('failed'))).toBe(false);
  });

  it('treats complete and complete_with_errors as ready for photos', () => {
    expect(isIndexReady(status('complete'))).toBe(true);
    expect(isIndexReady(status('complete_with_errors'))).toBe(true);
    expect(isIndexReady(status('running'))).toBe(false);
  });

  it('allows retry only after failure', () => {
    expect(canRetryIndex(status('failed'))).toBe(true);
    expect(canRetryIndex(status('complete'))).toBe(false);
  });

  it('invalidates photos when a poll finishes', () => {
    expect(shouldInvalidatePhotos(status('running'), status('complete'))).toBe(true);
    expect(shouldInvalidatePhotos(undefined, status('complete'))).toBe(false);
    expect(shouldInvalidatePhotos(status('complete'), status('complete'))).toBe(false);
  });
});

describe('indexStatusCopy', () => {
  // The waiting line is the main thing on screen during a first index, so it
  // goes through the translator rather than returning English (ADR 0021).
  const t = createTranslator('nl');

  it('speaks the reader’s language', () => {
    expect(indexStatusCopy(counted({ status: 'queued' }), t)).toBe('Wachten om je map te openen…');
    expect(indexStatusCopy(counted({ status: 'running' }), t)).toBe('Je map doorzoeken…');
    expect(indexStatusCopy(counted({ discovered: 9, processed: 3 }), t)).toBe('3 van 9 gelezen…');
    expect(indexStatusCopy(counted({ status: 'complete' }), t)).toBe('Je album wordt geopend…');
  });

  // The server's message says what actually went wrong; it is passed through
  // rather than replaced with a translated generality.
  it('prefers the server error over its own wording', () => {
    expect(indexStatusCopy(counted({ status: 'failed', error: 'permission denied' }), t)).toBe(
      'permission denied',
    );
    // A failure and a run an admin stopped are different things now, and each
    // says which it was.
    expect(indexStatusCopy(counted({ status: 'failed' }), t)).toBe(
      'Indexeren kon niet worden afgerond.',
    );
    expect(indexStatusCopy(counted({ status: 'stopped' }), t)).toBe(
      'Indexeren is gestopt voordat het klaar was.',
    );
  });
});

describe('indexProgress', () => {
  it('is zero until discovery has a denominator', () => {
    expect(indexProgress(counted({ discovered: 0, processed: 0 }))).toBe(0);
  });

  it('rounds to whole percent', () => {
    expect(indexProgress(counted({ discovered: 3, processed: 1 }))).toBe(33);
  });

  // A tree that grew during the walk can report more processed than
  // discovered; the bar must not overflow.
  it('never exceeds 100', () => {
    expect(indexProgress(counted({ discovered: 10, processed: 14 }))).toBe(100);
  });
});
