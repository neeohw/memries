import { describe, expect, it } from 'vitest';
import { mapSource, sourceBody } from './api';

describe('source api mapping', () => {
  it('maps admin sources without exposing secrets', () => {
    const source = mapSource({
      id: '42',
      name: 'NAS',
      type: 'smb',
      location: 'smb://nas/photos',
      username: 'me',
      has_password: true,
      owner_email: 'bob@example.com',
      updated_at: '2026-09-22T10:00:00Z',
    });
    expect(source).toEqual({
      id: '42',
      name: 'NAS',
      type: 'smb',
      location: 'smb://nas/photos',
      username: 'me',
      hasPassword: true,
      ownerEmail: 'bob@example.com',
      updatedAt: '2026-09-22T10:00:00Z',
    });
  });

  it('omits a blank password so edits keep the stored one', () => {
    expect(
      sourceBody({ name: ' NAS ', type: 'webdav', location: ' https://dav/x ', username: 'me' }),
    ).toEqual({ name: 'NAS', type: 'webdav', location: 'https://dav/x', username: 'me' });
    expect(
      sourceBody({
        name: '',
        type: 'smb',
        location: 'smb://nas/p',
        password: 'pw',
        ownerEmail: 'a@b',
      }),
    ).toMatchObject({ password: 'pw', owner_email: 'a@b' });
  });

  it('never sends credentials for server folders', () => {
    expect(
      sourceBody({
        name: '',
        type: 'local',
        location: '/data/photos',
        username: 'x',
        password: 'y',
      }),
    ).toEqual({ name: '', type: 'local', location: '/data/photos' });
  });
});
