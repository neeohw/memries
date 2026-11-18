import type { Granularity, Photo } from '../models/photo';

export interface JustifiedTile {
  photo: Photo;
  width: number;
  height: number;
}

export interface JustifiedRow {
  tiles: JustifiedTile[];
  height: number;
}

const MIN_ASPECT = 0.5;
const MAX_ASPECT = 2.4;

export function tileAspect(photo: Pick<Photo, 'width' | 'height'>): number {
  if (!photo.width || !photo.height) return 1;
  return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, photo.width / photo.height));
}

/** Target row height (CSS px) for justified Timeline rows. */
export function targetRowHeight(granularity: Granularity, viewportWidth: number): number {
  const step = viewportWidth < 640 ? 0 : viewportWidth < 1280 ? 1 : viewportWidth < 1800 ? 2 : 3;
  // Each level is about 0.7 of the one closer in, so every zoom notch changes
  // the tiles visibly. Year used to share month's row, which made zooming out
  // from month regroup without resizing and read as a control that had not
  // worked (ADR 0019).
  if (granularity === 'week') return [170, 260, 320, 380][step];
  if (granularity === 'month') return [120, 190, 230, 270][step];
  return [85, 135, 165, 190][step];
}

/**
 * Packs photos into rows that fill `containerWidth` exactly, keeping each photo's aspect
 * ratio. The last row keeps the target height instead of stretching to the edge.
 */
export function justifyRows(
  photos: Photo[],
  containerWidth: number,
  targetHeight: number,
  gap: number,
): JustifiedRow[] {
  if (photos.length === 0 || containerWidth <= 0 || targetHeight <= 0) return [];
  const rows: JustifiedRow[] = [];
  let pending: Photo[] = [];
  let aspectSum = 0;

  const flush = (height: number) => {
    const tiles = pending.map((photo) => ({
      photo,
      height,
      width: tileAspect(photo) * height,
    }));
    rows.push({ tiles, height });
    pending = [];
    aspectSum = 0;
  };

  for (const photo of photos) {
    pending.push(photo);
    aspectSum += tileAspect(photo);
    const gaps = gap * (pending.length - 1);
    if (aspectSum * targetHeight + gaps >= containerWidth) {
      flush((containerWidth - gaps) / aspectSum);
    }
  }

  if (pending.length > 0) {
    const gaps = gap * (pending.length - 1);
    flush(Math.min(targetHeight, (containerWidth - gaps) / aspectSum));
  }

  return rows;
}
