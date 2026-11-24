import { thumbUrl } from './photoSrc';
import type { HistogramBucket } from './scrubberScale';
import { wallClockFromExifValue } from './takenAt';
import type { Album, Photo } from '../models/photo';
import type {
  FolderPreview,
  FolderPreviewNode,
  Me,
  Source,
  SourceInput,
  SourceType,
} from '../models/source';
import type { IndexStatus } from './indexStatus';

export type ApiPhoto = {
  _key: string;
  hash?: string;
  taken_at?: string;
  taken_at_local?: string;
  dims?: { w?: number; h?: number };
  favorite?: boolean;
};

export type ApiTimelineBucket = {
  bucket: string;
  count?: number;
};

/**
 * Month histogram for the date scrubber (ADR 0017).
 *
 * Always month granularity, whatever the timeline's own granularity selector
 * says: the scrubber's vocabulary is months and years, and `day` would return
 * thousands of rows for a library this size. One row per month is a few
 * hundred rows at most, so this is a single cheap request.
 *
 * This is the first consumer of `/api/timeline`, which ADR 0002 left unused
 * when timeline grouping moved into the SPA.
 */
export async function fetchTimelineHistogram(): Promise<HistogramBucket[]> {
  const res = await apiFetch('/api/timeline?granularity=month');
  const body = (await res.json()) as { buckets?: ApiTimelineBucket[] | null };
  return (body.buckets ?? []).map((bucket) => ({
    key: bucket.bucket,
    count: bucket.count ?? 0,
  }));
}

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
  favorite?: boolean;
};

export type ApiSource = {
  id: string;
  name: string;
  type: SourceType;
  location: string;
  username?: string;
  has_password?: boolean;
  excludes?: string[];
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
    excludes: raw.excludes ?? [],
    updatedAt: raw.updated_at,
  };
}

type ApiPreviewNode = {
  name?: string;
  path?: string;
  photos?: number;
  total?: number;
  excluded?: string;
  children?: ApiPreviewNode[] | null;
  more?: number;
};

export type ApiFolderPreview = {
  name?: string;
  location?: string;
  photos?: number;
  skipped?: number;
  others?: number;
  folders?: number;
  truncated?: boolean;
  tree?: ApiPreviewNode | null;
};

function mapPreviewNode(raw: ApiPreviewNode): FolderPreviewNode {
  return {
    name: raw.name ?? '',
    path: raw.path ?? '',
    photos: raw.photos ?? 0,
    total: raw.total ?? 0,
    excluded: raw.excluded || undefined,
    children: (raw.children ?? []).map(mapPreviewNode),
    more: raw.more ?? 0,
  };
}

export function mapFolderPreview(raw: ApiFolderPreview): FolderPreview {
  return {
    name: raw.name ?? '',
    location: raw.location ?? '',
    photos: raw.photos ?? 0,
    skipped: raw.skipped ?? 0,
    others: raw.others ?? 0,
    folders: raw.folders ?? 0,
    truncated: raw.truncated === true,
    tree: raw.tree ? mapPreviewNode(raw.tree) : null,
  };
}

export function sourceBody(input: SourceInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: input.name.trim(),
    type: input.type,
    location: input.location.trim(),
  };
  if (input.type !== 'local') {
    body.username = (input.username ?? '').trim();
    if (input.password) body.password = input.password;
  }
  // Always sent, including empty: leaving it out on an edit would be
  // indistinguishable from "no change" and make removing the last pattern
  // impossible.
  body.excludes = (input.excludes ?? []).map((p) => p.trim()).filter(Boolean);
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

/**
 * Photos per page.
 *
 * 500 is the server's cap (`db.ClampPhotoLimit`). The scrubber can ask to jump
 * to a month that is not loaded yet, and the only way there under keyset
 * pagination is to page forward, so the page size sets how many round trips a
 * far jump costs: at 50 the oldest photo in a 12k library was ~240 requests,
 * at 500 it is ~24 (ADR 0017). Photo rows are metadata only — thumbs load
 * lazily per tile — so a page is roughly 100KB of JSON.
 */
export const PHOTO_PAGE_SIZE = 500;

export async function fetchPhotosPage(cursor?: string, filter?: PhotoFilter): Promise<PhotosPage> {
  const params = new URLSearchParams({ limit: String(PHOTO_PAGE_SIZE) });
  if (cursor) params.set('cursor', cursor);
  if (filter?.favorite === true) params.set('favorite', 'true');
  if (filter?.favorite === false) params.set('favorite', 'false');
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

/**
 * Favorites or unfavorites a whole selection (ADR 0018).
 *
 * The server scopes the update to the owner and refuses the batch outright if
 * any id is not theirs, so there is no partial success to reconcile here.
 */
export async function setPhotosFavorite(ids: string[], favorite: boolean): Promise<number> {
  const res = await apiFetch('/api/photos/favorite', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, favorite }),
  });
  const body = (await res.json()) as { updated?: number };
  return body.updated ?? 0;
}

/** Adds a selection to one album. Same route as the single-photo add. */
export async function addPhotosToAlbum(albumId: string, photoIds: string[]): Promise<Album> {
  const res = await apiFetch(`/api/albums/${encodeURIComponent(albumId)}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo_ids: photoIds }),
  });
  return mapAlbum((await res.json()) as ApiAlbumView);
}

/**
 * Creates an album, optionally filled with a selection.
 *
 * One request rather than a create followed by an add: the server does both
 * in a transaction, so a bad id leaves no half-made album behind (ADR 0018).
 */
export async function createAlbum(name: string, photoIds?: string[]): Promise<Album> {
  const res = await apiFetch('/api/albums', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim(), photo_ids: photoIds ?? [] }),
  });
  return mapAlbum((await res.json()) as ApiAlbumView);
}

/**
 * Deletes albums, leaving their photos in the library.
 *
 * Ids travel as repeated query parameters: a DELETE body is legal but proxies
 * are allowed to drop it, and albums are few enough that a URL holds them.
 */
export async function deleteAlbums(ids: string[]): Promise<void> {
  const query = ids.map((id) => `id=${encodeURIComponent(id)}`).join('&');
  await apiFetch(`/api/albums?${query}`, { method: 'DELETE' });
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

function mapMe(body: { Email?: string; Name?: string; admin?: boolean; locale?: string }): Me {
  return {
    email: body.Email ?? '',
    name: body.Name ?? '',
    admin: body.admin === true,
    locale: body.locale ?? '',
  };
}

/**
 * Records the reader's interface language on their account (ADR 0021).
 *
 * An empty locale is legal and means "follow the browser", which is how a
 * reader undoes a choice.
 */
export async function setLocale(locale: string): Promise<void> {
  await apiFetch('/api/me/locale', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locale }),
  });
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

/**
 * Dry run: what a scan of this unsaved form would find (ADR 0027).
 *
 * id is the folder being edited, so a blank password field can fall back to
 * the stored one, or null for a folder being added. A POST because it carries
 * the form, not because it changes anything.
 */
export async function previewSource(id: string | null, input: SourceInput): Promise<FolderPreview> {
  const path = id
    ? `/api/admin/sources/${encodeURIComponent(id)}/preview`
    : '/api/admin/sources/preview';
  const res = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sourceBody(input)),
  });
  return mapFolderPreview((await res.json()) as ApiFolderPreview);
}

/** Server-wide settings an admin can change (ADR 0022). */
export type ServerSettings = {
  thumbnailRoot: string;
  defaultThumbnailRoot: string;
  allowedRoots: string[];
  /** 0 means the server could not read it, and the UI leaves it out. */
  freeBytes: number;
};

type ApiSettings = {
  thumbnail_root?: string;
  default_thumbnail_root?: string;
  allowed_roots?: string[] | null;
  free_bytes?: number;
  needs_reindex?: boolean;
};

function mapSettings(raw: ApiSettings): ServerSettings {
  return {
    thumbnailRoot: raw.thumbnail_root ?? '',
    defaultThumbnailRoot: raw.default_thumbnail_root ?? '',
    allowedRoots: raw.allowed_roots ?? [],
    freeBytes: raw.free_bytes ?? 0,
  };
}

export async function fetchSettings(): Promise<ServerSettings> {
  const res = await apiFetch('/api/admin/settings');
  return mapSettings((await res.json()) as ApiSettings);
}

/**
 * An empty path restores the install default.
 *
 * needsReindex is true when the location actually changed: thumbs already
 * written stay in the old folder, so the page has to say that a scan is what
 * fills the new one.
 */
export async function setThumbnailRoot(
  path: string,
): Promise<ServerSettings & { needsReindex: boolean }> {
  const res = await apiFetch('/api/admin/settings/thumbnails', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  const body = (await res.json()) as ApiSettings;
  return { ...mapSettings(body), needsReindex: body.needs_reindex === true };
}
