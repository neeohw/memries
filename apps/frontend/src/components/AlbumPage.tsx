import { useAlbum } from '../hooks/useAlbums';
import type { Photo } from '../models/photo';
import { ChevronLeftIcon } from './icons';
import { PageHeader } from './PageHeader';
import { PhotoGrid } from './PhotoGrid';

export function AlbumPage({
  albumId,
  onBack,
  onOpen,
  onActions,
}: {
  albumId: string;
  onBack: () => void;
  onOpen: (photo: Photo, origin: HTMLElement, list: Photo[]) => void;
  onActions?: (photo: Photo, origin: HTMLElement) => void;
}) {
  const query = useAlbum(albumId);
  const album = query.data?.album;
  const photos = query.data?.photos ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={album?.name ?? 'Album'}
        meta={
          album ? `${album.photoCount} ${album.photoCount === 1 ? 'photo' : 'photos'}` : undefined
        }
        leading={
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to albums"
            title="Back to albums"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink transition hover:bg-surface/70 hover:text-plum"
          >
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-8 min-[640px]:px-5">
        {query.isPending && (
          <p className="mt-10 text-center text-sm text-ink" role="status">
            Opening this album…
          </p>
        )}

        {query.isError && (
          <div className="mt-10 text-center" role="alert">
            <p className="font-display text-2xl font-semibold tracking-tight text-plum">
              We could not open this album
            </p>
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="mt-5 min-h-11 rounded-full bg-plum px-5 text-sm font-medium text-cream"
            >
              Try again
            </button>
          </div>
        )}

        {query.isSuccess &&
          album &&
          (photos.length === 0 ? (
            <p className="mt-10 text-center text-sm text-ink" role="status">
              No photos in this album yet.
            </p>
          ) : (
            <PhotoGrid
              photos={photos}
              granularity="year"
              onOpen={(photo, origin) => onOpen(photo, origin, photos)}
              onActions={onActions}
            />
          ))}
      </div>
    </div>
  );
}
