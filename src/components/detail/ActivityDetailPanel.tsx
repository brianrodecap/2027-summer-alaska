import Typography from '@mui/material/Typography';

import { clockSuffix } from '../../model/dayClocks';
import { includedInLabel, PRIORITY_LABEL } from '../../model/entityDetails';
import {
  DINING_FORMAT_LABEL,
  firstImage,
  timeAndMealTypeLabel,
  uniqueById,
} from '../../model/formatting';
import { mealOptionLabel, mealOptionTimeLabel } from '../../model/mealOptions';
import {
  activityHeadline,
  activityStart,
  activityZone,
  optionShows,
  resolveActivityDate,
  sheetNotes,
} from '../../model/tripModel';
import type { Booking, EnrichedActivity, EnrichedMealOption, Place } from '../../model/types';
import { useHeroImageSelect } from '../../state/useHeroImageSelect';
import { useLiveDays } from '../../state/useLiveDays';
import { useActivityPlaceImagePersist } from '../../state/usePlaceImagePersist';
import { useTripData } from '../../state/useTripData';
import { BookingClockNote } from '../day/BookingClockNote';
import { BookingSection } from '../shared/BookingChip';
import { DetailSideSheet } from '../shared/DetailSideSheet';
import { EntityHeroImage } from '../shared/EntityHeroImage';
import { LinkifiedText } from '../shared/LinkifiedText';
import { DEFAULT_PLACE_ICON, DINING_FORMAT_ICON, renderMaterialIcon } from '../shared/materialIcon';
import { splitNotes } from '../shared/noteKind';
import { NotesCluster } from '../shared/Notes';
import { PackagesSection, TravelersSection } from './DetailSections';
import { PlacePanel } from './PlacePanel';

function selectedPlace(
  activity: EnrichedActivity,
  selectedOption?: EnrichedMealOption,
): Place | null {
  return selectedOption ? selectedOption.place : activity.place;
}

// The booking this sheet shows, and the id of the entity that holds it — the
// selected candidate's own reservation, else the Activity's. The holder is
// what "also covers" leaves out, so the sheet never lists itself.
function selectedBooking(
  activity: EnrichedActivity,
  selectedOption?: EnrichedMealOption,
): { booking: Booking | null; holderId: string } {
  return selectedOption?.booking
    ? { booking: selectedOption.booking, holderId: selectedOption._id }
    : { booking: activity.booking, holderId: activity._id };
}

// A meal Activity's own place is never on activity.place (only options are)
// — the side sheet needs whichever candidate is currently selected in the
// row instead.
// `includedIn` is the option's "Included in …" line, which says what the
// dining format would, more precisely, so it takes the format line's place.
function SelectedMealOptionBody({
  option,
  includedIn,
}: {
  option: EnrichedMealOption;
  includedIn: string | null;
}) {
  // option.place's own label is already shown as the side sheet's header
  // title — only repeat it here when there's no place, i.e. the label being
  // shown is the dining format itself.
  return (
    <>
      {!option.place && <Typography variant="subtitle1">{mealOptionLabel(option)}</Typography>}
      {(option.place || includedIn) && (
        <Typography variant="body2" color="text.secondary">
          {includedIn ?? DINING_FORMAT_LABEL[option.diningFormat]}
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
  const onSelectImage = useHeroImageSelect('activity', activity?._id);
  const onAutoImage = useActivityPlaceImagePersist(activity, selectedOption);
  const { data } = useTripData();
  const liveDays = useLiveDays();

  if (!activity) return null;

  const place = selectedPlace(activity, selectedOption);
  const { booking, holderId } = selectedBooking(activity, selectedOption);
  const image = firstImage(activity, place);
  const date = resolveActivityDate(activity);
  // The clock its time is on, on a day the clocks change, as its row says.
  const day = date ? liveDays.byDate.get(date) : undefined;
  const clock = day && activity.startAt ? clockSuffix(day, activityStart(activity), true) : '';
  const includedIn = data
    ? includedInLabel(data, selectedOption ? selectedOption.includedIn : activity.includedIn)
    : null;
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
  } = splitNotes(
    uniqueById([
      ...sheetNotes(activity),
      ...(selectedOption ? optionShows(selectedOption).notes : []),
    ]),
  );
  const aboveNotes = [...above, ...mid];

  return (
    <DetailSideSheet
      open={open}
      onClose={onClose}
      onEdit={onEdit}
      title={place ? place.label : activityHeadline(activity)}
      titleIcon={place ? renderMaterialIcon(titleIconName, { color: 'primary' }) : undefined}
    >
      <EntityHeroImage image={image} />
      <Typography variant="body1">
        {timeAndMealTypeLabel(
          activity,
          selectedOption ? mealOptionTimeLabel(activity, selectedOption) : undefined,
          clock,
        )}
      </Typography>
      <BookingClockNote
        at={activity.startAt}
        bookingZone={activityZone(activity)}
        placeZone={place?.timeZone}
      />
      {activity.priority && (
        <Typography variant="body2" color="text.secondary">
          {PRIORITY_LABEL[activity.priority]}
        </Typography>
      )}
      {selectedOption ? (
        <SelectedMealOptionBody option={selectedOption} includedIn={includedIn} />
      ) : (
        // null only when a Place already named the title above — nothing
        // left to add here, same as the meal-option body's own
        // no-place-no-repeat rule.
        activity.text && (
          <Typography variant="body1">
            <LinkifiedText text={activity.text} />
          </Typography>
        )
      )}
      {!selectedOption && includedIn && (
        <Typography variant="body2" color="text.secondary">
          {includedIn}
        </Typography>
      )}
      <BookingSection booking={booking} date={date} entityId={holderId} />
      <TravelersSection names={selectedOption ? selectedOption.travelers : activity.travelers} />
      <NotesCluster notes={aboveNotes} expanded />
      <PackagesSection packages={activity.packages} date={date} />
      {place && (
        <PlacePanel place={place} onSelectImage={onSelectImage} onAutoImage={onAutoImage} />
      )}
      <NotesCluster notes={footnotes} expanded />
    </DetailSideSheet>
  );
}
