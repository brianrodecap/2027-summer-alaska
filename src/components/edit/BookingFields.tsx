import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import type { Booking, BookingStatus } from '../../model/types';

export interface BookingFormValue {
  hasBooking: boolean;
  status: BookingStatus;
  confirmationNumber: string;
  costAmount: string;
}

const BOOKING_STATUS_OPTIONS: { value: BookingStatus; label: string }[] = [
  { value: 'planning', label: 'Planning' },
  { value: 'booked', label: 'Booked' },
  { value: 'cancelled', label: 'Cancelled' },
];

// Booking is optional on Leg/Stay/Transit/Activity — the "Has a booking"
// checkbox is what actually decides whether one exists after Save, so the
// fields underneath render pre-filled with a blank/planning default even
// when there's no booking yet, letting this form both edit an existing
// booking and add a brand new one.
export function BookingFields({
  value,
  onChange,
}: {
  value: BookingFormValue;
  onChange: (value: BookingFormValue) => void;
}) {
  return (
    <Stack spacing={1.5}>
      <Typography variant="overline" color="text.secondary">
        Booking
      </Typography>
      <FormControlLabel
        control={
          <Checkbox
            checked={value.hasBooking}
            onChange={(e) => onChange({ ...value, hasBooking: e.target.checked })}
          />
        }
        label="Has a booking / reservation"
      />
      <TextField
        select
        label="Status"
        value={value.status}
        onChange={(e) => onChange({ ...value, status: e.target.value as BookingStatus })}
      >
        {BOOKING_STATUS_OPTIONS.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </TextField>
      <Stack direction="row" spacing={2}>
        <TextField
          label="Confirmation #"
          value={value.confirmationNumber}
          onChange={(e) => onChange({ ...value, confirmationNumber: e.target.value })}
          fullWidth
        />
        <TextField
          label="Cost"
          type="number"
          value={value.costAmount}
          onChange={(e) => onChange({ ...value, costAmount: e.target.value })}
          fullWidth
        />
      </Stack>
    </Stack>
  );
}

export function bookingFormValueFrom(booking: Booking | null | undefined): BookingFormValue {
  return {
    hasBooking: Boolean(booking),
    status: booking?.status ?? 'planning',
    confirmationNumber: booking?.confirmationNumber ?? '',
    costAmount: booking?.cost?.amount != null ? String(booking.cost.amount) : '',
  };
}

export function readBookingFormValue(
  value: BookingFormValue,
  currentBooking: Booking | null | undefined,
): Booking | null {
  if (!value.hasBooking) return null;
  return {
    status: value.status,
    confirmationNumber: value.confirmationNumber || null,
    cost: value.costAmount
      ? { amount: Number(value.costAmount), currency: currentBooking?.cost?.currency ?? 'USD' }
      : null,
  };
}
