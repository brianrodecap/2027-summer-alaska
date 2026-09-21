import Box from '@mui/material/Box';
import useMediaQuery from '@mui/material/useMediaQuery';
import { APIProvider } from '@vis.gl/react-google-maps';

import { PLACES_API_KEY } from '../../config/places';
import type { Day } from '../../model/types';
import { DayMapSidebar } from '../day/DayMapSidebar';
import type { DayRowOpeners } from '../day/openHandlers';

// Full viewport height, outside the day list's own scrolling content — one
// persistent map (DayMapSidebar) that swaps to whichever day useActiveDayDate
// says the reader has scrolled to, rather than a map per day. Narrower screens
// keep the map-icon-opens-a-dialog flow (useDayMapDialog/DayMapPanel) instead.
export function MapSidebarSlot({
  activeDay,
  onOpenActivity,
  onOpenStay,
  onOpenTransit,
}: { activeDay: Day | null } & DayRowOpeners) {
  // Matches the `lg` breakpoint the wrapping Box below is CSS-hidden behind on
  // narrow viewports — gates the component's mount itself, not just its
  // visibility, so its Places/Routes API lookups never fire on a screen where
  // the map is never shown.
  const visible = useMediaQuery((theme) => theme.breakpoints.up('lg'));
  return (
    <Box
      sx={{
        display: { xs: 'none', lg: 'block' },
        width: { lg: 440, xl: 560 },
        flexShrink: 0,
        position: 'sticky',
        top: 0,
        height: '100vh',
      }}
    >
      {visible && (
        <APIProvider apiKey={PLACES_API_KEY}>
          <DayMapSidebar
            activeDay={activeDay}
            onOpenActivity={onOpenActivity}
            onOpenStay={onOpenStay}
            onOpenTransit={onOpenTransit}
          />
        </APIProvider>
      )}
    </Box>
  );
}
