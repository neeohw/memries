export type Granularity = 'year' | 'month' | 'week' | 'day';

export type NavTab = 'memories' | 'albums' | 'favorites' | 'search' | 'folders';

export interface Album {
  id: string;
  name: string;
  createdAt: string;
  photoCount: number;
  coverPhotoId?: string;
  photoIds: string[];
}

export interface Photo {
  id: string;
  /**
   * Content fingerprint, not identity. `id` survives a resync; `hash` changes
   * when the bytes do, which is what versions the thumb URL so an immutable
   * cache entry is replaced rather than reused.
   */
  hash: string;
  imageUrl: string;
  thumbnailUrl: string;
  takenAt: string;
  location?: string;
  caption?: string;
  width: number;
  height: number;
  favorite: boolean;
  people?: string[];
  alt: string;
}

export interface TimelineGroup {
  key: string;
  label: string;
  sublabel: string;
  photos: Photo[];
}

export type SearchCategory = 'years' | 'favorites';

export interface SearchState {
  query: string;
  years: string[];
  favoritesOnly: boolean;
  openCategory: SearchCategory | null;
}
