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
  const photo = { id: 'abc123', thumbnailUrl: '/api/thumb/abc123?size=512' };

  it('uses 256 on desktop viewports and 512 below 1280', () => {
    expect(compactThumbSize(1280)).toBe(256);
    expect(compactThumbSize(1920)).toBe(256);
    expect(compactThumbSize(1279)).toBe(512);
    expect(compactThumbSize(390)).toBe(512);
  });

  it('uses the 1024 thumb for large timeline cards', () => {
    expect(timelineSrc(photo, 'featured', 390)).toBe('/api/thumb/abc123?size=1024');
    expect(timelineSrc(photo, 'day', 1280)).toBe('/api/thumb/abc123?size=1024');
  });

  it('uses the viewport compact size for thumb and medium cards', () => {
    expect(timelineSrc(photo, 'thumb', 1280)).toBe(compactThumbUrl('abc123', 1280));
    expect(timelineSrc(photo, 'medium', 800)).toBe('/api/thumb/abc123?size=512');
  });

  it('picks the smallest thumb that stays sharp at 2x for justified tiles', () => {
    expect(sizedThumbUrl('abc123', 120)).toBe('/api/thumb/abc123?size=256');
    expect(sizedThumbUrl('abc123', 230)).toBe('/api/thumb/abc123?size=512');
    expect(sizedThumbUrl('abc123', 420)).toBe('/api/thumb/abc123?size=1024');
  });

  it('falls back to the 1024 thumb when an original cannot load', () => {
    expect(viewerFallbackSrc(photo)).toBe(thumbUrl('abc123', 1024));
  });
});
