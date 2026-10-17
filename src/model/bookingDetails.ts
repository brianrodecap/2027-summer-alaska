// What a detail sheet spells out about one booking beyond its chip: what was
// paid and what is still due, each line's own payment state, and who sold it.
// Pure — the sheet's BookingDetails renders these. Payment states come from
// the budget's lineBucket, so the sheet and the budget always agree.
import { bookedThroughName } from './bookingFormValue';
import { type BookingPaymentSummary, formatLongDate, formatMoney, lineBucket } from './tripModel';
import type { Booking, Payable } from './types';

// "Paid $198.00 · Due $9,138.00 by Apr 18, 2027", one "Due" per due date.
export function paymentSummaryLine(
  booking: Booking,
  { spent, estimated, due }: BookingPaymentSummary,
): string | null {
  if (booking.status === 'cancelled') return 'Cancelled — not counted in the budget';
  const bits = [
    spent && `Paid ${formatMoney(spent)}`,
    ...due.map(({ when, amount }) => {
      const owed = `Due ${formatMoney(amount)}`;
      if (when === 'atProperty') return `${owed} at the property`;
      return when ? `${owed} by ${formatLongDate(when.dueBy)}` : owed;
    }),
    estimated && `Estimated ${formatMoney(estimated)}`,
  ].filter(Boolean);
  return bits.length ? bits.join(' · ') : null;
}

// One price line's payment state, in the same bucket the budget puts it:
// "paid Aug 6, 2026", "due Apr 18, 2027", "due at the property", "paid".
// null when there's nothing to say (an unscheduled estimate, or a cancelled
// booking's line that was never paid). A Package passes itself: its status
// and payable read the same way a booking line's do.
export function priceLineLabel(
  payable: Payable | undefined,
  booking: Pick<Booking, 'status'>,
  date: string | null,
  today: string,
): string | null {
  const paidAt = typeof payable === 'object' && 'paidAt' in payable ? payable.paidAt : null;
  const dueBy = typeof payable === 'object' && 'dueBy' in payable ? payable.dueBy : null;
  if (paidAt) return `paid ${formatLongDate(paidAt)}`;
  if (booking.status === 'cancelled') return null;
  const atProperty = payable === 'atProperty';
  switch (lineBucket(payable, booking, date, today)) {
    case 'spent':
      return atProperty ? 'paid at the property' : 'paid';
    case 'pending':
      if (dueBy) return `due ${formatLongDate(dueBy)}`;
      return atProperty ? 'due at the property' : 'due';
    case 'estimated':
      if (dueBy) return `due ${formatLongDate(dueBy)}`;
      return atProperty ? 'at the property' : null;
  }
}

// "Capital One Travel", or "Expedia · Conf# 7261" when the seller has its
// own confirmation number.
export function bookedThroughLabel(bookedThrough: Booking['bookedThrough']): string | null {
  const name = bookedThroughName(bookedThrough);
  if (!name) return null;
  const conf = typeof bookedThrough === 'object' ? bookedThrough.confirmationNumber : null;
  return conf ? `${name} · Conf# ${conf}` : name;
}
