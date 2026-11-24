/**
 * A local Source's folder is an absolute server path, but only paths inside
 * MEMRIES_SOURCE_ROOTS are accepted (ADR 0013). The form therefore shows the
 * root as a fixed prefix and takes only the part below it, so a path outside
 * the root cannot be typed rather than being rejected after the fact.
 *
 * These are the two halves of that: split what is stored for display, join
 * what is shown back into what is stored.
 */

/** Drops trailing slashes, so `/data/photos/` and `/data/photos` are one root. */
export function trimRoot(root: string): string {
  const trimmed = root.trim().replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/**
 * splitLocation finds the root an absolute path sits under, and the part
 * below it.
 *
 * The longest matching root wins, so nested roots (`/media` and
 * `/media/sdhc`) resolve to the one that leaves the shortest remainder —
 * which is the one a reader would say the folder is "in".
 *
 * A path under no root comes back with `root: null`. That is not a bug to
 * hide: a Source saved before the roots changed still has to be editable, so
 * the caller falls back to a plain absolute field and says why.
 */
export function splitLocation(
  location: string,
  roots: string[],
): { root: string | null; rel: string } {
  const path = location.trim().replace(/\/+$/, '');
  let best: string | null = null;
  for (const raw of roots) {
    const root = trimRoot(raw);
    if (path !== root && !path.startsWith(root === '/' ? '/' : `${root}/`)) continue;
    if (best === null || root.length > best.length) best = root;
  }
  if (best === null) return { root: null, rel: location };
  return { root: best, rel: path.slice(best === '/' ? 1 : best.length + 1) };
}

/**
 * joinLocation puts a root and a typed remainder back together.
 *
 * The remainder is treated as relative however it is written: a pasted
 * absolute path that already starts with the root loses the duplicate, and
 * stray slashes are trimmed. An empty remainder means the root itself, which
 * is how "add the whole folder" is expressed.
 */
export function joinLocation(root: string, rel: string): string {
  const base = trimRoot(root);
  let rest = rel.trim();
  if (rest === base) rest = '';
  else if (rest.startsWith(`${base}/`)) rest = rest.slice(base.length + 1);
  rest = rest.replace(/^\/+/, '').replace(/\/+$/, '');
  if (rest === '') return base;
  return base === '/' ? `/${rest}` : `${base}/${rest}`;
}
