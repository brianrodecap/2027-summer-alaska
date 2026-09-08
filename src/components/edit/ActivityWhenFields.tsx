import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useState } from 'react';

import { type ActivityFormState, TIME_LABEL_OPTIONS } from '../../model/editForms';
import type { TimeLabel } from '../../model/types';
import { LabelWithTip } from '../shared/LabelWithTip';
import { DateStringField, TimeStringField } from './DateTimeFieldPair';
import { DurationSelect } from './DurationSelect';

// A UI-only sentinel layered on top of TimeLabel (never itself written to
// form.timeLabel/activity.timeLabel) so the "Time" select can offer
// "Specific start time" as one option among the fuzzy labels, rather than a
// separate control the two have to be kept visually in sync with.
//
// It gets its own union member rather than riding on TimeLabel: TimeLabel
// ends in `(string & {})`, so a bare 'exact' would typecheck as a genuine
// fuzzy label and nothing but convention would stop it being written to the
// form.
type TimeMode = TimeLabel | '' | 'exact';

// Built from TIME_LABEL_OPTIONS' own order (that const's doc comment already
// promises the flat ActivityEditForm and the wizard can't drift apart) with
// "Specific start time" inserted right after None, ahead of every real fuzzy
// label. Partitioned by value rather than by index, so it doesn't quietly
// depend on None happening to be TIME_LABEL_OPTIONS[0].
const WIZARD_TIME_OPTIONS: { value: TimeMode; label: string }[] = [
  ...TIME_LABEL_OPTIONS.filter((o) => o.value === ''),
  { value: 'exact', label: 'Specific start time' },
  ...TIME_LABEL_OPTIONS.filter((o) => o.value !== ''),
];

function timeModeFromForm(form: Pick<ActivityFormState, 'timeLabel' | 'startsTime'>): TimeMode {
  if (form.timeLabel) return form.timeLabel;
  if (form.startsTime) return 'exact';
  return '';
}

// The Start date/Time/(Start time)/Duration group shared by Activity's
// merged "Where & When" step and Meal's standalone "When" step. "Time" mode
// is local component state, not derived fresh from the form on every
// render, because "just picked 'Specific start time' but haven't typed one
// yet" and "None" are otherwise indistinguishable (both leave startsTime and
// timeLabel empty) — see WIZARD_TIME_OPTIONS above.
//
// Lives under edit/ rather than wizard/ deliberately, same reason as
// StayTransitFields.tsx's fields: WizardShell is a lazily-loaded chunk of
// its own, so pointing the flat ActivityEditForm at it would drag the whole
// wizard into EditDialog's bundle.
export function ActivityWhenFields({
  form,
  onChange,
}: {
  form: ActivityFormState;
  onChange: (form: ActivityFormState) => void;
}) {
  const [mode, setMode] = useState<TimeMode>(() => timeModeFromForm(form));

  return (
    <Stack spacing={2}>
      <DateStringField
        label="Start date"
        value={form.startsDate}
        onChange={(v) => onChange({ ...form, startsDate: v })}
      />
      <TextField
        select
        label={
          <LabelWithTip
            text="Time"
            tip={`Pick a specific start time if you know it, "All day" if it has no time slot of its own, or a rough part of the day otherwise — every option still places it in order.`}
          />
        }
        value={mode}
        onChange={(e) => {
          const value = e.target.value as TimeLabel | '';
          setMode(value);
          onChange(
            value === 'exact'
              ? { ...form, timeLabel: '' }
              : { ...form, timeLabel: value, startsTime: null },
          );
        }}
      >
        {WIZARD_TIME_OPTIONS.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </TextField>
      {mode === 'exact' && (
        <TimeStringField
          label="Start time"
          value={form.startsTime}
          onChange={(v) => onChange({ ...form, startsTime: v })}
        />
      )}
      <DurationSelect
        label="Duration (optional)"
        value={form.durationMinutes}
        onChange={(durationMinutes) => onChange({ ...form, durationMinutes })}
      />
    </Stack>
  );
}
