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
