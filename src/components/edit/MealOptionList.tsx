import AddIcon from '@mui/icons-material/Add';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import DeleteIcon from '@mui/icons-material/Delete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { DINING_FORMATS_WITH_INCLUDED_IN, swapItems } from '../../model/editForms';
import { DINING_FORMAT_LABEL } from '../../model/formatting';
import type { Activity, DiningFormat, MealOption, Stay, Transit } from '../../model/types';
import { BookingFields } from './BookingFields';
import { bookingFormValueFrom, readBookingFormValue } from './bookingFormValue';
import { IncludedInField } from './IncludedInField';
import { PlacePickerField } from './PlacePickerField';

const MEAL_OPTION_DINING_FORMAT_VALUES: DiningFormat[] = [
  'included',
  'package',
  'included-with-activity',
  'included-with-transit',
  'sit-down',
  'grab-and-go',
  'drivethru',
  'self-catered',
];

function emptyOption(): MealOption {
  return {
    _id: crypto.randomUUID(),
    diningFormat: 'sit-down',
    place: null,
    includedIn: null,
    booking: null,
  };
}

// One MealOption candidate row — an add/remove/reorder list, the same
// bordered-card shape as a Route variant's own place list. Reordering
// matters here: options[0] is the candidate a meal row's tabs show by
// default, and array order is tab order.
function MealOptionRow({
  option,
  stays,
  activities,
  transits,
  jumpToDate,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  option: MealOption;
  stays: Stay[];
  activities: Activity[];
  transits: Transit[];
  jumpToDate: string | null;
  onChange: (option: MealOption) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        p: 2,
        mb: 1.5,
        position: 'relative',
      }}
    >
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 1 }}>
        <TextField
          select
          label="Dining format"
          value={option.diningFormat}
          onChange={(e) => {
            const diningFormat = e.target.value as DiningFormat;
            const includedIn = DINING_FORMATS_WITH_INCLUDED_IN.includes(diningFormat)
              ? option.includedIn
              : null;
            onChange({ ...option, diningFormat, includedIn });
          }}
          fullWidth
        >
          {MEAL_OPTION_DINING_FORMAT_VALUES.map((v) => (
            <MenuItem key={v} value={v}>
              {DINING_FORMAT_LABEL[v]}
            </MenuItem>
          ))}
        </TextField>
        <IconButton size="small" aria-label="Move this candidate earlier" onClick={onMoveUp}>
          <ArrowUpwardIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" aria-label="Move this candidate later" onClick={onMoveDown}>
          <ArrowDownwardIcon fontSize="small" />
        </IconButton>
      </Stack>
      <Stack spacing={1.5}>
        <PlacePickerField
          place={option.place}
          onChange={(place) => onChange({ ...option, place })}
        />
        {DINING_FORMATS_WITH_INCLUDED_IN.includes(option.diningFormat) && (
          <IncludedInField
            diningFormat={option.diningFormat}
            stays={stays}
            activities={activities}
            transits={transits}
            value={option.includedIn}
            onChange={(includedIn) => onChange({ ...option, includedIn })}
            jumpToDate={jumpToDate}
          />
        )}
        <BookingFields
          value={bookingFormValueFrom(option.booking)}
          onChange={(v) =>
            onChange({ ...option, booking: readBookingFormValue(v, option.booking) })
          }
        />
      </Stack>
      <IconButton
        size="small"
        aria-label="Remove this candidate"
        onClick={onRemove}
        sx={{ position: 'absolute', bottom: 8, right: 8 }}
      >
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}

// Leave empty to keep the single decided place/dining format; add a few to
// leave this meal undecided among them instead — options and the decided
// fields are mutually exclusive (see editForms.ts's applyActivityForm).
export function MealOptionList({
  options,
  stays,
  activities,
  transits,
  jumpToDate,
  onChange,
}: {
  options: MealOption[];
  stays: Stay[];
  activities: Activity[];
  transits: Transit[];
  jumpToDate: string | null;
  onChange: (options: MealOption[]) => void;
}) {
  const update = (i: number, option: MealOption) =>
    onChange(options.map((o, idx) => (idx === i ? option : o)));
  const remove = (i: number) => onChange(options.filter((_, idx) => idx !== i));
  const moveUp = (i: number) => {
    if (i === 0) return;
    onChange(swapItems(options, i - 1, i));
  };
  const moveDown = (i: number) => {
    if (i === options.length - 1) return;
    onChange(swapItems(options, i, i + 1));
  };

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Meal candidates — leave empty to keep the single decided place/dining format above; add a
        few to leave this meal undecided among them instead.
      </Typography>
      {options.map((option, i) => (
        <MealOptionRow
          key={option._id}
          option={option}
          stays={stays}
          activities={activities}
          transits={transits}
          jumpToDate={jumpToDate}
          onChange={(o) => update(i, o)}
          onRemove={() => remove(i)}
          onMoveUp={() => moveUp(i)}
          onMoveDown={() => moveDown(i)}
        />
      ))}
      <Button startIcon={<AddIcon />} onClick={() => onChange([...options, emptyOption()])}>
        Add candidate
      </Button>
    </Box>
  );
}
