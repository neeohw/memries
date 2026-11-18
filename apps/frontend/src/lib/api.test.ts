import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SIGN_IN_FAILED,
  UnauthorizedError,
  flattenPhotoPages,
  isUnauthorized,
  mapAlbum,
  mapPhoto,
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
