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
      <h1 className="sr-only">Search</h1>
      <form
        className="shrink-0 px-3 py-2 min-[640px]:px-5"
        role="search"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <label className="flex min-h-11 max-w-3xl items-center gap-3 rounded-full bg-surface/70 px-4 focus-within:ring-2 focus-within:ring-plum">
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
            className="h-11 min-w-0 w-full bg-transparent text-base text-plum outline-none placeholder:text-ink focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </label>

        {parsed && (
          <div className="mt-1 flex max-w-3xl items-center gap-2 pl-4" role="status">
            <p className="min-w-0 flex-1 text-sm text-ink">{parsed.label}</p>
            <button
              type="button"
              onClick={() => onSearchChange({ ...search, query: '' })}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink transition hover:text-plum"
              aria-label="Clear search date"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
        )}
      </form>

      <div className="flex min-h-0 flex-1 flex-col min-[1024px]:flex-row">
        <div className="shrink-0 px-3 pb-3 min-[640px]:px-5 min-[1024px]:w-64 min-[1024px]:overflow-y-auto min-[1024px]:border-r min-[1024px]:border-plum/5 min-[1024px]:pb-6 min-[1024px]:pt-2">
          {showSuggestions && (
            <>
              <p className="mb-2 hidden text-xs font-medium uppercase tracking-wide text-ink min-[1024px]:block">
                Try
              </p>
              <ul
                className="no-scrollbar -mx-3 flex gap-1.5 overflow-x-auto px-3 min-[640px]:-mx-5 min-[640px]:px-5 min-[1024px]:mx-0 min-[1024px]:mb-5 min-[1024px]:flex-wrap min-[1024px]:overflow-visible min-[1024px]:px-0"
                aria-label="Search suggestions"
              >
                {SEARCH_SUGGESTIONS.map((suggestion, index) => (
                  <li key={suggestion.chip} className="shrink-0">
                    <button
                      type="button"
                      data-suggestion-chip
                      onClick={() => onSearchChange({ ...search, query: suggestion.query })}
                      className={`min-h-9 whitespace-nowrap rounded-full bg-surface/70 px-3 text-sm text-ink transition duration-200 hover:text-plum ${
                        reducedMotion ? '' : 'animate-chip-in'
                      }`}
                      style={reducedMotion ? undefined : { animationDelay: `${index * 45}ms` }}
                    >
                      {suggestion.chip}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className="mb-2 hidden text-xs font-medium uppercase tracking-wide text-ink min-[1024px]:block">
            Filters
          </p>
          <div
            className="mt-2 flex flex-wrap gap-1.5 min-[1024px]:mt-0"
            role="group"
            aria-label="Search filters"
          >
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
                  className={`min-h-9 rounded-full px-3 text-sm font-medium transition duration-200 ${
                    active ? 'bg-plum text-cream' : 'bg-surface/70 text-ink hover:text-plum'
                  }`}
                >
                  {category.label}
                </button>
              );
            })}
          </div>

          {facetOptions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Years">
              {facetOptions.map((option) => {
                const selected = selectedFacets.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => toggleFacet(option)}
                    aria-pressed={selected}
                    className={`min-h-9 rounded-full px-3 text-sm transition duration-200 ${
                      selected ? 'bg-peach text-plum' : 'bg-surface/50 text-ink'
                    }`}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-8 min-[640px]:px-5 min-[1024px]:pt-2">
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
              <p className="mb-2 text-xs text-ink" role="status">
                {results.length} {results.length === 1 ? 'result' : 'results'}
              </p>
              <SearchResultGrid photos={results} onOpen={onOpen} onActions={onActions} />
            </>
          )}
        </div>
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
    <div className="flex flex-col gap-1">
      {visualRows.map((rowPhotos, rowIndex) => (
        <div
          key={rowPhotos.map((photo) => photo.id).join('-')}
          ref={bindRow(rowIndex)}
          className="grid gap-1"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
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
      className="relative overflow-hidden rounded-md bg-blush/30 transition duration-200 active:scale-[0.985]"
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
