import { useCallback, useState } from 'react';

import { safeGetItem, safeSetItem } from '../../config/safeStorage';

export type SidebarView = 'map' | 'assistant';

const STORAGE_KEY = 'itinerary.sidebarView';

// Which view the wide-screen sidebar shows — the day map or the trip assistant —
// remembered per browser so the day list reopens the way it was left.
export function useSidebarView() {
  const [view, setViewState] = useState<SidebarView>(() =>
    safeGetItem(STORAGE_KEY) === 'assistant' ? 'assistant' : 'map',
  );
  const setView = useCallback((next: SidebarView) => {
    setViewState(next);
    safeSetItem(STORAGE_KEY, next);
  }, []);
  return [view, setView] as const;
}
