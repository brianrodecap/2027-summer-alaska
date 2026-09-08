import Stack from '@mui/material/Stack';

import type { StayFormState, TransitFormState } from '../../model/editForms';
import { DateTimeFieldPair } from './DateTimeFieldPair';
import { PlacePickerField } from './PlacePickerField';

// The Stay/Transit field groups both edit paths share — the guided wizard
// (one group per step, see renderWizardStep) and EditDialog's flat forms
// (all groups stacked in one view). Same reason PlaceConditionsToggles and
// DateTimeFieldPair live here rather than in either caller: EditContext's
// via: 'wizard' | 'flat' split means both are genuinely reachable, and a
// field defined in only one of them silently drifts from the other.
//
// These live under edit/ rather than wizard/ deliberately: WizardShell is a
// lazily-loaded chunk of its own, so pointing the flat forms at it would drag
// the whole wizard into EditDialog's bundle.

export function LodgingField({
  form,
  onChange,
}: {
  form: StayFormState;
  onChange: (form: StayFormState) => void;
}) {
  return (
    <PlacePickerField
      label="Lodging name"
      place={form.place}
      onChange={(place) => onChange({ ...form, place })}
    />
  );
}

export function StayWhenFields({
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

// TransitFormState.from/to are non-nullable Place, so clearing a picker has
// to re-inflate the empty sentinel — keeping that literal in one place is
// half the point of this component.
export function TransitEndpointFields({
  form,
  onChange,
}: {
  form: TransitFormState;
  onChange: (form: TransitFormState) => void;
}) {
  return (
    <Stack direction="row" spacing={2}>
      <PlacePickerField
        label="From"
        place={form.from}
        onChange={(place) => onChange({ ...form, from: place ?? { id: null, label: '' } })}
      />
      <PlacePickerField
        label="To"
        place={form.to}
        onChange={(place) => onChange({ ...form, to: place ?? { id: null, label: '' } })}
      />
    </Stack>
  );
}
