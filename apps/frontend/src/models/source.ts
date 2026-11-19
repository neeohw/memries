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

export interface Me {
  email: string;
  name: string;
  admin: boolean;
}
