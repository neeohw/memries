import type { Album, Photo } from '../models/photo';

export function testPhoto(overrides: Partial<Photo> = {}): Photo {
  return {
    id: 'p1',
    hash: 'p1hash',
    imageUrl: '/api/original/p1',
    thumbnailUrl: '/api/thumb/p1?size=512&v=p1hash',
    takenAt: '2026-08-26T10:00:00',
    width: 1000,
    height: 800,
    favorite: false,
    alt: 'Photo',
    ...overrides,
  };
}

export function testAlbum(overrides: Partial<Album> = {}): Album {
  return {
    id: 'a1',
    name: 'Summer',
    createdAt: '2026-08-01T00:00:00',
    photoCount: 2,
    photoIds: ['p1', 'p2'],
    ...overrides,
  };
}
