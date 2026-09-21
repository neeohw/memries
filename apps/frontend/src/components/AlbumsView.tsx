import { useEffect, useRef, useState } from 'react';
import { compactThumbSize, thumbUrl } from '../lib/photoSrc';
import { useViewportWidth } from '../hooks/useViewportWidth';
import type { Album } from '../models/photo';
import { FoldersIcon, PlusIcon } from './icons';
import { PageHeader } from './PageHeader';

export function AlbumsView({
  albums,
  onCreate,
  onOpen,
  creating,
}: {
  albums: Album[];
  onCreate: (name: string) => void;
  onOpen: (album: Album) => void;
  creating: boolean;
}) {
  const [drafting, setDrafting] = useState(false);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (drafting) inputRef.current?.focus();
  }, [drafting]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    onCreate(trimmed);
    setName('');
    setDrafting(false);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Albums"
        actions={
          <button
            type="button"
            onClick={() => setDrafting(true)}
            disabled={drafting}
            className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-ink transition duration-200 hover:bg-surface/70 hover:text-plum disabled:opacity-40"
          >
            <PlusIcon className="h-4 w-4" />
            New album
          </button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-8 min-[640px]:px-5">
        {creating && (
          <p className="sr-only" role="status">
            Creating album…
          </p>
        )}

        {albums.length === 0 && !drafting && (
          <p className="mt-10 text-center text-sm text-ink" role="status">
            No albums yet.
          </p>
        )}

        <ul className="grid list-none grid-cols-2 gap-3 p-0 min-[800px]:grid-cols-3 min-[1280px]:grid-cols-4 min-[1600px]:grid-cols-5 min-[2000px]:grid-cols-6">
          {drafting && (
            <li className="col-span-2 min-[800px]:col-span-1">
              <form
                data-album-form
                className="animate-form-in flex h-full min-h-[11rem] flex-col justify-between rounded-xl bg-surface/70 p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  submit();
                }}
              >
                <label className="text-sm font-medium text-plum">
                  Album name
                  <input
                    ref={inputRef}
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Summer, the house, Tuesday…"
                    className="mt-2 h-11 w-full rounded-xl bg-cream px-3 text-sm text-plum outline-none ring-1 ring-plum/10 placeholder:text-ink"
                  />
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="submit"
                    disabled={!name.trim() || creating}
                    className="min-h-10 rounded-full bg-plum px-4 text-sm font-medium text-cream disabled:opacity-40"
                  >
                    {creating ? 'Creating…' : 'Create'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDrafting(false);
                      setName('');
                    }}
                    className="min-h-10 rounded-full bg-surface px-4 text-sm font-medium text-ink"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </li>
          )}

          {albums.map((album) => (
            <li key={album.id}>
              <AlbumCard album={album} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function AlbumCard({ album, onOpen }: { album: Album; onOpen: (album: Album) => void }) {
  const coverId = album.coverPhotoId ?? album.photoIds[0];
  const count = album.photoCount;
  const countLabel = `${count} ${count === 1 ? 'photo' : 'photos'}`;
  const coverSize = compactThumbSize(useViewportWidth());

  return (
    <article data-album-card className="album-card overflow-hidden rounded-xl">
      <button
        type="button"
        onClick={() => onOpen(album)}
        className="group block w-full text-left transition duration-200 active:scale-[0.99]"
        aria-label={`Open album ${album.name}, ${countLabel}`}
      >
        <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-blush/50">
          {coverId ? (
            <img
              src={thumbUrl(coverId, coverSize)}
              alt=""
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="grid h-full place-items-center text-peach">
              <FoldersIcon className="h-8 w-8" />
            </div>
          )}
        </div>
        <div className="px-1 py-2">
          <p className="truncate text-sm font-semibold text-plum">{album.name}</p>
          <p className="mt-0.5 text-xs text-ink">{countLabel}</p>
        </div>
      </button>
    </article>
  );
}
