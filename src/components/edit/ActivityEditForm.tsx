import Checkbox from '@mui/material/Checkbox';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import type { ActivityFormState } from '../../model/editForms';
import type {
  DiningFormat,
  MealType,
  PlanStatus,
  Priority,
  Stay,
  TimeLabel,
  Traveler,
} from '../../model/types';
import { BookingFields } from './BookingFields';
import { DateTimeFieldPair } from './DateTimeFieldPair';
import { MealOptionList } from './MealOptionList';
import { PlacePickerField } from './PlacePickerField';

const STATUS_OPTIONS: { value: PlanStatus; label: string }[] = [
  { value: 'planning', label: 'Planning' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const PRIORITY_OPTIONS: { value: Priority | ''; label: string }[] = [
  { value: '', label: 'None' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

// The same closed vocabulary as tripModel.ts's TIME_LABEL_ANCHORS.
const TIME_LABEL_OPTIONS: { value: TimeLabel | ''; label: string }[] = [
  { value: '', label: 'None' },
  { value: 'Morning', label: 'Morning' },
  { value: 'Afternoon', label: 'Afternoon' },
  { value: 'Evening', label: 'Evening' },
  { value: 'All day', label: 'All day' },
];

const MEAL_TYPE_OPTIONS: { value: MealType | ''; label: string }[] = [
  { value: '', label: 'Not a meal' },
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' },
];

const DINING_FORMAT_OPTIONS: { value: DiningFormat | ''; label: string }[] = [
  { value: '', label: 'None' },
  { value: 'included', label: 'Included with the stay' },
  { value: 'package', label: 'Covered by package' },
  { value: 'sit-down', label: 'Sit-down' },
  { value: 'grab-and-go', label: 'Grab-and-go' },
  { value: 'drivethru', label: 'Drive-thru' },
  { value: 'self-catered', label: 'Self-catered' },
];

export function ActivityEditForm({
  form,
  onChange,
  stays,
  tripTravelers,
}: {
  form: ActivityFormState;
  onChange: (form: ActivityFormState) => void;
  stays: Stay[];
  tripTravelers: Traveler[];
}) {
  const hasOptions = form.options.length > 0;

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
      <DateTimeFieldPair
        dateLabel="Ends date"
        timeLabel="Ends time"
        dateValue={form.endsDate}
        timeValue={form.endsTime}
        onDateChange={(v) => onChange({ ...form, endsDate: v })}
        onTimeChange={(v) => onChange({ ...form, endsTime: v })}
      />
      <TextField
        select
        label="Fuzzy time (used only when Starts has a date but no time, and Ends is blank)"
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
      {!hasOptions && (
        <TextField
          select
          label="Dining format"
          value={form.diningFormat}
          onChange={(e) => onChange({ ...form, diningFormat: e.target.value as DiningFormat | '' })}
        >
          {DINING_FORMAT_OPTIONS.map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
        </TextField>
      )}

      <Divider />
      <MealOptionList
        options={form.options}
        stays={stays}
        onChange={(options) => onChange({ ...form, options })}
      />

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
