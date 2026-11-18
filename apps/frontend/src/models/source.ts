export type SourceType = 'local' | 'smb' | 'webdav';

/** An admin-managed folder whose photos are indexed into one Owner's library. */
export interface Source {
  id: string;
  name: string;
  type: SourceType;
  location: string;
  username?: string;
  hasPassword: boolean;
  ownerEmail: string;
  updatedAt: string;
}

export interface SourceInput {
  name: string;
  type: SourceType;
  location: string;
  username?: string;
  /** Omitted on edit to keep the stored password. */
  password?: string;
  ownerEmail?: string;
}

export interface Me {
  email: string;
  name: string;
  admin: boolean;
}
