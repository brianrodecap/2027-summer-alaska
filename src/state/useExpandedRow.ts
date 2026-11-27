import { createContext, useContext, useSyncExternalStore } from 'react';

import { createExpandedRows, type ExpandedRows } from './expandedRows';

export const ExpandedRowsContext = createContext<ExpandedRows>(createExpandedRows());

export const useExpandedRows = () => useContext(ExpandedRowsContext);

// Whether this card is open, and how to open or close it. A card with no id never is.
export function useExpandedRow(id: string | undefined) {
  const rows = useExpandedRows();
  const expanded = useSyncExternalStore(rows.subscribe, () => Boolean(id) && rows.isOpen(id!));
  return { expanded, toggle: () => id && rows.toggle(id) };
}
