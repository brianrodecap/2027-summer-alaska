import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';

import { type BookingFormValue, hasPerTravelerPricing } from '../../model/bookingFormValue';
import { bookingNoun } from '../../model/formatting';
import type { BookingStatus } from '../../model/types';

const BOOKING_STATUS_OPTIONS: { value: BookingStatus | ''; label: string }[] = [
  { value: '', label: 'None' },
  { value: 'planning', label: 'Planning' },
  { value: 'booked', label: 'Booked' },
  { value: 'cancelled', label: 'Cancelled' },
];

// Booking is optional on Leg/Stay/Transit/Activity — the Status select's own
// blank "None" option is what actually decides whether one exists after
// Save, so there's no separate "Has a booking"/"Has a reservation" checkbox
// alongside it (a real BookingStatus value already means "yes, there's
// one").
//
// Callers pass the raw `isMeal` fact rather than a pre-chosen word — a meal's
// booking reads more naturally as a "reservation", and formatting.ts's
// bookingNoun owns that mapping for every site that needs it. Both describe
// the same BookingStatus data, baked directly into the Status field's own
// label ("Booking status"/"Reservation status") rather than a separate
// section heading above it — one line said the same thing twice for no
// reason.
//
// A booking covering more than one entry (a round trip's two flights) says
// so under its status, since an edit here reaches every entry it covers.
export function BookingFields({
  value,
  onChange,
  isMeal = false,
}: {
  value: BookingFormValue;
  onChange: (value: BookingFormValue) => void;
  isMeal?: boolean;
}) {
  const perTraveler = hasPerTravelerPricing(value);
  const { covers } = value;
  return (
    <Stack spacing={1.5}>
      <TextField
        select
        label={`${bookingNoun(isMeal).label} status`}
        value={value.status}
        onChange={(e) => onChange({ ...value, status: e.target.value as BookingStatus | '' })}
        slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
        helperText={covers.length > 1 ? `Covers ${covers.join(', ')}` : undefined}
      >
        {BOOKING_STATUS_OPTIONS.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </TextField>
      {value.status && (
        <>
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
              disabled={perTraveler}
              helperText={perTraveler ? 'Sum of each traveler’s fare' : undefined}
              fullWidth
            />
          </Stack>
          <TextField
            label="Booked through"
            placeholder="e.g. Capital One Travel"
            value={value.bookedThrough}
            onChange={(e) => onChange({ ...value, bookedThrough: e.target.value })}
            fullWidth
          />
        </>
      )}
    </Stack>
  );
}
