import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import AddIcon from '@mui/icons-material/Add';

import { PlacePickerField } from './PlacePickerField';
import { DINING_FORMAT_LABEL } from '../../model/formatting';
import type { DiningFormat, MealOption, Ref, Stay } from '../../model/types';

const MEAL_OPTION_DINING_FORMAT_VALUES: DiningFormat[] = ['included', 'package', 'sit-down', 'grab-and-go', 'drivethru', 'self-catered'];

// includedIn points at either a whole Stay's base rate or one specific
// Package nested inside a Stay — flattened here into a single select whose
// value encodes both the entity kind and id ('stay:<id>' / 'package:<id>').
function includedInOptions(stays: Stay[]): { value: string; label: string }[] {
  const options = [{ value: '', label: 'Not included/covered' }];
  for (const stay of stays) {
    options.push({ value: `stay:${stay._id}`, label: `Included with ${stay.lodging?.name ?? stay._id}` });
    for (const pkg of stay.packages ?? []) {
      options.push({ value: `package:${pkg._id}`, label: `Package: ${pkg.name}` });
    }
  }
  return options;
}

function includedInValue(includedIn: Ref | null): string {
  return includedIn && 'entity' in includedIn ? `${includedIn.entity}:${includedIn.id}` : '';
}

function parseIncludedIn(value: string): Ref | null {
  if (!value) return null;
  const [entity, id] = value.split(':');
  return entity === 'stay' || entity === 'package' ? { entity, id } : null;
}

function emptyOption(): MealOption {
  return { diningFormat: 'sit-down', place: null, includedIn: null, note: null };
}

// One MealOption candidate row — an add/remove/reorder list, the same
// bordered-card shape as a Route variant's own place list. Reordering
// matters here: options[0] is the candidate a meal row's tabs show by
// default, and array order is tab order.
function MealOptionRow({
  option,
  stays,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  option: MealOption;
  stays: Stay[];
  onChange: (option: MealOption) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2, mb: 1.5, position: 'relative' }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 1 }}>
        <TextField
          select
          label="Dining format"
          value={option.diningFormat}
          onChange={(e) => onChange({ ...option, diningFormat: e.target.value as DiningFormat })}
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
        <PlacePickerField place={option.place} onChange={(place) => onChange({ ...option, place })} />
        <TextField
          select
          label="Included in"
          value={includedInValue(option.includedIn)}
          onChange={(e) => onChange({ ...option, includedIn: parseIncludedIn(e.target.value) })}
        >
          {includedInOptions(stays).map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField label="Note (optional)" value={option.note ?? ''} onChange={(e) => onChange({ ...option, note: e.target.value || null })} />
      </Stack>
      <IconButton size="small" aria-label="Remove this candidate" onClick={onRemove} sx={{ position: 'absolute', bottom: 8, right: 8 }}>
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}

// Leave empty to keep the single decided place/dining format; add a few to
// leave this meal undecided among them instead — options and the decided
// fields are mutually exclusive (see editForms.ts's applyActivityForm).
export function MealOptionList({ options, stays, onChange }: { options: MealOption[]; stays: Stay[]; onChange: (options: MealOption[]) => void }) {
  const update = (i: number, option: MealOption) => onChange(options.map((o, idx) => (idx === i ? option : o)));
  const remove = (i: number) => onChange(options.filter((_, idx) => idx !== i));
  const moveUp = (i: number) => {
    if (i === 0) return;
    const next = [...options];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    onChange(next);
  };
  const moveDown = (i: number) => {
    if (i === options.length - 1) return;
    const next = [...options];
    [next[i], next[i + 1]] = [next[i + 1], next[i]];
    onChange(next);
  };

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Meal candidates — leave empty to keep the single decided place/dining format above; add a few to leave this meal undecided among them
        instead.
      </Typography>
      {options.map((option, i) => (
        <MealOptionRow
          key={i}
          option={option}
          stays={stays}
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
