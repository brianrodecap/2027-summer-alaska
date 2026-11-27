import CloseIcon from '@mui/icons-material/Close';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { APIProvider } from '@vis.gl/react-google-maps';
import { useMemo, useState } from 'react';

import { getGoogleApiKey, hasGoogleApiKey } from '../../config/apiKeys';
import { mapEmbedUrls, routeUrls } from '../../model/dayMap';
import type { Day } from '../../model/types';
import { DayMapSidebar } from './DayMapSidebar';

// Google's keyless embed, for a reader with no API key; it numbers nothing.
// mapEmbedUrls comes back empty when the day has nothing resolvable to
// map yet (e.g. a still-unplanned day with no places named anywhere). It can
// also come back with more than one entry — a day that crosses a genuine
// relocation (a one-way flight/ferry with no same-day return, e.g. Anchorage
// -> Kotzebue) spans two road networks with nothing connecting them, so it's
// shown as separate maps rather than one embed pretending a drivable route
// exists where there isn't one.
function EmbedMaps({ day }: { day: Day }) {
  const urls = useMemo(() => mapEmbedUrls(day.visits), [day.visits]);
  if (urls.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        Nothing resolvable to map yet for this day.
      </Typography>
    );
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {urls.map((url, i) => (
        <Box key={url}>
          {urls.length > 1 && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              Leg {i + 1} of {urls.length}
            </Typography>
          )}
          <Box
            component="iframe"
            src={url}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            title={`Map for ${day.dateLabel}${urls.length > 1 ? ` (leg ${i + 1})` : ''}`}
            sx={{ width: '100%', height: 320, border: 0, borderRadius: 1 }}
          />
        </Box>
      ))}
    </Box>
  );
}

// The day's map where there is no room beside the list: the same numbered map, so a
// pin's number is its card's. Tapping a pin's entry closes this onto that card.
export function DayMapPanel({
  day,
  open,
  onClose,
}: {
  day: Day | null;
  open: boolean;
  onClose: () => void;
}) {
  const phone = useMediaQuery((theme) => theme.breakpoints.down('sm'));
  // Closing onto a card must not hand focus, and the scroll, back to the map button.
  const [revealed, setRevealed] = useState(false);
  const visits = day?.visits;
  const fullRouteUrls = useMemo(() => (visits ? routeUrls(visits) : []), [visits]);
  if (!day) return null;
  const numbered = hasGoogleApiKey();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      fullScreen={phone}
      disableRestoreFocus={revealed}
      slotProps={{
        paper: { sx: numbered && !phone ? { height: '80vh' } : undefined },
        transition: { onEnter: () => setRevealed(false) },
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Map for {day.dateLabel}
        <IconButton onClick={onClose} aria-label="Close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent
        dividers
        sx={numbered ? { p: 0, display: 'flex', flexDirection: 'column' } : undefined}
      >
        {numbered ? (
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <APIProvider apiKey={getGoogleApiKey()}>
              <DayMapSidebar
                activeDay={day}
                onRevealed={() => {
                  setRevealed(true);
                  onClose();
                }}
              />
            </APIProvider>
          </Box>
        ) : (
          <EmbedMaps day={day} />
        )}
        {fullRouteUrls.length > 0 && (
          <Box
            sx={{
              mt: numbered ? 0 : 2,
              p: numbered ? 2 : 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 0.5,
            }}
          >
            {fullRouteUrls.map((routeUrl, i) => (
              <Link key={routeUrl} href={routeUrl} target="_blank" rel="noopener">
                {fullRouteUrls.length > 1
                  ? `Open route ${i + 1} in Google Maps`
                  : 'Open full route in Google Maps'}
              </Link>
            ))}
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
