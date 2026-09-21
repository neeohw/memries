export const COMPACT_ROW_OVERSCAN = 10;

export function thumbsGridColumns(width: number): number {
  if (width >= 2200) return 14;
  if (width >= 1800) return 12;
  if (width >= 1500) return 10;
  if (width >= 1280) return 8;
  if (width >= 800) return 7;
  if (width >= 680) return 6;
  if (width >= 640) return 5;
  return 4;
}

export function searchGridColumns(width: number): number {
  if (width >= 1800) return 8;
  if (width >= 1400) return 6;
  if (width >= 1024) return 5;
  if (width >= 800) return 4;
  if (width >= 640) return 3;
  return 2;
}

export function rowWindow(
  rowCount: number,
  firstVisible: number,
  lastVisible: number,
  overscan = COMPACT_ROW_OVERSCAN,
): { start: number; end: number } {
  if (rowCount <= 0) return { start: 0, end: 0 };
  const lo = Math.min(firstVisible, lastVisible);
  const hi = Math.max(firstVisible, lastVisible);
  const start = Math.max(0, lo - overscan);
  const end = Math.min(rowCount, hi + 1 + overscan);
  return { start, end };
}

export function shouldMountThumb(
  index: number,
  columns: number,
  firstVisibleRow: number,
  lastVisibleRow: number,
  overscan = COMPACT_ROW_OVERSCAN,
): boolean {
  if (columns < 1) return false;
  const row = Math.floor(index / columns);
  const lo = Math.min(firstVisibleRow, lastVisibleRow) - overscan;
  const hi = Math.max(firstVisibleRow, lastVisibleRow) + overscan;
  return row >= lo && row <= hi;
}

export function chunkIntoRows<T>(items: T[], columns: number): T[][] {
  const size = Math.max(1, columns);
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}
