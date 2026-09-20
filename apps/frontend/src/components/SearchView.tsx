import { useEffect, useMemo, useRef } from 'react';
import { usePhotoPress } from '../hooks/usePhotoPress';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { useViewportWidth } from '../hooks/useViewportWidth';
import { useVisibleRowRange } from '../hooks/useVisibleRowRange';
import { photoOpenLabel } from '../lib/photoName';
import { photoFacets } from '../lib/groupPhotos';
import { chunkIntoRows, rowWindow, searchGridColumns } from '../lib/keepWindow';
import { parseSmartDate, SEARCH_SUGGESTIONS } from '../lib/parseSmartDate';
import { compactThumbSize, compactThumbUrl } from '../lib/photoSrc';
import type { Photo, SearchCategory, SearchState } from '../models/photo';
import { FavoriteBadge } from './FavoriteBadge';
import { CloseIcon, SearchIcon } from './icons';

const CATEGORIES: { id: SearchCategory; label: string }[] = [
  { id: 'years', label: 'Years' },
  { id: 'favorites', label: 'Favorites' },
];

export function SearchView({
  photos,
  facetPhotos,
  search,
  onSearchChange,
  onOpen,
  onActions,
  autoFocus,
  ready = true,
}: {
  photos: Photo[];
  facetPhotos: Photo[];
  search: SearchState;
  onSearchChange: (next: SearchState) => void;
  onOpen: (photo: Photo, origin: HTMLElement, list: Photo[]) => void;
  onActions?: (photo: Photo, origin: HTMLElement) => void;
  autoFocus: boolean;
  ready?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const facets = useMemo(() => photoFacets(facetPhotos), [facetPhotos]);
  const parsed = useMemo(() => parseSmartDate(search.query, new Date()), [search.query]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const results = photos;
  const showSuggestions = !search.query.trim() || (ready && results.length === 0);

  const toggleCategory = (id: SearchCategory) => {
    if (id === 'favorites') {
      onSearchChange({
        ...search,
        favoritesOnly: !search.favoritesOnly,
        openCategory: search.openCategory,
      });
      return;
    }
    onSearchChange({
      ...search,
      openCategory: search.openCategory === id ? null : id,
    });
  };

  const facetOptions = search.openCategory === 'years' ? facets.years : [];

  const toggleFacet = (value: string) => {
    if (search.openCategory === 'years') {
      onSearchChange({ ...search, years: xor(search.years, value) });
    }
  };

  const selectedFacets = search.years;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pb-3 min-[640px]:px-6">
        <h1 className="font-display text-[2.1rem] font-semibold leading-tight tracking-tight text-plum">
          Search
        </h1>
        <form
          className="mt-4"
          role="search"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <label className="flex min-h-12 items-center gap-3 rounded-full bg-surface/70 px-4 shadow-soft backdrop-blur-md">
            <SearchIcon className="h-5 w-5 shrink-0 text-ink" />
            <span className="sr-only">Search memories</span>
            <input
              ref={inputRef}
              type="search"
              name="memries-memory-search"
              autoComplete="off"
              value={search.query}
              onChange={(event) => onSearchChange({ ...search, query: event.target.value })}
              placeholder="Yesterday, last winter, June…"
              className="h-12 min-w-0 w-full bg-transparent text-base text-plum outline-none placeholder:text-ink"
            />
          </label>

          {parsed && (
            <div className="mt-3 flex items-center gap-2" role="status">
              <p className="min-w-0 flex-1 text-sm text-ink">{parsed.label}</p>
              <button
                type="button"
                onClick={() => onSearchChange({ ...search, query: '' })}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink transition hover:text-plum"
                aria-label="Clear search date"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
          )}

          {showSuggestions && (
            <ul className="mt-3 flex flex-wrap gap-2" aria-label="Search suggestions">
              {SEARCH_SUGGESTIONS.map((suggestion, index) => (
                <li key={suggestion.chip}>
                  <button
                    type="button"
                    data-suggestion-chip
                    onClick={() => onSearchChange({ ...search, query: suggestion.query })}
                    className={`min-h-11 rounded-full bg-surface/70 px-4 text-sm font-medium text-ink shadow-soft transition duration-200 hover:text-plum ${
                      reducedMotion ? '' : 'animate-chip-in'
                    }`}
                    style={reducedMotion ? undefined : { animationDelay: `${index * 45}ms` }}
                  >
                    {suggestion.chip}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Search filters">
            {CATEGORIES.map((category) => {
              const active =
                category.id === 'favorites'
                  ? search.favoritesOnly
                  : search.openCategory === category.id ||
                    (category.id === 'years' && search.years.length > 0);
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => toggleCategory(category.id)}
                  aria-pressed={active}
                  aria-expanded={
                    category.id === 'years' ? search.openCategory === 'years' : undefined
                  }
                  className={`min-h-11 rounded-full px-4 text-sm font-medium transition duration-200 ${
                    active ? 'bg-plum text-cream shadow-lift' : 'bg-surface/70 text-ink shadow-soft'
                  }`}
                >
                  {category.label}
                </button>
              );
            })}
          </div>

          {facetOptions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Years">
              {facetOptions.map((option) => {
                const selected = selectedFacets.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => toggleFacet(option)}
                    aria-pressed={selected}
                    className={`min-h-11 rounded-full px-3 text-sm transition duration-200 ${
                      selected ? 'bg-peach text-plum' : 'bg-surface/50 text-ink'
                    }`}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          )}
        </form>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 min-[640px]:px-6">
        {!ready ? (
          <p className="mt-10 text-center text-sm text-ink" role="status">
            Looking through your memories…
          </p>
        ) : results.length === 0 ? (
          <div
            className="mt-10 flex flex-col items-center text-center"
            data-empty="search"
            role="status"
          >
            <span
              className={`grid h-14 w-14 place-items-center rounded-full bg-surface/70 text-peach shadow-soft ${reducedMotion ? '' : 'index-pulse'}`}
              aria-hidden
            >
              <SearchIcon className="h-6 w-6" />
            </span>
            <p className="mt-4 text-sm text-ink">No memories match that search.</p>
          </div>
        ) : (
          <>
            <p className="mb-3 text-sm text-ink" role="status">
              {results.length} {results.length === 1 ? 'result' : 'results'}
            </p>
            <SearchResultGrid photos={results} onOpen={onOpen} onActions={onActions} />
          </>
        )}
      </div>
    </div>
  );
}

function SearchResultGrid({
  photos,
  onOpen,
  onActions,
}: {
  photos: Photo[];
  onOpen: (photo: Photo, origin: HTMLElement, list: Photo[]) => void;
  onActions?: (photo: Photo, origin: HTMLElement) => void;
}) {
  const width = useViewportWidth();
  const columns = searchGridColumns(width);
  const visualRows = chunkIntoRows(photos, columns);
  const { first, last, bindRow } = useVisibleRowRange(visualRows.length);
  const keep = rowWindow(visualRows.length, first, last);

  return (
    <div className="flex flex-col gap-2.5">
      {visualRows.map((rowPhotos, rowIndex) => (
        <div
          key={rowPhotos.map((photo) => photo.id).join('-')}
          ref={bindRow(rowIndex)}
          className="grid grid-cols-2 gap-2.5 min-[640px]:grid-cols-3 min-[800px]:grid-cols-4"
        >
          {rowPhotos.map((photo) => (
            <SearchResultButton
              key={photo.id}
              photo={photo}
              showImage={rowIndex >= keep.start && rowIndex < keep.end}
              onOpen={(origin) => onOpen(photo, origin, photos)}
              onActions={onActions ? (origin) => onActions(photo, origin) : undefined}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function SearchResultButton({
  photo,
  showImage,
  onOpen,
  onActions,
}: {
  photo: Photo;
  showImage: boolean;
  onOpen: (origin: HTMLElement) => void;
  onActions?: (origin: HTMLElement) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const viewportWidth = useViewportWidth();
  const box = compactThumbSize(viewportWidth);
  const ariaLabel = photoOpenLabel(photo);

  const press = usePhotoPress({
    onOpen: () => {
      if (buttonRef.current) onOpen(buttonRef.current);
    },
    onActions: onActions
      ? () => {
          if (buttonRef.current) onActions(buttonRef.current);
        }
      : undefined,
  });

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={press.onClick}
      onPointerDown={press.onPointerDown}
      onPointerMove={press.onPointerMove}
      onPointerUp={press.onPointerUp}
      onPointerCancel={press.onPointerCancel}
      onContextMenu={press.onContextMenu}
      onKeyDown={press.onKeyDown}
      className="relative overflow-hidden rounded-2xl bg-blush/30 shadow-soft transition duration-200 active:scale-[0.985]"
      aria-label={ariaLabel}
      aria-haspopup={onActions ? 'dialog' : undefined}
    >
      {showImage && (
        <img
          src={compactThumbUrl(photo.id, viewportWidth)}
          alt=""
          width={box}
          height={box}
          loading="lazy"
          decoding="async"
          className="aspect-square h-full w-full object-cover"
        />
      )}
      {photo.favorite && <FavoriteBadge compact />}
    </button>
  );
}

function xor(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}
