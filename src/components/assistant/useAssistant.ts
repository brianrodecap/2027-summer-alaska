import useMediaQuery from '@mui/material/useMediaQuery';
import { useCallback, useState } from 'react';

import { useSidebarView } from '../daysview/useSidebarView';

// Where the trip assistant shows and how the app bar's Ask AI button reaches it: on
// wide screens it's the sidebar's Assistant tab (the choice remembered per browser);
// below `lg`, where there's no sidebar, it's a bottom sheet. The conversation itself
// is AssistantChatProvider's.
export function useAssistant() {
  const [sidebarView, setSidebarView] = useSidebarView();
  const wide = useMediaQuery((theme) => theme.breakpoints.up('lg'));
  const [sheetOpen, setSheetOpen] = useState(false);

  const open = useCallback(() => {
    if (wide) setSidebarView('assistant');
    else setSheetOpen(true);
  }, [wide, setSidebarView]);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  return { sidebarView, setSidebarView, open, sheetOpen: sheetOpen && !wide, closeSheet };
}
