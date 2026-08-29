import Checkbox from '@mui/material/Checkbox';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import type { ActivityFormState } from '../../model/editForms';
import {
  DINING_FORMAT_OPTIONS,
  DINING_FORMATS_WITH_INCLUDED_IN,
  PRIORITY_OPTIONS,
  TIME_LABEL_OPTIONS,
} from '../../model/editForms';
import type {
  Activity,
  DiningFormat,
  MealType,
  PlanStatus,
  Priority,
  Stay,
  TimeLabel,
  Transit,
  Traveler,
} from '../../model/types';
import { BookingFields } from './BookingFields';
import { DateTimeFieldPair } from './DateTimeFieldPair';
import { DurationSelect } from './DurationSelect';
import { IncludedInField } from './IncludedInField';
import { MealOptionList } from './MealOptionList';
import { PlacePickerField } from './PlacePickerField';

const STATUS_OPTIONS: { value: PlanStatus; label: string }[] = [
  { value: 'planning', label: 'Planning' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const MEAL_TYPE_OPTIONS: { value: MealType | ''; label: string }[] = [
  { value: '', label: 'Not a meal' },
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' },
];

export function ActivityEditForm({
  form,
  onChange,
  stays,
  activities,
  transits,
  tripTravelers,
}: {
  form: ActivityFormState;
  onChange: (form: ActivityFormState) => void;
  stays: Stay[];
  activities: Activity[];
  transits: Transit[];
  tripTravelers: Traveler[];
}) {
  const hasOptions = form.options.length > 0;
  // The meal-candidates section must stay reachable even if mealType was
  // somehow left blank on existing candidate data, so hasOptions keeps it
  // visible too — the single-choice dining-format/included-in fields below
  // don't need this since they're mutually exclusive with hasOptions anyway.
  const isMeal = form.mealType !== '' || hasOptions;

  return (
    <Stack spacing={2}>
      <DateTimeFieldPair
        dateLabel="Starts date"
        timeLabel="Starts time"
        dateValue={form.startsDate}
        timeValue={form.startsTime}
        onDateChange={(v) => onChange({ ...form, startsDate: v })}
        onTimeChange={(v) => onChange({ ...form, startsTime: v })}
      />
      <DurationSelect
        value={form.durationMinutes}
        onChange={(durationMinutes) => onChange({ ...form, durationMinutes })}
      />
      <TextField
        select
        label="Fuzzy time (used only when Starts has a date but no time)"
        value={form.timeLabel}
        onChange={(e) => onChange({ ...form, timeLabel: e.target.value as TimeLabel | '' })}
      >
        {TIME_LABEL_OPTIONS.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </TextField>

      {!hasOptions && (
        <>
          <Typography variant="overline" color="text.secondary">
            Place
          </Typography>
          <PlacePickerField place={form.place} onChange={(place) => onChange({ ...form, place })} />
        </>
      )}

      <TextField
        label="Description"
        value={form.text}
        onChange={(e) => onChange({ ...form, text: e.target.value })}
        required
      />
      <TextField
        select
        label="Status"
        value={form.status}
        onChange={(e) => onChange({ ...form, status: e.target.value as PlanStatus })}
      >
        {STATUS_OPTIONS.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        label="Priority"
        value={form.priority}
        onChange={(e) => onChange({ ...form, priority: e.target.value as Priority | '' })}
      >
        {PRIORITY_OPTIONS.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        label="Meal type"
        value={form.mealType}
        onChange={(e) => onChange({ ...form, mealType: e.target.value as MealType | '' })}
      >
        {MEAL_TYPE_OPTIONS.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </TextField>
      {form.mealType !== '' && !hasOptions && (
        <TextField
          select
          label="Dining format"
          value={form.diningFormat}
          onChange={(e) => {
            const diningFormat = e.target.value as DiningFormat | '';
            const includedIn = DINING_FORMATS_WITH_INCLUDED_IN.includes(
              diningFormat as DiningFormat,
            )
              ? form.includedIn
              : null;
            onChange({ ...form, diningFormat, includedIn });
          }}
        >
          {DINING_FORMAT_OPTIONS.map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
        </TextField>
      )}
      {form.mealType !== '' &&
        !hasOptions &&
        form.diningFormat &&
        DINING_FORMATS_WITH_INCLUDED_IN.includes(form.diningFormat) && (
          <IncludedInField
            diningFormat={form.diningFormat}
            stays={stays}
            activities={activities}
            transits={transits}
            value={form.includedIn}
            onChange={(includedIn) => onChange({ ...form, includedIn })}
            jumpToDate={form.startsDate}
          />
        )}

      {isMeal && (
        <>
          <Divider />
          <MealOptionList
            options={form.options}
            stays={stays}
            activities={activities}
            transits={transits}
            jumpToDate={form.startsDate}
            onChange={(options) => onChange({ ...form, options })}
          />
        </>
      )}

      {tripTravelers.length > 0 && (
        <>
          <Divider />
          <Typography variant="overline" color="text.secondary">
            Travelers (excursions only — leave all unchecked for everyone)
          </Typography>
          <Stack>
            {tripTravelers.map((t) => (
              <FormControlLabel
                key={t.id}
                control={
                  <Checkbox
                    checked={form.travelerIds.includes(t.id)}
                    onChange={(e) =>
                      onChange({
                        ...form,
                        travelerIds: e.target.checked
                          ? [...form.travelerIds, t.id]
                          : form.travelerIds.filter((id) => id !== t.id),
                      })
                    }
                  />
                }
                label={t.name}
              />
            ))}
          </Stack>
        </>
      )}

      <Divider />
      <BookingFields value={form.booking} onChange={(booking) => onChange({ ...form, booking })} />
    </Stack>
  );
}
