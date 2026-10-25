// The attachments check (attachments.check.ts): does importing a real booking
// document give the same trip data a person entered by hand from it? Pure
// pieces only — resetting the entries a document covers to placeholders,
// saving an import's review queue the way a reviewer clicking Save on every
// draft would, and comparing the result with an expected-results file kept
// beside the private documents (attachments/expected.json, never committed).
import {
  bookedThroughName,
  bookingCost,
  bookingOf,
  faresByTraveler,
  fixedCost,
  withoutOrphanBookings,
} from '../model/bookings';
import type { QueuedImport } from '../model/documentImport';
import {
  COLLECTION_FOR_KIND,
  commitEntityEdit,
  EDIT_KINDS,
  type EditKind,
  type Entity,
  findByKind,
  TRANSIT_DETAIL_KEYS,
  withTripTravelers,
} from '../model/editForms';
import { uniqueById } from '../model/formatting';
import { buildTripView, entityLabel, todayDateStr } from '../model/tripModel';
import type { Booking, BookingStatus, BudgetRow, Payable, TripData } from '../model/types';

// What a person entered from one document. Field paths are dotted
// ("lodging.place.id", "packages.0.name", "options.length"); an expected
// object or array element matches when its own keys match (extra keys on
// the actual value are fine, so a place can carry images).
export interface GoldenDocument {
  trip?: string; // the trip's slug; defaults to the only one this repo has
  // Existing entries the document covers, by id → expected fields once saved.
  entities: Record<string, Record<string, unknown>>;
  // Entries the import should add (no id known in advance). Any other new
  // entry is a finding — a duplicate where an update was due, say.
  newEntities?: { kind: EditKind; fields: Record<string, unknown> }[];
  // The booking each entry ends up pointing at, by entry id.
  bookings?: Record<string, GoldenBooking>;
  // What each entry's packages add up to, by entry id — the total and when
  // it's paid, not how the fees are named or split into lines (a resort fee
  // and its tax as one line or two cost the same).
  packageTotals?: Record<string, { total: number; payable?: Payable | 'paid' }>;
  // What the document's bookings add up to, overall and per traveler id,
  // across every booking an expected or new entry ends up on — however the
  // import splits them (one booking for a round trip, or one per leg).
  totals?: { total: number; perTraveler?: Record<string, number>; status?: BookingStatus };
  notes?: { mention?: string[]; avoid?: string[] };
}

export interface GoldenBooking {
  status?: BookingStatus;
  confirmationNumber?: string;
  bookedThrough?: string;
  perTraveler?: { travelerId: string; amount: number; ticketNumber?: string }[];
  fixedTotal?: number;
  // When every fixed charge is paid: 'paid' means no payable at all.
  fixedPayable?: Payable | 'paid';
}

export interface Finding {
  where: string;
  expected: unknown;
  actual: unknown;
}

function findEntity(data: TripData, id: string): { kind: EditKind; entity: Entity } | null {
  for (const kind of EDIT_KINDS) {
    const entity = findByKind(kind, id, data);
    if (entity) return { kind, entity };
  }
  return null;
}

// Every entry the import added: those in `after` that `before` doesn't have.
function addedEntries(before: TripData, after: TripData): { kind: EditKind; entity: Entity }[] {
  return EDIT_KINDS.flatMap((kind) =>
    (after[COLLECTION_FOR_KIND[kind]] as Entity[])
      .filter((entity) => !findByKind(kind, entity._id, before))
      .map((entity) => ({ kind, entity })),
  );
}

// The entries a document covers, as a placeholder would have them before the
// booking existed: place and rough times kept, everything the document
// supplies (booking, seats, carrier details, room details, packages) gone.
// Without this, a document already entered by hand would pass whether or
// not the import read anything at all.
export function placeholderData(data: TripData, golden: GoldenDocument): TripData {
  const ids = new Set([...Object.keys(golden.entities), ...Object.keys(golden.bookings ?? {})]);
  const reset = <E extends Entity>(entity: E): E => {
    if (!ids.has(entity._id)) return entity;
    const copy = structuredClone(entity);
    copy.bookingId = null;
    delete copy.packages;
    if ('mode' in copy) {
      for (const key of TRANSIT_DETAIL_KEYS) delete copy[key];
      delete copy.seats;
      copy.travelers = null;
    }
    if ('lodging' in copy && copy.lodging) {
      copy.lodging = { place: copy.lodging.place, roomType: null };
      delete copy.portCalls;
    }
    return copy;
  };
  // A booking a Leg shares with a reset entry (a cruise fare on its leg and
  // cabin) goes too, so the answer can't be read back off the leg.
  const resetBookings = new Set(
    [...data.stays, ...data.transits, ...data.activities]
      .filter((e) => ids.has(e._id) && e.bookingId)
      .map((e) => e.bookingId),
  );
  return withoutOrphanBookings({
    ...data,
    legs: data.legs.map((l) =>
      l.bookingId && resetBookings.has(l.bookingId) ? { ...l, bookingId: null } : l,
    ),
    stays: data.stays.map(reset),
    transits: data.transits.map(reset),
    activities: data.activities.map(reset),
  });
}

// Every queued draft saved as-is, in order, the way a reviewer clicking Save
// through the whole queue would leave the trip; plus the note texts the
// queue would offer afterwards.
export function saveQueue(
  data: TripData,
  queue: QueuedImport[],
): { data: TripData; notes: string[] } {
  let next = data;
  for (const draft of queue) {
    next = withTripTravelers(
      commitEntityEdit(next, draft.kind, draft.entity, draft.bookings),
      draft.travelers,
    );
  }
  return {
    data: withoutOrphanBookings(next),
    notes: queue.flatMap((d) => d.notes.map((n) => n.text)),
  };
}

function getPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, key) => {
    if (cur == null) return undefined;
    return (cur as Record<string, unknown>)[key];
  }, value);
}

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

// Numbers to the cent, strings ignoring case and spacing, objects by the
// expected keys only, arrays as a set of matching elements of equal length.
export function matches(expected: unknown, actual: unknown): boolean {
  if (expected === null) return actual == null;
  if (typeof expected === 'number') {
    return typeof actual === 'number' && Math.abs(expected - actual) < 0.005;
  }
  if (typeof expected === 'string') {
    return typeof actual === 'string' && normalize(expected) === normalize(actual);
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    const unused = [...actual];
    return expected.every((e) => {
      const i = unused.findIndex((a) => matches(e, a));
      if (i === -1) return false;
      unused.splice(i, 1);
      return true;
    });
  }
  if (typeof expected === 'object') {
    if (actual == null || typeof actual !== 'object') return false;
    return Object.entries(expected as Record<string, unknown>).every(([k, v]) =>
      matches(v, (actual as Record<string, unknown>)[k]),
    );
  }
  return expected === actual;
}

function fieldFindings(where: string, entity: Entity, fields: Record<string, unknown>): Finding[] {
  return Object.entries(fields).flatMap(([path, expected]) => {
    const actual = getPath(entity, path);
    return matches(expected, actual) ? [] : [{ where: `${where} ${path}`, expected, actual }];
  });
}

function bookingFindings(where: string, booking: Booking | null, golden: GoldenBooking): Finding[] {
  if (!booking) return [{ where: `${where} booking`, expected: 'a booking', actual: null }];
  const checks: [string, unknown, unknown][] = [
    ['status', golden.status, booking.status],
    ['confirmationNumber', golden.confirmationNumber, booking.confirmationNumber],
    ['bookedThrough', golden.bookedThrough, bookedThroughName(booking.bookedThrough)],
    [
      'perTraveler',
      golden.perTraveler,
      faresByTraveler(booking).map(({ travelerId, fare, ticketNumber }) => ({
        travelerId,
        amount: fare.amount,
        ticketNumber,
      })),
    ],
    ['fixedTotal', golden.fixedTotal, fixedCost(booking)?.amount ?? 0],
    ['fixedPayable', golden.fixedPayable, commonPayable(booking.pricing?.fixed ?? [])],
  ];
  return checks
    .filter(([, expected, actual]) => expected !== undefined && !matches(expected, actual))
    .map(([key, expected, actual]) => ({ where: `${where} booking ${key}`, expected, actual }));
}

// When a set of priced lines is payable: the one answer they share ('paid'
// when nothing is owed), else each distinct answer. Not bookingFormValue's
// commonPayable: this reports every answer so the check can compare it to the
// golden's, where the form helper collapses a mismatch to undefined.
function commonPayable(lines: { payable?: Payable }[]): Payable | 'paid' | (Payable | 'paid')[] {
  const distinct = [...new Set(lines.map((l) => JSON.stringify(l.payable ?? 'paid')))].map(
    (p) => JSON.parse(p) as Payable | 'paid',
  );
  return distinct.length === 1 ? distinct[0] : distinct;
}

// What an entry's packages add to the budget, read off the budget's own rows
// (so a nightly rate is counted as the Budget view counts it), and when
// they're all paid.
function packageFindings(
  where: string,
  entity: Entity,
  golden: NonNullable<GoldenDocument['packageTotals']>[string],
  budgetRows: BudgetRow[],
): Finding[] {
  const ids = new Set((entity.packages ?? []).filter((p) => p.cost).map((p) => p._id));
  const rows = budgetRows.filter((r) => r.entity === 'package' && ids.has(r.id));
  const total = rows.flatMap((r) => r.lines).reduce((sum, l) => sum + l.amount.amount, 0);
  const checks: [string, unknown, unknown][] = [
    ['total', golden.total, total],
    ['payable', golden.payable, commonPayable((entity.packages ?? []).filter((p) => p.cost))],
  ];
  return checks
    .filter(([, expected, actual]) => expected !== undefined && !matches(expected, actual))
    .map(([key, expected, actual]) => ({ where: `${where} packages ${key}`, expected, actual }));
}

// Everything that differs from what a person entered. Empty means the import
// gave the same result.
export function checkDocument(
  before: TripData,
  after: TripData,
  notes: string[],
  golden: GoldenDocument,
): Finding[] {
  const findings: Finding[] = [];
  for (const [id, fields] of Object.entries(golden.entities)) {
    const found = findEntity(after, id);
    if (!found) findings.push({ where: id, expected: 'an entry', actual: 'none' });
    else
      findings.push(
        ...fieldFindings(`${entityLabel(found.kind, found.entity)} (${id})`, found.entity, fields),
      );
  }

  const allAdded = addedEntries(before, after);
  // Matched off one by one below; what's left over is unexpected.
  const added = [...allAdded];
  for (const expected of golden.newEntities ?? []) {
    const i = added.findIndex(
      (a) => a.kind === expected.kind && !fieldFindings('', a.entity, expected.fields).length,
    );
    if (i === -1)
      findings.push({
        where: `new ${expected.kind}`,
        expected: expected.fields,
        actual: 'none like it',
      });
    else added.splice(i, 1);
  }
  for (const extra of added) {
    findings.push({
      where: `unexpected new ${extra.kind}`,
      expected: 'none',
      actual: entityLabel(extra.kind, extra.entity),
    });
  }

  for (const [id, expected] of Object.entries(golden.bookings ?? {})) {
    const found = findEntity(after, id);
    findings.push(...bookingFindings(id, found ? bookingOf(after, found.entity) : null, expected));
  }

  // Built once, and only when a document checks package totals.
  let rows: BudgetRow[] | null = null;
  const budgetRows = () =>
    (rows ??= buildTripView(after, todayDateStr()).budget.byLeg.flatMap((group) => group.rows));
  for (const [id, expected] of Object.entries(golden.packageTotals ?? {})) {
    const found = findEntity(after, id);
    if (found) findings.push(...packageFindings(id, found.entity, expected, budgetRows()));
    else findings.push({ where: `${id} packages`, expected: 'an entry', actual: 'none' });
  }

  if (golden.totals) {
    const touched = [
      ...Object.keys(golden.entities).map((id) => findEntity(after, id)?.entity),
      ...allAdded.map((a) => a.entity),
    ];
    const all = uniqueById(
      touched.map((entity) => (entity ? bookingOf(after, entity) : null)),
    ).filter((b) => b.status !== 'cancelled');
    const { status } = golden.totals;
    if (status && all.some((b) => b.status !== status)) {
      findings.push({ where: 'totals status', expected: status, actual: all.map((b) => b.status) });
    }
    const total = all.reduce((sum, b) => sum + (bookingCost(b)?.amount ?? 0), 0);
    if (!matches(golden.totals.total, total)) {
      findings.push({ where: 'totals total', expected: golden.totals.total, actual: total });
    }
    for (const [travelerId, expected] of Object.entries(golden.totals.perTraveler ?? {})) {
      const actual = all
        .flatMap((b) => b.pricing?.perTraveler ?? [])
        .filter((f) => f.travelerId === travelerId)
        .reduce((sum, f) => sum + f.fare.amount, 0);
      if (!matches(expected, actual)) {
        findings.push({ where: `totals ${travelerId}`, expected, actual });
      }
    }
  }

  const text = notes.map(normalize);
  // A mention can name alternatives ('refund|cancel'): any one will do.
  for (const word of golden.notes?.mention ?? []) {
    const anyOf = word.split('|').map(normalize);
    if (!text.some((t) => anyOf.some((w) => t.includes(w)))) {
      findings.push({ where: 'notes', expected: `mentions "${word}"`, actual: notes });
    }
  }
  for (const word of golden.notes?.avoid ?? []) {
    const hit = notes.find((n) => normalize(n).includes(normalize(word)));
    if (hit) findings.push({ where: 'notes', expected: `doesn't mention "${word}"`, actual: hit });
  }
  return findings;
}
