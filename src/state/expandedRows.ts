// Which day-list cards are open. A store rather than context state, so opening one
// card re-renders that card alone, not every row of an unvirtualized ~28-day list.
export interface ExpandedRows {
  isOpen: (cardId: string) => boolean;
  toggle: (cardId: string) => void;
  open: (cardId: string) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createExpandedRows(): ExpandedRows {
  const opened = new Set<string>();
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((listener) => listener());
  return {
    isOpen: (cardId) => opened.has(cardId),
    toggle: (cardId) => {
      if (!opened.delete(cardId)) opened.add(cardId);
      changed();
    },
    open: (cardId) => {
      if (opened.has(cardId)) return;
      opened.add(cardId);
      changed();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// A card's id: its day, since a stay's morning card recurs on each day of the stay,
// and its row (dayMap.ts's mapRefRowId).
export const cardId = (date: string, rowKey: string) => `${date}|${rowKey}`;
