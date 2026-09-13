import CloseIcon from '@mui/icons-material/Close';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';

import { dayFullRouteUrls, dayMapEmbedUrl } from '../../model/tripModel';
import type { Day } from '../../model/types';
import { useDayMapSelections } from './useDayMapSelections';

// dayMapEmbedUrl comes back empty when the day has nothing resolvable to
// map yet (e.g. a still-unplanned day with no places named anywhere). It can
// also come back with more than one entry — a day that crosses a genuine
// relocation (a one-way flight/ferry with no same-day return, e.g. Anchorage
// -> Kotzebue) spans two road networks with nothing connecting them, so it's
// shown as separate maps rather than one embed pretending a drivable route
// exists where there isn't one.
export function DayMapPanel({
  day,
  open,
  onClose,
}: {
  day: Day | null;
  open: boolean;
  onClose: () => void;
}) {
  const selections = useDayMapSelections(day);
  if (!day) return null;

  const urls = dayMapEmbedUrl(day, selections);
  const fullRouteUrls = dayFullRouteUrls(day, selections);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Map for {day.dateLabel}
        <IconButton onClick={onClose} aria-label="Close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {urls.length > 0 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {urls.map((url, i) => (
              <Box key={url}>
                {urls.length > 1 && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mb: 0.5 }}
                  >
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
        ) : (
          <Typography variant="body2" color="text.secondary">
            Nothing resolvable to map yet for this day.
          </Typography>
        )}
        {fullRouteUrls.length > 0 && (
          <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
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
