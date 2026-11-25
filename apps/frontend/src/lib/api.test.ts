import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SIGN_IN_FAILED,
  UnauthorizedError,
  flattenPhotoPages,
  isUnauthorized,
  mapAlbum,
  mapFolderPreview,
  mapPhoto,
  fetchPhotosPage,
  fetchYearSummary,
  signIn,
  signOut,
  wallClockFromApi,
} from './api';
import type { Photo } from '../models/photo';

describe('api mapping', () => {
  it('maps catalog photos onto the UI model', () => {
    const photo = mapPhoto({
      _key: 'abc123',
      hash: 'deadbeef',
      taken_at: '2024-08-25T18:30:01.123456789Z',
      taken_at_local: '2024-08-25T18:30:01',
      dims: { w: 4000, h: 3000 },
    });
    expect(photo).toEqual({
      id: 'abc123',
      kind: 'photo',
      durationMs: 0,
      hash: 'deadbeef',
      imageUrl: '/api/original/abc123',
      thumbnailUrl: '/api/thumb/abc123?size=512&v=deadbeef',
      takenAt: '2024-08-25T18:30:01',
      width: 4000,
      height: 3000,
      favorite: false,
      alt: 'Photo',
    });
  });

  // A clip is the same row with a kind and a length. Anything the server does
  // not call a video is a still, including a row written before video existed
  // (ADR 0029).
  it('maps a clip, and treats an unknown kind as a photo', () => {
    const clip = mapPhoto({
      _key: 'v1',
      hash: 'beef',
      kind: 'video',
      duration_ms: 222_000,
      taken_at_local: '2026-06-18T19:09:27',
    });
    expect(clip.kind).toBe('video');
    expect(clip.durationMs).toBe(222_000);
    expect(clip.alt).toBe('Video');
    // The player is handed the original, not a rendition.
    expect(clip.imageUrl).toBe('/api/original/v1');

    expect(mapPhoto({ _key: 'x', kind: 'something-else' }).kind).toBe('photo');
    expect(mapPhoto({ _key: 'y' }).durationMs).toBe(0);
  });

  // A catalog row without a hash must still map, just without a cache version.
  it('maps a photo with no hash to an unversioned thumb URL', () => {
    const photo = mapPhoto({ _key: 'nohash', taken_at_local: '2024-08-25T18:30:01' });
    expect(photo.hash).toBe('');
    expect(photo.thumbnailUrl).toBe('/api/thumb/nohash?size=512');
  });

  it('maps favorite true from the API', () => {
    const photo = mapPhoto({
      _key: 'fav1',
      favorite: true,
      taken_at_local: '2024-08-25T18:30:01',
    });
    expect(photo.favorite).toBe(true);
  });

  it('maps favorite false when omitted or explicitly false', () => {
    expect(mapPhoto({ _key: 'a' }).favorite).toBe(false);
    expect(mapPhoto({ _key: 'b', favorite: false }).favorite).toBe(false);
  });

  it('maps album views onto the UI model', () => {
    const album = mapAlbum({
      id: 'album-1',
      name: 'Trip',
      created_at: '2024-01-15T10:00:00Z',
      photo_count: 2,
      cover_photo_id: 'p1',
      photo_ids: ['p1', 'p2'],
    });
    expect(album).toEqual({
      id: 'album-1',
      name: 'Trip',
      createdAt: '2024-01-15T10:00:00Z',
      photoCount: 2,
      coverPhotoId: 'p1',
      photoIds: ['p1', 'p2'],
    });
  });

  it('falls back to a timezone-naive wall clock from taken_at', () => {
    expect(wallClockFromApi('2024-08-25T18:30:01Z')).toBe('2024-08-25T18:30:01');
  });

  it('flattens cursor pages without duplicating ids', () => {
    const a = { id: 'a' } as Photo;
    const b = { id: 'b' } as Photo;
    const pages = flattenPhotoPages([{ photos: [a, b] }, { photos: [b, { id: 'c' } as Photo] }]);
    expect(pages.map((photo) => photo.id)).toEqual(['a', 'b', 'c']);
  });

  // Go leaves a zero count and an empty slice out of its JSON, so every
  // field here arrives absent on a folder with nothing in it.
  it('fills in a dry run that the server sent sparsely', () => {
    const preview = mapFolderPreview({
      location: '/data/photos',
      photos: 2,
      tree: { name: 'photos', total: 2, children: [{ name: '2019', path: '2019', photos: 2 }] },
    });
    expect(preview).toMatchObject({
      name: '',
      location: '/data/photos',
      photos: 2,
      skipped: 0,
      others: 0,
      folders: 0,
      truncated: false,
    });
    expect(preview.tree?.path).toBe('');
    expect(preview.tree?.children[0]).toEqual({
      name: '2019',
      path: '2019',
      photos: 2,
      total: 0,
      excluded: undefined,
      children: [],
      more: 0,
    });
    expect(mapFolderPreview({}).tree).toBeNull();
  });

  it('recognises only its own unauthorized error', () => {
    expect(isUnauthorized(new UnauthorizedError())).toBe(true);
    expect(isUnauthorized(new Error('unauthorized'))).toBe(false);
    expect(isUnauthorized(null)).toBe(false);
    expect(isUnauthorized('unauthorized')).toBe(false);
  });
});

describe('signIn', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(response: Partial<Response>) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: '',
      headers: new Headers(),
      text: async () => '',
      json: async () => ({}),
      ...response,
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('posts the credentials as JSON with the session cookie', async () => {
    const fetchMock = stubFetch({
      ok: true,
      status: 200,
      json: async () => ({ Email: 'admin@example.com', Name: 'Admin', admin: true }),
    });

    await expect(signIn('admin@example.com', 'password')).resolves.toEqual({
      email: 'admin@example.com',
      name: 'Admin',
      admin: true,
      // A server that sends no locale means "follow the browser" (ADR 0021).
      locale: '',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/auth/login');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body)).toEqual({ login: 'admin@example.com', password: 'password' });
  });

  it('reports a rejected sign-in without saying which field was wrong', async () => {
    stubFetch({ ok: false, status: 401 });
    await expect(signIn('admin@example.com', 'nope')).rejects.toThrow(SIGN_IN_FAILED);
    // The message must not hint at whether the account exists.
    expect(SIGN_IN_FAILED).not.toMatch(/unknown|no such|exist|account/i);
  });

  it('turns a throttled response into a wait time', async () => {
    stubFetch({ ok: false, status: 429, headers: new Headers({ 'Retry-After': '90' }) });
    await expect(signIn('admin@example.com', 'nope')).rejects.toThrow(/2 minute/);
  });

  it('falls back to a generic throttle message without Retry-After', async () => {
    stubFetch({ ok: false, status: 429 });
    await expect(signIn('admin@example.com', 'nope')).rejects.toThrow(/Too many attempts/);
  });

  it('treats an already-expired session as a successful sign-out', async () => {
    stubFetch({ ok: false, status: 401 });
    await expect(signOut()).resolves.toBeUndefined();
  });
});

describe('the year summary and the windowed feed', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubJSON(body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: '',
      headers: new Headers(),
      text: async () => '',
      json: async () => body,
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('asks for the sample size and maps each year', async () => {
    const fetchMock = stubJSON({
      years: [
        {
          year: '2026',
          count: 1240,
          photos: [
            {
              _key: 'p1',
              hash: 'h1',
              taken_at_local: '2026-08-26T10:00:00',
              dims: { w: 100, h: 80 },
            },
          ],
        },
        { year: '2025', count: 87, photos: [] },
      ],
    });

    const years = await fetchYearSummary(4);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/photos/summary?per_month=4');
    expect(years.map((year) => [year.year, year.count, year.photos.length])).toEqual([
      ['2026', 1240, 1],
      ['2025', 87, 0],
    ]);
    // Photos come back through the same mapping as the feed's, so a tile does
    // not care which query it came from.
    expect(years[0].photos[0].thumbnailUrl).toContain('/api/thumb/p1');
  });

  it('survives a body with no years', async () => {
    stubJSON({});
    await expect(fetchYearSummary()).resolves.toEqual([]);
  });

  it('scopes the feed with `to` when one is given', async () => {
    const fetchMock = stubJSON({ photos: [] });
    await fetchPhotosPage(undefined, { to: '2020' });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('to=2020');

    fetchMock.mockClear();
    await fetchPhotosPage(undefined, {});
    expect(fetchMock.mock.calls[0][0] as string).not.toContain('to=');
  });
});
