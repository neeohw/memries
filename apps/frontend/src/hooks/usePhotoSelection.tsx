import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  EMPTY_SELECTION,
  type Selection,
  orderedSelection,
  selectRange,
  toggleSelection,
} from '../lib/selection';

export interface SelectionApi {
  selected: Selection;
  /** At least one photo is selected, so tiles toggle instead of opening. */
  active: boolean;
  count: number;
  /** Selected ids in library order. */
  ids: string[];
  toggle: (id: string, opts?: { shiftKey?: boolean }) => void;
  clear: () => void;
}

const INERT: SelectionApi = {
  selected: EMPTY_SELECTION,
  active: false,
  count: 0,
  ids: [],
  toggle: () => {},
  clear: () => {},
};

const SelectionContext = createContext<SelectionApi | null>(null);

/**
 * Multi-select state for one grid (ADR 0018).
 *
 * Split from the provider so the component that owns the state can also read
 * it — the toolbar and the tiles sit on opposite sides of the same subtree.
 *
 * `orderedIds` is the library order of the loaded photos, which shift-click
 * needs to resolve a range.
 */
export function useSelectionState(orderedIds: readonly string[]): SelectionApi {
  const [selected, setSelected] = useState<Selection>(EMPTY_SELECTION);
  // The last plainly-clicked tile, which a following shift-click ranges from.
  const [anchor, setAnchor] = useState<string | null>(null);

  const toggle = useCallback(
    (id: string, opts?: { shiftKey?: boolean }) => {
      if (opts?.shiftKey) {
        setSelected((current) => selectRange(current, orderedIds, anchor, id));
        // The anchor stays put, so a second shift-click extends from the same
        // origin instead of walking along behind the pointer.
        return;
      }
      setSelected((current) => toggleSelection(current, id));
      setAnchor(id);
    },
    [anchor, orderedIds],
  );

  const clear = useCallback(() => {
    setSelected(EMPTY_SELECTION);
    setAnchor(null);
  }, []);

  return useMemo(
    () => ({
      selected,
      active: selected.size > 0,
      count: selected.size,
      ids: orderedSelection(selected, orderedIds),
      toggle,
      clear,
    }),
    [clear, orderedIds, selected, toggle],
  );
}

/**
 * Publishes a selection to the tiles below.
 *
 * A context rather than props because the tile that needs it sits three
 * components down, and because several views render grids: anything not
 * wrapped in a provider gets an inert selection and behaves as it did before.
 */
export function PhotoSelectionProvider({
  value,
  children,
}: {
  value: SelectionApi;
  children: ReactNode;
}) {
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function usePhotoSelection(): SelectionApi {
  return useContext(SelectionContext) ?? INERT;
}
