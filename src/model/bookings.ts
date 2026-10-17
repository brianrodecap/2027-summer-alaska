// Readers' side of the bookings collection (bookings.json). Every Leg/Stay/
// Transit/Activity/MealOption carries only a bookingId, never the booking
// itself — one booking can pay for several entities (a round-trip ticket covers
// two Transits), so it's stored once. Resolve through bookingOf rather than
// searching data.bookings by hand, and read a booking's price through
// bookingCost, never by picking at `pricing` directly.
import type {
  Activity,
  Booking,
  FixedCharge,
  Leg,
  MealOption,
  Money,
  PassengerFare,
  Payable,
  Stay,
  Transit,
  TripData,
} from './types';

const indexCache = new WeakMap<Booking[], Map<string, Booking>>();

function bookingIndex(bookings: Booking[]): Map<string, Booking> {
  let index = indexCache.get(bookings);
  if (!index) {
    index = new Map(bookings.map((b) => [b._id, b]));
    indexCache.set(bookings, index);
  }
  return index;
}

export function bookingById(bookings: Booking[], id: string | null | undefined): Booking | null {
  return id ? (bookingIndex(bookings).get(id) ?? null) : null;
}

export function bookingOf(
  data: Pick<TripData, 'bookings'>,
  entity: { bookingId?: string | null } | null | undefined,
): Booking | null {
  return bookingById(data.bookings, entity?.bookingId);
}

// Sums Money values to the cent, in the first one's currency. null for none.
export function sumMoney(amounts: Money[]): Money | null {
  if (!amounts.length) return null;
  const cents = amounts.reduce((sum, m) => sum + Math.round(m.amount * 100), 0);
  return { amount: cents / 100, currency: amounts[0].currency };
}

// The booking's total: its per-traveler fares plus its fixed charges. null
// when unpriced.
export function bookingCost(booking: Booking | null | undefined): Money | null {
  const pricing = booking?.pricing;
  if (!pricing) return null;
  return sumMoney([
    ...pricing.perTraveler.map((f) => f.fare),
    ...pricing.fixed.map((c) => c.amount),
  ]);
}

// The part of the total that grows with each traveler, and the part that
// doesn't. null when that part is empty.
export function perTravelerCost(booking: Booking | null | undefined): Money | null {
  return sumMoney((booking?.pricing?.perTraveler ?? []).map((f) => f.fare));
}

export function fixedCost(booking: Booking | null | undefined): Money | null {
  return sumMoney((booking?.pricing?.fixed ?? []).map((c) => c.amount));
}

// The per-traveler fares, or null when the booking has none.
export function bookingFares(booking: Booking | null | undefined): PassengerFare[] | null {
  const fares = booking?.pricing?.perTraveler;
  return fares?.length ? fares : null;
}

export interface TravelerPrice {
  travelerId: string;
  ticketNumber?: string;
  lines: { amount: Money; payable?: Payable }[];
}

// One entry per traveler, each with every payment line of their fare (a
// deposit paid, the balance due), in the order the booking lists them; the
// ticket number is whichever line carries one.
export function travelerPrices(booking: Booking | null | undefined): TravelerPrice[] {
  const byTraveler = new Map<string, TravelerPrice>();
  for (const f of booking?.pricing?.perTraveler ?? []) {
    const entry = byTraveler.get(f.travelerId) ?? { travelerId: f.travelerId, lines: [] };
    entry.lines.push({ amount: f.fare, payable: f.payable });
    entry.ticketNumber ??= f.ticketNumber;
    byTraveler.set(f.travelerId, entry);
  }
  return [...byTraveler.values()];
}

// One fare per traveler: a fare split into payment lines (a deposit paid, the
// balance due by a date) is still that traveler's one fare. Summed in the
// first line's currency like bookingCost: a booking is priced in one currency
// (a reviewed false positive — mixed-currency lines can't be authored).
export function faresByTraveler(
  booking: Booking | null | undefined,
): { travelerId: string; fare: Money; ticketNumber?: string }[] {
  return travelerPrices(booking).map(({ travelerId, ticketNumber, lines }) => ({
    travelerId,
    fare: sumMoney(lines.map((l) => l.amount))!,
    ticketNumber,
  }));
}

// The date a payable is still owed by, or null (paid, paid on a date, or due
// at the property).
export function payableDueBy(payable: Payable | undefined): string | null {
  return typeof payable === 'object' && payable !== null && 'dueBy' in payable
    ? payable.dueBy
    : null;
}

export function payableLines(
  booking: Booking | null | undefined,
): { amount: Money; payable?: Payable }[] {
  return [
    ...(booking?.pricing?.perTraveler ?? []).map((f) => ({ amount: f.fare, payable: f.payable })),
    ...(booking?.pricing?.fixed ?? []).map((c) => ({ amount: c.amount, payable: c.payable })),
  ];
}

// The last date any of a booking's lines is due by — its final payment —
// or null when nothing is owed by a date.
export function finalPaymentDue(booking: Booking | null | undefined): string | null {
  const dates = payableLines(booking)
    .map((line) => payableDueBy(line.payable))
    .filter((d): d is string => d !== null);
  return dates.length ? dates.sort().at(-1)! : null;
}

export function bookingFixedCharges(booking: Booking | null | undefined): FixedCharge[] | null {
  const fixed = booking?.pricing?.fixed;
  return fixed?.length ? fixed : null;
}

// Every entity that carries a bookingId — Legs, Stays, Transits, Activities
// and each meal candidate — walked in the order the collections list them.
// The one list of "which slots can hold a booking": referrers and orphan
// pruning both read it, so a new slot is added here once.
export type BookingReferrer =
  | { kind: 'leg'; id: string; entity: Leg }
  | { kind: 'stay'; id: string; entity: Stay }
  | { kind: 'transit'; id: string; entity: Transit }
  | { kind: 'activity'; id: string; entity: Activity }
  | { kind: 'mealOption'; id: string; entity: MealOption; meal: Activity };

type BookingHolders = Pick<TripData, 'legs' | 'stays' | 'transits' | 'activities'>;
type LegContents = Pick<TripData, 'stays' | 'transits' | 'activities'>;

function* bookingHolders(data: BookingHolders): Generator<BookingReferrer> {
  for (const l of data.legs) yield { kind: 'leg', id: l._id, entity: l };
  yield* legContentHolders(data);
}

// Everything but the Legs themselves — the slots that sit inside a Leg.
function* legContentHolders(
  data: LegContents,
): Generator<Exclude<BookingReferrer, { kind: 'leg' }>> {
  for (const s of data.stays) yield { kind: 'stay', id: s._id, entity: s };
  for (const t of data.transits) yield { kind: 'transit', id: t._id, entity: t };
  for (const a of data.activities) {
    yield { kind: 'activity', id: a._id, entity: a };
    for (const o of a.options ?? []) yield { kind: 'mealOption', id: o._id, entity: o, meal: a };
  }
}

// The distinct booking ids pointed at from inside one Leg — its Stays,
// Transits, Activities and their meal candidates (not the Leg's own).
export function bookingIdsInLeg(data: LegContents, legId: string): Set<string> {
  const ids = new Set<string>();
  for (const ref of legContentHolders(data)) {
    const refLegId = ref.kind === 'mealOption' ? ref.meal.legId : ref.entity.legId;
    if (refLegId === legId && ref.entity.bookingId) ids.add(ref.entity.bookingId);
  }
  return ids;
}

// The booking ids an entity and its own meal candidates point at.
export function bookingIdsOf(entity: {
  bookingId?: string | null;
  options?: { bookingId?: string | null }[];
}): string[] {
  return [entity.bookingId, ...(entity.options ?? []).map((o) => o.bookingId)].filter(
    (id): id is string => Boolean(id),
  );
}

// Every entity that points at bookingId — used to tell a reviewer "shared
// with OTZ → ANC, Jul 10".
export function bookingReferrers(data: BookingHolders, bookingId: string): BookingReferrer[] {
  return [...bookingHolders(data)].filter((ref) => ref.entity.bookingId === bookingId);
}

export function uniqueBookings(bookings: (Booking | null)[]): Booking[] {
  const seen = new Map<string, Booking>();
  for (const b of bookings) if (b && !seen.has(b._id)) seen.set(b._id, b);
  return [...seen.values()];
}

// `data` with every booking no entity references any more dropped — the same
// object when there are none, so a write that didn't touch bookings stays a
// no-op for them. TripDataContext.setData runs it on every write, so no edit
// path — a form Save, a delete, an AI day plan, a meal-option change — has to
// remember to.
export function withoutOrphanBookings<T extends BookingHolders & Pick<TripData, 'bookings'>>(
  data: T,
): T {
  const referenced = new Set<string>();
  for (const ref of bookingHolders(data))
    if (ref.entity.bookingId) referenced.add(ref.entity.bookingId);
  const bookings = data.bookings.filter((b) => referenced.has(b._id));
  return bookings.length === data.bookings.length ? data : { ...data, bookings };
}
