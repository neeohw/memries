import { describe, expect, it } from 'vitest';
import {
  compactThumbSize,
  compactThumbUrl,
  sizedThumbUrl,
  thumbUrl,
  timelineSrc,
  viewerFallbackSrc,
} from './photoSrc';

describe('photoSrc', () => {
  const photo = {
    id: 'abc123',
    hash: 'deadbeef',
    thumbnailUrl: '/api/thumb/abc123?size=512&v=deadbeef',
  };

  it('uses 256 on desktop viewports and 512 below 1280', () => {
    expect(compactThumbSize(1280)).toBe(256);
    expect(compactThumbSize(1920)).toBe(256);
    expect(compactThumbSize(1279)).toBe(512);
    expect(compactThumbSize(390)).toBe(512);
  });

  // Thumbs are served private, immutable, max-age=1y. A resynced Photo keeps
  // its id and overwrites the same disk path, so the only spec-aligned way to
  // bust that cache is a different URL. v is the content hash; the server
  // ignores it.
  it('versions thumb URLs by content hash', () => {
    expect(thumbUrl('abc123', 256, 'deadbeef')).toBe('/api/thumb/abc123?size=256&v=deadbeef');
    expect(compactThumbUrl('abc123', 1280, 'deadbeef')).toBe(
      '/api/thumb/abc123?size=256&v=deadbeef',
    );
    expect(sizedThumbUrl('abc123', 120, 'deadbeef')).toBe('/api/thumb/abc123?size=256&v=deadbeef');
  });

  it('omits the version when no hash is known', () => {
    // Album covers arrive as a bare cover_photo_id with no hash, and a stale
    // cover is acceptable; a malformed URL is not.
    expect(thumbUrl('abc123', 512)).toBe('/api/thumb/abc123?size=512');
    expect(compactThumbUrl('abc123', 390)).toBe('/api/thumb/abc123?size=512');
  });

  it('escapes the id and the version', () => {
    expect(thumbUrl('a b/c', 256, 'x&y')).toBe('/api/thumb/a%20b%2Fc?size=256&v=x%26y');
  });

  it('uses the 1024 thumb for large timeline cards', () => {
    expect(timelineSrc(photo, 'featured', 390)).toBe('/api/thumb/abc123?size=1024&v=deadbeef');
    expect(timelineSrc(photo, 'day', 1280)).toBe('/api/thumb/abc123?size=1024&v=deadbeef');
  });

  it('uses the viewport compact size for thumb and medium cards', () => {
    expect(timelineSrc(photo, 'thumb', 1280)).toBe('/api/thumb/abc123?size=256&v=deadbeef');
    expect(timelineSrc(photo, 'medium', 800)).toBe('/api/thumb/abc123?size=512&v=deadbeef');
  });

  it('picks the smallest thumb that stays sharp at 2x for justified tiles', () => {
    expect(sizedThumbUrl('abc123', 120, 'deadbeef')).toBe('/api/thumb/abc123?size=256&v=deadbeef');
    expect(sizedThumbUrl('abc123', 230, 'deadbeef')).toBe('/api/thumb/abc123?size=512&v=deadbeef');
    expect(sizedThumbUrl('abc123', 420, 'deadbeef')).toBe('/api/thumb/abc123?size=1024&v=deadbeef');
  });

  it('falls back to the 1024 thumb when an original cannot load', () => {
    expect(viewerFallbackSrc(photo)).toBe('/api/thumb/abc123?size=1024&v=deadbeef');
  });

  // Two Photos that differ only in content must not share a cache entry.
  it('gives a resynced Photo a different URL', () => {
    const before = timelineSrc({ ...photo, hash: 'old' }, 'thumb', 1280);
    const after = timelineSrc({ ...photo, hash: 'new' }, 'thumb', 1280);
    expect(before).not.toBe(after);
  });
});
