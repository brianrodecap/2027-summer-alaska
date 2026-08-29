import Checkbox from '@mui/material/Checkbox';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

import type {
  ActivityFormState,
  MealDecision,
  StayFormState,
  TransitFormState,
  WizardCategory,
} from '../../model/editForms';
import {
  DINING_FORMATS_WITH_INCLUDED_IN,
  routeSelectOptions,
  WIZARD_CATEGORY_META,
} from '../../model/editForms';
import { DINING_FORMAT_LABEL } from '../../model/formatting';
import { formatDateLabel, formatTime, transitRouteLabel } from '../../model/tripModel';
import type {
  Activity,
  DiningFormat,
  MealType,
  Priority,
  Route,
  Scenario,
  Stay,
  TimeLabel,
  Transit,
  Traveler,
} from '../../model/types';
import { BookingFields } from '../edit/BookingFields';
import type { BookingFormValue } from '../edit/bookingFormValue';
import { DateTimeFieldPair } from '../edit/DateTimeFieldPair';
import { DurationSelect } from '../edit/DurationSelect';
import { IncludedInField } from '../edit/IncludedInField';
import { MealOptionList } from '../edit/MealOptionList';
import { PlacePickerField } from '../edit/PlacePickerField';

// ---------- shared "pick one of a few cards" control, used by the category
// question and the meal decided/still-deciding question ----------

function ChoiceCards<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; helper?: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <Stack spacing={1}>
      {options.map((o) => (
        <Paper
          key={o.value}
          variant="outlined"
          onClick={() => onChange(o.value)}
          sx={{
            p: 1.5,
            cursor: 'pointer',
            borderColor: value === o.value ? 'primary.main' : 'divider',
            borderWidth: value === o.value ? 2 : 1,
            bgcolor: value === o.value ? 'primary.container' : undefined,
          }}
        >
          <Typography
            variant="subtitle2"
            color={value === o.value ? 'primary.onContainer' : undefined}
          >
            {o.label}
          </Typography>
          {o.helper && (
            <Typography
              variant="body2"
              color={value === o.value ? 'primary.onContainer' : 'text.secondary'}
            >
              {o.helper}
            </Typography>
          )}
        </Paper>
      ))}
    </Stack>
  );
}

// ---------- category / meal-branch ----------

const CATEGORY_ORDER: WizardCategory[] = ['stay', 'meal', 'transit', 'activity', 'scenario'];

export function CategoryStep({
  value,
  onChange,
}: {
  value: WizardCategory;
  onChange: (value: WizardCategory) => void;
}) {
  return (
    <ChoiceCards
      options={CATEGORY_ORDER.map((c) => ({ value: c, ...WIZARD_CATEGORY_META[c] }))}
      value={value}
      onChange={onChange}
    />
  );
}

export function MealBranchStep({
  isMeal,
  onChange,
}: {
  isMeal: boolean;
  onChange: (isMeal: boolean) => void;
}) {
  return (
    <ChoiceCards
      options={[
        {
          value: 'yes',
          label: "Yes, it's a meal",
          helper: 'Breakfast, lunch, dinner, or a snack.',
        },
        { value: 'no', label: 'No, just an activity', helper: 'A hike, tour, or anything else.' },
      ]}
      value={isMeal ? 'yes' : 'no'}
      onChange={(v) => onChange(v === 'yes')}
    />
  );
}

// ---------- Stay ----------

export function StayDetailsStep({
  form,
  onChange,
}: {
  form: StayFormState;
  onChange: (form: StayFormState) => void;
}) {
  return (
    <TextField
      label="Lodging name"
      value={form.lodgingName}
      onChange={(e) => onChange({ ...form, lodgingName: e.target.value })}
      fullWidth
      autoFocus
    />
  );
}

export function StayWhenStep({
  form,
  onChange,
}: {
  form: StayFormState;
  onChange: (form: StayFormState) => void;
}) {
  return (
    <Stack spacing={2}>
      <DateTimeFieldPair
        dateLabel="Check-in date"
        timeLabel="Check-in time"
        dateValue={form.checkInDate}
        timeValue={form.checkInTime}
        onDateChange={(v) => onChange({ ...form, checkInDate: v })}
        onTimeChange={(v) => onChange({ ...form, checkInTime: v })}
      />
      <DateTimeFieldPair
        dateLabel="Check-out date"
        timeLabel="Check-out time"
        dateValue={form.checkOutDate}
        timeValue={form.checkOutTime}
        onDateChange={(v) => onChange({ ...form, checkOutDate: v })}
        onTimeChange={(v) => onChange({ ...form, checkOutTime: v })}
      />
    </Stack>
  );
}

// ---------- Transit ----------

export function TransitWhereStep({
  form,
  onChange,
}: {
  form: TransitFormState;
  onChange: (form: TransitFormState) => void;
}) {
  return (
    <Stack direction="row" spacing={2}>
      <TextField
        label="From"
        value={form.fromLabel}
        onChange={(e) => onChange({ ...form, fromLabel: e.target.value })}
        fullWidth
        autoFocus
      />
      <TextField
        label="To"
        value={form.toLabel}
        onChange={(e) => onChange({ ...form, toLabel: e.target.value })}
        fullWidth
      />
    </Stack>
  );
}

export function TransitRouteStep({
  form,
  onChange,
  routes,
}: {
  form: TransitFormState;
  onChange: (form: TransitFormState) => void;
  routes: Route[];
}) {
  const selectedRoute = routes.find((r) => r._id === form.routeId) ?? null;
  return (
    <Stack spacing={2}>
      <TextField
        select
        label="Route"
        value={form.routeId ?? ''}
        onChange={(e) => {
          const routeId = e.target.value || null;
          const route = routes.find((r) => r._id === routeId) ?? null;
          onChange({ ...form, routeId, routeVariant: route?.variants[0]?.tone ?? null });
        }}
      >
        {routeSelectOptions(routes).map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </TextField>
      {selectedRoute && (
        <TextField
          select
          label="Route variant"
          value={form.routeVariant ?? ''}
          onChange={(e) => onChange({ ...form, routeVariant: e.target.value || null })}
        >
          {selectedRoute.variants.map((v) => (
            <MenuItem key={v.tone} value={v.tone}>
              {v.label}
            </MenuItem>
          ))}
        </TextField>
      )}
    </Stack>
  );
}

export function TransitWhenStep({
  form,
  onChange,
}: {
  form: TransitFormState;
  onChange: (form: TransitFormState) => void;
}) {
  const hasRoute = Boolean(form.routeId);
  return (
    <Stack spacing={2}>
      <DateTimeFieldPair
        dateLabel="Departs date"
        timeLabel="Departs time"
        dateValue={form.departsDate}
        timeValue={form.departsTime}
        onDateChange={(v) => onChange({ ...form, departsDate: v })}
        onTimeChange={(v) => onChange({ ...form, departsTime: v })}
      />
      {hasRoute ? (
        <Typography variant="body2" color="text.secondary">
          Arrival is computed from the selected route's own drive times, updated live as it's
          picked.
        </Typography>
      ) : (
        <DateTimeFieldPair
          dateLabel="Arrives date"
          timeLabel="Arrives time"
          dateValue={form.arrivesDate}
          timeValue={form.arrivesTime}
          onDateChange={(v) => onChange({ ...form, arrivesDate: v })}
          onTimeChange={(v) => onChange({ ...form, arrivesTime: v })}
        />
      )}
    </Stack>
  );
}

// ---------- Activity / Meal "when" (shared — both are plain Activity
// fields) ----------

const TIME_LABEL_OPTIONS: { value: TimeLabel | ''; label: string }[] = [
  { value: '', label: 'None' },
  { value: 'Morning', label: 'Morning' },
  { value: 'Afternoon', label: 'Afternoon' },
  { value: 'Evening', label: 'Evening' },
  { value: 'All day', label: 'All day' },
];

export function ActivityWhenStep({
  form,
  onChange,
}: {
  form: ActivityFormState;
  onChange: (form: ActivityFormState) => void;
}) {
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
    </Stack>
  );
}

// ---------- generic Activity ----------

export function ActivityWhatStep({
  form,
  onChange,
}: {
  form: ActivityFormState;
  onChange: (form: ActivityFormState) => void;
}) {
  return (
    <TextField
      label="Description"
      value={form.text}
      onChange={(e) => onChange({ ...form, text: e.target.value })}
      required
      fullWidth
      autoFocus
    />
  );
}

export function ActivityPlaceStep({
  form,
  onChange,
}: {
  form: ActivityFormState;
  onChange: (form: ActivityFormState) => void;
}) {
  return <PlacePickerField place={form.place} onChange={(place) => onChange({ ...form, place })} />;
}

const PRIORITY_OPTIONS: { value: Priority | ''; label: string }[] = [
  { value: '', label: 'None' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export function ExtrasStep({
  form,
  onChange,
  tripTravelers,
}: {
  form: ActivityFormState;
  onChange: (form: ActivityFormState) => void;
  tripTravelers: Traveler[];
}) {
  return (
    <Stack spacing={2}>
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
      {tripTravelers.length > 0 && (
        <Stack>
          <Typography variant="overline" color="text.secondary">
            Travelers (excursions only — leave all unchecked for everyone)
          </Typography>
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
      )}
    </Stack>
  );
}

// ---------- Meal ----------

const MEAL_TYPE_OPTIONS: { value: MealType | ''; label: string }[] = [
  { value: '', label: 'Not sure yet' },
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' },
];

export function MealWhatStep({
  form,
  onChange,
}: {
  form: ActivityFormState;
  onChange: (form: ActivityFormState) => void;
}) {
  return (
    <Stack spacing={2}>
      <TextField
        select
        label="Meal"
        value={form.mealType}
        onChange={(e) => onChange({ ...form, mealType: e.target.value as MealType | '' })}
      >
        {MEAL_TYPE_OPTIONS.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        label="Description"
        value={form.text}
        onChange={(e) => onChange({ ...form, text: e.target.value })}
        required
        fullWidth
        placeholder="e.g. Dinner at the lodge"
      />
    </Stack>
  );
}

export function MealDecisionStep({
  decision,
  onChange,
}: {
  decision: MealDecision;
  onChange: (decision: MealDecision) => void;
}) {
  return (
    <ChoiceCards
      options={[
        { value: 'decided' as const, label: 'Yes, I know the place' },
        {
          value: 'undecided' as const,
          label: 'Still deciding between a few',
          helper: 'List every candidate — they show up as switchable tabs on the day.',
        },
      ]}
      value={decision}
      onChange={onChange}
    />
  );
}

const DINING_FORMAT_OPTIONS: { value: DiningFormat | ''; label: string }[] = [
  { value: '', label: 'None' },
  { value: 'included', label: 'Included with the stay' },
  { value: 'package', label: 'Covered by package' },
  { value: 'included-with-activity', label: 'Included with another activity' },
  { value: 'included-with-transit', label: 'Included with travel' },
  { value: 'sit-down', label: 'Sit-down' },
  { value: 'grab-and-go', label: 'Grab-and-go' },
  { value: 'drivethru', label: 'Drive-thru' },
  { value: 'self-catered', label: 'Self-catered' },
];

export function MealPlaceStep({
  form,
  onChange,
  stays,
  activities,
  transits,
}: {
  form: ActivityFormState;
  onChange: (form: ActivityFormState) => void;
  stays: Stay[];
  activities: Activity[];
  transits: Transit[];
}) {
  return (
    <Stack spacing={2}>
      <PlacePickerField place={form.place} onChange={(place) => onChange({ ...form, place })} />
      <TextField
        select
        label="Dining format"
        value={form.diningFormat}
        onChange={(e) => {
          const diningFormat = e.target.value as DiningFormat | '';
          const includedIn = DINING_FORMATS_WITH_INCLUDED_IN.includes(diningFormat as DiningFormat)
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
      {form.diningFormat && DINING_FORMATS_WITH_INCLUDED_IN.includes(form.diningFormat) && (
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
    </Stack>
  );
}

export function MealOptionsStep({
  form,
  onChange,
  stays,
  activities,
  transits,
}: {
  form: ActivityFormState;
  onChange: (form: ActivityFormState) => void;
  stays: Stay[];
  activities: Activity[];
  transits: Transit[];
}) {
  return (
    <MealOptionList
      options={form.options}
      stays={stays}
      activities={activities}
      transits={transits}
      jumpToDate={form.startsDate}
      onChange={(options) => onChange({ ...form, options })}
    />
  );
}

// ---------- Booking (shared by every kind but Scenario) ----------

export function BookingStep({
  value,
  onChange,
}: {
  value: BookingFormValue;
  onChange: (value: BookingFormValue) => void;
}) {
  return <BookingFields value={value} onChange={onChange} />;
}

// ---------- Review ----------

export function ReviewRow({ label, value }: { label: string; value: ReactNode }) {
  if (!value) return null;
  return (
    <Stack direction="row" spacing={1}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 110 }}>
        {label}
      </Typography>
      <Typography variant="body2">{value}</Typography>
    </Stack>
  );
}

export function ReviewSection({ children }: { children: ReactNode }) {
  return (
    <Stack spacing={0.75} sx={{ mb: 1.5 }}>
      {children}
    </Stack>
  );
}

export { Divider as ReviewDivider };

function whenLabel(date: string | null, time: string | null): string | null {
  if (!date || !time) return null;
  return `${formatDateLabel(date)} at ${formatTime(`${date}T${time}`)}`;
}

export function ActivityReview({
  form,
  category,
}: {
  form: ActivityFormState;
  category: 'activity' | 'meal';
}) {
  const when =
    whenLabel(form.startsDate, form.startsTime) ??
    (form.startsDate && form.timeLabel
      ? `${formatDateLabel(form.startsDate)}, ${form.timeLabel}`
      : null);
  return (
    <ReviewSection>
      <Typography variant="subtitle1">{form.text || 'Untitled'}</Typography>
      <ReviewRow label="When" value={when} />
      {category === 'meal' && <ReviewRow label="Meal" value={form.mealType || null} />}
      {form.options.length > 0 ? (
        <ReviewRow label="Candidates" value={`${form.options.length} still being considered`} />
      ) : (
        <>
          <ReviewRow label="Place" value={form.place?.label} />
          <ReviewRow
            label="Dining"
            value={form.diningFormat ? DINING_FORMAT_LABEL[form.diningFormat] : null}
          />
        </>
      )}
      <ReviewRow label="Priority" value={form.priority || null} />
      <ReviewRow label="Booking" value={form.booking.hasBooking ? 'Booked / reserved' : null} />
    </ReviewSection>
  );
}

export function StayReview({ form }: { form: StayFormState }) {
  return (
    <ReviewSection>
      <Typography variant="subtitle1">{form.lodgingName || 'Untitled stay'}</Typography>
      <ReviewRow label="Check-in" value={whenLabel(form.checkInDate, form.checkInTime)} />
      <ReviewRow label="Check-out" value={whenLabel(form.checkOutDate, form.checkOutTime)} />
      <ReviewRow label="Booking" value={form.booking.hasBooking ? 'Booked / reserved' : null} />
    </ReviewSection>
  );
}

export function TransitReview({ form, routes }: { form: TransitFormState; routes: Route[] }) {
  const route = routes.find((r) => r._id === form.routeId) ?? null;
  return (
    <ReviewSection>
      <Typography variant="subtitle1">
        {form.fromLabel || '?'} → {form.toLabel || '?'}
      </Typography>
      <ReviewRow label="Departs" value={whenLabel(form.departsDate, form.departsTime)} />
      <ReviewRow
        label="Route"
        value={
          route
            ? transitRouteLabel(route)
            : `Arrives ${whenLabel(form.arrivesDate, form.arrivesTime) ?? '?'}`
        }
      />
      <ReviewRow label="Booking" value={form.booking.hasBooking ? 'Booked / reserved' : null} />
    </ReviewSection>
  );
}

export function ScenarioReview({ form }: { form: Scenario }) {
  return (
    <ReviewSection>
      <Typography variant="subtitle1">{form.label || 'Untitled scenario'}</Typography>
      <ReviewRow label="Tone" value={form.tone} />
    </ReviewSection>
  );
}
