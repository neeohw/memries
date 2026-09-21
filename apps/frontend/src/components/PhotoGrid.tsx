import { useVisibleRowRange } from '../hooks/useVisibleRowRange';
import { useElementWidth } from '../hooks/useElementWidth';
import { useViewportWidth } from '../hooks/useViewportWidth';
import { justifyRows, targetRowHeight } from '../lib/justifyRows';
import { chunkIntoRows, rowWindow, thumbsGridColumns } from '../lib/keepWindow';
import type { Granularity, Photo } from '../models/photo';
import { PhotoCard } from './PhotoCard';

const GAP = 4;

export function PhotoGrid({
  photos,
  granularity,
  onOpen,
  onActions,
}: {
  photos: Photo[];
  granularity: Granularity;
  onOpen: (photo: Photo, origin: HTMLElement) => void;
  onActions?: (photo: Photo, origin: HTMLElement) => void;
}) {
  if (photos.length === 0) return null;
  if (granularity === 'year') {
    return <CompactThumbs photos={photos} onOpen={onOpen} onActions={onActions} />;
  }
  return (
    <JustifiedRows
      photos={photos}
      granularity={granularity}
      onOpen={onOpen}
      onActions={onActions}
    />
  );
}

function JustifiedRows({
  photos,
  granularity,
  onOpen,
  onActions,
}: {
  photos: Photo[];
  granularity: Granularity;
  onOpen: (photo: Photo, origin: HTMLElement) => void;
  onActions?: (photo: Photo, origin: HTMLElement) => void;
}) {
  const viewportWidth = useViewportWidth();
  const { ref, width } = useElementWidth<HTMLDivElement>(Math.max(320, viewportWidth - 48));
  const rows = justifyRows(photos, width, targetRowHeight(granularity, viewportWidth), GAP);
  const { first, last, bindRow } = useVisibleRowRange(rows.length);
  const keep = rowWindow(rows.length, first, last);

  return (
    <div ref={ref} className="flex w-full flex-col" style={{ gap: GAP }} data-photo-rows>
      {rows.map((row, rowIndex) => (
        <div
          key={row.tiles.map((tile) => tile.photo.id).join('-')}
          ref={bindRow(rowIndex)}
          className="flex"
          style={{ gap: GAP, height: row.height }}
        >
          {row.tiles.map((tile, tileIndex) => (
            <PhotoCard
              key={tile.photo.id}
              photo={tile.photo}
              density="medium"
              size={{ width: tile.width, height: tile.height }}
              showImage={rowIndex >= keep.start && rowIndex < keep.end}
              revealIndex={rowIndex + tileIndex}
              onOpen={onOpen}
              onActions={onActions}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function CompactThumbs({
  photos,
  onOpen,
  onActions,
}: {
  photos: Photo[];
  onOpen: (photo: Photo, origin: HTMLElement) => void;
  onActions?: (photo: Photo, origin: HTMLElement) => void;
}) {
  const width = useViewportWidth();
  const columns = thumbsGridColumns(width);
  const visualRows = chunkIntoRows(photos, columns);
  const { first, last, bindRow } = useVisibleRowRange(visualRows.length);
  const keep = rowWindow(visualRows.length, first, last);

  return (
    <div className="flex flex-col" style={{ gap: GAP }}>
      {visualRows.map((rowPhotos, rowIndex) => (
        <div
          key={rowPhotos.map((photo) => photo.id).join('-')}
          ref={bindRow(rowIndex)}
          className="grid"
          style={{ gap: GAP, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {rowPhotos.map((photo, photoIndex) => (
            <PhotoCard
              key={photo.id}
              photo={photo}
              density="thumb"
              showImage={rowIndex >= keep.start && rowIndex < keep.end}
              revealIndex={rowIndex * columns + photoIndex}
              onOpen={onOpen}
              onActions={onActions}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
