import { thumbUrl } from './photoSrc';
import { wallClockFromExifValue } from './takenAt';
import type { Album, Photo } from '../models/photo';
import type { Me, Source, SourceInput, SourceType } from '../models/source';
import type { IndexStatus } from './indexStatus';

export type ApiPhoto = {
  _key: string;
  hash?: string;
  taken_at?: string;
  taken_at_local?: string;
  dims?: { w?: number; h?: number };
  favorite?: boolean;
};

export type ApiAlbumView = {
  id: string;
  name: string;
  created_at: string;
  photo_count: number;
  cover_photo_id?: string;
  photo_ids: string[];
};

export type PhotosPage = {
  photos: Photo[];
  nextCursor: string | null;
};

export type PhotoFilter = {
  years?: string[];
  months?: string[];
  favorite?: boolean;
  q?: string;
  localFrom?: string;
  localTo?: string;
};

export type ApiSource = {
  id: string;
  name: string;
  type: SourceType;
  location: string;
  username?: string;
  has_password?: boolean;
  owner_email: string;
  updated_at: string;
};

export function mapSource(raw: ApiSource): Source {
  return {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    location: raw.location,
    username: raw.username || undefined,
    hasPassword: raw.has_password === true,
    ownerEmail: raw.owner_email,
    updatedAt: raw.updated_at,
  };
}

export function sourceBody(input: SourceInput): Record<string, string> {
  const body: Record<string, string> = {
    name: input.name.trim(),
    type: input.type,
    location: input.location.trim(),
  };
  if (input.type !== 'local') {
    body.username = (input.username ?? '').trim();
    if (input.password) body.password = input.password;
  }
  if (input.ownerEmail?.trim()) body.owner_email = input.ownerEmail.trim();
  return body;
}

/**
 * Thrown when the server refuses a request for lack of a session.
 *
 * Sign-in is a screen in this app rather than a redirect to an identity
 * provider (ADR 0016), so an unauthorized response is a value the UI reacts to
 * instead of a navigation.
 */
export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized');
    this.name = 'UnauthorizedError';
  }
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof UnauthorizedError;
}

export function wallClockFromApi(value: string | undefined): string {
  if (!value) return '';
  const fromExif = wallClockFromExifValue(value);
  if (fromExif) return fromExif;
  return value.length >= 19 ? value.slice(0, 19) : value;
}

export function mapPhoto(raw: ApiPhoto): Photo {
  const id = raw._key;
  const hash = raw.hash ?? '';
  return {
    id,
    hash,
    imageUrl: `/api/original/${encodeURIComponent(id)}`,
    thumbnailUrl: thumbUrl(id, 512, hash),
    takenAt: raw.taken_at_local || wallClockFromApi(raw.taken_at),
    width: raw.dims?.w || 1,
    height: raw.dims?.h || 1,
    favorite: raw.favorite === true,
    alt: 'Photo',
  };
}

export function mapAlbum(raw: ApiAlbumView): Album {
  return {
    id: raw.id,
    name: raw.name,
    createdAt: raw.created_at,
    photoCount: raw.photo_count,
    coverPhotoId: raw.cover_photo_id,
    photoIds: raw.photo_ids ?? [],
  };
}

export function flattenPhotoPages(pages: Array<{ photos: Photo[] }>): Photo[] {
  const seen = new Set<string>();
  const out: Photo[] = [];
  for (const page of pages) {
    for (const photo of page.photos) {
      if (seen.has(photo.id)) continue;
      seen.add(photo.id);
      out.push(photo);
    }
  }
  return out;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
  });
  if (res.status === 401) {
    throw new UnauthorizedError();
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res;
}

export async function fetchIndexStatus(): Promise<IndexStatus> {
  const res = await apiFetch('/api/index/status');
  return (await res.json()) as IndexStatus;
}

export async function startIndex(): Promise<IndexStatus> {
  const res = await apiFetch('/api/index', { method: 'POST' });
  return (await res.json()) as IndexStatus;
}

export async function fetchPhotosPage(cursor?: string, filter?: PhotoFilter): Promise<PhotosPage> {
  const params = new URLSearchParams({ limit: '50' });
  if (cursor) params.set('cursor', cursor);
  if (filter?.favorite === true) params.set('favorite', 'true');
  if (filter?.favorite === false) params.set('favorite', 'false');
  if (filter?.q) params.set('q', filter.q);
  if (filter?.localFrom) params.set('local_from', filter.localFrom);
  if (filter?.localTo) params.set('local_to', filter.localTo);
  for (const year of filter?.years ?? []) {
    params.append('year', year);
  }
  for (const month of filter?.months ?? []) {
    params.append('month', month);
  }
  const res = await apiFetch(`/api/photos?${params}`);
  const body = (await res.json()) as { photos?: ApiPhoto[]; next_cursor?: string };
  return {
    photos: (body.photos ?? []).map(mapPhoto),
    nextCursor: body.next_cursor || null,
  };
}

export async function setPhotoFavorite(id: string, favorite: boolean): Promise<void> {
  await apiFetch(`/api/photos/${encodeURIComponent(id)}/favorite`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ favorite }),
  });
}

export async function fetchAlbums(): Promise<Album[]> {
  const res = await apiFetch('/api/albums');
  const body = (await res.json()) as { albums?: ApiAlbumView[] };
  return (body.albums ?? []).map(mapAlbum);
}

export async function createAlbum(name: string): Promise<Album> {
  const res = await apiFetch('/api/albums', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim() }),
  });
  return mapAlbum((await res.json()) as ApiAlbumView);
}

export async function addPhotoToAlbum(albumId: string, photoId: string): Promise<Album> {
  const res = await apiFetch(`/api/albums/${encodeURIComponent(albumId)}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo_id: photoId }),
  });
  return mapAlbum((await res.json()) as ApiAlbumView);
}

export async function fetchAlbum(id: string): Promise<{ album: Album; photos: Photo[] }> {
  const res = await apiFetch(`/api/albums/${encodeURIComponent(id)}`);
  const body = (await res.json()) as ApiAlbumView & { photos?: ApiPhoto[] };
  return {
    album: mapAlbum(body),
    photos: (body.photos ?? []).map(mapPhoto),
  };
}

export async function removePhotoFromAlbum(albumId: string, photoId: string): Promise<Album> {
  const res = await apiFetch(
    `/api/albums/${encodeURIComponent(albumId)}/photos/${encodeURIComponent(photoId)}`,
    { method: 'DELETE' },
  );
  return mapAlbum((await res.json()) as ApiAlbumView);
}

function mapMe(body: { Email?: string; Name?: string; admin?: boolean }): Me {
  return { email: body.Email ?? '', name: body.Name ?? '', admin: body.admin === true };
}

export async function fetchMe(): Promise<Me> {
  const res = await apiFetch('/api/me');
  return mapMe(await res.json());
}

/** Error text shown for any rejected sign-in, matching the server's refusal to
 * say whether it was the address or the password that was wrong. */
export const SIGN_IN_FAILED = 'That login and password did not match.';

/**
 * Signs in and returns the session's user.
 *
 * `/auth/login` sits outside `/api`, which the session middleware guards, so
 * this call deliberately does not go through `apiFetch`: a 401 here is a wrong
 * password to report in the form, not a lost session to recover from.
 */
export async function signIn(login: string, password: string): Promise<Me> {
  const res = await fetch('/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });
  if (res.status === 401) {
    throw new Error(SIGN_IN_FAILED);
  }
  if (res.status === 429) {
    const seconds = Number(res.headers.get('Retry-After'));
    throw new Error(
      Number.isFinite(seconds) && seconds > 0
        ? `Too many attempts. Try again in ${Math.ceil(seconds / 60)} minute(s).`
        : 'Too many attempts. Try again later.',
    );
  }
  if (!res.ok) {
    throw new Error((await res.text()) || res.statusText);
  }
  return mapMe(await res.json());
}

export async function signOut(): Promise<void> {
  const res = await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
  if (!res.ok && res.status !== 401) {
    throw new Error((await res.text()) || res.statusText);
  }
}

export async function fetchSources(): Promise<Source[]> {
  const res = await apiFetch('/api/admin/sources');
  const body = (await res.json()) as { sources?: ApiSource[] };
  return (body.sources ?? []).map(mapSource);
}

export async function createSource(input: SourceInput): Promise<Source> {
  const res = await apiFetch('/api/admin/sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sourceBody(input)),
  });
  return mapSource((await res.json()) as ApiSource);
}

export async function updateSource(id: string, input: SourceInput): Promise<Source> {
  const res = await apiFetch(`/api/admin/sources/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sourceBody(input)),
  });
  return mapSource((await res.json()) as ApiSource);
}

export async function deleteSource(id: string): Promise<void> {
  await apiFetch(`/api/admin/sources/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function scanSource(id: string): Promise<void> {
  await apiFetch(`/api/admin/sources/${encodeURIComponent(id)}/scan`, { method: 'POST' });
}
