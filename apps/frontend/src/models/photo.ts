export type Granularity = 'year' | 'month' | 'week';

export type NavTab = 'memories' | 'albums' | 'favorites' | 'folders' | 'account';

export interface Album {
  id: string;
  name: string;
  createdAt: string;
  photoCount: number;
  coverPhotoId?: string;
  photoIds: string[];
}

/** A still or a clip. The timeline shows both; only the viewer differs. */
export type MediaKind = 'photo' | 'video';

export interface Photo {
  id: string;
  kind: MediaKind;
  /** Playing time in milliseconds; 0 for a still (ADR 0029). */
  durationMs: number;
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
  /**
   * How many photos the period holds, which is `photos.length` everywhere
   * except year view: there the feed is a sample of the year, and the
   * difference is what the "more" affordance reports (ADR 0031).
   */
  total: number;
}
