import CloseIcon from '@mui/icons-material/Close';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';

import { activeMealOptions } from '../../model/mealOptions';
import { dayFullRouteUrl, dayMapEmbedUrl } from '../../model/tripModel';
import type { Day, Place, SequenceItem } from '../../model/types';
import {
  useMealOptionSelection,
  useRouteToneSelection,
  useScenarioSelection,
} from '../../state/TripSelectionsContext';

// Only activities the reader has actually switched away from the model's
// default candidate get an entry here — dayMapStops/dayFullRouteUrl already
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

// dayMapEmbedUrl is null when the day has nothing resolvable to map yet
// (e.g. a still-unplanned day with no places named anywhere).
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
  const url = dayMapEmbedUrl(day, selections);
  const fullRouteUrl = dayFullRouteUrl(day, selections);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Map for {day.dateLabel}
        <IconButton onClick={onClose} aria-label="Close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {url ? (
          <Box
            component="iframe"
            src={url}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            title={`Map for ${day.dateLabel}`}
            sx={{ width: '100%', height: 320, border: 0, borderRadius: 1 }}
          />
        ) : (
          <Typography variant="body2" color="text.secondary">
            Nothing resolvable to map yet for this day.
          </Typography>
        )}
        {fullRouteUrl && (
          <Box sx={{ mt: 2 }}>
            <Link href={fullRouteUrl} target="_blank" rel="noopener">
              Open full route in Google Maps
            </Link>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
