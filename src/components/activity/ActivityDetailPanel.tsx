import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { DINING_FORMAT_LABEL, firstImage } from '../../model/formatting';
import { mealOptionLabel } from '../../model/mealOptions';
import type { Booking, EnrichedActivity, EnrichedMealOption, Place } from '../../model/types';
import { BookingChip } from '../shared/BookingChip';
import { DetailSideSheet } from '../shared/DetailSideSheet';
import { LinkifiedText } from '../shared/LinkifiedText';
import { DEFAULT_PLACE_ICON, DINING_FORMAT_ICON, renderMaterialIcon } from '../shared/materialIcon';
import { NotesCluster, splitNotes } from '../shared/Notes';
import { PlacePanel } from './PlacePanel';

function selectedPlace(
  activity: EnrichedActivity,
  selectedOption?: EnrichedMealOption,
): Place | null {
  return selectedOption ? selectedOption.place : activity.place;
}

function selectedBooking(
  activity: EnrichedActivity,
  selectedOption?: EnrichedMealOption,
): Booking | null {
  return selectedOption?.booking ?? activity.booking;
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
  const booking = selectedBooking(activity, selectedOption);
  const image = firstImage(activity) ?? (place ? firstImage(place) : null);
  const titleIconName = selectedOption
    ? DINING_FORMAT_ICON[selectedOption.diningFormat]
    : DEFAULT_PLACE_ICON;
  // The side sheet has no trailing chip row to keep `mid` (info) notes above
  // of — unlike the day-list row this opened from, it just wants every
  // non-footnote note up top, same as before `mid` existed as its own slot.
  // A selected candidate's own notes (see EnrichedMealOption.notes) join the
  // Activity's — this sheet is that one candidate's own detail view, so both
  // are "about what's showing here" the same way the day-list row treats them.
  const {
    above,
    mid,
    below: footnotes,
  } = splitNotes([...(activity.notes ?? []), ...(selectedOption?.notes ?? [])]);
  const aboveNotes = [...above, ...mid];

  return (
    <DetailSideSheet
      open={open}
      onClose={onClose}
      onEdit={onEdit}
      title={place ? place.label : activity.text}
      titleIcon={place ? renderMaterialIcon(titleIconName, { color: 'primary' }) : undefined}
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
      {selectedOption ? (
        <SelectedMealOptionBody option={selectedOption} />
      ) : (
        <Typography variant="body1">
          <LinkifiedText text={activity.text} />
        </Typography>
      )}
      {booking && (
        <Box sx={{ mt: 1.5 }}>
          <BookingChip booking={booking} />
        </Box>
      )}
      <NotesCluster notes={aboveNotes} expanded />
      {place && <PlacePanel place={place} />}
      <NotesCluster notes={footnotes} expanded />
    </DetailSideSheet>
  );
}
