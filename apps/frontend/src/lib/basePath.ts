/**
 * Where this app is mounted.
 *
 * It may be served from the root of a host, or from a sublocation of a web
 * server that is already busy with something else — `/memries/` on the box's
 * existing site (ADR 0030). Every URL the app builds has to carry that
 * prefix, and the app has to work it out for itself: a path baked in at build
 * time would mean a package per mount point.
 *
 * The signal is the document's own URL. There is no client-side router here —
 * tabs are React state, not history entries — so the document is always the
 * mount point itself, which makes this exact rather than a guess.
 */

/**
 * basePathFrom reduces a document URL to the directory it was served from,
 * with a slash at each end.
 *
 * `/memries/` stays. `/memries` becomes `/`, which is the honest answer:
 * without the trailing slash the browser would resolve relative URLs against
 * the parent anyway, so the web server redirects to add it rather than
 * letting this guess.
 */
export function basePathFrom(documentURI: string): string {
  let pathname: string;
  try {
    pathname = new URL(documentURI, 'http://localhost/').pathname;
  } catch {
    return '/';
  }
  const dir = pathname.slice(0, pathname.lastIndexOf('/') + 1);
  if (dir === '' || dir === '/') return '/';
  return dir.startsWith('/') ? dir : `/${dir}`;
}

/**
 * Read once. The document cannot move under us without a page load, and
 * reading it per request would put a URL parse in front of every thumbnail.
 */
let cached: string | undefined;

export function basePath(): string {
  if (cached === undefined) {
    cached =
      typeof document === 'undefined' ? '/' : basePathFrom(document.baseURI || location.pathname);
  }
  return cached;
}

/** Only for tests, which need to mount the app somewhere else and back. */
export function resetBasePath(): void {
  cached = undefined;
}

/**
 * withBase turns an app-absolute path into one the browser can fetch.
 *
 * Takes `/api/photos`, gives `/memries/api/photos` when mounted there, and
 * `/api/photos` when mounted at the root.
 */
export function withBase(path: string): string {
  const base = basePath();
  if (base === '/') return path;
  return path.startsWith('/') ? base.slice(0, -1) + path : `${base}${path}`;
}
