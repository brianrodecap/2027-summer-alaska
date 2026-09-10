import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';

import { firstImage, timeAndMealTypeLabel } from '../../model/formatting';
import { liveOverlapWarnings } from '../../model/mealOptions';
import { activityHeadline } from '../../model/tripModel';
import type { Day, EnrichedActivity, EnrichedMealOption, Note } from '../../model/types';
import { useMealOptionSelection } from '../../state/useTripSelections';
import { BookingChip } from '../shared/BookingChip';
import { LinkifiedText } from '../shared/LinkifiedText';
import { DEFAULT_PLACE_ICON, DINING_FORMAT_ICON } from '../shared/materialIcon';
import { NotesCluster } from '../shared/Notes';
import { OverlapWarnings } from '../shared/OverlapWarnings';
import { ROW_OVERLINE_SX } from '../shared/rowLeadingTokens';
import { TravelerChips } from '../shared/TravelerChips';
import { AvatarOrDotView } from './AvatarOrDot';
import { PlaceConditionsLine } from './PlaceConditionsLine';
import { useSunAnchoredTime } from './useSunAnchoredTime';

// Activities don't carry an explicit category field — a committed meal's
// diningFormat is the only synchronous signal richer than "does this
// activity name a place at all".
function activityRowIconName(activity: EnrichedActivity): string {
  if (activity.diningFormat) return DINING_FORMAT_ICON[activity.diningFormat];
  if (activity.place) return DEFAULT_PLACE_ICON;
  return 'event';
}

// The image/icon a plain (non-meal) Activity contributes to the day
// timeline's own dot column — DayTimeline's own ActivityNode picks this or
// MealRowLeading before either ever mounts, based on isMealActivity(),
// so a meal Activity's dot never mounts this component's own hooks only to
// discard them.
export function ActivityLeading({
  activity,
  inView,
}: {
  activity: EnrichedActivity;
  inView: boolean;
}) {
  const image = firstImage(activity) ?? firstImage(activity.place);
  return <AvatarOrDotView image={image} icon={activityRowIconName(activity)} inView={inView} />;
}

export function ActivityRow({
  activity,
  day,
  onOpen,
  midNotes,
  inView,
  buttonRef,
}: {
  activity: EnrichedActivity;
  day: Day;
  onOpen: (activity: EnrichedActivity, selectedOption?: EnrichedMealOption) => void;
  midNotes?: Note[];
  inView: boolean;
  buttonRef: (node: HTMLButtonElement | null) => void;
}) {
  const { mealOptionIndex } = useMealOptionSelection();
  const timeText = useSunAnchoredTime(activity, day, inView);

  return (
    <ButtonBase
      ref={buttonRef}
      onClick={() => onOpen(activity)}
      sx={{
        flexGrow: 1,
        minWidth: 0,
        textAlign: 'left',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1,
      }}
    >
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" sx={ROW_OVERLINE_SX}>
          {timeAndMealTypeLabel(activity, timeText)}
        </Typography>
        <Typography variant="body1">
          <LinkifiedText text={activityHeadline(activity)} />
        </Typography>
        <PlaceConditionsLine place={activity.place} date={day.date} />
        <NotesCluster notes={midNotes} />
        <TravelerChips names={activity.travelers} />
        {activity.booking && (
          <Box sx={{ mt: 0.5 }}>
            <BookingChip booking={activity.booking} />
          </Box>
        )}
        <OverlapWarnings activity={liveOverlapWarnings(activity, day, mealOptionIndex)} />
      </Box>
    </ButtonBase>
  );
}
