import { describe, expect, it } from 'vitest';
import { mapSource, sourceBody } from './api';

describe('source api mapping', () => {
  it('maps admin sources without exposing secrets', () => {
    const source = mapSource({
      id: '42',
      name: 'NAS',
      type: 'webdav',
      location: 'https://dav/photos',
      username: 'me',
      has_password: true,
      updated_at: '2026-09-22T10:00:00Z',
    });
    expect(source).toEqual({
      id: '42',
      name: 'NAS',
      type: 'webdav',
      location: 'https://dav/photos',
      username: 'me',
      hasPassword: true,
      excludes: [],
      updatedAt: '2026-09-22T10:00:00Z',
    });
  });

  it('defaults a source with no excludes to an empty list, never undefined', () => {
    // The editor renders straight from this, and an undefined would make
    // every source with no patterns a crash rather than an empty list.
    const source = mapSource({
      id: '1',
      name: 'x',
      type: 'local',
      location: '/data/photos',
      updated_at: '2026-09-22T10:00:00Z',
    });
    expect(source.excludes).toEqual([]);
  });

  it('carries excludes through in order', () => {
    const source = mapSource({
      id: '1',
      name: 'x',
      type: 'local',
      location: '/data/photos',
      excludes: ['^2019/', '(^|/)\\.thumbs$'],
      updated_at: '2026-09-22T10:00:00Z',
    });
    expect(source.excludes).toEqual(['^2019/', '(^|/)\\.thumbs$']);
  });

  it('omits a blank password so edits keep the stored one', () => {
    expect(
      sourceBody({ name: ' NAS ', type: 'webdav', location: ' https://dav/x ', username: 'me' }),
    ).toEqual({
      name: 'NAS',
      type: 'webdav',
      location: 'https://dav/x',
      username: 'me',
      excludes: [],
    });
    expect(
      sourceBody({
        name: '',
        type: 'webdav',
        location: 'https://dav/p',
        password: 'pw',
      }),
    ).toMatchObject({ password: 'pw' });
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
    ).toEqual({ name: '', type: 'local', location: '/data/photos', excludes: [] });
  });

  it('always sends excludes, so removing the last pattern takes effect', () => {
    // Leaving the field out on an edit would be indistinguishable from "no
    // change", and the last pattern could never be deleted.
    expect(
      sourceBody({ name: '', type: 'local', location: '/data/photos', excludes: [] }),
    ).toMatchObject({ excludes: [] });
    expect(
      sourceBody({
        name: '',
        type: 'local',
        location: '/data/photos',
        excludes: ['  ^2019/  ', '', '   ', '/RAW/'],
      }),
    ).toMatchObject({ excludes: ['^2019/', '/RAW/'] });
  });
});
