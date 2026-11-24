export type SourceType = 'local' | 'webdav';

/** An admin-managed folder whose photos are indexed into one Owner's library. */
export interface Source {
  id: string;
  name: string;
  type: SourceType;
  location: string;
  username?: string;
  hasPassword: boolean;
  /** Regexes matched against each folder's path below the source root. */
  excludes: string[];
  updatedAt: string;
}

export interface SourceInput {
  name: string;
  type: SourceType;
  location: string;
  username?: string;
  /** Omitted on edit to keep the stored password. */
  password?: string;
  excludes?: string[];
}

/** One folder in a dry run's tree (ADR 0027). */
export interface FolderPreviewNode {
  name: string;
  /** Path below the folder's root; empty for the root itself. */
  path: string;
  /** Photos directly inside; total counts the whole subtree. */
  photos: number;
  total: number;
  /** The exclude pattern that keeps this folder out, if any. */
  excluded?: string;
  children: FolderPreviewNode[];
  /** Children left out to keep the answer bounded. */
  more: number;
}

/** What a scan of an unsaved folder form would find, having written nothing. */
export interface FolderPreview {
  name: string;
  location: string;
  photos: number;
  skipped: number;
  others: number;
  folders: number;
  /** A limit was reached, so every count is a floor. */
  truncated: boolean;
  tree: FolderPreviewNode | null;
}

export interface Me {
  email: string;
  name: string;
  admin: boolean;
  /** 'en', 'nl', or empty to follow the browser (ADR 0021). */
  locale: string;
}
