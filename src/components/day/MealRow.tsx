import ButtonBase from '@mui/material/ButtonBase';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TimelineDot from '@mui/lab/TimelineDot';

import { firstImage, timeAndMealTypeLabel, DINING_FORMAT_LABEL } from '../../model/formatting';
import { activeMealOptions, mealOptionLabel, selectedMealOptionIndex } from '../../model/mealOptions';
import { materialIcon, DINING_FORMAT_ICON } from '../shared/materialIcon';
import { useMealOptionSelection } from '../../state/TripSelectionsContext';
import { TravelerChips } from '../shared/TravelerChips';
import { TransitOverlapWarning } from '../shared/TransitOverlapWarning';
import { LinkifiedText } from '../shared/LinkifiedText';
import { NotesCluster, splitNotes } from '../shared/Notes';
import type { Day, EnrichedActivity, EnrichedMealOption, Note } from '../../model/types';

// Which candidate is "active" for a meal Activity — shared by the row's own
// content and the timeline dot beside it, so both stay in sync as the user
// switches tabs.
function useMealSelection(activity: EnrichedActivity, day: Day) {
  const { mealOptionIndex } = useMealOptionSelection();
  const options = activeMealOptions(activity, day);
  const index = selectedMealOptionIndex(options, mealOptionIndex, activity._id);
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
// row's "open the side sheet" handler. `midNotes` is the Activity's own info
// notes (about the meal choice as a whole, e.g. "still deciding" — shown no
// matter which candidate is picked); the selected candidate's own notes are
// a separate `entity:'mealOption'` concern (see EnrichedMealOption.notes) —
// swapping candidates swaps which of those are visible, alert/info above and
// beside the row, footnote below the chip group.
export function MealRow({
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
  const { selectMealOption } = useMealOptionSelection();
  const { options, index, selected } = useMealSelection(activity, day);
  const { above: optionAbove, mid: optionMid, below: optionBelow } = splitNotes(selected?.notes ?? []);

  return (
    <Box sx={{ minWidth: 0 }}>
      <NotesCluster notes={optionAbove} />
      <ButtonBase
        onClick={() => onOpen(activity, selected ?? undefined)}
        sx={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: 1 }}
      >
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {timeAndMealTypeLabel(activity)}
          </Typography>
          <Typography variant="body1">{selected ? mealOptionLabel(selected) : <LinkifiedText text={activity.text} />}</Typography>
          <NotesCluster notes={midNotes} />
          <NotesCluster notes={optionMid} />
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
      <NotesCluster notes={optionBelow} />
    </Box>
  );
}
