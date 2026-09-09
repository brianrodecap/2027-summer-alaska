import Stack from '@mui/material/Stack';

import type { StayFormState, TransitFormState } from '../../model/editForms';
import { DateTimeFieldPair } from './DateTimeFieldPair';
import { PlaceConditionsTogglesFor } from './PlaceConditionsToggles';
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
    <Stack spacing={2}>
      <PlacePickerField
        label="Lodging name"
        place={form.place}
        onChange={(place) => onChange({ ...form, place })}
      />
      <PlaceConditionsTogglesFor
        place={form.place}
        onPlaceChange={(place) => onChange({ ...form, place })}
      />
    </Stack>
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

// From/To share everything but their label and copy — kept as one local
// component so the two endpoints can't drift.
function TransitEndpointField({
  label,
  side,
  form,
  onChange,
}: {
  label: string;
  side: 'from' | 'to';
  form: TransitFormState;
  onChange: (form: TransitFormState) => void;
}) {
  const place = form[side];
  const copy = side === 'from' ? 'departure' : 'arrival';
  return (
    <Stack spacing={2} sx={{ flex: 1 }}>
      <PlacePickerField
        label={label}
        place={place}
        onChange={(place) => onChange({ ...form, [side]: place ?? { id: null, label: '' } })}
      />
      <PlaceConditionsTogglesFor
        place={place}
        onPlaceChange={(place) => onChange({ ...form, [side]: place })}
        weatherLabel={`Show weather (${copy})`}
        elevationLabel={`Show elevation (${copy})`}
      />
    </Stack>
  );
}

export function TransitEndpointFields({
  form,
  onChange,
}: {
  form: TransitFormState;
  onChange: (form: TransitFormState) => void;
}) {
  return (
    <Stack direction="row" spacing={2}>
      <TransitEndpointField label="From" side="from" form={form} onChange={onChange} />
      <TransitEndpointField label="To" side="to" form={form} onChange={onChange} />
    </Stack>
  );
}
