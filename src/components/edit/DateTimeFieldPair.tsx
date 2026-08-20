import Stack from '@mui/material/Stack';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { TimeField } from '@mui/x-date-pickers/TimeField';
import dayjs from 'dayjs';

// A date+time value (Activity's Starts/Ends, Stay's Check in/out, Transit's
// Departs/Arrives) as two independently-pickable real MUI inputs — a direct
// built-in replacement for the old app's hand-rolled pseudo-fields + picker
// dialogs. dayjs objects are constructed/read only at this component's own
// boundary — tripModel.ts does all date math on plain ISO strings, so
// nothing here ever hands a dayjs object back across that line.
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
      <DatePicker
        label={dateLabel}
        value={dateValue ? dayjs(dateValue, 'YYYY-MM-DD') : null}
        onChange={(value) => onDateChange(value?.isValid() ? value.format('YYYY-MM-DD') : null)}
        slotProps={{ textField: { fullWidth: true } }}
      />
      <TimeField
        label={timeLabel}
        value={timeValue ? dayjs(timeValue, 'HH:mm') : null}
        onChange={(value) => onTimeChange(value?.isValid() ? value.format('HH:mm') : null)}
        fullWidth
      />
    </Stack>
  );
}
