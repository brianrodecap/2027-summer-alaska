// Proposed itinerary changes, checked by code (strategy S4 — see
// attachments/import-check/STRATEGIES.md). The AI reads a booking document
// with the itinerary in view and proposes, per entry, what to change in the
// trip's own field names: which placeholder a booking confirms, its new
// times, places, travelers and price. This module is the code's half, and it
// never interprets a document:
//   - validateProposal / validateFinish check a proposal against the trip,
//     and their messages go back to the AI to fix, never get repaired here;
//   - queueFromProposals turns checked proposals into review drafts.
// IMPORT_CONVENTIONS is how this trip is modeled, in one list the AI gets.
import { bookingById, bookingOf, payableLines } from './bookings';
import type { QueuedImport } from './documentImport';
import {
  blankActivity,
  blankPackage,
  blankStay,
  blankTransit,
  COLLECTION_FOR_KIND,
  decideMeal,
  DINING_FORMATS_WITH_INCLUDED_IN,
  EDIT_KINDS,
  type EditKind,
  type Entity,
  EXTRACTABLE_DINING_FORMATS,
  findByKind,
  optionFromDecided,
  setMealOptions,
} from './editForms';
import { DINING_FORMAT_LABEL, MEAL_TYPES, NOTE_KINDS } from './formatting';
import { isIsoDate } from './isoDate';
import { allPackages } from './packages';
import { addDaysStr, dateOnly, diffMinutesIso, tripDateRange } from './tripModel';
import type {
  Activity,
  Booking,
  BookingStatus,
  DiningFormat,
  MealOption,
  MealType,
  Money,
  NoteKind,
  Package,
  Payable,
  Place,
  RefEntityKind,
  SeatAssignment,
  Stay,
  Transit,
  Traveler,
  TripData,
} from './types';

// ---------- What the AI proposes ----------

export interface ProposedPlace {
  placeId?: string; // from a search_places result, or already on the trip
  label: string;
  onboard?: boolean; // a venue on the ship itself (port-call timing skips it)
}

const PACKAGE_REQUIRES = ['car', 'pet', 'none'] as const;

// One candidate for a meal still being decided.
export interface ProposedMealOption {
  place: ProposedPlace;
  diningFormat?: DiningFormat;
}

export interface ProposedPackage {
  name: string;
  key?: string; // its own name, for a meal's includedWith to point at
  cost?: { amount: number; currency?: string };
  payable?: ProposedPayable;
  per?: 'night' | 'once'; // 'once' restates a nightly fee as a flat one
  benefits?: string[];
  travelers?: string[]; // the travelers it covers when not the whole party
  // What it's only for — parking needs a car, a pet fee a pet — checked
  // against the trip, never stored. Always said, so the check always runs.
  requires: 'car' | 'pet' | 'none';
}

export interface ProposedChanges {
  checkInAt?: string;
  checkOutAt?: string;
  lodging?: ProposedPlace;
  roomType?: string;
  roomNumber?: string; // a hotel room or ship's stateroom, e.g. 'L232'
  bedConfiguration?: string;
  deckGroup?: string; // a ship's stateroom: its deck group and zone
  shipZone?: string;
  portCalls?: ProposedPortCall[]; // a cruise's stops; replaces the stay's list
  departsAt?: string;
  arrivesAt?: string;
  from?: ProposedPlace;
  to?: ProposedPlace;
  mode?: string;
  carrier?: string;
  flightNumber?: string;
  operatedBy?: string;
  aircraft?: string;
  seats?: SeatAssignment[];
  startAt?: string;
  durationMinutes?: number;
  text?: string;
  place?: ProposedPlace;
  mealType?: MealType;
  diningFormat?: DiningFormat;
  includedWith?: string; // an entry id or a new entry's key whose price covers this one
  mealOptions?: ProposedMealOption[]; // a meal still deciding: its full candidate list
  travelers?: string[] | null; // null: the whole party
  packages?: ProposedPackage[];
}

// Which changes apply to which kind of entry. A field on the wrong kind (a
// roomType on a transit) is turned down by name rather than silently dropped,
// so the AI can put it where it belongs.
const FIELDS_BY_KIND: Record<EditKind, ReadonlySet<string>> = {
  stay: new Set([
    'checkInAt',
    'checkOutAt',
    'lodging',
    'roomType',
    'roomNumber',
    'bedConfiguration',
    'deckGroup',
    'shipZone',
    'portCalls',
    'packages',
  ] satisfies (keyof ProposedChanges)[]),
  transit: new Set([
    'departsAt',
    'arrivesAt',
    'from',
    'to',
    'mode',
    'carrier',
    'flightNumber',
    'operatedBy',
    'aircraft',
    'seats',
    'travelers',
    'packages',
  ] satisfies (keyof ProposedChanges)[]),
  activity: new Set([
    'startAt',
    'durationMinutes',
    'text',
    'place',
    'mealType',
    'diningFormat',
    'includedWith',
    'mealOptions',
    'travelers',
    'packages',
  ] satisfies (keyof ProposedChanges)[]),
};

// Every priced line says when it's paid — 'paid' at booking, or a Payable —
// so the decision is made, never skipped.
export type ProposedPayable = 'paid' | Payable;

export interface ProposedPortCall {
  kind: 'port' | 'scenic';
  place: ProposedPlace;
  arrivesAt?: string;
  departsAt?: string;
}

export interface ProposedFare {
  travelerId: string;
  amount: number;
  currency?: string;
  ticketNumber?: string;
  payable: ProposedPayable;
}

export interface ProposedCharge {
  label: string;
  amount: number;
  currency?: string;
  payable: ProposedPayable;
}

export interface ProposedBooking {
  ref: string; // the same ref on every entry one booking covers
  status: BookingStatus;
  confirmationNumber?: string;
  bookedThrough?: string;
  perTraveler?: ProposedFare[];
  fixed?: ProposedCharge[];
}

export interface ChangeProposal {
  entityId?: string; // the existing entry this updates
  key?: string; // a new entry's own name, for notes and includedWith to point at
  kind: EditKind;
  legId?: string; // new entries
  date?: string; // new entries, YYYY-MM-DD
  scenarioId?: string | null; // new entries
  changes: ProposedChanges;
  booking?: ProposedBooking;
  // A candidate added to a meal still being decided (an optional breakfast
  // the lodge sells); the booking, an estimate, goes on this option.
  addOption?: { place: ProposedPlace; diningFormat: DiningFormat };
  // The drive is being put on a route in this same change, which clears the
  // arrival it has stored (the route walk gives the real one).
  onRoute?: boolean;
  why: string;
}

export interface ProposedNote {
  concerns: string; // an entry id or a new entry's key
  kind: NoteKind;
  text: string;
}

// ---------- The proposal as a tool input ----------

// The JSON schema for one proposal's fields, shared by the document import's
// propose_change and the trip chat's propose_edit, so both describe a change
// in the trip's own field names the same way.
const PLACE = {
  type: 'object',
  properties: {
    placeId: {
      type: 'string',
      description: 'From a search_places result, or already on the trip.',
    },
    label: { type: 'string' },
    onboard: {
      type: 'boolean',
      description: 'True for a venue on the ship itself (a specialty restaurant, a theater).',
    },
  },
  required: ['label'],
};

const PAYABLE = {
  description:
    "When it's paid: 'paid' at booking, 'atProperty' when charged at the property or hotel, { dueBy: 'YYYY-MM-DD' } for a payment still owed by a date, or { paidAt: 'YYYY-MM-DD' } for a payment the document says was already received on that date (a deposit).",
  anyOf: [
    { type: 'string', enum: ['paid', 'atProperty'] },
    { type: 'object', properties: { dueBy: { type: 'string' } }, required: ['dueBy'] },
    { type: 'object', properties: { paidAt: { type: 'string' } }, required: ['paidAt'] },
  ],
};

export const PROPOSAL_PROPERTIES = {
  entityId: { type: 'string', description: 'The existing entry this updates.' },
  key: {
    type: 'string',
    description: 'For a new entry: a short name notes and includedWith can use.',
  },
  kind: { type: 'string', enum: ['stay', 'transit', 'activity'] },
  legId: { type: 'string', description: 'New entries only.' },
  date: { type: 'string', description: 'New entries only: YYYY-MM-DD.' },
  scenarioId: { type: 'string', description: 'New entries only, when it belongs to one plan.' },
  changes: {
    type: 'object',
    properties: {
      checkInAt: {
        type: 'string',
        description: 'Stay. Local date-time, e.g. 2027-07-03T14:00.',
      },
      checkOutAt: { type: 'string' },
      lodging: PLACE,
      roomType: { type: 'string', description: "The room's name without its beds." },
      roomNumber: {
        type: 'string',
        description: "A room or ship's stateroom number, e.g. 'L232'.",
      },
      deckGroup: {
        type: 'string',
        description: "A ship's stateroom deck group, e.g. 'Upper'.",
      },
      shipZone: { type: 'string', description: "A ship's stateroom zone, e.g. 'Mid-Forward'." },
      portCalls: {
        type: 'array',
        description: "A cruise's stops, in order; replaces the stay's list.",
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['port', 'scenic'] },
            place: PLACE,
            arrivesAt: { type: 'string', description: 'Local date-time.' },
            departsAt: { type: 'string', description: 'All aboard, local date-time.' },
          },
          required: ['kind', 'place'],
        },
      },
      bedConfiguration: {
        type: 'string',
        description: "Every bed, extra beds included: '2 Queen + 1 Rollaway'.",
      },
      departsAt: { type: 'string', description: 'Transit.' },
      arrivesAt: { type: 'string' },
      from: PLACE,
      to: PLACE,
      mode: {
        type: 'string',
        description: "'flight', 'shuttle', 'ferry', 'bus', 'train', 'drive'.",
      },
      carrier: { type: 'string' },
      flightNumber: { type: 'string' },
      operatedBy: {
        type: 'string',
        description: 'The airline flying a codeshare, its name only.',
      },
      aircraft: { type: 'string' },
      seats: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            travelerId: { type: 'string' },
            seat: { type: 'string' },
            cabin: { type: 'string' },
            fareClass: { type: 'string' },
          },
          required: ['travelerId', 'seat'],
        },
      },
      startAt: { type: 'string', description: 'Activity.' },
      durationMinutes: { type: 'number' },
      text: { type: 'string' },
      place: PLACE,
      mealType: { type: 'string', enum: MEAL_TYPES },
      diningFormat: {
        type: 'string',
        enum: [
          ...EXTRACTABLE_DINING_FORMATS,
          'included',
          'included-with-activity',
          'included-with-transit',
          'package',
        ],
      },
      includedWith: {
        type: 'string',
        description:
          'The entry id or new key whose price covers this meal; for diningFormat package, the package’s id or key.',
      },
      mealOptions: {
        type: 'array',
        description:
          'A meal still being decided between places: every candidate (two or more), in order of preference — ' +
          'in an edit, the full list, including the ones that stay. One entry decides the meal on that place.',
        items: {
          type: 'object',
          properties: {
            place: PLACE,
            diningFormat: { type: 'string', enum: EXTRACTABLE_DINING_FORMATS },
          },
          required: ['place'],
        },
      },
      travelers: {
        type: ['array', 'null'],
        items: { type: 'string' },
        description: 'Traveler ids, or null for the whole party.',
      },
      packages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            key: {
              type: 'string',
              description: 'A short name a meal’s includedWith can use to point at this package.',
            },
            cost: {
              type: 'object',
              properties: { amount: { type: 'number' }, currency: { type: 'string' } },
              required: ['amount'],
            },
            payable: PAYABLE,
            per: { type: 'string', enum: ['night', 'once'] },
            benefits: { type: 'array', items: { type: 'string' } },
            travelers: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Traveler ids it covers, when not the whole party; an empty list restates it as the whole party.',
            },
            requires: {
              type: 'string',
              enum: PACKAGE_REQUIRES,
              description: "'car' for parking, 'pet' for a pet fee, else 'none'.",
            },
          },
          required: ['name', 'requires'],
        },
      },
    },
  },
  booking: {
    type: 'object',
    properties: {
      ref: { type: 'string', description: 'The same ref on every entry this booking covers.' },
      status: {
        type: 'string',
        enum: ['booked', 'requested', 'planning', 'cancelled'],
        description:
          "'requested' when the seller still has to confirm it (a request received, payment to be processed).",
      },
      confirmationNumber: { type: 'string' },
      bookedThrough: {
        type: 'string',
        description: 'The agency it was bought through, if not the vendor.',
      },
      perTraveler: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            travelerId: { type: 'string' },
            amount: { type: 'number' },
            currency: { type: 'string' },
            ticketNumber: { type: 'string' },
            payable: PAYABLE,
          },
          required: ['travelerId', 'amount', 'payable'],
        },
      },
      fixed: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            amount: { type: 'number' },
            currency: { type: 'string' },
            payable: PAYABLE,
          },
          required: ['label', 'amount', 'payable'],
        },
      },
    },
    required: ['ref', 'status'],
  },
  addOption: {
    type: 'object',
    description: 'A candidate on a meal still being decided; the booking (an estimate) goes on it.',
    properties: {
      place: PLACE,
      diningFormat: { type: 'string', enum: EXTRACTABLE_DINING_FORMATS },
    },
    required: ['place', 'diningFormat'],
  },
};

// Adds someone the trip doesn't have yet (addTraveler) and answers with the id
// to use for them — shared by the document import and the trip chat, so
// neither has the AI guess an id.
export const ADD_TRAVELER_TOOL = {
  name: 'add_traveler',
  description:
    "Add a traveler who isn't in the party yet. Returns their id to use in proposals. Only a passenger or guest, never the buyer alone.",
  input_schema: {
    type: 'object' as const,
    properties: {
      name: {
        type: 'string',
        description: 'Full name, as a person would write it (not "LAST/FIRST").',
      },
      age: { type: 'number', description: 'Only when it’s known.' },
    },
    required: ['name'],
  },
};

// ---------- How this trip is modeled ----------

// The user's conventions, in one place: what a person who knows this trip
// would do with a booking, which no document says. Sent with every import,
// and with the trip chat.
export const IMPORT_CONVENTIONS = [
  'Price per traveler plus fixed charges, never one lump sum: a per-person rate is a fare for each traveler it covers; a room, its taxes or a per-booking fee is a fixed charge. Taxes printed per person belong in that person’s fare. Every fare and charge says when it is paid: nothing when paid at booking, payable atProperty when the document says it is charged at the property or hotel, dueBy for a later deadline. A deposit the document says was already received, with a balance still due, splits each affected fare into two lines for that traveler: the deposit with payable { paidAt } (the date it was received, usually the confirmation date) and the balance with { dueBy }, the two amounts adding to the fare. A charge the booking requires in full to confirm was taken at booking, even when the property’s own terminal processes it.',
  'A fee the booking’s total leaves out and the party pays at the property (a resort fee, parking) is a package on the stay with payable atProperty; a nightly rate is per night, its amount the rate. Parking requires a car, a pet fee a pet.',
  'A tour sold as flights out and back is those two flights, not also an activity. What its price covers beyond the flights is one package named "Included with your tour" on the outbound, its benefits one line each. A meal it covers is the day’s meal entry, diningFormat included-with-transit, includedWith the outbound, its place where it is served (the destination unless the document says otherwise). When the meal is covered by one named package instead (a package’s own benefit), diningFormat is package and includedWith is that package’s id, or the key given to it in the same or an earlier proposal.',
  'A lodge shuttle included with a room is two transits, in at check-in and out at check-out, between the meeting point and the lodge.',
  'A cruise’s stops between embarking and disembarking are portCalls on the cabin’s stay — port for one guests go ashore at, scenic for one the ship cruises past — each with its arrival and its all-aboard departure. Embarking and disembarking are the stay’s check-in and check-out.',
  'A booking the seller still has to confirm (a request received, payment yet to be processed) has status requested.',
  'A rental car is two activities at the rental office: picking it up, which carries the booking, and dropping it off. The driving itself is the trip’s own drives, not a transit from the office back to it.',
  'A credit the booking gives (onboard credit, a shore excursion credit) is money toward spending, not a cost: a benefit line of the package it comes with, or a note — never a package with a cost.',
  'A package bought for some of the party (a cruise perk for two of four guests) lists those travelers; its name is the package’s own, without them.',
  'A meal the document offers for a fee but the party hasn’t bought is an estimate: addOption on each of that day’s meals still being decided, with a planning booking pricing it per traveler at the top of the printed range, the child price only for travelers 12 or younger.',
  'Notes are what a person wants reminding of: reservation requirements, access limits, a timing to confirm (refund terms go in finish, not a note). Stock policy text every booking from the seller carries is not a note, and the room as booked decides capacity (2 queen beds sleep 4). A fee schedule nobody paid is at most a footnote.',
  'Update the placeholder a booking confirms rather than adding a second entry. Change only what the document says — except that when it gives only one end of a trip (a tour that ends back at base at 2 PM, with no departure from the lodge printed), move the other end with it, keeping the placeholder’s planned duration.',
];

// ---------- Checking ----------

const DATE_TIME_SHAPE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

// A real local date-time ('2027-07-11T08:00'): the shape, and a calendar day
// and clock time that exist — a lenient digit pattern lets 2027-07-32T24:75
// through to the overlap and route-walk math, which would run on NaN.
export function isDateTime(value: string): boolean {
  const m = DATE_TIME_SHAPE.exec(value);
  if (!m) return false;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const at = new Date(Date.UTC(y, mo - 1, d, h, mi));
  return (
    at.getUTCFullYear() === y &&
    at.getUTCMonth() === mo - 1 &&
    at.getUTCDate() === d &&
    h < 24 &&
    mi < 60
  );
}
const BOOKING_STATUSES: BookingStatus[] = ['planning', 'requested', 'booked', 'cancelled'];

export interface ProposalState {
  data: TripData;
  searchedPlaceIds: Set<string>;
  accepted: ChangeProposal[];
  notes: ProposedNote[];
  refundTerms: RefundTerms | null; // from finish; a note on the booked entry
  // Travelers the document names who aren't on the trip yet (add_traveler);
  // they join it with the first draft saved.
  newTravelers: Traveler[];
  // Set when changes are checked again as they're applied: their place ids
  // were checked against the searches when proposed, and places don't change.
  placeIdsChecked: boolean;
}

// A booking's refund terms as finish gives them: the policy, which code acts
// on (a nonrefundable booking's note is a warning; none stated adds no note),
// and the terms as printed, for the note.
const REFUND_POLICIES = ['nonrefundable', 'partial', 'full', 'none'] as const;
export interface RefundTerms {
  policy: (typeof REFUND_POLICIES)[number];
  text?: string;
}

export const REFUND_TERMS_SCHEMA = {
  type: 'object',
  description: "The booking's refund terms.",
  properties: {
    policy: {
      type: 'string',
      enum: REFUND_POLICIES,
      description:
        "'nonrefundable'; 'partial' (some refund, or a full one only until a deadline); 'full' (refundable up to the trip); 'none' when the document states no terms.",
    },
    text: {
      type: 'string',
      description:
        "The terms as printed, each deadline with its actual date ('Full refund until Apr 12, 2027; 50% until Jun 26, 2027'). Not for 'none'.",
    },
  },
  required: ['policy'],
};

function refundNote(terms: RefundTerms | null): { kind: NoteKind; text: string } | null {
  if (!terms || terms.policy === 'none') return null;
  const text = typeof terms.text === 'string' ? terms.text.trim() : '';
  return terms.policy === 'nonrefundable'
    ? { kind: 'warning', text: text || 'Nonrefundable.' }
    : { kind: 'info', text: text || 'Refundable.' };
}

export function proposalState(data: TripData): ProposalState {
  return {
    data,
    searchedPlaceIds: new Set(),
    accepted: [],
    notes: [],
    refundTerms: null,
    newTravelers: [],
    placeIdsChecked: false,
  };
}

// Every place an entry names — its lodging, endpoints, place, meal candidates
// and port calls. The one list of place-bearing fields, so a new one is added
// here once (proposedPlaces below is its proposal-side twin).
export function entryPlaces(entry: Entity): Place[] {
  const places = [
    'lodging' in entry ? entry.lodging?.place : undefined,
    ...('portCalls' in entry ? (entry.portCalls ?? []).map((call) => call.place) : []),
    'from' in entry ? entry.from : undefined,
    'to' in entry ? entry.to : undefined,
    'place' in entry ? entry.place : undefined,
    ...('options' in entry ? (entry.options ?? []).map((o) => o.place) : []),
  ];
  return places.filter((place): place is Place => !!place);
}

// Every place a proposal names.
export function proposedPlaces({ changes, addOption }: ChangeProposal): ProposedPlace[] {
  const c: Partial<ChangeProposal['changes']> = changes ?? {};
  return [
    c.lodging,
    c.from,
    c.to,
    c.place,
    addOption?.place,
    ...(c.mealOptions ?? []).map((o) => o.place),
    ...(c.portCalls ?? []).map((call) => call.place),
  ].filter((place): place is ProposedPlace => !!place);
}

// Every traveler id a proposal names — its travelers, seats, packages and
// fares. The one list of traveler-bearing fields (withTravelerIds repoints
// the same ones), as proposedPlaces is for places.
// Read before the shape checks (shapeErrors) have run, so a field of the wrong
// shape names no one rather than throwing.
export function proposedTravelerIds({ changes, booking }: ChangeProposal): Set<string> {
  const c: Partial<Record<keyof ProposedChanges, unknown>> = changes ?? {};
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const field = (v: unknown, key: string) => (v as Record<string, unknown> | null)?.[key];
  return new Set(
    [
      ...list(c.travelers),
      ...list(c.seats).map((s) => field(s, 'travelerId')),
      ...list(c.packages).flatMap((p) => list(field(p, 'travelers'))),
      ...list(booking?.perTraveler).map((f) => field(f, 'travelerId')),
    ].filter((id): id is string => typeof id === 'string'),
  );
}

// `change` with every traveler id `ids` maps replaced.
function withTravelerIds(change: ChangeProposal, ids: ReadonlyMap<string, string>): ChangeProposal {
  if (!ids.size) return change;
  const id = (travelerId: string) => ids.get(travelerId) ?? travelerId;
  const { changes, booking } = change;
  return {
    ...change,
    changes: {
      ...changes,
      ...(changes.travelers ? { travelers: changes.travelers.map(id) } : {}),
      ...(changes.seats
        ? { seats: changes.seats.map((s) => ({ ...s, travelerId: id(s.travelerId) })) }
        : {}),
      ...(changes.packages
        ? {
            packages: changes.packages.map((p) =>
              p.travelers ? { ...p, travelers: p.travelers.map(id) } : p,
            ),
          }
        : {}),
    },
    ...(booking?.perTraveler
      ? {
          booking: {
            ...booking,
            perTraveler: booking.perTraveler.map((f) => ({ ...f, travelerId: id(f.travelerId) })),
          },
        }
      : {}),
  };
}

function knownPlaceIds(data: TripData): Set<string> {
  const entries: Entity[] = [...data.stays, ...data.transits, ...data.activities];
  return new Set(entries.flatMap(entryPlaces).flatMap((place) => (place.id ? [place.id] : [])));
}

// The entry ids, package ids and new-entry or new-package keys a note or
// includedWith can point at.
function referable(state: ProposalState): Map<string, RefEntityKind> {
  const refs = new Map<string, RefEntityKind>();
  for (const kind of EDIT_KINDS) {
    for (const e of state.data[COLLECTION_FOR_KIND[kind]] as Entity[]) refs.set(e._id, kind);
  }
  for (const pkg of allPackages(state.data)) refs.set(pkg._id, 'package');
  for (const p of state.accepted) {
    if (p.key) refs.set(p.key, p.kind);
    for (const pkg of p.changes?.packages ?? []) if (pkg.key) refs.set(pkg.key, 'package');
  }
  return refs;
}

// The tool input isn't schema-validated, so what the checks below read as a
// list or an object is confirmed to be one first — a wrong shape is an error
// the AI can fix, not a TypeError out of the checks.
export function shapeErrors(p: ChangeProposal): string[] {
  const errors: string[] = [];
  const c: Partial<Record<keyof ProposedChanges, unknown>> = p.changes ?? {};
  const isObject = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v);
  const list = (where: string, v: unknown, each: (item: unknown) => string | null) => {
    if (v === undefined) return;
    if (!Array.isArray(v)) return void errors.push(`${where} must be a list.`);
    for (const item of v) {
      const problem = each(item);
      if (problem) errors.push(`${where}: ${problem}`);
    }
  };
  if (p.changes !== undefined && !isObject(p.changes)) return ['changes must be an object.'];
  if (p.why !== undefined && typeof p.why !== 'string') errors.push('why must be text.');
  list('packages', c.packages, (v) => {
    if (!isObject(v)) return 'each package must be an object.';
    const { name, travelers, benefits } = v as {
      name?: unknown;
      travelers?: unknown;
      benefits?: unknown;
    };
    if (name !== undefined && typeof name !== 'string') return 'a package name must be text.';
    if (
      benefits !== undefined &&
      !(Array.isArray(benefits) && benefits.every((b) => typeof b === 'string'))
    ) {
      return "a package's benefits must be a list of text.";
    }
    return travelers === undefined ||
      (Array.isArray(travelers) && travelers.every((id) => typeof id === 'string'))
      ? null
      : "a package's travelers must be a list of traveler ids.";
  });
  list('seats', c.seats, (v) => {
    if (!isObject(v)) return 'each seat must be an object.';
    const seat = v as { travelerId?: unknown; seat?: unknown };
    return typeof seat.travelerId === 'string' && typeof seat.seat === 'string'
      ? null
      : 'each seat needs a travelerId and a seat.';
  });
  if (Array.isArray(c.seats) && !c.seats.length) {
    errors.push('seats is empty: leave it out to keep the seats as they are.');
  }
  list('mealOptions', c.mealOptions, (v) =>
    isObject(v) ? null : 'each option must be an object.',
  );
  list('portCalls', c.portCalls, (v) => {
    if (!isObject(v)) return 'each port call must be an object.';
    const call = v as { kind?: unknown; place?: { label?: unknown } };
    if (call.kind !== 'port' && call.kind !== 'scenic') return `kind must be 'port' or 'scenic'.`;
    return isObject(call.place) && typeof call.place?.label === 'string'
      ? null
      : 'each port call needs a place with a label.';
  });
  for (const key of [
    'text',
    'roomType',
    'roomNumber',
    'bedConfiguration',
    'deckGroup',
    'shipZone',
    'mode',
    'carrier',
    'flightNumber',
    'operatedBy',
    'aircraft',
  ] as const) {
    if (c[key] !== undefined && typeof c[key] !== 'string') errors.push(`${key} must be text.`);
  }
  for (const key of ['lodging', 'from', 'to', 'place'] as const) {
    const place = c[key] as { label?: unknown } | undefined;
    if (place !== undefined && (!isObject(place) || typeof place.label !== 'string')) {
      errors.push(`${key} must be a place with a label.`);
    }
  }
  if (
    c.durationMinutes !== undefined &&
    !(
      typeof c.durationMinutes === 'number' &&
      Number.isFinite(c.durationMinutes) &&
      c.durationMinutes > 0
    )
  ) {
    errors.push('durationMinutes must be a positive number of minutes.');
  }
  if (c.travelers != null && !Array.isArray(c.travelers)) errors.push('travelers must be a list.');
  else if (Array.isArray(c.travelers) && !c.travelers.length) {
    errors.push('travelers is empty: use null for the whole party, or list who goes.');
  } else if (Array.isArray(c.travelers) && !c.travelers.every((id) => typeof id === 'string')) {
    errors.push('travelers must list traveler ids.');
  }
  if (p.booking !== undefined) {
    if (!isObject(p.booking)) return [...errors, 'booking must be an object.'];
    const amount = (v: unknown) =>
      isObject(v) && Number.isFinite((v as { amount?: unknown }).amount)
        ? null
        : 'each line needs an amount that is a number.';
    list(
      'booking.perTraveler',
      p.booking.perTraveler,
      (v) =>
        amount(v) ??
        (typeof (v as { travelerId?: unknown }).travelerId === 'string'
          ? null
          : 'each fare needs a travelerId.'),
    );
    list('booking.fixed', p.booking.fixed, amount);
  }
  if (p.addOption !== undefined) {
    const option = p.addOption as { place?: { label?: unknown } };
    if (!isObject(option)) errors.push('addOption must be an object.');
    else if (!isObject(option.place) || typeof option.place?.label !== 'string') {
      errors.push('addOption needs a place with a label.');
    }
  }
  return errors;
}

// Every problem with one proposal, in words the AI can act on. Empty means
// it's accepted.
export function validateProposal(p: ChangeProposal, state: ProposalState): string[] {
  const errors: string[] = [];
  const { data } = state;
  // The state is fixed for this call, so what's derived from it is built once.
  let refs: Map<string, RefEntityKind> | undefined;
  const referableOnce = () => (refs ??= referable(state));
  let transits: Transit[] | undefined;
  const proposedTransitsOnce = () => (transits ??= proposedTransits(state, referableOnce));
  // The trip's drives as they'd be saved: a drive this import updates stands in
  // for its stored copy, so a moved drive isn't counted on both days.
  const drivesAsSaved = (also: Transit[] = []) => {
    const proposed = [...proposedTransitsOnce(), ...also];
    const replaced = new Set(proposed.map((t) => t._id));
    return [...data.transits.filter((t) => !replaced.has(t._id)), ...proposed];
  };
  const travelerIds = new Set([...data.trip.travelers, ...state.newTravelers].map((t) => t.id));
  if (!EDIT_KINDS.includes(p.kind)) return [`kind must be one of ${EDIT_KINDS.join(', ')}.`];
  if (typeof p.why !== 'string' || !p.why.trim())
    errors.push('Give a why: the reason a person would accept.');

  let base: Entity | undefined;
  if (p.entityId) {
    base = findByKind(p.kind, p.entityId, data);
    if (!base) errors.push(`No ${p.kind} ${p.entityId} on the itinerary.`);
    if (state.accepted.some((a) => a.entityId === p.entityId)) {
      errors.push(`${p.entityId} is already updated by an earlier proposal; combine them.`);
    }
  } else {
    // A key is only needed when a note or an included meal points at the new
    // entry; given, it must be its own.
    if (p.key && referableOnce().has(p.key)) errors.push(`The key ${p.key} is already used.`);
    if (!data.legs.some((l) => l._id === p.legId)) errors.push(`No leg ${p.legId}.`);
    if (!p.date || !isIsoDate(p.date)) errors.push('A new entry needs date as YYYY-MM-DD.');
    else {
      // Within a day of the trip's own dates (a booking can start the trip a
      // day early) — a date beyond that is a misread, or another trip's. The
      // entry's own start counts too: a stay or drive saves at checkInAt or
      // departsAt, whatever its date says.
      const range = tripDateRange(data.stays, data.transits, data.activities);
      const own = [p.date, p.changes?.checkInAt, p.changes?.departsAt]
        .filter((at): at is string => typeof at === 'string' && at.length >= 10)
        .map((at) => at.slice(0, 10));
      const outside = range
        ? own.find(
            (day) => day < addDaysStr(range.startDate, -1) || day > addDaysStr(range.endDate, 1),
          )
        : undefined;
      if (range && outside) {
        errors.push(
          `${outside} is outside this trip (${range.startDate} to ${range.endDate}). Check the date, or leave this entry out if the document is for another trip.`,
        );
      }
    }
    if (p.scenarioId && !data.scenarios.some((s) => s._id === p.scenarioId)) {
      errors.push(`No scenario ${p.scenarioId}.`);
    }
  }

  const malformed = shapeErrors(p);
  if (malformed.length) return [...errors, ...malformed];
  const c = p.changes ?? {};
  if (!p.entityId) {
    // A new entry has to say what it is and, for a booking-like one, when.
    const missing =
      p.kind === 'transit'
        ? !c.departsAt && 'departsAt'
        : p.kind === 'stay'
          ? !c.checkInAt && 'checkInAt'
          : !c.text && !c.place && !c.mealOptions?.length && 'text, a place or mealOptions';
    if (missing) errors.push(`A new ${p.kind} needs ${missing}.`);
  }
  if (!p.entityId && p.kind === 'activity' && c.startAt && p.date && isDateTime(c.startAt)) {
    // A new activity's startAt decides its day (applyChanges clears `date`).
    if (dateOnly(c.startAt) !== p.date) {
      errors.push(`startAt ${c.startAt} isn't on the entry's date ${p.date}; set date to match.`);
    }
  }
  const allowed = FIELDS_BY_KIND[p.kind];
  for (const key of Object.keys(c)) {
    if (!allowed.has(key)) {
      errors.push(
        `${key} doesn't apply to a ${p.kind}; a ${p.kind} takes ${[...allowed].join(', ')}.`,
      );
    }
  }
  for (const key of ['checkInAt', 'checkOutAt', 'departsAt', 'arrivesAt', 'startAt'] as const) {
    if (c[key] !== undefined && !isDateTime(c[key] as string)) {
      errors.push(`${key} must be a local date-time like 2027-07-11T08:00.`);
    }
  }
  if (c.mealType && !MEAL_TYPES.includes(c.mealType)) {
    errors.push(`mealType must be one of ${MEAL_TYPES.join(', ')}.`);
  }
  const formats = Object.keys(DINING_FORMAT_LABEL);
  if (c.diningFormat && !formats.includes(c.diningFormat)) {
    errors.push(`diningFormat must be one of ${formats.join(', ')}.`);
  }
  const optionFormat = p.addOption?.diningFormat;
  if (optionFormat && !EXTRACTABLE_DINING_FORMATS.includes(optionFormat)) {
    errors.push(
      `An added option's diningFormat must be one of ${EXTRACTABLE_DINING_FORMATS.join(', ')}.`,
    );
  }
  if (c.mealOptions !== undefined) {
    if (!Array.isArray(c.mealOptions) || !c.mealOptions.length) {
      errors.push('mealOptions must list at least one candidate.');
    }
    for (const option of c.mealOptions ?? []) {
      if (!option?.place?.label) errors.push('Each meal option needs a place with a label.');
      if (option?.diningFormat && !EXTRACTABLE_DINING_FORMATS.includes(option.diningFormat)) {
        errors.push(
          `A meal option's diningFormat must be one of ${EXTRACTABLE_DINING_FORMATS.join(', ')}.`,
        );
      }
    }
  }
  let knownPlaces: Set<string> | undefined;
  for (const place of state.placeIdsChecked ? [] : proposedPlaces(p)) {
    if (
      place.placeId &&
      !state.searchedPlaceIds.has(place.placeId) &&
      !(knownPlaces ??= knownPlaceIds(data)).has(place.placeId)
    ) {
      errors.push(
        `placeId ${place.placeId} didn't come from search_places or the trip; search for "${place.label}" and use a result's placeId.`,
      );
    }
  }
  for (const id of proposedTravelerIds(p)) {
    if (!travelerIds.has(id)) errors.push(`No traveler ${id} on the trip.`);
  }
  // A package this same proposal adds can be pointed at by its key too.
  const ownPackageKeys = new Set((c.packages ?? []).flatMap((pkg) => (pkg.key ? [pkg.key] : [])));
  const includedKind: RefEntityKind | undefined = !c.includedWith
    ? undefined
    : ownPackageKeys.has(c.includedWith)
      ? 'package'
      : referableOnce().get(c.includedWith);
  if (c.includedWith && !includedKind) {
    errors.push(`includedWith ${c.includedWith} isn't an entry id or an earlier proposal's key.`);
  }
  // The format a meal ends up with: the one proposed, else the one it has.
  const mealFormat = c.diningFormat ?? (base as Activity | undefined)?.diningFormat;
  if (includedKind === 'package' && mealFormat !== 'package') {
    errors.push(`includedWith ${c.includedWith} is a package: its meal's diningFormat is package.`);
  }
  if (c.diningFormat === 'package' && c.includedWith && includedKind !== 'package') {
    errors.push(`diningFormat package needs includedWith to be a package's id or key.`);
  }
  if (p.kind === 'activity') {
    const covered = !!mealFormat && DINING_FORMATS_WITH_INCLUDED_IN.includes(mealFormat);
    if (
      c.diningFormat &&
      covered &&
      !c.includedWith &&
      !(base as Activity | undefined)?.includedIn
    ) {
      errors.push(
        `diningFormat ${c.diningFormat} needs includedWith: the entry or package that covers it.`,
      );
    }
    if (c.includedWith && !covered) {
      errors.push(
        `includedWith only goes with a diningFormat that another entry covers (${DINING_FORMATS_WITH_INCLUDED_IN.join(', ')}).`,
      );
    }
  }
  const packageKeys = new Set<string>();
  for (const pkg of c.packages ?? []) {
    if (pkg.key && (referableOnce().has(pkg.key) || packageKeys.has(pkg.key))) {
      errors.push(`The key ${pkg.key} is already used.`);
    }
    if (pkg.key) packageKeys.add(pkg.key);
    // Two packages in one proposal can't share a name: a name restates a package.
    if (
      typeof pkg.name === 'string' &&
      (c.packages ?? []).filter(
        (other) =>
          typeof other?.name === 'string' &&
          other.name.trim().toLowerCase() === pkg.name.trim().toLowerCase(),
      ).length > 1
    ) {
      errors.push(
        `Two packages are named ${pkg.name}: give each its own name, e.g. "${pkg.name} (adults)".`,
      );
    }
    if (typeof pkg.name !== 'string' || !pkg.name.trim())
      errors.push('Every package needs a name.');
    if (pkg.cost && typeof pkg.cost.amount !== 'number')
      errors.push(`${pkg.name}: cost.amount must be a number.`);
    if (pkg.cost && !isPayable(pkg.payable)) errors.push(sayWhenPaid(pkg.name));
    if (pkg.per === 'night' && p.kind !== 'stay')
      errors.push(`${pkg.name}: a per-night rate belongs on a stay.`);
    if (pkg.per && pkg.per !== 'night' && pkg.per !== 'once') {
      errors.push(`${pkg.name}: per can only be 'night' or 'once'.`);
    }
    if (pkg.cost && typeof pkg.cost.amount === 'number' && !(pkg.cost.amount > 0)) {
      errors.push(`${pkg.name}: a package's cost is a positive amount; a credit isn't a package.`);
    }
    if (!PACKAGE_REQUIRES.includes(pkg.requires)) {
      errors.push(`${pkg.name}: say what it requires — 'car', 'pet' or 'none'.`);
    }
  }
  const lines = [
    ...(p.booking?.perTraveler ?? []).map((f) => ({ name: `Fare for ${f.travelerId}`, line: f })),
    ...(p.booking?.fixed ?? []).map((c) => ({ name: c.label, line: c })),
  ];
  for (const { name, line } of lines) {
    if (typeof line.amount !== 'number') errors.push(`${name}: amount must be a number.`);
    // A discount is a negative fixed charge; a fare is never below zero.
    else if (line.amount < 0 && 'travelerId' in line)
      errors.push(`${name}: a fare can't be negative.`);
    if (!isPayable(line.payable)) errors.push(sayWhenPaid(name));
  }
  if (p.booking) {
    if (typeof p.booking.ref !== 'string' || !p.booking.ref.trim()) {
      errors.push('A booking needs a ref, the same on every entry that booking covers.');
    }
    if (!BOOKING_STATUSES.includes(p.booking.status)) {
      errors.push(`A booking's status must be one of ${BOOKING_STATUSES.join(', ')}.`);
    }
    // Naming an earlier booking's ref without a price is that same booking.
    const earlier = state.accepted.find(
      (a) => a.booking?.ref === p.booking?.ref && a.booking && isPriced(a.booking),
    )?.booking;
    if (earlier && isPriced(p.booking) && !samePrice(earlier, p.booking)) {
      errors.push(
        `Booking ${p.booking.ref} was already proposed at ${describeTotal(earlier)}; this one says ${describeTotal(p.booking)}. Give one booking one price.`,
      );
    }
  }
  if (errors.length) return errors;

  // Checks on the entry as it would be saved.
  const entry = applyChanges(p, base, new Map(), referableOnce);
  if (p.kind === 'transit') {
    const t = entry as Transit;
    if (c.arrivesAt && t.routeId) {
      errors.push(
        `${p.entityId} is a routed drive: its arrival comes from the route walk, so arrivesAt can't be set. Change departsAt instead, or leave the arrival out.`,
      );
    }
    if (t.arrivesAt && diffMinutesIso(t.departsAt, t.arrivesAt) <= 0) {
      errors.push(`Arrives ${t.arrivesAt}, not after it departs ${t.departsAt}.`);
    }
  }
  if (p.kind === 'stay') {
    const s = entry as Stay;
    if (diffMinutesIso(s.checkInAt, s.checkOutAt) <= 0) {
      errors.push(`Checks out ${s.checkOutAt}, not after check-in ${s.checkInAt}.`);
    }
    // Every port call the stay ends up with — restated or already on it, since
    // moving the cruise can leave the stored ones outside it.
    const restate = c.portCalls ? '' : ' Restate portCalls for the new dates.';
    for (const call of s.portCalls ?? []) {
      const where = call.place?.label || 'A port call';
      for (const at of [call.arrivesAt, call.departsAt]) {
        if (at && !isDateTime(at)) errors.push(`${where}: times look like 2027-07-21T06:30.`);
        else if (at && (at < s.checkInAt || at > s.checkOutAt)) {
          errors.push(
            `${where} at ${at} is outside the cruise (${s.checkInAt} to ${s.checkOutAt}).${restate}`,
          );
        }
      }
      if (call.arrivesAt && call.departsAt && call.departsAt <= call.arrivesAt) {
        errors.push(`${where}: leaves ${call.departsAt}, not after it arrives ${call.arrivesAt}.`);
      }
    }
    for (const pkg of c.packages ?? []) {
      if (pkg.requires === 'car' && !drivenToOrFrom(s, drivesAsSaved())) {
        errors.push(
          `${pkg.name}: no drive arrives or leaves on this stay's check-in or check-out day, so the party has no car to park here. Leave it out.`,
        );
      }
    }
  }
  if (p.kind !== 'stay') {
    // A car-only package on a drive or an activity needs a drive that day.
    const day = p.kind === 'transit' ? (entry as Transit).departsAt : (entry as Activity).startAt;
    const date = day ? dateOnly(day) : (p.date ?? (entry as Activity).date);
    const drives = drivesAsSaved(p.kind === 'transit' ? [entry as Transit] : []);
    for (const pkg of c.packages ?? []) {
      if (
        pkg.requires === 'car' &&
        (!date || !drivenToOrFrom({ checkInAt: date, checkOutAt: date }, drives))
      ) {
        errors.push(
          `${pkg.name}: no drive happens on ${date ?? 'its day'}, so the party has no car here. Leave it out.`,
        );
      }
    }
  }
  for (const pkg of c.packages ?? []) {
    if (pkg.requires === 'pet' && !data.trip.pets) {
      errors.push(`${pkg.name}: the party isn't traveling with pets. Leave it out.`);
    }
  }
  if (p.addOption) {
    const meal = base as Activity | undefined;
    if (p.kind !== 'activity' || !meal?.mealType) {
      errors.push('addOption goes on an existing meal activity.');
    } else if (!meal.options?.length && (meal.place || meal.diningFormat)) {
      errors.push(
        `${p.entityId} is already decided; add an option only to a meal still being decided.`,
      );
    }
  }
  return errors;
}

const sayWhenPaid = (name: string) =>
  `${name}: say when it's paid — payable 'paid' (at booking), 'atProperty' (charged at the property or hotel), { dueBy: 'YYYY-MM-DD' } (still owed by a date), or { paidAt: 'YYYY-MM-DD' } (already received on a date).`;

function isPayable(value: unknown): value is ProposedPayable {
  if (value === 'paid' || value === 'atProperty') return true;
  const { dueBy, paidAt } = (value ?? {}) as { dueBy?: unknown; paidAt?: unknown };
  const date = dueBy ?? paidAt;
  return typeof date === 'string' && isIsoDate(date);
}

const isPriced = (b: ProposedBooking) => !!(b.perTraveler?.length || b.fixed?.length);

// Each booking once, by ref, with its price from the proposal that gave one
// — another entry naming the same ref (the return flight) needn't repeat it.
function bookingsByRef(accepted: ChangeProposal[]): Map<string, ProposedBooking> {
  const byRef = new Map<string, ProposedBooking>();
  for (const { booking: b } of accepted) {
    const current = b && byRef.get(b.ref);
    if (b && (!current || (isPriced(b) && !isPriced(current)))) byRef.set(b.ref, b);
  }
  return byRef;
}

// `own` (this proposal's booking) with the price from the one for its ref that
// gave it, when `own` has none. What `own` states itself (status, confirmation,
// bookedThrough) wins; what it leaves out comes from the priced one.
function withPrice(own: ProposedBooking, priced: ProposedBooking | undefined): ProposedBooking {
  if (!priced || isPriced(own)) return own;
  return {
    ...priced,
    status: own.status,
    confirmationNumber: own.confirmationNumber ?? priced.confirmationNumber,
    bookedThrough: own.bookedThrough ?? priced.bookedThrough,
  };
}

function bookingTotal(b: ProposedBooking): number {
  return (
    (b.perTraveler ?? []).reduce((sum, f) => sum + f.amount, 0) +
    (b.fixed ?? []).reduce((sum, c) => sum + c.amount, 0)
  );
}

// What the document itself bills: the lines charged at the property aren't in
// its total (finish says so), so they're left out of the check against it.
function billedTotal(b: ProposedBooking): number {
  return (
    (b.perTraveler ?? [])
      .filter((f) => f.payable !== 'atProperty')
      .reduce((sum, f) => sum + f.amount, 0) +
    (b.fixed ?? []).filter((c) => c.payable !== 'atProperty').reduce((sum, c) => sum + c.amount, 0)
  );
}

// The same booking's price on two entries: the same total and the same split
// into fares and fixed charges, since the first one proposed is the one saved
// (bookingsByRef) — so a different split must not pass as "the same price".
function samePrice(a: ProposedBooking, b: ProposedBooking): boolean {
  const split = (x: ProposedBooking) => ({
    fares: (x.perTraveler ?? [])
      .map((f) => `${f.travelerId}:${f.amount}:${JSON.stringify(f.payable)}`)
      .sort(),
    fixed: (x.fixed ?? []).map((c) => `${c.amount}:${JSON.stringify(c.payable)}`).sort(),
  });
  const [sa, sb] = [split(a), split(b)];
  return (
    Math.abs(bookingTotal(a) - bookingTotal(b)) < 0.005 &&
    sa.fares.join() === sb.fares.join() &&
    sa.fixed.join() === sb.fixed.join()
  );
}

function describeTotal(b: ProposedBooking): string {
  return bookingTotal(b).toFixed(2);
}

// Whether a proposal's booking is the one already on file: not when both
// carry a confirmation number and they differ (a new booking, not an update).
function sameConfirmation(current: Booking, proposed: ProposedBooking): boolean {
  return (
    !current.confirmationNumber ||
    !proposed.confirmationNumber ||
    current.confirmationNumber === proposed.confirmationNumber
  );
}

// The price on file for the booking a ref updates — the booking an updated
// entry already points at — or null when there's none.
function currentBookingCost(state: ProposalState, ref: string): number | null {
  for (const p of state.accepted) {
    if (p.booking?.ref !== ref || !p.entityId) continue;
    const entry = findByKind(p.kind, p.entityId, state.data);
    const booking = entry ? bookingOf(state.data, entry) : null;
    // Only a booking the queue will reuse (queueFromProposals) has its price kept.
    if (!booking?.pricing || !sameConfirmation(booking, p.booking)) continue;
    // Like billedTotal: what's charged at the property isn't in the document's total.
    return payableLines(booking)
      .filter((line) => line.payable !== 'atProperty')
      .reduce((sum, line) => sum + line.amount.amount, 0);
  }
  return null;
}

// The transits this import has proposed so far, as they'd be saved — so a
// check about the trip's drives sees the drive the same document books.
function proposedTransits(
  state: ProposalState,
  refs: () => Map<string, RefEntityKind> = () => referable(state),
): Transit[] {
  return state.accepted
    .filter((p) => p.kind === 'transit')
    .map(
      (p) =>
        applyChanges(
          p,
          p.entityId ? findByKind('transit', p.entityId, state.data) : undefined,
          new Map(),
          refs,
        ) as Transit,
    );
}

// Once every proposal is in: what the bought bookings add up to must be the
// document's own total (estimates and fees paid at the property aside).
export function validateFinish(
  state: ProposalState,
  documentTotal: { amount: number; currency?: string } | undefined,
  refundTerms: RefundTerms | undefined,
): string[] {
  if (!state.accepted.length) {
    return ['Nothing was proposed. Propose the entries this document books.'];
  }
  const errors: string[] = [];
  if (
    !refundTerms ||
    typeof refundTerms !== 'object' ||
    !REFUND_POLICIES.includes(refundTerms.policy)
  ) {
    errors.push(
      `Give refundTerms: a policy (${REFUND_POLICIES.join(', ')}) and the terms as printed.`,
    );
  } else if (
    refundTerms.policy !== 'none' &&
    (typeof refundTerms.text !== 'string' || !refundTerms.text.trim())
  ) {
    errors.push('Give refundTerms.text: the terms as printed, each deadline with its date.');
  }
  // Packages aren't in this sum on purpose (a reviewed false positive): by the
  // import's convention (IMPORT_CONVENTIONS) a package is what the booking's
  // total leaves out — paid at the property — or what it already includes, so
  // none adds to the printed total.
  if (!Number.isFinite(documentTotal?.amount)) {
    errors.push('Give documentTotal.amount, a number: the total printed on the document.');
  } else if (documentTotal) {
    // What's bought: estimates and cancellations aside. A booking the import
    // only changes the status of keeps the price already on file.
    const priced = bookingsByRef(state.accepted);
    let total = 0;
    for (const [ref, b] of priced) {
      if (b.status === 'planning' || b.status === 'cancelled') continue;
      total += isPriced(b) ? billedTotal(b) : (currentBookingCost(state, ref) ?? 0);
    }
    // A booking is priced in one currency (sumMoney adopts the first line's),
    // so the document's and every proposed line's must agree.
    const currencies = new Set([
      documentTotal.currency ?? 'USD',
      ...[...priced.values()].flatMap((b) =>
        [...(b.perTraveler ?? []), ...(b.fixed ?? [])].map((line) => line.currency ?? 'USD'),
      ),
    ]);
    if (currencies.size > 1) {
      errors.push(
        `The document total and the proposed lines are in different currencies (${[...currencies].join(', ')}). Give every line, and documentTotal, in the one currency the document is priced in.`,
      );
    } else if (Math.abs(total - documentTotal.amount) >= 0.01) {
      errors.push(
        `The proposed fares and fixed charges add up to ${total.toFixed(2)}, but the document's total is ${documentTotal.amount.toFixed(2)}. Find the missing or extra line and propose that entry again with its corrected booking.`,
      );
    }
  }
  return errors;
}

// Checks a set of changes together, in order — one state, so two changes to
// the same entry are turned down ("combine them") and changes sharing a
// booking ref share one booking — the way an import checks its proposals.
// `placeIds` are the ones searches found; leave it out when checking changes
// again as they're applied (their place ids were checked when proposed).
// `travelers` are people added for the changes, still to join the trip; one
// the trip already has by that name (saved since, say) isn't added twice —
// the changes' references to them point at the traveler who's there.
export function checkedChanges(
  changes: ChangeProposal[],
  data: TripData,
  {
    placeIds,
    travelers = [],
  }: {
    placeIds?: Iterable<string>;
    travelers?: { id?: string; name: string; age?: number }[];
  } = {},
): { state: ProposalState; changes: ChangeProposal[] } | { errors: string[] } {
  // Before anything reads the changes' lists (withTravelerIds below).
  const malformed = changes.flatMap((change, i) =>
    shapeErrors(change).map((e) => (changes.length > 1 ? `Change ${i + 1}: ${e}` : e)),
  );
  if (malformed.length) return { errors: malformed };
  const state = proposalState(data);
  if (placeIds) for (const id of placeIds) state.searchedPlaceIds.add(id);
  else state.placeIdsChecked = true;
  const existingIds = new Map<string, string>();
  for (const person of travelers) {
    const wanted = person.id ?? travelerSlug(person.name);
    const existing = travelerNamed(person.name, data.trip.travelers);
    if (existing) {
      existingIds.set(wanted, existing.id);
      continue;
    }
    // An id already taken by someone else (a different name, or a traveler
    // added earlier in this same batch) gets a free one, and the changes'
    // references are pointed at it.
    const taken = (candidate: string) =>
      data.trip.travelers.some((t) => t.id === candidate) ||
      state.newTravelers.some((t) => t.id === candidate);
    let id = wanted;
    for (let n = 2; taken(id); n += 1) id = `${wanted}_${n}`;
    if (id !== wanted) existingIds.set(wanted, id);
    state.newTravelers.push({ ...person, id });
  }
  const remapped = changes.map((change) => withTravelerIds(change, existingIds));
  const errors: string[] = [];
  remapped.forEach((change, i) => {
    const found = validateProposal(change, state);
    if (!found.length) state.accepted.push(change);
    else errors.push(...(changes.length > 1 ? found.map((e) => `Change ${i + 1}: ${e}`) : found));
  });
  return errors.length ? { errors } : { state, changes: remapped };
}

// ---------- Matching places, packages and drives ----------

// Words of four letters or more that name a kind of place or say nothing at
// all, so they'd pair any airport with any airport, or any dinner with any
// dinner, rather than one business with itself.
const GENERIC_WORDS = new Set(
  (
    'about after airport before breakfast brunch cabin cabins campground ' +
    'center dinner evening excursion from have hotel international into lodge ' +
    'lunch meal memorial morning motel municipal national near night onto ' +
    'over park regional resort restaurant state station suites terminal that ' +
    'their then this tour tours trip visit will with your'
  ).split(' '),
);

// Distinctive words of a label: an airport code in parentheses plus words of
// four letters or more that aren't GENERIC_WORDS, so "Ted Stevens Anchorage
// International (ANC)" and "Anchorage (ANC)" share both 'anc' and
// 'anchorage', but "Kotzebue Airport" and "Anchorage Airport" share nothing.
function labelTokens(label: string | null | undefined): Set<string> {
  const text = label ?? '';
  const codes = [...text.matchAll(/\(([A-Z0-9]{3,4})\)/g)].map((m) => m[1].toLowerCase());
  const words = (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (w) => w.length >= 4 && !GENERIC_WORDS.has(w),
  );
  return new Set([...codes, ...words]);
}

function sharedTokenCount(a: Set<string>, b: Set<string>): number {
  return [...a].filter((t) => b.has(t)).length;
}

// Lenient on purpose: a document spells a business however it likes ("The
// Salmon Bake Restaurant"), so one shared distinctive word is enough. The AI's
// own candidate matching (askAIDrafts.ts's sameCandidate) is exact instead.
export function placesShare(a: Place | null | undefined, b: Place | null | undefined): boolean {
  if (!a || !b) return false;
  if (a.id && b.id) return a.id === b.id;
  return sharedTokenCount(labelTokens(a.label), labelTokens(b.label)) > 0;
}

// A re-imported confirmation restates the packages it already added (the
// resort fee, "Included with your stay"), so one with a name already on the
// stay updates that package — its price and perks — instead of adding a copy.
//
// A restated package's `travelers` and `benefits` are undefined when the
// proposal left them out (keep the old ones) and null when it restated them
// empty (the whole party, no perks), which clears the old ones.
export type RestatedPackage = Omit<Package, 'travelers' | 'benefits' | 'per'> & {
  per?: 'night' | 'once';
  travelers?: string[] | null;
  benefits?: string[] | null;
};

// The one package a restatement is about. A package is known by its name, so
// restating a name updates that package — including whom it covers. Only when
// the entry already holds several with that name (two groups' "Drinks") does
// the restated travelers choose between them.
export function matchingPackage<P extends { name: string; travelers?: string[] | null }>(
  list: P[],
  name: string,
  travelers: string[] | null | undefined,
): P | undefined {
  const norm = (n: string) => n.trim().toLowerCase();
  const who = (t: string[] | null | undefined) => [...(t ?? [])].sort().join();
  const sameName = list.filter((p) => norm(p.name) === norm(name));
  if (sameName.length <= 1 || travelers === undefined) {
    return sameName.length === 1 ? sameName[0] : undefined;
  }
  const covering = sameName.filter((p) => who(p.travelers) === who(travelers));
  return covering.length === 1 ? covering[0] : undefined;
}

export function mergePackages(current: Package[], incoming: RestatedPackage[]): Package[] {
  const merged = [...current];
  for (const pkg of incoming) {
    const found = matchingPackage(merged, pkg.name, pkg.travelers);
    const i = found ? merged.indexOf(found) : -1;
    if (i === -1) {
      const { per, ...rest } = pkg;
      merged.push({
        ...rest,
        ...(per === 'night' ? { per } : {}),
        benefits: pkg.benefits ?? null,
        travelers: pkg.travelers ?? null,
      });
    } else {
      // A restated price comes with when it's paid, which follows the price,
      // not the old package. How often it's charged does too when restated;
      // left out, the package keeps its old rate (a restatement that only
      // corrects the amount mustn't turn a nightly rate into a one-off).
      const { per: oldPer, ...old } = merged[i];
      const per = pkg.cost && pkg.per ? (pkg.per === 'night' ? 'night' : undefined) : oldPer;
      merged[i] = {
        ...old,
        ...(per ? { per } : {}),
        cost: pkg.cost ?? merged[i].cost,
        payable: pkg.cost ? pkg.payable : merged[i].payable,
        benefits: pkg.benefits === undefined ? merged[i].benefits : pkg.benefits,
        travelers: pkg.travelers === undefined ? merged[i].travelers : pkg.travelers,
      };
    }
  }
  return merged;
}

// Whether a drive leaves on the stay's check-in or check-out day — the party
// arrives or leaves by car, so the car is there to park. Read off the trip's
// drive Transits (by date, since a drive's endpoints are often just a town).
export function drivenToOrFrom(
  stay: Pick<Stay, 'checkInAt' | 'checkOutAt'>,
  transits: Pick<Transit, 'mode' | 'departsAt' | 'arrivesAt'>[],
): boolean {
  const ends = new Set([dateOnly(stay.checkInAt), dateOnly(stay.checkOutAt)]);
  return transits.some(
    (t) =>
      t.mode === 'drive' &&
      [t.departsAt, t.arrivesAt].some((at) => at != null && ends.has(dateOnly(at))),
  );
}

// ---------- Turning proposals into drafts ----------

// Words that say what a place is. "Anchorage Hotel" is not "… Anchorage
// International Airport" though both share "anchorage": a label that names a
// kind of place needs the other to name it too.
const PLACE_KIND_WORDS = [
  'airport',
  'hotel',
  'lodge',
  'motel',
  'resort',
  'restaurant',
  'campground',
  'cabin',
  'cabins',
  'station',
  'terminal',
  'park',
];

function sameKindOfPlace(proposed: string, current: string): boolean {
  const kinds = (label: string) =>
    new Set(
      label
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((w) => PLACE_KIND_WORDS.includes(w)),
    );
  const have = kinds(current);
  return [...kinds(proposed)].every((w) => have.has(w));
}

function placeFrom(p: ProposedPlace, current: Place | null | undefined): Place {
  // A proposal that names the same place without an id — every distinctive
  // word of its label already in the entry's ("Anchorage Airport" for "Ted
  // Stevens Anchorage International Airport") — keeps the resolved one. One
  // shared word isn't enough here: "Alaska Salmon Bake" isn't "The Alaska
  // Fish House", and keeping that would quietly drop the change.
  const proposed = labelTokens(p.label);
  if (
    !p.placeId &&
    current?.id &&
    sameKindOfPlace(p.label, current.label) &&
    proposed.size > 0 &&
    sharedTokenCount(proposed, labelTokens(current.label)) === proposed.size
  ) {
    return p.onboard === undefined ? current : { ...current, onboard: p.onboard };
  }
  // Restating the entry's own place id keeps its other flags and contact fields.
  if (p.placeId && current?.id === p.placeId) {
    const { onboard: _drop, ...rest } = current;
    const onboard = p.onboard ?? current.onboard;
    // The stored label is the curated one; the proposal's loose spelling of the
    // same place ("Anchorage Airport") doesn't replace it.
    return { ...rest, ...(onboard ? { onboard: true } : {}) };
  }
  return {
    id: p.placeId ?? null,
    label: p.label,
    images: [],
    ...(p.onboard ? { onboard: true } : {}),
  };
}

function packagesFrom(
  proposed: ProposedPackage[],
  ids: ReadonlyMap<string, string>,
): RestatedPackage[] {
  return proposed.map(({ requires: _requires, key, cost, payable, per, ...pkg }) => ({
    ...blankPackage(),
    ...(key && ids.has(key) ? { _id: ids.get(key) as string } : {}),
    ...pkg,
    // Like a payable, a rate describes a charge: no cost keeps no `per`.
    ...(cost && per ? { per } : {}),
    // Stored like a booking line's: paid at booking is no payable at all.
    // A package with no cost has nothing to pay, so no payable either.
    ...(cost && payable && payable !== 'paid' ? { payable } : {}),
    cost: cost ? { amount: cost.amount, currency: cost.currency ?? 'USD' } : null,
    benefits: pkg.benefits && (pkg.benefits.length ? pkg.benefits : null),
    travelers: pkg.travelers && (pkg.travelers.length ? pkg.travelers : null),
  }));
}

const INCLUDED_FORMAT_KIND: Partial<Record<DiningFormat, RefEntityKind>> = {
  included: 'stay',
  'included-with-activity': 'activity',
  'included-with-transit': 'transit',
  package: 'package',
};

// The entry as it would be saved: the existing one (or a blank) with the
// proposal's changes laid over it. `ids` gives new entries' keys their ids.
function applyChanges(
  p: ChangeProposal,
  base: Entity | undefined,
  ids: Map<string, string>,
  refs: () => Map<string, RefEntityKind>,
): Entity {
  const c = p.changes ?? {};
  const resolveRef = (ref: string) => ids.get(ref) ?? ref;
  const withPackages = <E extends Entity>(e: E): E => {
    if (!c.packages?.length) return e;
    e.packages = mergePackages(e.packages ?? [], packagesFrom(c.packages, ids));
    // A keyed package merged into one the entry already had is that package,
    // so a meal pointing at the key points at the one that's kept.
    for (const { key, name, travelers } of c.packages) {
      const kept = matchingPackage(e.packages, name, travelers);
      if (key && kept) ids.set(key, kept._id);
    }
    return e;
  };

  if (p.kind === 'stay') {
    const s = base ? (structuredClone(base) as Stay) : blankStay(p.legId ?? '', p.date ?? '');
    if (!base && p.scenarioId) s.scenarioId = p.scenarioId;
    if (c.checkInAt) s.checkInAt = c.checkInAt;
    if (c.checkOutAt) s.checkOutAt = c.checkOutAt;
    if (c.portCalls) {
      // A restated call keeps what the stay already had for the same port —
      // its resolved place and any times the proposal leaves out.
      const earlier = s.portCalls ?? [];
      const used = new Set<(typeof earlier)[number]>();
      s.portCalls = c.portCalls.map((call) => {
        const proposed = labelTokens(call.place.label);
        const samePort = (e: (typeof earlier)[number]) =>
          call.place.placeId
            ? e.place.id === call.place.placeId
            : proposed.size > 0 &&
              sharedTokenCount(proposed, labelTokens(e.place.label)) === proposed.size;
        // The same port by place alone, so a port that becomes a scenic pass
        // (or back) keeps its place and times. One cruise can call at a port
        // on two days: each old call is matched once, by the day the proposal
        // gives, then by kind.
        const options = earlier.filter((e) => !used.has(e) && samePort(e));
        const day = call.arrivesAt ?? call.departsAt;
        // Narrow by day, then by kind; whichever step leaves exactly one is
        // the match. Still several (or none) is no match — never the first in
        // the stored order.
        const sameDay = day
          ? options.filter((e) => (e.arrivesAt ?? e.departsAt)?.slice(0, 10) === day.slice(0, 10))
          : [];
        const pool = sameDay.length ? sameDay : options;
        const sameKind = pool.filter((e) => e.kind === call.kind);
        const narrowed = sameKind.length ? sameKind : pool;
        const old = narrowed.length === 1 ? narrowed[0] : undefined;
        if (old) used.add(old);
        return {
          kind: call.kind,
          place: placeFrom(call.place, old?.place),
          arrivesAt: call.arrivesAt ?? old?.arrivesAt ?? null,
          departsAt: call.departsAt ?? old?.departsAt ?? null,
        };
      });
    }
    const details = [
      'roomType',
      'roomNumber',
      'bedConfiguration',
      'deckGroup',
      'shipZone',
    ] as const;
    if (c.lodging || details.some((key) => c[key])) {
      const lodging = s.lodging ?? { place: { id: null, label: '' } };
      if (c.lodging) lodging.place = placeFrom(c.lodging, lodging.place);
      for (const key of details) if (c[key]) lodging[key] = c[key];
      s.lodging = lodging;
    }
    return withPackages(s);
  }

  if (p.kind === 'transit') {
    const t = base ? (structuredClone(base) as Transit) : blankTransit(p.legId ?? '', p.date ?? '');
    if (!base && p.scenarioId) t.scenarioId = p.scenarioId;
    if (c.departsAt) t.departsAt = c.departsAt;
    if (c.arrivesAt && !t.routeId) t.arrivesAt = c.arrivesAt;
    if (p.onRoute) t.arrivesAt = null;
    if (c.from) t.from = placeFrom(c.from, t.from);
    if (c.to) t.to = placeFrom(c.to, t.to);
    if (c.mode) t.mode = c.mode;
    for (const key of ['carrier', 'flightNumber', 'operatedBy', 'aircraft'] as const) {
      if (c[key]) t[key] = c[key];
    }
    if (c.seats?.length) t.seats = c.seats;
    if (c.travelers !== undefined) t.travelers = c.travelers;
    return withPackages(t);
  }

  const a = base
    ? (structuredClone(base) as Activity)
    : blankActivity(p.legId ?? '', p.date ?? '', p.scenarioId ?? null);
  if (c.startAt) {
    a.startAt = c.startAt;
    a.date = null;
    a.timeLabel = null;
  }
  if (c.durationMinutes) a.durationMinutes = c.durationMinutes;
  if (c.text) a.text = c.text;
  if (c.place) a.place = placeFrom(c.place, a.place);
  if (c.mealType) a.mealType = c.mealType;
  if (c.diningFormat) {
    a.diningFormat = c.diningFormat;
    if (!DINING_FORMATS_WITH_INCLUDED_IN.includes(c.diningFormat)) a.includedIn = null;
  }
  if (c.includedWith) {
    // The kind of the entry it points at, which the dining format only
    // restates — it decides the Ref, not the other way round.
    const entity =
      refs().get(c.includedWith) ??
      INCLUDED_FORMAT_KIND[a.diningFormat ?? 'included-with-transit'] ??
      'transit';
    a.includedIn = { entity, id: resolveRef(c.includedWith) };
  }
  // Settling a meal that was choosing between candidates (an included lunch)
  // drops the candidates, as the edit form does — unless the same change
  // restates them, which keeps the ones it matches (and their reservations).
  if (c.diningFormat && a.options?.length && !p.addOption && !c.mealOptions?.length) {
    a.options = null;
  }
  if (c.mealOptions?.length) applyMealOptions(a, c.mealOptions);
  if (c.travelers !== undefined) a.travelers = c.travelers;
  return withPackages(a);
}

// Deliberately stricter than placesShare (any shared distinctive word): a
// candidate can carry a real place id, so a name-only match must be exact —
// "Salmon Bake" and "Salmon Smokehouse" are two candidates.
function sameCandidate(option: MealOption, proposed: ProposedMealOption): boolean {
  if (proposed.place.placeId && option.place?.id) return proposed.place.placeId === option.place.id;
  return option.place?.label.trim().toLowerCase() === proposed.place.label.trim().toLowerCase();
}

// Sets a meal's candidates. One that matches a candidate the meal already has
// (by place id, else by name) keeps its id, booking and includedIn, so revising
// the list never drops a reservation already made; one candidate decides the
// meal. Mutates `activity` (a fresh draft).
export function applyMealOptions(activity: Activity, proposed: ProposedMealOption[]): void {
  const existing: MealOption[] =
    activity.options ?? (activity.place ? [optionFromDecided(activity)] : []);
  const options = proposed.map((p): MealOption => {
    const match = existing.find((o) => sameCandidate(o, p));
    return {
      _id: match?._id ?? crypto.randomUUID(),
      diningFormat: p.diningFormat ?? match?.diningFormat ?? 'sit-down',
      place: {
        ...match?.place,
        id: p.place.placeId ?? match?.place?.id ?? null,
        label: p.place.label,
        ...(p.place.onboard !== undefined ? { onboard: p.place.onboard } : {}),
      },
      includedIn: match?.includedIn ?? null,
      bookingId: match?.bookingId ?? null,
    };
  });
  if (options.length === 1) decideMeal(activity, options[0]);
  else setMealOptions(activity, options);
}

// A proposed booking as stored. Updating a booking already on file, it keeps
// whatever the proposal leaves out: a status change alone ("mark it booked")
// keeps the price, confirmation number and agency already there.
function bookingFrom(b: ProposedBooking, id: string, current: Booking | null): Booking {
  const money = (amount: number, currency?: string): Money => ({
    amount,
    currency: currency ?? 'USD',
  });
  const booking: Booking = {
    ...current,
    _id: id,
    status: b.status,
    confirmationNumber: b.confirmationNumber ?? current?.confirmationNumber ?? null,
    pricing: isPriced(b)
      ? {
          perTraveler: (b.perTraveler ?? []).map((f) => ({
            travelerId: f.travelerId,
            fare: money(f.amount, f.currency),
            ...(f.ticketNumber ? { ticketNumber: f.ticketNumber } : {}),
            ...(f.payable && f.payable !== 'paid' ? { payable: f.payable } : {}),
          })),
          fixed: (b.fixed ?? []).map((c) => ({
            label: c.label,
            amount: money(c.amount, c.currency),
            ...(c.payable && c.payable !== 'paid' ? { payable: c.payable } : {}),
          })),
        }
      : (current?.pricing ?? null),
  };
  if (b.bookedThrough) booking.bookedThrough = b.bookedThrough;
  return booking;
}

// Accepted proposals as the review queue, in order. A booking several
// entries share (a round trip) is one document; it keeps the id of the
// booking an updated entry already has, so it's edited in place rather than
// replaced.
export function queueFromProposals(state: ProposalState): QueuedImport[] {
  const { data } = state;
  const ids = new Map<string, string>();
  for (const p of state.accepted) {
    if (p.key) ids.set(p.key, crypto.randomUUID());
    for (const pkg of p.changes?.packages ?? []) {
      if (pkg.key) ids.set(pkg.key, crypto.randomUUID());
    }
  }
  const bases = new Map(
    state.accepted.map((p) => [p, p.entityId ? findByKind(p.kind, p.entityId, data) : undefined]),
  );
  // A keyed package that matches one its entry already has (mergePackages)
  // is that package, so every entry pointing at the key — whichever comes
  // first in the queue — resolves to the kept id, not the fresh one above.
  for (const p of state.accepted) {
    const current = (bases.get(p) as { packages?: Package[] | null } | undefined)?.packages;
    for (const { key, name, travelers } of p.changes?.packages ?? []) {
      const kept = current && matchingPackage(current, name, travelers);
      if (key && kept) ids.set(key, kept._id);
    }
  }
  // One ref is one booking: the first entry on file under a booking gives the
  // ref its id, and every other entry naming the ref joins it. An entry that
  // was on file under a different booking is moved onto this one by design.
  const bookingIds = new Map<string, string>();
  for (const p of state.accepted) {
    if (!p.booking || bookingIds.has(p.booking.ref) || p.addOption) continue;
    const base = bases.get(p);
    const current = base ? bookingOf(data, base) : null;
    if (current && sameConfirmation(current, p.booking)) bookingIds.set(p.booking.ref, current._id);
  }
  const priced = bookingsByRef(state.accepted);
  const bookingIdFor = (ref: string) => {
    if (!bookingIds.has(ref)) bookingIds.set(ref, crypto.randomUUID());
    return bookingIds.get(ref) as string;
  };

  // The refund terms finish gave, as a note on the main purchase: the entry
  // whose booking costs the most, then by ref and entry id, so the same
  // document gets the note on the same entry whatever order they were proposed in.
  const entryId = (p: ChangeProposal) => p.entityId ?? p.key ?? '';
  const refundHolder = state.accepted
    .filter((p) => p.booking && p.booking.status !== 'planning' && p.booking.status !== 'cancelled')
    .sort(
      (a, b) =>
        bookingTotal(priced.get(b.booking!.ref)!) - bookingTotal(priced.get(a.booking!.ref)!) ||
        a.booking!.ref.localeCompare(b.booking!.ref) ||
        entryId(a).localeCompare(entryId(b)),
    )[0];
  const refund = refundNote(state.refundTerms);

  // The state is fixed from here, so the refs every proposal reads are built once.
  let refs: Map<string, RefEntityKind> | undefined;
  const refsOnce = () => (refs ??= referable(state));
  return state.accepted.map((p): QueuedImport => {
    const base = bases.get(p);
    const entity = applyChanges(p, base, ids, refsOnce);
    if (!base && p.key) entity._id = ids.get(p.key) as string;
    const bookingId = p.booking ? bookingIdFor(p.booking.ref) : null;
    const booking = p.booking
      ? bookingFrom(
          withPrice(p.booking, priced.get(p.booking.ref)),
          bookingId!,
          bookingById(data.bookings, bookingId!),
        )
      : null;
    if (p.addOption) {
      // The candidate carries the booking (a reservation at that one place),
      // or joins unbooked when there's none yet.
      const meal = entity as Activity;
      const options = meal.options ?? [];
      const place = placeFrom(p.addOption.place, null);
      const same = options.find((o) => o.place && sameCandidate(o, p.addOption!));
      if (same) {
        if (booking) same.bookingId = booking._id;
      } else {
        options.push({
          _id: crypto.randomUUID(),
          diningFormat: p.addOption.diningFormat,
          place,
          includedIn: null,
          bookingId: booking?._id ?? null,
        });
      }
      // A lone candidate is the decision, as in applyMealOptions.
      if (options.length === 1) decideMeal(meal, options[0]);
      else meal.options = options;
    } else if (booking) {
      entity.bookingId = booking._id;
    }
    const target = p.entityId ?? p.key;
    return {
      kind: p.kind,
      entity,
      bookings: booking ? [booking] : [],
      // On every draft, not just the first: one can be skipped, and saving
      // the same traveler twice adds them once (withTripTravelers).
      travelers: state.newTravelers,
      overrideId: base ? base._id : undefined,
      why: p.why,
      notes: [
        ...(p === refundHolder && refund ? [refund] : []),
        ...state.notes.filter((n) => n.concerns === target),
      ].map((n) => ({ ref: { entity: p.kind, id: entity._id }, kind: n.kind, text: n.text })),
    };
  });
}

// The id a new traveler gets: trav_ plus their name in lowercase with
// underscores ('Pat Guest' is trav_pat_guest) — the rule the trip chat
// describes to the AI, too.
export function travelerSlug(name: string): string {
  return `trav_${name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')}`;
}

// A traveler already in `travelers` by that name, ignoring case and spacing.
export function travelerNamed(name: string, travelers: Traveler[]): Traveler | undefined {
  const wanted = name.trim().toLowerCase();
  return travelers.find((t) => t.name.trim().toLowerCase() === wanted);
}

// A traveler the document names who isn't on the trip yet, with the id
// proposals then use for them — refused when the trip already has someone
// by that name, so a passenger list can't double the party.
export function addTraveler(
  input: { name?: string; age?: number },
  state: ProposalState,
): { traveler: Traveler } | { errors: string[] } {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) return { errors: ['Give the traveler’s name.'] };
  const everyone = [...state.data.trip.travelers, ...state.newTravelers];
  const same = travelerNamed(name, everyone);
  if (same) return { errors: [`${name} is already on the trip as ${same.id}; use that id.`] };
  const base = travelerSlug(name);
  let id = base;
  for (let n = 2; everyone.some((t) => t.id === id); n++) id = `${base}_${n}`;
  if (input.age != null && !(typeof input.age === 'number' && input.age >= 0 && input.age < 130)) {
    return { errors: ['age must be a number of years, or left out when the document gives none.'] };
  }
  const traveler: Traveler = { id, name, ...(input.age != null ? { age: input.age } : {}) };
  state.newTravelers.push(traveler);
  return { traveler };
}

// A note concerns an entry this import proposes, and is queued with that
// entry's draft.
export function validateNote(n: ProposedNote, state: ProposalState): string[] {
  if (!n || typeof n !== 'object') return ['A note must be an object.'];
  const errors: string[] = [];
  if (!NOTE_KINDS.includes(n.kind)) errors.push(`kind must be one of ${NOTE_KINDS.join(', ')}.`);
  if (typeof n.text !== 'string' || !n.text.trim()) errors.push('A note needs text.');
  const touched = new Set(state.accepted.flatMap((p) => [p.entityId, p.key].filter(Boolean)));
  if (!touched.has(n.concerns)) {
    errors.push(
      `concerns must be an entry this import proposes (${[...touched].join(', ') || 'none yet'}); propose that entry first.`,
    );
  }
  return errors;
}
