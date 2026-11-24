import { describe, expect, it } from 'vitest';
import { joinLocation, splitLocation, trimRoot } from './sourcePath';

describe('splitLocation', () => {
  it('splits a path into the root it sits under and the part below it', () => {
    expect(splitLocation('/data/photos/backup iPhone XS', ['/data/photos'])).toEqual({
      root: '/data/photos',
      rel: 'backup iPhone XS',
    });
  });

  it('reads the root itself as an empty remainder', () => {
    expect(splitLocation('/data/photos', ['/data/photos'])).toEqual({
      root: '/data/photos',
      rel: '',
    });
    expect(splitLocation('/data/photos/', ['/data/photos/'])).toEqual({
      root: '/data/photos',
      rel: '',
    });
  });

  // Nested roots: the folder is "in" the one that leaves the least behind.
  it('prefers the longest matching root', () => {
    expect(splitLocation('/media/sdhc/2019', ['/media', '/media/sdhc'])).toEqual({
      root: '/media/sdhc',
      rel: '2019',
    });
  });

  // A Source saved before the roots changed still has to be editable, so this
  // is a state the form renders rather than an error.
  it('reports no root for a path outside all of them', () => {
    expect(splitLocation('/etc/passwd', ['/data/photos'])).toEqual({
      root: null,
      rel: '/etc/passwd',
    });
    expect(splitLocation('/data/photosbackup', ['/data/photos'])).toEqual({
      root: null,
      rel: '/data/photosbackup',
    });
    expect(splitLocation('/anything', [])).toEqual({ root: null, rel: '/anything' });
  });
});

describe('joinLocation', () => {
  it('puts the root and the remainder back together', () => {
    expect(joinLocation('/data/photos', 'holidays/2019')).toBe('/data/photos/holidays/2019');
    expect(joinLocation('/data/photos/', '/holidays/')).toBe('/data/photos/holidays');
  });

  it('reads an empty remainder as the whole folder', () => {
    expect(joinLocation('/data/photos', '')).toBe('/data/photos');
    expect(joinLocation('/data/photos', '   ')).toBe('/data/photos');
  });

  // Pasting the full path into a field that already shows the prefix is the
  // obvious mistake to make, so it is absorbed rather than doubled.
  it('absorbs a pasted path that repeats the root', () => {
    expect(joinLocation('/data/photos', '/data/photos/2019')).toBe('/data/photos/2019');
    expect(joinLocation('/data/photos', '/data/photos')).toBe('/data/photos');
  });

  it('handles a root of /', () => {
    expect(trimRoot('/')).toBe('/');
    expect(joinLocation('/', 'srv/photos')).toBe('/srv/photos');
    expect(joinLocation('/', '')).toBe('/');
    expect(splitLocation('/srv/photos', ['/'])).toEqual({ root: '/', rel: 'srv/photos' });
  });
});
