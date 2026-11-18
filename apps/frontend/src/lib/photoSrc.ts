import type { Photo } from '../models/photo';

export type PhotoDensity = 'thumb' | 'medium' | 'featured' | 'day';

export const COMPACT_DESKTOP_MIN_WIDTH = 1280;

export function compactThumbSize(viewportWidth: number): 256 | 512 {
  return viewportWidth >= COMPACT_DESKTOP_MIN_WIDTH ? 256 : 512;
}

/**
 * Thumb URL, versioned by content hash.
 *
 * Thumbs are served `private, max-age=31536000, immutable`. A resynced Photo
 * keeps its id (ADR 0005) and its new JPEG overwrites the same disk path, so
 * under RFC 8246 a client should not revalidate and would show the old image
 * for a year. Changing the URL is the spec-aligned way to bust that, and the
 * content hash is exactly the value that changes when the bytes do.
 *
 * `v` is a browser cache key only; the server ignores it. The hash is optional
 * because album covers arrive as a bare `cover_photo_id` with no hash, and a
 * stale cover is acceptable where a stale photo is not.
 */
export function thumbUrl(id: string, size: 256 | 512 | 1024, hash?: string): string {
  const url = `/api/thumb/${encodeURIComponent(id)}?size=${size}`;
  return hash ? `${url}&v=${encodeURIComponent(hash)}` : url;
}

export function compactThumbUrl(id: string, viewportWidth: number, hash?: string): string {
  return thumbUrl(id, compactThumbSize(viewportWidth), hash);
}

/** Smallest thumb that stays sharp at 2x for a tile whose long edge is `cssPx`. */
export function sizedThumbUrl(id: string, cssPx: number, hash?: string): string {
  const needed = cssPx * 2;
  return thumbUrl(id, needed <= 256 ? 256 : needed <= 512 ? 512 : 1024, hash);
}

export function timelineSrc(
  photo: Pick<Photo, 'id' | 'hash' | 'thumbnailUrl'>,
  density: PhotoDensity,
  viewportWidth = 1280,
): string {
  if (density === 'featured' || density === 'day') {
    return thumbUrl(photo.id, 1024, photo.hash);
  }
  return compactThumbUrl(photo.id, viewportWidth, photo.hash);
}

export function cardImageSrc(photo: Photo, density: PhotoDensity, viewportWidth = 1280): string {
  return timelineSrc(photo, density, viewportWidth);
}

export function viewerFallbackSrc(photo: Pick<Photo, 'id' | 'hash'>): string {
  return thumbUrl(photo.id, 1024, photo.hash);
}
