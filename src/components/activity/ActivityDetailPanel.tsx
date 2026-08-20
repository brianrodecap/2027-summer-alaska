import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { firstImage, DINING_FORMAT_LABEL } from '../../model/formatting';
import { mealOptionLabel } from '../../model/mealOptions';
import { materialIcon, DEFAULT_PLACE_ICON, DINING_FORMAT_ICON } from '../shared/materialIcon';
import { DetailSideSheet } from '../shared/DetailSideSheet';
import { BookingChip } from '../shared/BookingChip';
import { Notes } from '../shared/Notes';
import { PlacePanel } from './PlacePanel';
import type { EnrichedActivity, EnrichedMealOption, Place } from '../../model/types';

function selectedPlace(activity: EnrichedActivity, selectedOption?: EnrichedMealOption): Place | null {
  return selectedOption ? selectedOption.place : activity.place;
}

// A meal Activity's own place is never on activity.place (only options are)
// — the side sheet needs whichever candidate is currently selected in the
// row instead.
function SelectedMealOptionBody({ option }: { option: EnrichedMealOption }) {
  // option.place's own label is already shown as the side sheet's header
  // title — only repeat it here when there's no place, i.e. the label being
  // shown is the dining format itself.
  return (
    <>
      {!option.place && <Typography variant="subtitle1">{mealOptionLabel(option)}</Typography>}
      {option.place && (
        <Typography variant="body2" color="text.secondary">
          {DINING_FORMAT_LABEL[option.diningFormat]}
        </Typography>
      )}
      {option.note && <Typography variant="body2">{option.note}</Typography>}
    </>
  );
}

// The activity/meal side sheet — an Activity's (or a meal's selected
// MealOption's) own detail, plus the live Google Places lookup panel for
// whichever real-world place it names. Only shows the Place itself (its own
// details and refs) — no restated trip/day/scenario context.
export function ActivityDetailPanel({
  activity,
  selectedOption,
  open,
  onClose,
  onEdit,
}: {
  activity: EnrichedActivity | null;
  selectedOption?: EnrichedMealOption;
  open: boolean;
  onClose: () => void;
  onEdit?: () => void;
}) {
  if (!activity) return null;

  const place = selectedPlace(activity, selectedOption);
  const image = firstImage(activity) ?? (place ? firstImage(place) : null);
  const TitleIcon = selectedOption ? materialIcon(DINING_FORMAT_ICON[selectedOption.diningFormat]) : materialIcon(DEFAULT_PLACE_ICON);

  return (
    <DetailSideSheet
      open={open}
      onClose={onClose}
      onEdit={onEdit}
      title={place ? place.label : activity.text}
      titleIcon={place ? <TitleIcon color="primary" /> : undefined}
    >
      {image && (
        <Box
          component="img"
          src={image.uri}
          alt={image.caption ?? ''}
          title={image.credit ?? ''}
          sx={{ width: '100%', borderRadius: 2, mb: 2 }}
        />
      )}
      {selectedOption ? <SelectedMealOptionBody option={selectedOption} /> : <Typography variant="body1">{activity.text}</Typography>}
      {activity.booking && (
        <Box sx={{ mt: 1.5 }}>
          <BookingChip booking={activity.booking} />
        </Box>
      )}
      <Notes notes={activity.notes} />
      {place && <PlacePanel place={place} />}
    </DetailSideSheet>
  );
}
