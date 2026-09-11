import type { Booking, BookingStatus, Money } from '../../model/types';

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
// rather than a separate checkbox alongside it.
export interface BookingFormValue {
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

export function bookingFormValueFrom(booking: Booking | null | undefined): BookingFormValue {
  return {
    status: booking?.status ?? '',
    confirmationNumber: booking?.confirmationNumber ?? '',
    costAmount: booking?.cost?.amount != null ? String(booking.cost.amount) : '',
    bookedThrough: bookedThroughName(booking?.bookedThrough),
  };
}

export function readBookingFormValue(
  value: BookingFormValue,
  currentBooking: Booking | null | undefined,
): Booking | null {
  if (!value.status) return null;
  return {
    status: value.status,
    confirmationNumber: value.confirmationNumber || null,
    cost: moneyFromAmountInput(value.costAmount, currentBooking?.cost?.currency),
    bookedThrough: value.bookedThrough.trim() || undefined,
  };
}
