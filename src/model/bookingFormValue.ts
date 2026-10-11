import { bookingCost, bookingFares, bookingFixedCharges } from './bookings';
import type { Booking, BookingStatus, FixedCharge, Money, PassengerFare, Payable } from './types';

// Shared by any "amount" text input that commits straight to a Money field
// (readBookingFormValue below, PackagesField's per-fee cost input) — ''
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
// edit (payment dates, ticket numbers) through Save untouched. `covers`
// names every entry the seeded booking pays for — shown as "Covers …" when a
// booking is shared (a round trip's two flights); read-only, never saved.
// The price is edited as its two parts (see Pricing): one per-person amount
// and one fixed amount, each only while it's a single number — fares that
// differ by traveler, or several itemized fixed charges, show read-only.
export interface BookingFormValue {
  id: string;
  base: Booking | null;
  covers: string[];
  status: BookingStatus | '';
  confirmationNumber: string;
  perPersonAmount: string;
  fixedAmount: string;
  // When the price is paid (see Payable) — one choice for every fare and
  // fixed charge on the booking, unless they already differ (see
  // hasMixedPayables), in which case each keeps its own.
  payable: Payable | undefined;
  bookedThrough: string;
}

// A payable as stored: a due or paid date never picked reads as paid.
function storedPayable(payable: Payable | undefined): Payable | undefined {
  if (!payable || payable === 'atProperty') return payable;
  const date = 'dueBy' in payable ? payable.dueBy : payable.paidAt;
  return date ? payable : undefined;
}

// `line` with `payable` stored as storedPayable says — left off when paid.
export function withPayable<T extends { payable?: Payable }>(
  line: T,
  payable: Payable | undefined,
): T {
  const { payable: _old, ...rest } = line;
  const stored = storedPayable(payable);
  return (stored ? { ...rest, payable: stored } : rest) as T;
}

// Booking.bookedThrough can be a plain string or a {name, confirmationNumber}
// object, but this form only ever reads/writes the name — the confirmation
// number already has its own field on Booking itself, so repeating it inside
// bookedThrough here would just be the same fact stored twice.
export function bookedThroughName(bookedThrough: Booking['bookedThrough']): string {
  if (!bookedThrough) return '';
  return typeof bookedThrough === 'string' ? bookedThrough : bookedThrough.name;
}

const payableKey = (p: Payable | undefined) => JSON.stringify(p ?? null);

// The one Payment choice every line shares; none when they differ, so it
// never depends on which line happens to be listed first.
function commonPayable(lines: { payable?: Payable }[]): Payable | undefined {
  const [first] = lines;
  return first && lines.every((l) => payableKey(l.payable) === payableKey(first.payable))
    ? first.payable
    : undefined;
}

export function bookingFormValueFrom(
  booking: Booking | null | undefined,
  covers: string[] = [],
): BookingFormValue {
  const fares = bookingFares(booking) ?? [];
  const fixed = bookingFixedCharges(booking) ?? [];
  return {
    id: booking?._id ?? crypto.randomUUID(),
    base: booking ?? null,
    covers: booking ? covers : [],
    status: booking?.status ?? '',
    confirmationNumber: booking?.confirmationNumber ?? '',
    perPersonAmount: uniformFare(fares) ? String(fares[0].fare.amount) : '',
    fixedAmount: fixed.length === 1 ? String(fixed[0].amount.amount) : '',
    payable: commonPayable([...fares, ...fixed]),
    bookedThrough: bookedThroughName(booking?.bookedThrough),
  };
}

// A fare split into payment lines (a deposit paid, the balance due by a
// date) has several lines for one traveler.
function splitFares(fares: PassengerFare[]): boolean {
  return new Set(fares.map((f) => f.travelerId)).size < fares.length;
}

function uniformFare(fares: PassengerFare[]): boolean {
  return (
    fares.length > 0 &&
    !splitFares(fares) &&
    fares.every((f) => f.fare.amount === fares[0].fare.amount)
  );
}

export function hasSplitFares(value: BookingFormValue): boolean {
  return splitFares(bookingFares(value.base) ?? []);
}

// Fares that differ by traveler (a cruise's adult and child fares), or are
// split into payment lines, can't be one per-person number, so BookingFields
// shows them read-only and Save keeps them as they are; likewise several
// itemized fixed charges.
export function hasVaryingFares(value: BookingFormValue): boolean {
  const fares = bookingFares(value.base) ?? [];
  return fares.length > 0 && !uniformFare(fares);
}

// Lines paid at different times (a fare paid now, a fee at the property)
// can't share one Payment choice, so the form leaves each as it is.
export function hasMixedPayables(value: BookingFormValue): boolean {
  const lines = [...(bookingFares(value.base) ?? []), ...(bookingFixedCharges(value.base) ?? [])];
  return lines.some((l) => payableKey(l.payable) !== payableKey(lines[0].payable));
}

export function hasItemizedFixedCharges(value: BookingFormValue): boolean {
  return (bookingFixedCharges(value.base)?.length ?? 0) > 1;
}

// The id of the Booking a form writes, without building the document —
// readBookingFormValue's own null case, else its _id.
export function bookingIdFromForm(value: BookingFormValue): string | null {
  return value.status ? value.id : null;
}

// `travelerIds` is who a per-person amount applies to when the booking has
// no fares yet — the entry's own travelers, or the whole party. A booking
// that already has fares keeps the same travelers (and ticket numbers).
export function readBookingFormValue(
  value: BookingFormValue,
  travelerIds: string[],
): Booking | null {
  if (!value.status) return null;
  const base = value.base;
  const currency = bookingCost(base)?.currency;
  const baseFares = bookingFares(base) ?? [];
  const baseFixed = bookingFixedCharges(base) ?? [];
  const perPerson = moneyFromAmountInput(value.perPersonAmount, currency);
  const fares: PassengerFare[] = hasVaryingFares(value)
    ? baseFares
    : perPerson
      ? (baseFares.length ? baseFares.map((f) => f.travelerId) : travelerIds).map((travelerId) => ({
          ...baseFares.find((f) => f.travelerId === travelerId),
          travelerId,
          fare: perPerson,
        }))
      : [];
  const fixedMoney = moneyFromAmountInput(value.fixedAmount, currency);
  const charges: FixedCharge[] = hasItemizedFixedCharges(value)
    ? baseFixed
    : fixedMoney
      ? [{ ...baseFixed[0], label: baseFixed[0]?.label ?? 'Fixed', amount: fixedMoney }]
      : [];
  // One Payment choice covers every line, unless they already differed.
  const mixed = hasMixedPayables(value);
  const perTraveler = mixed ? fares : fares.map((f) => withPayable(f, value.payable));
  const fixed = mixed ? charges : charges.map((c) => withPayable(c, value.payable));
  const pricing: Booking['pricing'] =
    perTraveler.length || fixed.length ? { perTraveler, fixed } : null;
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
