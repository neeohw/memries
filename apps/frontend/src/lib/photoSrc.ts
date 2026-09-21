import type { Photo } from '../models/photo';

export type PhotoDensity = 'thumb' | 'medium' | 'featured' | 'day';

export const COMPACT_DESKTOP_MIN_WIDTH = 1280;

export function compactThumbSize(viewportWidth: number): 256 | 512 {
  return viewportWidth >= COMPACT_DESKTOP_MIN_WIDTH ? 256 : 512;
}

export function thumbUrl(id: string, size: 256 | 512 | 1024): string {
  return `/api/thumb/${encodeURIComponent(id)}?size=${size}`;
}

export function compactThumbUrl(id: string, viewportWidth: number): string {
  return thumbUrl(id, compactThumbSize(viewportWidth));
}

/** Smallest thumb that stays sharp at 2x for a tile whose long edge is `cssPx`. */
export function sizedThumbUrl(id: string, cssPx: number): string {
  const needed = cssPx * 2;
  return thumbUrl(id, needed <= 256 ? 256 : needed <= 512 ? 512 : 1024);
}

export function timelineSrc(
  photo: Pick<Photo, 'id' | 'thumbnailUrl'>,
  density: PhotoDensity,
  viewportWidth = 1280,
): string {
  if (density === 'featured' || density === 'day') {
    return thumbUrl(photo.id, 1024);
  }
  return compactThumbUrl(photo.id, viewportWidth);
}

export function cardImageSrc(photo: Photo, density: PhotoDensity, viewportWidth = 1280): string {
  return timelineSrc(photo, density, viewportWidth);
}

export function viewerFallbackSrc(photo: Pick<Photo, 'id'>): string {
  return thumbUrl(photo.id, 1024);
}
