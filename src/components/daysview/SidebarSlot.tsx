import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import useMediaQuery from '@mui/material/useMediaQuery';
import { APIProvider } from '@vis.gl/react-google-maps';

import { PLACES_API_KEY } from '../../config/places';
import type { Day } from '../../model/types';
import { AssistantPanel } from '../assistant/AssistantPanel';
import { DayMapSidebar } from '../day/DayMapSidebar';
import type { DayRowOpeners } from '../day/openHandlers';
import type { SidebarView } from './useSidebarView';

// Full viewport height, outside the day list's own scrolling content — one
// persistent sidebar beside the day list that shows either the day map
// (DayMapSidebar, swapping to whichever day useActiveDayDate says the reader has
// scrolled to) or the trip assistant, switched by the tabs at its top. A third
// column would squeeze the day list too much, so the two share this one slot.
// Narrower screens keep the map-icon-opens-a-dialog flow
// (useDayMapDialog/DayMapPanel) and the assistant's bottom sheet instead.
export function SidebarSlot({
  activeDay,
  view,
  onViewChange,
  onOpenActivity,
  onOpenStay,
  onOpenTransit,
}: {
  activeDay: Day | null;
  view: SidebarView;
  onViewChange: (view: SidebarView) => void;
} & DayRowOpeners) {
  // Matches the `lg` breakpoint the wrapping Box below is CSS-hidden behind on
  // narrow viewports — gates the contents' mount itself, not just their
  // visibility, so the map's Places/Routes API lookups never fire on a screen
  // where the sidebar is never shown.
  const visible = useMediaQuery((theme) => theme.breakpoints.up('lg'));
  return (
    <Box
      sx={{
        display: { xs: 'none', lg: 'flex' },
        flexDirection: 'column',
        width: { lg: 440, xl: 560 },
        flexShrink: 0,
        position: 'sticky',
        top: 0,
        height: '100vh',
        borderLeft: 1,
        borderColor: 'divider',
      }}
    >
      {visible && (
        <>
          <Tabs
            value={view}
            onChange={(_, next: SidebarView) => onViewChange(next)}
            variant="fullWidth"
            sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}
          >
            <Tab value="map" label="Map" />
            <Tab value="assistant" label="Assistant" />
          </Tabs>
          <Box sx={{ flex: 1, minHeight: 0 }}>
            {view === 'map' ? (
              <APIProvider apiKey={PLACES_API_KEY}>
                <DayMapSidebar
                  activeDay={activeDay}
                  onOpenActivity={onOpenActivity}
                  onOpenStay={onOpenStay}
                  onOpenTransit={onOpenTransit}
                />
              </APIProvider>
            ) : (
              <AssistantPanel focusDay={activeDay} fitViewport />
            )}
          </Box>
        </>
      )}
    </Box>
  );
}
