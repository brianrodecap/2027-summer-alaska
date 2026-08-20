import ButtonBase from '@mui/material/ButtonBase';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TimelineDot from '@mui/lab/TimelineDot';

import { firstImage, timeAndMealTypeLabel, DINING_FORMAT_LABEL } from '../../model/formatting';
import { activeMealOptions, mealOptionLabel } from '../../model/mealOptions';
import { materialIcon, DINING_FORMAT_ICON } from '../shared/materialIcon';
import { useTripSelections } from '../../state/TripSelectionsContext';
import { TravelerChips } from '../shared/TravelerChips';
import { TransitOverlapWarning } from '../shared/TransitOverlapWarning';
import type { Day, EnrichedActivity, EnrichedMealOption } from '../../model/types';

// Which candidate is "active" for a meal Activity — shared by the row's own
// content and the timeline dot beside it, so both stay in sync as the user
// switches tabs.
function useMealSelection(activity: EnrichedActivity, day: Day) {
  const { mealOptionIndex } = useTripSelections();
  const options = activeMealOptions(activity, day);
  const storedIndex = mealOptionIndex.get(activity._id);
  const index = storedIndex !== undefined && storedIndex < options.length ? storedIndex : 0;
  const selected = options[index] ?? null;
  return { options, index, selected };
}

// The image/icon a meal Activity contributes to the day timeline's own dot
// column, for whichever candidate is currently selected.
export function MealRowLeading({ activity, day }: { activity: EnrichedActivity; day: Day }) {
  const { selected } = useMealSelection(activity, day);
  const Icon = materialIcon(selected ? DINING_FORMAT_ICON[selected.diningFormat] : 'event');
  const image = selected ? firstImage(selected.place) : null;
  return image ? (
    <Avatar src={image.uri} sx={{ width: 32, height: 32 }} />
  ) : (
    <TimelineDot color="primary">
      <Icon fontSize="small" />
    </TimelineDot>
  );
}

// A meal Activity with several still-open MealOption candidates renders as
// its own row: time/selected-candidate line, plus a chip group for switching
// candidates inline — the header is its own button, a sibling of the chips
// rather than a wrapper around them, so a chip click can't bubble into the
// row's "open the side sheet" handler.
export function MealRow({
  activity,
  day,
  onOpen,
}: {
  activity: EnrichedActivity;
  day: Day;
  onOpen: (activity: EnrichedActivity, selectedOption?: EnrichedMealOption) => void;
}) {
  const { selectMealOption } = useTripSelections();
  const { options, index, selected } = useMealSelection(activity, day);

  return (
    <Box sx={{ minWidth: 0 }}>
      <ButtonBase
        onClick={() => onOpen(activity, selected ?? undefined)}
        sx={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: 1 }}
      >
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {timeAndMealTypeLabel(activity)}
          </Typography>
          <Typography variant="body1">{selected ? mealOptionLabel(selected) : activity.text}</Typography>
          <TravelerChips names={selected?.travelers} />
          <TransitOverlapWarning activity={activity} />
        </Box>
        <ChevronRightIcon color="action" sx={{ mt: 0.5 }} />
      </ButtonBase>
      {options.length > 1 && (
        <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
          {options.map((option, i) => {
            const OptionIcon = materialIcon(DINING_FORMAT_ICON[option.diningFormat]);
            const active = i === index;
            return (
              <Chip
                key={i}
                label={DINING_FORMAT_LABEL[option.diningFormat]}
                icon={<OptionIcon fontSize="small" />}
                color={active ? 'primary' : 'default'}
                variant={active ? 'filled' : 'outlined'}
                onClick={() => selectMealOption(activity._id, i)}
              />
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
