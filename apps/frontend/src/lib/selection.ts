/**
 * Multi-select arithmetic for the Timeline (ADR 0018).
 *
 * Kept free of React so the range rule in particular can be tested directly:
 * it is the part a reader notices when it is wrong.
 */

export type Selection = ReadonlySet<string>;

export const EMPTY_SELECTION: Selection = new Set<string>();

export function isSelected(selection: Selection, id: string): boolean {
  return selection.has(id);
}

/** Adds `id` if absent, removes it if present. */
export function toggleSelection(selection: Selection, id: string): Selection {
  const next = new Set(selection);
  if (!next.delete(id)) next.add(id);
  return next;
}

/**
 * Shift-click: selects everything between the anchor and the target.
 *
 * Both ends are included, the order of the two does not matter, and the result
 * is unioned with what was already selected rather than replacing it — so
 * shift-clicking a second range extends the selection instead of discarding
 * the first, which is what every file manager does.
 *
 * An anchor that is no longer in the list (its page was dropped, say) falls
 * back to toggling the target alone, which is better than selecting from the
 * start of the library.
 */
export function selectRange(
  selection: Selection,
  orderedIds: readonly string[],
  anchorId: string | null,
  targetId: string,
): Selection {
  const anchor = anchorId === null ? -1 : orderedIds.indexOf(anchorId);
  const target = orderedIds.indexOf(targetId);
  if (anchor < 0 || target < 0) return toggleSelection(selection, targetId);

  const [from, to] = anchor <= target ? [anchor, target] : [target, anchor];
  const next = new Set(selection);
  for (let i = from; i <= to; i++) next.add(orderedIds[i]);
  return next;
}

/** True when every id is selected and there is at least one. */
export function allSelected(selection: Selection, ids: readonly string[]): boolean {
  return ids.length > 0 && ids.every((id) => selection.has(id));
}

/**
 * Whether the selection's favorite action should remove rather than add.
 *
 * Google Photos flips the control once everything selected is already
 * favorited, so the button is never a no-op.
 */
export function selectionIsAllFavorited(
  selection: Selection,
  photos: readonly { id: string; favorite: boolean }[],
): boolean {
  const chosen = photos.filter((photo) => selection.has(photo.id));
  return chosen.length > 0 && chosen.every((photo) => photo.favorite);
}

/** "3 selected", for the toolbar heading and its live announcement. */
export function selectionLabel(count: number): string {
  return `${count} selected`;
}

/** Selected ids in the order they appear in the library, not insertion order. */
export function orderedSelection(selection: Selection, orderedIds: readonly string[]): string[] {
  return orderedIds.filter((id) => selection.has(id));
}
