import type { Photo } from '../models/photo';

/** What the lightbox was opened on, as the app holds it. */
export type ViewerState = {
  id: string;
  /** The strip that was clicked, captured at the moment of the click. */
  list: Photo[];
  /** Page the tab's own photos instead of the snapshot; see below. */
  follow?: boolean;
};

/**
 * What the lightbox should page through.
 *
 * Normally the snapshot: the tab's photos go on changing underneath — a page
 * arrives, a favorite is patched — and the viewer should not gain and lose
 * neighbours while it is open. Each item is refreshed from `photos` by id so
 * a heart press is reflected, and an item the tab no longer holds keeps the
 * values it was opened with.
 *
 * `follow` inverts that for the one case where the snapshot is the wrong list:
 * opening a photo from year view also zooms the timeline behind the viewer to
 * the week around it (ADR 0031), so the neighbours worth arrowing to are in
 * the feed that change is fetching, not in the sample that was clicked. Until
 * that feed arrives holding the photo, the snapshot — the one photo — is all
 * there is, which is a viewer with its arrows disabled rather than a viewer
 * that closed itself.
 */
export function resolveViewerList(viewer: ViewerState, photos: Photo[]): Photo[] {
  if (viewer.follow && photos.some((photo) => photo.id === viewer.id)) return photos;
  return viewer.list.map((item) => photos.find((photo) => photo.id === item.id) ?? item);
}
