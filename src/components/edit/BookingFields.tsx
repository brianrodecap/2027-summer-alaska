import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';

import {
  blankPaymentDue,
  type BookingFormValue,
  hasItemizedFixedCharges,
  hasMixedPayables,
  hasVaryingFares,
  paymentDueError,
} from '../../model/bookingFormValue';
import {
  bookingFares,
  bookingFixedCharges,
  fareLinesByTraveler,
  faresByTraveler,
  fixedCost,
  perTravelerCost,
} from '../../model/bookings';
import { bookingNoun } from '../../model/formatting';
import type { BookingStatus } from '../../model/types';
import { materialIcon } from '../shared/materialIcon';
import { DateStringField } from './DateTimeFieldPair';
import { PayableField } from './PayableField';
import { rowList } from './rowList';

const DeleteIcon = materialIcon('delete');

const BOOKING_STATUS_OPTIONS: { value: BookingStatus | ''; label: string }[] = [
  { value: '', label: 'None' },
  { value: 'planning', label: 'Planning' },
  { value: 'requested', label: 'Requested' },
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
// Below them, each payment due adds an amount every traveler still owes by a
// date (a balance after a deposit).
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
  const travelerCount = fareLinesByTraveler(value.base).length;
  // Read-only fares that are the same for everyone are only split oddly.
  const faresDiffer = new Set(faresByTraveler(value.base).map((f) => f.fare.amount)).size > 1;
  const paymentsDue = rowList(value.paymentsDue, (rows) =>
    onChange({ ...value, paymentsDue: rows }),
  );
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
              // Varying fares have no one per-person rate: the field shows what
              // every traveler's fare adds up to, so it says so.
              label={varyingFares ? 'Total fares' : 'Per person'}
              type="number"
              value={
                varyingFares ? (perTravelerCost(value.base)?.amount ?? '') : value.perPersonAmount
              }
              onChange={(e) => onChange({ ...value, perPersonAmount: e.target.value })}
              disabled={varyingFares}
              helperText={
                varyingFares && !faresDiffer
                  ? `${fareCount} fare lines, paid in parts`
                  : varyingFares
                    ? `${travelerCount} fares, varying by traveler`
                    : travelerCount
                      ? `× ${travelerCount} travelers`
                      : 'Grows with each traveler'
              }
              fullWidth
            />
            <TextField
              label={itemizedFixed ? 'Fixed (all charges)' : 'Fixed'}
              type="number"
              value={itemizedFixed ? (fixedCost(value.base)?.amount ?? '') : value.fixedAmount}
              onChange={(e) => onChange({ ...value, fixedAmount: e.target.value })}
              disabled={itemizedFixed}
              helperText={
                itemizedFixed
                  ? (bookingFixedCharges(value.base) ?? []).map((c) => c.label).join(' + ')
                  : 'Room, fees — same for any party size'
              }
              fullWidth
            />
          </Stack>
          {(value.perPersonAmount || value.fixedAmount || varyingFares || itemizedFixed) &&
            !hasMixedPayables(value) && (
              <PayableField
                value={value.payable}
                onChange={(payable) => onChange({ ...value, payable })}
              />
            )}
          {!varyingFares && value.perPersonAmount && (
            <>
              {value.paymentsDue.map((row, index) => (
                <Stack key={row.key} direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                  <TextField
                    label="Due per person"
                    type="number"
                    value={row.amount}
                    onChange={(e) => paymentsDue.updateAt(index, { amount: e.target.value })}
                    fullWidth
                  />
                  <DateStringField
                    label="Due by"
                    value={row.dueBy || null}
                    onChange={(next) => paymentsDue.updateAt(index, { dueBy: next ?? '' })}
                    error={paymentDueError(value, row)}
                  />
                  <IconButton aria-label="Remove" onClick={() => paymentsDue.removeAt(index)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ))}
              <Button
                size="small"
                onClick={() => paymentsDue.add(blankPaymentDue())}
                sx={{ alignSelf: 'flex-start' }}
              >
                Add a payment due
              </Button>
            </>
          )}
          <TextField
            label="Booked through"
            placeholder="e.g. Capital One Travel"
            value={value.bookedThrough}
            onChange={(e) => onChange({ ...value, bookedThrough: e.target.value })}
            fullWidth
          />
          {(value.bookedThrough.trim() || value.bookedThroughNumber) && (
            <TextField
              label="Seller's confirmation #"
              value={value.bookedThroughNumber}
              onChange={(e) => onChange({ ...value, bookedThroughNumber: e.target.value })}
              fullWidth
            />
          )}
        </>
      )}
    </Stack>
  );
}
