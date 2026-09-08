import Stack from '@mui/material/Stack';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { TimeField } from '@mui/x-date-pickers/TimeField';
import dayjs from 'dayjs';

// The date half of DateTimeFieldPair below, exported standalone for a
// caller that needs a bare date picker without an adjacent time field next
// to it — the wizard's own Activity "Start date" interleaves a Time-mode
// select and a conditional time field between the two instead of showing
// them side by side (see WizardStepContent.tsx's ActivityWhenFields).
// dayjs objects are constructed/read only at this component's own boundary —
// tripModel.ts does all date math on plain ISO strings, so nothing here ever
// hands a dayjs object back across that line.
export function DateStringField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null; // 'YYYY-MM-DD'
  onChange: (value: string | null) => void;
}) {
  return (
    <DatePicker
      label={label}
      value={value ? dayjs(value, 'YYYY-MM-DD') : null}
      onChange={(v) => onChange(v?.isValid() ? v.format('YYYY-MM-DD') : null)}
      slotProps={{ textField: { fullWidth: true } }}
    />
  );
}

// The time-string counterpart to DateStringField above ('HH:mm').
export function TimeStringField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null; // 'HH:MM'
  onChange: (value: string | null) => void;
}) {
  return (
    <TimeField
      label={label}
      value={value ? dayjs(value, 'HH:mm') : null}
      onChange={(v) => onChange(v?.isValid() ? v.format('HH:mm') : null)}
      fullWidth
    />
  );
}

// A date+time value (Activity's Starts/Ends, Stay's Check in/out, Transit's
// Departs/Arrives) as two independently-pickable real MUI inputs — a direct
// built-in replacement for the old app's hand-rolled pseudo-fields + picker
// dialogs.
export function DateTimeFieldPair({
  dateLabel,
  timeLabel,
  dateValue,
  timeValue,
  onDateChange,
  onTimeChange,
}: {
  dateLabel: string;
  timeLabel: string;
  dateValue: string | null; // 'YYYY-MM-DD'
  timeValue: string | null; // 'HH:MM'
  onDateChange: (value: string | null) => void;
  onTimeChange: (value: string | null) => void;
}) {
  return (
    <Stack direction="row" spacing={2}>
      <DateStringField label={dateLabel} value={dateValue} onChange={onDateChange} />
      <TimeStringField label={timeLabel} value={timeValue} onChange={onTimeChange} />
    </Stack>
  );
}
