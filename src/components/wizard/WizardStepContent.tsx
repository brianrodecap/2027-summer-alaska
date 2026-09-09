import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { type ReactNode, useState } from 'react';

import type {
  ActivityFormState,
  MealDecision,
  StayFormState,
  TransitFormState,
  WizardCategory,
} from '../../model/editForms';
import {
  applyMealTypeChange,
  blankMealOption,
  DINING_FORMAT_OPTIONS,
  DINING_FORMATS_WITH_INCLUDED_IN,
  MEAL_TYPE_VALUES,
  PRIORITY_OPTIONS,
  routeSelectOptions,
  routeVariantOptions,
  WIZARD_CATEGORY_META,
} from '../../model/editForms';
import { bookingNoun, DINING_FORMAT_LABEL } from '../../model/formatting';
import { isMealActivity } from '../../model/mealOptions';
import {
  activityHeadline,
  formatDateLabel,
  formatTime,
  transitRouteLabel,
} from '../../model/tripModel';
import type {
  Activity,
  DiningFormat,
  MealType,
  Priority,
  Route,
  Scenario,
  Stay,
  Transit,
  Traveler,
} from '../../model/types';
import { ActivityWhenFields } from '../edit/ActivityWhenFields';
import { BookingFields } from '../edit/BookingFields';
import type { BookingFormValue } from '../edit/bookingFormValue';
import { DateTimeFieldPair } from '../edit/DateTimeFieldPair';
import { IncludedInField } from '../edit/IncludedInField';
import { MealOptionList } from '../edit/MealOptionList';
import { PlaceConditionsTogglesFor } from '../edit/PlaceConditionsToggles';
import { PlacePickerField } from '../edit/PlacePickerField';
import { TravelerCheckboxList } from '../edit/TravelerCheckboxList';
import { InfoTip } from '../shared/LabelWithTip';
import { renderMaterialIcon } from '../shared/materialIcon';

// ---------- shared "pick one of a few cards" control, used by the category
// question and the meal decided/still-deciding question ----------

function ChoiceCards<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; helper?: string; icon?: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <Stack spacing={1}>
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <Paper
            key={o.value}
            variant="outlined"
            onClick={() => onChange(o.value)}
            sx={{
              p: 1.5,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              borderColor: selected ? 'primary.main' : 'divider',
              borderWidth: selected ? 2 : 1,
              bgcolor: selected ? 'primary.container' : undefined,
            }}
          >
            {o.icon &&
              renderMaterialIcon(o.icon, {
                fontSize: 'small',
                sx: { color: selected ? 'primary.onContainer' : 'text.secondary', flexShrink: 0 },
              })}
            <Typography
              variant="subtitle2"
              color={selected ? 'primary.onContainer' : undefined}
              sx={{ flexGrow: 1 }}
            >
              {o.label}
            </Typography>
            {o.helper && (
              <InfoTip tip={o.helper} color={selected ? 'primary.onContainer' : 'text.secondary'} />
            )}
          </Paper>
        );
      })}
    </Stack>
  );
}

// ---------- category / meal-branch ----------

// Computed once from WIZARD_CATEGORY_META's own key order (see that
// object's doc comment), rather than per-render, since it never changes.
const CATEGORY_OPTIONS = (Object.keys(WIZARD_CATEGORY_META) as WizardCategory[]).map((c) => ({
  value: c,
  ...WIZARD_CATEGORY_META[c],
}));

export function CategoryStep({
  value,
  onChange,
}: {
  value: WizardCategory;
  onChange: (value: WizardCategory) => void;
}) {
  return <ChoiceCards options={CATEGORY_OPTIONS} value={value} onChange={onChange} />;
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

// ---------- Stay / Transit ----------
//
// The Stay lodging/when fields and the Transit From/To pair aren't defined
// here — they're LodgingField/StayWhenFields/TransitEndpointFields in
// edit/StayTransitFields, shared verbatim with EditDialog's flat forms.
// renderWizardStep renders them directly for those step ids.

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
          {routeVariantOptions(selectedRoute).map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
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

// ---------- generic Activity ----------

export function ActivityWhereWhenStep({
  form,
  onChange,
}: {
  form: ActivityFormState;
  onChange: (form: ActivityFormState) => void;
}) {
  return (
    <Stack spacing={2}>
      <PlacePickerField place={form.place} onChange={(place) => onChange({ ...form, place })} />
      <ActivityWhenFields form={form} onChange={onChange} />
    </Stack>
  );
}

// Not a wizard step of its own any more (the 'activityWhat' step id is gone)
// — just the description field, rendered inline by DetailsStep below.
function DescriptionField({
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
      placeholder={form.place?.label}
      fullWidth
      autoFocus
    />
  );
}

// Consolidates what used to be three separate steps — description, priority
// + attendees, and booking/reservation — into one, since none of them are
// required and stepping through each individually was mostly just clicking
// Next three times in a row. Attendees only appears once a booking/
// reservation is actually on the books: without one there's nothing yet
// that could be limiting who's going, so asking earlier just adds noise.
export function DetailsStep({
  form,
  onChange,
  tripTravelers,
  showDescription,
  isMeal,
}: {
  form: ActivityFormState;
  onChange: (form: ActivityFormState) => void;
  tripTravelers: Traveler[];
  showDescription: boolean;
  isMeal: boolean;
}) {
  // A non-empty candidate list (meal-only — see applyActivityForm) means
  // reservation details were already collected per-candidate on the earlier
  // Where & When step (MealOptionList's own BookingFields), one per place
  // still in the running. A second, whole-Activity reservation field here
  // would just duplicate that — and wouldn't even mean anything, since
  // there's no single decided place left for it to describe — so it's
  // skipped, along with the attendees list that only makes sense once a
  // booking is actually on the books.
  const showBooking = !isMealActivity(form);
  return (
    <Stack spacing={2}>
      {showDescription && <DescriptionField form={form} onChange={onChange} />}
      <PlaceConditionsTogglesFor
        place={form.place}
        onPlaceChange={(place) => onChange({ ...form, place })}
      />
      <TextField
        select
        label="Priority"
        value={form.priority}
        onChange={(e) => onChange({ ...form, priority: e.target.value as Priority | '' })}
        slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
      >
        {PRIORITY_OPTIONS.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </TextField>
      {showBooking && (
        <>
          <Divider />
          <BookingFields
            isMeal={isMeal}
            value={form.booking}
            onChange={(booking) => onChange({ ...form, booking })}
          />
          {tripTravelers.length > 0 && form.booking.status && (
            <TravelerCheckboxList
              travelers={tripTravelers}
              selectedIds={form.travelerIds}
              onChange={(travelerIds) => onChange({ ...form, travelerIds })}
            />
          )}
        </>
      )}
    </Stack>
  );
}

// ---------- Meal ----------

export function MealWhatStep({
  form,
  onChange,
}: {
  form: ActivityFormState;
  onChange: (form: ActivityFormState) => void;
}) {
  return (
    <TextField
      select
      label="Meal"
      value={form.mealType}
      onChange={(e) => onChange(applyMealTypeChange(form, e.target.value as MealType | ''))}
      fullWidth
      autoFocus
    >
      {MEAL_TYPE_VALUES.map((o) => (
        <MenuItem key={o.value} value={o.value}>
          {o.label}
        </MenuItem>
      ))}
    </TextField>
  );
}

// Shown only when findDuplicateMealActivity (editForms.ts) has already found
// a same-day, same-meal-type Activity — offers to fold this in-progress meal
// into that one's options instead of letting it become a second, competing
// Activity (see mergeMealOptionIntoActivity).
export function MealDuplicateStep({
  activity,
  merge,
  onChange,
}: {
  activity: Activity;
  merge: boolean;
  onChange: (merge: boolean) => void;
}) {
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        There's already a {activity.mealType} on this day:{' '}
        <strong>{activityHeadline(activity)}</strong>
        {activity.startAt ? ` (${formatTime(activity.startAt)})` : ''}.
      </Typography>
      <ChoiceCards
        options={[
          {
            value: 'merge' as const,
            label: `Add as another option for "${activityHeadline(activity)}"`,
            helper:
              'Both show up as switchable choices on one row instead of two separate entries.',
          },
          {
            value: 'separate' as const,
            label: 'Keep this as a separate item',
            helper: "They're genuinely two different things, even though they share a meal type.",
          },
        ]}
        value={merge ? 'merge' : 'separate'}
        onChange={(v) => onChange(v === 'merge')}
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
        {
          value: 'undecided' as const,
          label: 'Still deciding between a few',
          helper: 'List every candidate — they show up as switchable tabs on the day.',
        },
        { value: 'decided' as const, label: 'Yes, I know the place' },
      ]}
      value={decision}
      onChange={onChange}
    />
  );
}

// The single-place half of MealWhereWhenStep below — a real place, plus the
// dining-format detail that only makes sense once there's exactly one of
// them (a candidate list has its own per-row dining format instead).
function MealPlaceFields({
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

// Meal's own "Where & When" — mirrors ActivityWhereWhenStep, except which
// Place picker to show is a genuine either/or: a single settled Place (see
// MealPlaceFields) or a whole candidate list (MealOptionList), decided by
// mealDecision one step earlier — `showCandidates` folds in the
// merge-into-duplicate override (mergeMealOptionIntoActivity always adds
// exactly one new candidate, so that path forces single-place mode
// regardless of what mealDecision says — see renderWizardStep.tsx).
export function MealWhereWhenStep({
  form,
  onChange,
  showCandidates,
  stays,
  activities,
  transits,
}: {
  form: ActivityFormState;
  onChange: (form: ActivityFormState) => void;
  showCandidates: boolean;
  stays: Stay[];
  activities: Activity[];
  transits: Transit[];
}) {
  // An empty candidate list otherwise shows nothing but "Add candidate" —
  // since undecided is the common default, fall back to one blank row up
  // front so there's always something to fill in rather than an extra click
  // just to get started. Editing it commits the real value through onChange,
  // same as MealOptionList's own "Add candidate" button does.
  //
  // Held in state (lazily initialized) rather than minted during render:
  // blankMealOption() calls crypto.randomUUID(), and MealOptionList keys its
  // rows on option._id, so a fresh id each render would remount the row —
  // discarding the PlacePickerField's in-progress search and focus on every
  // unrelated keystroke in this step.
  const [placeholderOption] = useState(blankMealOption);
  const options = showCandidates && form.options.length === 0 ? [placeholderOption] : form.options;

  return (
    <Stack spacing={2}>
      {showCandidates ? (
        <MealOptionList
          options={options}
          stays={stays}
          activities={activities}
          transits={transits}
          jumpToDate={form.startsDate}
          onChange={(options) => onChange({ ...form, options })}
        />
      ) : (
        <MealPlaceFields
          form={form}
          onChange={onChange}
          stays={stays}
          activities={activities}
          transits={transits}
        />
      )}
      <ActivityWhenFields form={form} onChange={onChange} />
    </Stack>
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

function BookingReviewRow({
  booking,
  isMeal = false,
}: {
  booking: BookingFormValue;
  isMeal?: boolean;
}) {
  const noun = bookingNoun(isMeal);
  return <ReviewRow label={noun.label} value={booking.status ? noun.done : null} />;
}

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
      <Typography variant="subtitle1">{form.text || form.place?.label || 'Untitled'}</Typography>
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
      <BookingReviewRow booking={form.booking} isMeal={category === 'meal'} />
    </ReviewSection>
  );
}

export function StayReview({ form }: { form: StayFormState }) {
  return (
    <ReviewSection>
      <Typography variant="subtitle1">{form.place?.label || 'Untitled stay'}</Typography>
      <ReviewRow label="Check-in" value={whenLabel(form.checkInDate, form.checkInTime)} />
      <ReviewRow label="Check-out" value={whenLabel(form.checkOutDate, form.checkOutTime)} />
      <BookingReviewRow booking={form.booking} />
    </ReviewSection>
  );
}

export function TransitReview({ form, routes }: { form: TransitFormState; routes: Route[] }) {
  const route = routes.find((r) => r._id === form.routeId) ?? null;
  return (
    <ReviewSection>
      <Typography variant="subtitle1">
        {transitRouteLabel({ from: form.from, to: form.to })}
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
      <BookingReviewRow booking={form.booking} />
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
