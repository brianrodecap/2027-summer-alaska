import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { DINING_FORMAT_LABEL, firstImage, timeAndMealTypeLabel } from '../../model/formatting';
import {
  activeMealOptions,
  mealOptionLabel,
  selectedMealOptionIndex,
} from '../../model/mealOptions';
import type { Day, EnrichedActivity, EnrichedMealOption, Note } from '../../model/types';
import { useMealOptionSelection } from '../../state/TripSelectionsContext';
import { LinkifiedText } from '../shared/LinkifiedText';
import { DINING_FORMAT_ICON, renderMaterialIcon, RowLeadingDot } from '../shared/materialIcon';
import { NotesCluster, splitNotes } from '../shared/Notes';
import { TransitOverlapWarning } from '../shared/TransitOverlapWarning';
import { TravelerChips } from '../shared/TravelerChips';

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
  const image = selected ? firstImage(selected.place) : null;
  return image ? (
    <Avatar src={image.uri} sx={{ width: 32, height: 32 }} />
  ) : (
    <RowLeadingDot icon={selected ? DINING_FORMAT_ICON[selected.diningFormat] : 'event'} />
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
  const {
    above: optionAbove,
    mid: optionMid,
    below: optionBelow,
  } = splitNotes(selected?.notes ?? []);

  return (
    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
      <NotesCluster notes={optionAbove} />
      <ButtonBase
        onClick={() => onOpen(activity, selected ?? undefined)}
        sx={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: 1 }}
      >
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {timeAndMealTypeLabel(activity)}
          </Typography>
          <Typography variant="body1">
            {selected ? mealOptionLabel(selected) : <LinkifiedText text={activity.text} />}
          </Typography>
          <NotesCluster notes={midNotes} />
          <NotesCluster notes={optionMid} />
          <TravelerChips names={selected?.travelers} />
          <TransitOverlapWarning activity={activity} />
        </Box>
      </ButtonBase>
      {options.length > 1 && (
        <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
          {options.map((option, i) => {
            const active = i === index;
            return (
              <Chip
                key={i}
                label={DINING_FORMAT_LABEL[option.diningFormat]}
                icon={renderMaterialIcon(DINING_FORMAT_ICON[option.diningFormat], {
                  fontSize: 'small',
                })}
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
