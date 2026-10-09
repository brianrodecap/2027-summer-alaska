import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';

import {
  type BookingFormValue,
  hasItemizedFixedCharges,
  hasVaryingFares,
} from '../../model/bookingFormValue';
import { bookingFares, bookingFixedCharges } from '../../model/bookings';
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
//
// The price is two fields, matching Pricing's two parts: what each traveler
// pays, and what the booking costs regardless of headcount (a room, a fee).
// Either goes read-only when it can't be one number — fares that differ by
// traveler, or several itemized fixed charges — and Save keeps it as is.
export function BookingFields({
  value,
  onChange,
  isMeal = false,
}: {
  value: BookingFormValue;
  onChange: (value: BookingFormValue) => void;
  isMeal?: boolean;
}) {
  const varyingFares = hasVaryingFares(value);
  const itemizedFixed = hasItemizedFixedCharges(value);
  const { covers } = value;
  const fareCount = bookingFares(value.base)?.length ?? 0;
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
          <TextField
            label="Confirmation #"
            value={value.confirmationNumber}
            onChange={(e) => onChange({ ...value, confirmationNumber: e.target.value })}
            fullWidth
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label="Per person"
              type="number"
              value={varyingFares ? '' : value.perPersonAmount}
              onChange={(e) => onChange({ ...value, perPersonAmount: e.target.value })}
              disabled={varyingFares}
              helperText={
                varyingFares
                  ? 'Varies by traveler'
                  : fareCount
                    ? `× ${fareCount} travelers`
                    : 'Grows with each traveler'
              }
              fullWidth
            />
            <TextField
              label="Fixed"
              type="number"
              value={itemizedFixed ? '' : value.fixedAmount}
              onChange={(e) => onChange({ ...value, fixedAmount: e.target.value })}
              disabled={itemizedFixed}
              helperText={
                itemizedFixed
                  ? (bookingFixedCharges(value.base) ?? []).map((c) => c.label).join(', ')
                  : 'Room, fees — same for any party size'
              }
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
