import CloseIcon from '@mui/icons-material/Close';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';

import { activeMealOptions } from '../../model/mealOptions';
import { dayFullRouteUrls, dayMapEmbedUrl } from '../../model/tripModel';
import type { Day, Place, SequenceItem } from '../../model/types';
import {
  useMealOptionSelection,
  useRouteToneSelection,
  useScenarioSelection,
} from '../../state/useTripSelections';

// Only activities the reader has actually switched away from the model's
// default candidate get an entry here — dayMapStops/dayFullRouteUrls already
// fall back to the first place-bearing option on their own for anything
// left out of this map, same as the model's own "planned by default"
// convention.
function collectMealPlaces(
  day: Day,
  mealOptionIndex: Map<string, number>,
): Map<string, Place | null> {
  const result = new Map<string, Place | null>();
  const walk = (sequence: SequenceItem[]) => {
    for (const item of sequence) {
      if (item.type === 'section') {
        for (const activity of item.activities) {
          if (!activity.options?.length || !mealOptionIndex.has(activity._id)) continue;
          const options = activeMealOptions(activity, day);
          const option = options[mealOptionIndex.get(activity._id) as number];
          if (option) result.set(activity._id, option.place);
        }
      } else if (item.type === 'scenario-tabs') {
        for (const track of item.tracks ?? day.scenarioTracks) walk(track.sequence);
      }
    }
  };
  walk(day.sequence);
  return result;
}

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
  const { scenarioTone } = useScenarioSelection();
  const { routeTones } = useRouteToneSelection();
  const { mealOptionIndex } = useMealOptionSelection();
  if (!day) return null;

  const selections = {
    scenarioTone: scenarioTone.get(day.date),
    routeTones,
    mealPlaces: collectMealPlaces(day, mealOptionIndex),
  };
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
