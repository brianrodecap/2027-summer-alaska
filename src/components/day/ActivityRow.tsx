import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';

import { firstImage, timeAndMealTypeLabel } from '../../model/formatting';
import { liveOverlapWarnings } from '../../model/mealOptions';
import type { Day, EnrichedActivity, EnrichedMealOption, Note } from '../../model/types';
import { useMealOptionSelection } from '../../state/useTripSelections';
import { BookingChip } from '../shared/BookingChip';
import { LinkifiedText } from '../shared/LinkifiedText';
import { DEFAULT_PLACE_ICON, DINING_FORMAT_ICON } from '../shared/materialIcon';
import { NotesCluster } from '../shared/Notes';
import { OverlapWarnings } from '../shared/OverlapWarnings';
import { RowLeadingDot } from '../shared/RowLeadingDot';
import { TravelerChips } from '../shared/TravelerChips';
import { MealRow, MealRowLeading } from './MealRow';

// Activities don't carry an explicit category field — a committed meal's
// diningFormat is the only synchronous signal richer than "does this
// activity name a place at all".
function activityRowIconName(activity: EnrichedActivity): string {
  if (activity.diningFormat) return DINING_FORMAT_ICON[activity.diningFormat];
  if (activity.place) return DEFAULT_PLACE_ICON;
  return 'event';
}

// The image/icon an Activity contributes to the day timeline's own dot
// column — a meal with open candidates defers to whichever option is
// currently selected, same as its row content does.
export function ActivityLeading({ activity, day }: { activity: EnrichedActivity; day: Day }) {
  if (activity.options?.length) return <MealRowLeading activity={activity} day={day} />;

  const image = firstImage(activity) ?? firstImage(activity.place);
  return image ? (
    <Avatar src={image.uri} sx={{ width: 32, height: 32 }} />
  ) : (
    <RowLeadingDot icon={activityRowIconName(activity)} />
  );
}

export function ActivityRow({
  activity,
  day,
  onOpen,
  midNotes,
}: {
  activity: EnrichedActivity;
  day: Day;
  onOpen: (activity: EnrichedActivity, selectedOption?: EnrichedMealOption) => void;
  midNotes?: Note[];
}) {
  const { mealOptionIndex } = useMealOptionSelection();

  if (activity.options?.length)
    return <MealRow activity={activity} day={day} onOpen={onOpen} midNotes={midNotes} />;

  return (
    <ButtonBase
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
        <Typography variant="caption" color="text.secondary">
          {timeAndMealTypeLabel(activity)}
        </Typography>
        <Typography variant="body1">
          <LinkifiedText text={activity.text} />
        </Typography>
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
