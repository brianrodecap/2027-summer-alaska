import { bookingCost, bookingFares } from './bookings';
import type { Booking, BookingStatus, Money } from './types';

// Shared by any "amount" text input that commits straight to a Money field
// (readBookingFormValue below, StayPackagesField's per-fee cost input) — ''
// means "no cost", otherwise the existing currency carries over rather than
// resetting to a hardcoded default on every edit.
export function moneyFromAmountInput(
  amount: string,
  currentCurrency: string | undefined,
): Money | null {
  return amount ? { amount: Number(amount), currency: currentCurrency ?? 'USD' } : null;
}

// '' stands in for "no booking yet" — the Status select's own blank option
// (see BookingFields) is what decides whether a booking exists after Save,
// rather than a separate checkbox alongside it. `id` is the Booking document
// this form writes — the existing one's, or a fresh id minted once when the
// form is seeded, so reading the form twice yields the same document. `base`
// is the document it was seeded from, carrying every field this form doesn't
// edit (payment dates, per-traveler fares) through Save untouched. `covers`
// names every entry the seeded booking pays for — shown as "Covers …" when a
// booking is shared (a round trip's two flights); read-only, never saved.
export interface BookingFormValue {
  id: string;
  base: Booking | null;
  covers: string[];
  status: BookingStatus | '';
  confirmationNumber: string;
  costAmount: string;
  bookedThrough: string;
}

// Booking.bookedThrough can be a plain string or a {name, confirmationNumber}
// object, but this form only ever reads/writes the name — the confirmation
// number already has its own field on Booking itself, so repeating it inside
// bookedThrough here would just be the same fact stored twice.
function bookedThroughName(bookedThrough: Booking['bookedThrough']): string {
  if (!bookedThrough) return '';
  return typeof bookedThrough === 'string' ? bookedThrough : bookedThrough.name;
}

export function bookingFormValueFrom(
  booking: Booking | null | undefined,
  covers: string[] = [],
): BookingFormValue {
  const cost = bookingCost(booking);
  return {
    id: booking?._id ?? crypto.randomUUID(),
    base: booking ?? null,
    covers: booking ? covers : [],
    status: booking?.status ?? '',
    confirmationNumber: booking?.confirmationNumber ?? '',
    costAmount: cost ? String(cost.amount) : '',
    bookedThrough: bookedThroughName(booking?.bookedThrough),
  };
}

// Per-traveler pricing is edited fare by fare, never through the single
// total field — the total is their sum (bookingCost), so typing over it would
// either contradict the fares or silently discard them. BookingFields shows
// the total read-only in that case.
export function hasPerTravelerPricing(value: BookingFormValue): boolean {
  return bookingFares(value.base) !== null;
}

// The id of the Booking a form writes, without building the document —
// readBookingFormValue's own null case, else its _id.
export function bookingIdFromForm(value: BookingFormValue): string | null {
  return value.status ? value.id : null;
}

export function readBookingFormValue(value: BookingFormValue): Booking | null {
  if (!value.status) return null;
  const base = value.base;
  const pricing: Booking['pricing'] = hasPerTravelerPricing(value)
    ? (base?.pricing ?? null)
    : (() => {
        const cost = moneyFromAmountInput(value.costAmount, bookingCost(base)?.currency);
        return cost ? { kind: 'total', cost } : null;
      })();
  const booking: Booking = {
    ...base,
    _id: value.id,
    status: value.status,
    pricing,
    confirmationNumber: value.confirmationNumber || null,
  };
  const bookedThrough = value.bookedThrough.trim();
  if (bookedThrough) booking.bookedThrough = bookedThrough;
  else delete booking.bookedThrough;
  return booking;
}
