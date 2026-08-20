import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Divider from '@mui/material/Divider';

import { DateTimeFieldPair } from './DateTimeFieldPair';
import { BookingFields } from './BookingFields';
import type { StayFormState } from '../../model/editForms';

export function StayEditForm({ form, onChange }: { form: StayFormState; onChange: (form: StayFormState) => void }) {
  return (
    <Stack spacing={2}>
      <TextField label="Lodging name" value={form.lodgingName} onChange={(e) => onChange({ ...form, lodgingName: e.target.value })} />
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
      <Divider />
      <BookingFields value={form.booking} onChange={(booking) => onChange({ ...form, booking })} />
    </Stack>
  );
}
