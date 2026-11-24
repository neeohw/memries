/**
 * @vitest-environment jsdom
 *
 * Where the app is mounted is read from the document, so this one needs one.
 * The config runs .ts tests in node and .tsx in jsdom (vitest.config.ts).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { basePath, basePathFrom, resetBasePath, withBase } from './basePath';

describe('basePathFrom', () => {
  it('is the root when the app is served from one', () => {
    expect(basePathFrom('http://box/')).toBe('/');
    expect(basePathFrom('http://box/index.html')).toBe('/');
  });

  // The case this exists for: an existing site with Memries under a path.
  it('is the sublocation when the app is served from one', () => {
    expect(basePathFrom('http://box/memries/')).toBe('/memries/');
    expect(basePathFrom('http://box/memries/index.html')).toBe('/memries/');
    expect(basePathFrom('http://box/apps/photos/')).toBe('/apps/photos/');
  });

  // Without the trailing slash the browser resolves relative URLs against the
  // parent, so this reports what the browser will actually do rather than
  // guessing; the web server redirects to add the slash.
  it('does not invent a trailing slash', () => {
    expect(basePathFrom('http://box/memries')).toBe('/');
  });

  it('survives something that is not a URL', () => {
    expect(basePathFrom('')).toBe('/');
    expect(basePathFrom('::nonsense::')).toBe('/');
  });

  it('ignores the query and the fragment', () => {
    expect(basePathFrom('http://box/memries/?size=512#x')).toBe('/memries/');
  });
});

describe('withBase', () => {
  afterEach(() => resetBasePath());

  it('leaves paths alone at the root', () => {
    expect(withBase('/api/photos')).toBe('/api/photos');
  });

  it('prefixes every path under a sublocation', () => {
    document.head.innerHTML = '<base href="http://localhost/memries/">';
    resetBasePath();
    expect(basePath()).toBe('/memries/');
    expect(withBase('/api/photos')).toBe('/memries/api/photos');
    expect(withBase('/auth/login')).toBe('/memries/auth/login');
    // No doubled slash where the two halves meet.
    expect(withBase('/api/photos')).not.toContain('//');
    document.head.innerHTML = '';
  });
});
