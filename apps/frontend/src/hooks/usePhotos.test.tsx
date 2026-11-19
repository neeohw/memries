import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../lib/api';
import { testPhoto } from '../test/fixtures';
import { photosQueryKey, useBatchFavorite, useToggleFavorite } from './usePhotos';

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function seed(client: QueryClient) {
  // The timeline holds both photos; the Favorites list holds neither, because
  // neither was a favorite when it was fetched.
  client.setQueryData(photosQueryKey(), {
    pages: [{ photos: [testPhoto({ id: 'a' }), testPhoto({ id: 'b' })], nextCursor: null }],
    pageParams: [undefined],
  });
  client.setQueryData(photosQueryKey({ favorite: true }), {
    pages: [{ photos: [], nextCursor: null }],
    pageParams: [undefined],
  });
}

describe('favorite mutations', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seed(client);
  });

  it('flips the flag in the cache straight away', async () => {
    const put = vi.spyOn(api, 'setPhotoFavorite').mockResolvedValue(undefined as never);
    const { result } = renderHook(() => useToggleFavorite(), { wrapper: wrapper(client) });

    act(() => result.current.mutate({ id: 'a', favorite: true }));
    await waitFor(() => expect(put).toHaveBeenCalled());

    const timeline = client.getQueryData(photosQueryKey()) as {
      pages: { photos: { id: string; favorite: boolean }[] }[];
    };
    expect(timeline.pages[0].photos.find((p) => p.id === 'a')?.favorite).toBe(true);
    put.mockRestore();
  });

  it('marks the favorites list stale, so a newly favorited photo appears there', async () => {
    // Patching cached rows cannot add a photo to a list it was never in, so
    // without an invalidation the Favorites tab keeps showing the stale page
    // it fetched before the heart was pressed.
    const put = vi.spyOn(api, 'setPhotoFavorite').mockResolvedValue(undefined as never);
    const { result } = renderHook(() => useToggleFavorite(), { wrapper: wrapper(client) });

    act(() => result.current.mutate({ id: 'a', favorite: true }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const state = client.getQueryState(photosQueryKey({ favorite: true }));
    expect(state?.isInvalidated).toBe(true);
    put.mockRestore();
  });

  it('leaves the unfiltered timeline query alone', async () => {
    // It was patched correctly in place; refetching every loaded page of a
    // 500-per-page infinite query would be an expensive way to learn nothing.
    const put = vi.spyOn(api, 'setPhotoFavorite').mockResolvedValue(undefined as never);
    const { result } = renderHook(() => useToggleFavorite(), { wrapper: wrapper(client) });

    act(() => result.current.mutate({ id: 'a', favorite: true }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(client.getQueryState(photosQueryKey())?.isInvalidated).toBe(false);
    put.mockRestore();
  });

  it('does the same for a batch', async () => {
    const put = vi.spyOn(api, 'setPhotosFavorite').mockResolvedValue(undefined as never);
    const { result } = renderHook(() => useBatchFavorite(), { wrapper: wrapper(client) });

    act(() => result.current.mutate({ ids: ['a', 'b'], favorite: true }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(client.getQueryState(photosQueryKey({ favorite: true }))?.isInvalidated).toBe(true);
    expect(client.getQueryState(photosQueryKey())?.isInvalidated).toBe(false);
    put.mockRestore();
  });
});
