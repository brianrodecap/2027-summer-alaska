import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { APIProvider } from '@vis.gl/react-google-maps';

import { getGoogleApiKey, hasGoogleApiKey } from '../../config/apiKeys';
import type { Day } from '../../model/types';
import { AssistantPanel } from '../assistant/AssistantPanel';
import { STICKY_PANE_SX } from '../day/dayLayout';
import { DayMapSidebar } from '../day/DayMapSidebar';
import type { SidebarView } from './useSidebarView';

// Full viewport height, outside the day list's own scrolling content — one
// persistent pane, between the day navigator and the day list, that shows either
// the day map (DayMapSidebar, swapping to whichever day useActiveDayDate says the
// reader has scrolled to) or the trip assistant, switched by the tabs at its top.
// The two share this one slot, which takes whatever width the day list leaves. Narrower screens
// keep the map-icon-opens-a-dialog flow (useDayMapDialog/DayMapPanel, the same map)
// and the assistant's bottom sheet instead.
export function SidebarSlot({
  activeDay,
  view,
  onViewChange,
}: {
  activeDay: Day | null;
  view: SidebarView;
  onViewChange: (view: SidebarView) => void;
}) {
  // Matches the `lg` breakpoint the wrapping Box below is CSS-hidden behind on
  // narrow viewports — gates the contents' mount itself, not just their
  // visibility, so the map's Places/Routes API lookups never fire on a screen
  // where the sidebar is never shown.
  const visible = useMediaQuery((theme) => theme.breakpoints.up('lg'));
  return (
    <Box
      sx={{
        ...STICKY_PANE_SX,
        display: { xs: 'none', lg: 'flex' },
        flexDirection: 'column',
        flex: 1,
        minWidth: 0,
        borderLeft: 1,
        borderRight: 1,
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
            {view === 'map' && !hasGoogleApiKey() ? (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                Add a Google API key in Settings to show the map.
              </Typography>
            ) : view === 'map' ? (
              <APIProvider apiKey={getGoogleApiKey()}>
                <DayMapSidebar activeDay={activeDay} />
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
