import { describe, expect, it } from 'vitest';

import {
  bookingWarnings,
  type DocumentExtraction,
  draftBookings,
  draftEntityFromExtraction,
  draftIncludedTransfers,
  endpointSearch,
  type ExtractedFields,
  findConflictCandidate,
  matchTraveler,
  mergeBooking,
  mergeDraftIntoExisting,
  notesFromExtraction,
  planDocumentImport,
  planIncludedMeals,
  planIncludedTransfers,
  travelersFrom,
  withDocumentTravelers,
} from './documentImport';
import { blankActivity, blankStay, blankTransit } from './editForms';
import { buildTripView } from './tripModel';
import type { Activity, Stay, Transit, Traveler, TripData } from './types';

// A synthetic stand-in for a Kennicott-Glacier-Lodge-style booking
// confirmation: no direct vehicle access, so the rate bundles a round-trip
// shuttle to a fixed meeting point, plus a nonrefundable-style callout.
function kennicottLikeFields(overrides: Partial<ExtractedFields> = {}): ExtractedFields {
  return {
    kind: 'stay',
    lodgingName: 'Kennicott Glacier Lodge',
    checkInAt: '2027-07-03T14:00',
    checkOutAt: '2027-07-05T11:00',
    bookingStatus: 'booked',
    costAmount: 990,
    includedTransfers: [{ transferPointLabel: 'McCarthy Road footbridge' }],
    includedPerks: ['Round-trip shuttle between the McCarthy Road footbridge and the lodge'],
    noteworthy: [{ kind: 'warning', text: 'Cancellation fees apply within 60 days of arrival.' }],
    ...overrides,
  };
}

describe('draftEntityFromExtraction: included perks/fees', () => {
  it('folds includedPerks into a zero-cost Package on the stay', () => {
    const stay = draftEntityFromExtraction(kennicottLikeFields(), 'leg_test', '2027-07-03') as Stay;
    expect(stay.packages).toHaveLength(1);
    expect(stay.packages?.[0].cost).toBeNull();
    expect(stay.packages?.[0].benefits).toEqual([
      'Round-trip shuttle between the McCarthy Road footbridge and the lodge',
    ]);
  });

  it('keeps extraFees and includedPerks as separate packages when both are present', () => {
    const fields = kennicottLikeFields({
      extraFees: [{ name: 'Pet fee', amount: 25 }],
    });
    const stay = draftEntityFromExtraction(fields, 'leg_test', '2027-07-03') as Stay;
    expect(stay.packages).toHaveLength(2);
    expect(stay.packages?.map((p) => p.name)).toEqual(['Pet fee', 'Included with your stay']);
  });
});

describe('draftIncludedTransfers', () => {
  it('produces an arrival transit anchored at check-in and a departure transit anchored at check-out', () => {
    const fields = kennicottLikeFields();
    const stay = draftEntityFromExtraction(fields, 'leg_test', '2027-07-03') as Stay;
    const transfers = draftIncludedTransfers(fields, stay, 'leg_test');

    expect(transfers).toHaveLength(2);
    const [arrival, departure] = transfers.map((t) => t.transit);

    expect(arrival.mode).toBe('shuttle');
    expect(arrival.departsAt).toBe('2027-07-03T14:00');
    expect(arrival.from.label).toBe('McCarthy Road footbridge');
    expect(arrival.to.label).toBe('Kennicott Glacier Lodge');

    expect(departure.mode).toBe('shuttle');
    expect(departure.departsAt).toBe('2027-07-05T11:00');
    expect(departure.from.label).toBe('Kennicott Glacier Lodge');
    expect(departure.to.label).toBe('McCarthy Road footbridge');
  });

  it('returns nothing for a stay with no included transfers', () => {
    const fields = kennicottLikeFields({ includedTransfers: undefined });
    const stay = draftEntityFromExtraction(fields, 'leg_test', '2027-07-03') as Stay;
    expect(draftIncludedTransfers(fields, stay, 'leg_test')).toEqual([]);
  });
});

describe('draftEntityFromExtraction: contact fallbacks', () => {
  it('sets phone/email/website on the lodging place when no id was resolved', () => {
    const fields = kennicottLikeFields({
      phone: '+1 907 2582350',
      email: 'reservations@kennicottlodge.com',
      website: 'http://www.KennicottLodge.com',
    });
    const stay = draftEntityFromExtraction(fields, 'leg_test', '2027-07-03') as Stay;
    expect(stay.lodging?.place.phone).toBe('+1 907 2582350');
    expect(stay.lodging?.place.email).toBe('reservations@kennicottlodge.com');
    expect(stay.lodging?.place.website).toBe('http://www.KennicottLodge.com');
  });

  // Regression: a resolved Place (id + images returned by the live Text
  // Search / Place Details lookup) has no phone/email/website fields of its
  // own — assigning it wholesale onto stay.lodging.place used to silently
  // drop everything the AI had just extracted, email included, even though
  // email has no live Google equivalent to fall back on afterward.
  it('keeps the extracted email even when the place resolves to a real Google id', () => {
    const fields = kennicottLikeFields({
      phone: '+1 907 2582350',
      email: 'reservations@kennicottlodge.com',
      website: 'http://www.KennicottLodge.com',
    });
    const stay = draftEntityFromExtraction(fields, 'leg_test', '2027-07-03', {
      lodging: { id: 'place_real', label: 'Kennicott Glacier Lodge', images: [] },
    }) as Stay;
    expect(stay.lodging?.place.id).toBe('place_real');
    expect(stay.lodging?.place.email).toBe('reservations@kennicottlodge.com');
  });
});

describe('draftIncludedTransfers: notes', () => {
  it("attaches each transfer note to both of that transfer's own Transit drafts", () => {
    const fields = kennicottLikeFields({
      includedTransfers: [
        {
          transferPointLabel: 'McCarthy Road footbridge',
          notes: [
            {
              kind: 'info',
              text: 'Shuttle runs hourly noon–8pm; confirm which arrival mode applies (car, shuttle van, or plane) since each meets at a different point.',
            },
          ],
        },
      ],
    });
    const stay = draftEntityFromExtraction(fields, 'leg_test', '2027-07-03') as Stay;
    const transfers = draftIncludedTransfers(fields, stay, 'leg_test');

    expect(transfers).toHaveLength(2);
    expect(transfers.every((t) => t.notes.length === 1 && t.notes[0].kind === 'info')).toBe(true);
  });

  it('returns no notes when a transfer has none of its own', () => {
    const fields = kennicottLikeFields();
    const stay = draftEntityFromExtraction(fields, 'leg_test', '2027-07-03') as Stay;
    const transfers = draftIncludedTransfers(fields, stay, 'leg_test');
    expect(transfers.every((t) => t.notes.length === 0)).toBe(true);
  });
});

describe('notesFromExtraction', () => {
  it('turns each noteworthy callout into a draft concerning the given entity id', () => {
    const notes = notesFromExtraction(kennicottLikeFields(), 'stay_123');
    expect(notes).toEqual([
      {
        ref: { entity: 'stay', id: 'stay_123' },
        kind: 'warning',
        text: 'Cancellation fees apply within 60 days of arrival.',
      },
    ]);
  });

  it('returns an empty array when nothing is noteworthy', () => {
    expect(notesFromExtraction(kennicottLikeFields({ noteworthy: undefined }), 'stay_123')).toEqual(
      [],
    );
  });
});

describe('mergeBooking: bookedThrough', () => {
  it('sets bookedThrough on a freshly-merged booking', () => {
    const booking = mergeBooking({ kind: 'stay', bookedThrough: 'Capital One Travel' });
    expect(booking?.bookedThrough).toBe('Capital One Travel');
  });

  it('preserves an existing bookedThrough when the extraction omits it', () => {
    const base = {
      _id: 'booking_base',
      status: 'booked' as const,
      pricing: null,
      confirmationNumber: null,
      bookedThrough: 'Expedia',
    };
    const booking = mergeBooking({ kind: 'stay', costAmount: 100 }, base);
    expect(booking?.bookedThrough).toBe('Expedia');
    // Merging keeps the existing document's id, so a booking two entries
    // share is updated in place rather than forked.
    expect(booking?._id).toBe('booking_base');
  });
});

// ---------- round-trip flight import (synthetic) ----------

const travelers: Traveler[] = [
  { id: 't_alex', name: 'Alex Tester' },
  { id: 't_sam', name: 'Sam Tester' },
];

function flightFields(overrides: Partial<ExtractedFields>): ExtractedFields {
  return {
    kind: 'transit',
    mode: 'flight',
    carrier: 'Test Air',
    bookingStatus: 'booked',
    confirmationNumber: 'TST123',
    costAmount: 500,
    ...overrides,
  };
}

const roundTrip: DocumentExtraction = {
  entities: [
    flightFields({
      fromLabel: 'Hometown (HOM)',
      toLabel: 'Faraway (FAR)',
      startAt: '2027-07-08T08:55',
      endAt: '2027-07-08T10:33',
      flightNumber: 'TA 1',
      aircraft: 'Test 737',
      seats: [
        { travelerName: 'Alex Tester', seat: '22A', cabin: 'Coach', fareClass: 'N' },
        { travelerName: 'Sam Tester', seat: '22B', cabin: 'Coach', fareClass: 'N' },
      ],
    }),
    flightFields({
      fromLabel: 'Faraway (FAR)',
      toLabel: 'Hometown (HOM)',
      startAt: '2027-07-10T18:29',
      endAt: '2027-07-10T20:07',
      flightNumber: 'TA 2',
      operatedBy: 'Partner Air',
      seats: [
        { travelerName: 'Alex Tester', seat: '13A' },
        { travelerName: 'Sam Tester', seat: '13B' },
      ],
    }),
  ],
  passengerFares: [
    { travelerName: 'Alex Tester', amount: 250, ticketNumber: '001' },
    { travelerName: 'Sam Tester', amount: 250, ticketNumber: '002' },
  ],
};

function placeholder(id: string, from: string, to: string, departsAt: string): Transit {
  return {
    ...blankTransit('leg_test', departsAt.slice(0, 10)),
    _id: id,
    mode: 'flight',
    from: { id: null, label: from },
    to: { id: 'place_far_airport', label: to },
    departsAt,
    arrivesAt: departsAt.replace(/T\d\d/, 'T23'),
    images: [{ uri: 'https://example.test/plane.jpg', credit: null, caption: null }],
  };
}

function tripWithPlaceholders(): TripData {
  return {
    trip: { _id: 'trip_test', name: 'Test', travelers, images: [] },
    legs: [
      { _id: 'leg_test', tripId: 'trip_test', name: 'Leg', skeletonAuthority: 'self', images: [] },
    ],
    stays: [],
    transits: [
      placeholder('ph_out', 'Hometown International (HOM)', 'Faraway (FAR)', '2027-07-08T08:40'),
      placeholder('ph_back', 'Faraway (FAR)', 'Hometown International (HOM)', '2027-07-10T17:00'),
    ],
    activities: [],
    bookings: [],
    scenarios: [],
    notes: [],
    travelModeOverrides: [],
    routes: [],
  };
}

describe('travelersFrom', () => {
  it('ignores a purchaser-only name list when the headcount covers more people', () => {
    expect(
      travelersFrom(flightFields({ travelerNames: ['Alex Tester'], travelerCount: 2 }), travelers),
    ).toBeNull();
  });

  it('cannot say who a smaller unnamed headcount is', () => {
    expect(travelersFrom(flightFields({ travelerCount: 1 }), travelers)).toBeUndefined();
  });

  it('keeps a name list that matches the headcount', () => {
    expect(
      travelersFrom(flightFields({ travelerNames: ['Sam Tester'], travelerCount: 1 }), travelers),
    ).toEqual(['t_sam']);
  });
});

describe('matchTraveler', () => {
  it('matches a full name ignoring case and spacing, then a unique first name', () => {
    expect(matchTraveler('  alex   TESTER ', travelers)).toBe('t_alex');
    expect(matchTraveler('Sam Q. Tester', travelers)).toBe('t_sam');
  });

  it('reads manifest and last-name-first spellings', () => {
    expect(matchTraveler('TESTER/ALEX MR', travelers)).toBe('t_alex');
    expect(matchTraveler('Tester, Sam', travelers)).toBe('t_sam');
    expect(matchTraveler('Alex', travelers)).toBe('t_alex');
  });

  it('refuses an ambiguous or unknown name rather than guessing', () => {
    const twins = [...travelers, { id: 't_alex2', name: 'Alex Other' }];
    expect(matchTraveler('Alex', twins)).toBeNull();
    expect(matchTraveler('Pat Stranger', travelers)).toBeNull();
    // A shared first name alone isn't the same person.
    expect(matchTraveler('Alex Somebody', travelers)).toBeNull();
  });
});

describe('withDocumentTravelers', () => {
  it('adds one new traveler per unrecognized name, named in reading order', () => {
    const roster = withDocumentTravelers(
      ['STRANGER/PAT MS', 'Alex Tester', 'Pat Stranger', "o'brien/jo"],
      travelers,
    );
    expect(roster.added.map((t) => t.name)).toEqual(['Pat Stranger', "Jo O'Brien"]);
    expect(roster.travelers).toHaveLength(4);
  });
});

describe('draftBookings', () => {
  it('gives both flights on one confirmation the same booking, priced per traveler', () => {
    const { bookingFor, extraNotes } = draftBookings(roundTrip, travelers);
    expect(bookingFor[0]).not.toBeNull();
    expect(bookingFor[1]).toBe(bookingFor[0]);
    expect(bookingFor[0]?.pricing).toEqual({
      perTraveler: [
        { travelerId: 't_alex', fare: { amount: 250, currency: 'USD' }, ticketNumber: '001' },
        { travelerId: 't_sam', fare: { amount: 250, currency: 'USD' }, ticketNumber: '002' },
      ],
      fixed: [],
    });
    expect(extraNotes.size).toBe(0);
  });

  it('flags itemized fares that disagree with the stated total', () => {
    const mismatched = { ...roundTrip, passengerFares: roundTrip.passengerFares?.slice(0, 1) };
    const { extraNotes } = draftBookings(mismatched, travelers);
    expect(extraNotes.get(0)?.[0].kind).toBe('warning');
  });

  it('keeps the overall price when a passenger matches no traveler', () => {
    const stranger = {
      ...roundTrip,
      passengerFares: [{ travelerName: 'Pat Stranger', amount: 500 }],
    };
    const { bookingFor, extraNotes } = draftBookings(stranger, travelers);
    expect(bookingFor[0]?.pricing).toEqual({
      perTraveler: [],
      fixed: [{ label: 'Total', amount: { amount: 500, currency: 'USD' } }],
    });
    expect(extraNotes.get(0)?.[0].text).toContain('Pat Stranger');
  });

  it('keeps entries without a confirmation number as separate bookings', () => {
    const loose: DocumentExtraction = {
      entities: roundTrip.entities.map((e) => ({ ...e, confirmationNumber: undefined })),
    };
    const { bookingFor } = draftBookings(loose, travelers);
    expect(bookingFor[0]?._id).not.toBe(bookingFor[1]?._id);
  });
});

describe('bookingWarnings', () => {
  it('collects every booking’s warnings for a flow that stages entries all at once', () => {
    const mismatched = { ...roundTrip, passengerFares: roundTrip.passengerFares?.slice(0, 1) };
    expect(bookingWarnings(mismatched, travelers).map((n) => n.kind)).toEqual(['warning']);
    expect(bookingWarnings(roundTrip, [])[0].text).toContain('Alex Tester');
  });
});

describe('draftEntityFromExtraction: flight details', () => {
  it('stores per-flight seats by traveler id, and the whole party as null', () => {
    const transit = draftEntityFromExtraction(
      roundTrip.entities[0],
      'leg_test',
      '2027-07-08',
      {},
      travelers,
    ) as Transit;
    expect(transit.seats).toEqual([
      { travelerId: 't_alex', seat: '22A', cabin: 'Coach', fareClass: 'N' },
      { travelerId: 't_sam', seat: '22B', cabin: 'Coach', fareClass: 'N' },
    ]);
    expect(transit.travelers).toBeNull();
    expect(transit.aircraft).toBe('Test 737');
  });
});

describe('findConflictCandidate', () => {
  const data = tripWithPlaceholders();
  const draft = (fields: ExtractedFields) =>
    draftEntityFromExtraction(fields, 'leg_test', fields.startAt!.slice(0, 10)) as Transit;

  it('matches the placeholder for the same direction, never the return flight', () => {
    expect(findConflictCandidate('transit', draft(roundTrip.entities[0]), data.transits)?._id).toBe(
      'ph_out',
    );
    expect(findConflictCandidate('transit', draft(roundTrip.entities[1]), data.transits)?._id).toBe(
      'ph_back',
    );
  });

  it('looks one day either side of the booking, and no further', () => {
    const moved = { ...roundTrip.entities[0], startAt: '2027-07-09T07:00' };
    expect(findConflictCandidate('transit', draft(moved), data.transits)?._id).toBe('ph_out');
    const tooFar = { ...roundTrip.entities[0], startAt: '2027-07-11T07:00' };
    expect(findConflictCandidate('transit', draft(tooFar), data.transits)).toBeNull();
  });

  it('can replace an entry that is already booked', () => {
    const booked = data.transits.map((t) => ({ ...t, status: 'active' as const, bookingId: 'x' }));
    expect(findConflictCandidate('transit', draft(roundTrip.entities[0]), booked)?._id).toBe(
      'ph_out',
    );
  });

  it('ignores a different mode and anything already claimed', () => {
    const asDrive = { ...roundTrip.entities[0], mode: 'drive' };
    expect(findConflictCandidate('transit', draft(asDrive), data.transits)).toBeNull();
    expect(
      findConflictCandidate(
        'transit',
        draft(roundTrip.entities[0]),
        data.transits,
        new Set(['ph_out']),
      ),
    ).toBeNull();
  });
});

describe('findConflictCandidate: generic words and ties', () => {
  const unresolved = (id: string, from: string, to: string, departsAt: string): Transit => ({
    ...placeholder(id, from, to, departsAt),
    to: { id: null, label: to },
  });
  const stay = (id: string, label: string, checkInAt = '2027-07-08T15:00'): Stay => ({
    ...blankStay('leg_test', '2027-07-08'),
    _id: id,
    checkInAt,
    lodging: { place: { id: null, label } },
  });
  const activity = (id: string, text: string): Activity => ({
    ...blankActivity('leg_test', '2027-07-08'),
    _id: id,
    text,
    startAt: '2027-07-08T19:00',
  });

  it('never pairs two airports on the word "airport" alone', () => {
    const outbound = unresolved(
      'ph_out',
      'Hometown Airport',
      'Faraway Airport',
      '2027-07-08T08:00',
    );
    const ret = unresolved(
      'new',
      'Faraway Memorial Airport',
      'Hometown International Airport',
      '2027-07-09T09:00',
    );
    expect(findConflictCandidate('transit', ret, [outbound])).toBeNull();
  });

  it('pairs a stay only with its own lodging or an unnamed placeholder', () => {
    const draft = stay('new', 'Kantishna Lodge');
    expect(findConflictCandidate('stay', draft, [stay('other', 'Riverside Lodge')])).toBeNull();
    expect(findConflictCandidate('stay', draft, [stay('ph', '')])?._id).toBe('ph');
    expect(findConflictCandidate('stay', draft, [stay('k', 'The Kantishna Lodge')])?._id).toBe('k');
  });

  it('offers neither of two equally good matches rather than the first in the array', () => {
    const draft = stay('new', 'Kantishna Lodge');
    expect(findConflictCandidate('stay', draft, [stay('a', ''), stay('b', '')])).toBeNull();
  });

  it('needs more than one shared generic-free word to pair activities by text', () => {
    const draft = activity('new', 'Dinner at Salmon Bake');
    expect(
      findConflictCandidate('activity', draft, [activity('x', 'Dinner with friends')]),
    ).toBeNull();
    expect(
      findConflictCandidate('activity', draft, [activity('y', 'Salmon Bake buffet')])?._id,
    ).toBe('y');
  });
});

describe('mergeDraftIntoExisting', () => {
  it('takes the booking’s times and details but keeps the placeholder’s images and resolved places', () => {
    const [existing] = tripWithPlaceholders().transits;
    const draft = draftEntityFromExtraction(
      roundTrip.entities[0],
      'leg_test',
      '2027-07-08',
      {},
      travelers,
    ) as Transit;
    const merged = mergeDraftIntoExisting(roundTrip.entities[0], existing, draft) as Transit;
    expect(merged._id).toBe('ph_out');
    expect(merged.departsAt).toBe('2027-07-08T08:55');
    expect(merged.flightNumber).toBe('TA 1');
    expect(merged.seats).toHaveLength(2);
    expect(merged.images).toEqual(existing.images);
    // The unresolved endpoint takes the document's label; the resolved one stays.
    expect(merged.from.label).toBe('Hometown (HOM)');
    expect(merged.to.id).toBe('place_far_airport');
  });

  it('leaves a transit’s departure alone when the document only gives its arrival', () => {
    const [existing] = tripWithPlaceholders().transits;
    const fields = flightFields({ endAt: '2027-07-08T11:00' });
    const draft = draftEntityFromExtraction(fields, 'leg_test', '2027-07-08') as Transit;
    const merged = mergeDraftIntoExisting(fields, existing, draft) as Transit;
    expect(merged.departsAt).toBe(existing.departsAt);
    expect(merged.arrivesAt).toBe('2027-07-08T11:00');
  });

  it('moves a placeholder departure that would fall after the document’s arrival', () => {
    const existing: Transit = {
      ...placeholder('ph_return', 'Remote Lodge', 'Float Base', '2027-07-08T15:00'),
      arrivesAt: '2027-07-08T16:30',
    };
    const fields = flightFields({ endAt: '2027-07-08T14:00' });
    const draft = draftEntityFromExtraction(fields, 'leg_test', '2027-07-08') as Transit;
    const merged = mergeDraftIntoExisting(fields, existing, draft) as Transit;
    expect(merged.departsAt).toBe('2027-07-08T12:30');
    expect(merged.arrivesAt).toBe('2027-07-08T14:00');
  });

  it('moves a placeholder arrival that would fall before the document’s departure', () => {
    const existing: Transit = {
      ...placeholder('ph_out', 'Float Base', 'Remote Lodge', '2027-07-08T08:30'),
      arrivesAt: '2027-07-08T09:30',
    };
    const fields = flightFields({ startAt: '2027-07-08T10:00' });
    const draft = draftEntityFromExtraction(fields, 'leg_test', '2027-07-08') as Transit;
    const merged = mergeDraftIntoExisting(fields, existing, draft) as Transit;
    expect(merged.departsAt).toBe('2027-07-08T10:00');
    expect(merged.arrivesAt).toBe('2027-07-08T11:00');
  });

  it('leaves a stay’s check-in alone when the document only gives its check-out', () => {
    const existing: Stay = {
      ...blankStay('leg_test', '2027-07-08'),
      checkInAt: '2027-07-08T16:00',
      checkOutAt: '2027-07-10T10:00',
    };
    const fields: ExtractedFields = { kind: 'stay', checkOutAt: '2027-07-10T12:00' };
    const draft = draftEntityFromExtraction(fields, 'leg_test', '2027-07-10') as Stay;
    const merged = mergeDraftIntoExisting(fields, existing, draft) as Stay;
    expect(merged.checkInAt).toBe('2027-07-08T16:00');
    expect(merged.checkOutAt).toBe('2027-07-10T12:00');
  });
});

describe('mergeDraftIntoExisting: re-imports and undecided meals', () => {
  it('replaces an older traveler restriction when the document names the whole party', () => {
    const [existing] = tripWithPlaceholders().transits;
    existing.travelers = ['t_alex'];
    const draft = draftEntityFromExtraction(
      roundTrip.entities[0],
      'leg_test',
      '2027-07-08',
      {},
      travelers,
    ) as Transit;
    const merged = mergeDraftIntoExisting(roundTrip.entities[0], existing, draft) as Transit;
    expect(merged.travelers).toBeNull();
  });

  it('updates a re-imported stay’s packages instead of adding copies', () => {
    const fields = kennicottLikeFields({ extraFees: [{ name: 'Resort fee', amount: 30 }] });
    const first = draftEntityFromExtraction(fields, 'leg_test', '2027-07-03') as Stay;
    const again = kennicottLikeFields({ extraFees: [{ name: 'Resort fee', amount: 35 }] });
    const draft = draftEntityFromExtraction(again, 'leg_test', '2027-07-03') as Stay;
    const merged = mergeDraftIntoExisting(again, first, draft) as Stay;
    expect(merged.packages?.map((p) => p.name)).toEqual(['Resort fee', 'Included with your stay']);
    expect(merged.packages?.[0]).toMatchObject({
      _id: first.packages?.[0]._id,
      cost: { amount: 35 },
    });
  });

  it('decides an undecided meal on the reservation, keeping its place and booking', () => {
    const existing: Activity = {
      ...blankActivity('leg_test', '2027-07-08'),
      startAt: '2027-07-08T19:00',
      mealType: 'dinner',
      options: [
        {
          _id: 'o1',
          diningFormat: 'sit-down',
          place: { id: 'place_bistro', label: 'Harbor Bistro' },
          includedIn: null,
          bookingId: null,
        },
        {
          _id: 'o2',
          diningFormat: 'sit-down',
          place: { id: 'place_grill', label: 'Ridge Grill' },
          includedIn: null,
          bookingId: null,
        },
      ],
    };
    const fields: ExtractedFields = {
      kind: 'activity',
      placeLabel: 'Harbor Bistro',
      startAt: '2027-07-08T19:30',
      confirmationNumber: 'RES1',
    };
    const booking = mergeBooking(fields);
    const draft = draftEntityFromExtraction(fields, 'leg_test', '2027-07-08', {}, [], booking);
    const merged = mergeDraftIntoExisting(fields, existing, draft) as Activity;
    expect(merged.options).toBeNull();
    expect(merged.place).toEqual({ id: 'place_bistro', label: 'Harbor Bistro' });
    expect(merged.diningFormat).toBe('sit-down');
    expect(merged.bookingId).toBe(booking?._id);
  });
  it('keeps an undecided meal’s candidates when a booking names no place', () => {
    const options = ['Harbor Bistro', 'Ridge Grill'].map((label, i) => ({
      _id: `o${i}`,
      diningFormat: 'sit-down' as const,
      place: { id: null, label },
      includedIn: null,
      bookingId: null,
    }));
    const existing: Activity = {
      ...blankActivity('leg_test', '2027-07-08'),
      mealType: 'dinner',
      options,
    };
    const fields: ExtractedFields = { kind: 'activity', confirmationNumber: 'RES2' };
    const booking = mergeBooking(fields);
    const draft = draftEntityFromExtraction(fields, 'leg_test', '2027-07-08', {}, [], booking);
    const merged = mergeDraftIntoExisting(fields, existing, draft) as Activity;
    expect(merged.options).toEqual(options);
  });
});

describe('planIncludedTransfers', () => {
  it('skips shuttle legs already on the itinerary and retimes moved ones', () => {
    const stay = draftEntityFromExtraction(kennicottLikeFields(), 'leg_test', '2027-07-03') as Stay;
    const first = planIncludedTransfers(kennicottLikeFields(), stay, 'leg_test', {}, []);
    expect(first).toHaveLength(2);
    const existing = first.map((t) => t.transit);
    expect(planIncludedTransfers(kennicottLikeFields(), stay, 'leg_test', {}, existing)).toEqual(
      [],
    );
    const later = { ...stay, checkOutAt: '2027-07-05T13:00' };
    const moved = planIncludedTransfers(kennicottLikeFields(), later, 'leg_test', {}, existing);
    expect(moved).toEqual([
      {
        transit: { ...existing[1], departsAt: '2027-07-05T13:00' },
        notes: [],
        overrideId: existing[1]._id,
      },
    ]);
  });
});

describe('planDocumentImport', () => {
  it('gives an entry added as new its own booking, not its match’s', () => {
    const data = tripWithPlaceholders();
    data.bookings = [{ _id: 'bk_ph', status: 'planning', pricing: null, confirmationNumber: null }];
    data.transits = data.transits.map((t) => ({ ...t, bookingId: 'bk_ph' }));
    const days = buildTripView(data).days;
    expect(planDocumentImport(roundTrip, data, days, [])[0].booking?._id).toBe('bk_ph');
    const plan = planDocumentImport(roundTrip, data, days, [], new Set([0, 1]));
    expect(plan[0].updating).toBe(false);
    expect(plan[0].existing?.entity._id).toBe('ph_out');
    expect(plan[0].booking?._id).not.toBe('bk_ph');
    expect(plan[0].draft.bookingId).toBe(plan[0].booking?._id);
  });

  it('adds a passenger the trip doesn’t know as a new traveler, with their seat and fare', () => {
    const data = tripWithPlaceholders();
    const withGuest: DocumentExtraction = {
      entities: [
        {
          ...roundTrip.entities[0],
          costAmount: 750,
          seats: [
            ...(roundTrip.entities[0].seats ?? []),
            { travelerName: 'GUEST/PAT', seat: '22C' },
          ],
        },
      ],
      passengerFares: [
        ...(roundTrip.passengerFares ?? []),
        { travelerName: 'GUEST/PAT', amount: 250 },
      ],
    };
    const [entry] = planDocumentImport(withGuest, data, buildTripView(data).days, []);
    expect(entry.travelers).toEqual([{ id: expect.any(String), name: 'Pat Guest' }]);
    const patId = entry.travelers[0].id;
    const merged = entry.existing?.merged as Transit;
    expect(merged.travelers).toBeNull(); // all three of the (now three) travelers
    expect(merged.seats?.map((s) => s.travelerId)).toEqual(['t_alex', 't_sam', patId]);
    expect(entry.booking?.pricing?.perTraveler).toHaveLength(3);
    expect(entry.notes).toEqual([]);
  });

  it('turns a round-trip confirmation into updates of both placeholders, sharing one booking', () => {
    const data = tripWithPlaceholders();
    const plan = planDocumentImport(roundTrip, data, buildTripView(data).days, []);
    expect(plan.map((e) => e.existing?.entity._id)).toEqual(['ph_out', 'ph_back']);
    expect(plan[0].existing?.merged.bookingId).toBeTruthy();
    expect(plan[1].existing?.merged.bookingId).toBe(plan[0].existing?.merged.bookingId);
    expect((plan[1].existing?.merged as Transit).operatedBy).toBe('Partner Air');
  });

  it('updates the booking the matched entries already share instead of replacing it', () => {
    const data = tripWithPlaceholders();
    data.bookings = [
      {
        _id: 'bk_old',
        status: 'booked',
        pricing: {
          perTraveler: [
            { travelerId: 't_alex', fare: { amount: 240, currency: 'USD' }, ticketNumber: 'OLD1' },
            { travelerId: 't_sam', fare: { amount: 240, currency: 'USD' }, ticketNumber: 'OLD2' },
          ],
          fixed: [],
        },
        confirmationNumber: 'TST123',
        depositPaidAt: '2027-01-15',
      },
    ];
    data.transits = data.transits.map((t) => ({ ...t, bookingId: 'bk_old' }));
    const noTickets = {
      ...roundTrip,
      passengerFares: roundTrip.passengerFares?.map(({ ticketNumber: _, ...f }) => f),
    };
    const plan = planDocumentImport(noTickets, data, buildTripView(data).days, []);
    expect(plan.map((e) => e.existing?.merged.bookingId)).toEqual(['bk_old', 'bk_old']);
    expect(plan[0].booking?._id).toBe('bk_old');
    expect(plan[0].booking?.depositPaidAt).toBe('2027-01-15');
    expect(plan[0].booking?.pricing).toEqual({
      perTraveler: [
        { travelerId: 't_alex', fare: { amount: 250, currency: 'USD' }, ticketNumber: 'OLD1' },
        { travelerId: 't_sam', fare: { amount: 250, currency: 'USD' }, ticketNumber: 'OLD2' },
      ],
      fixed: [],
    });
    // The old booking's price isn't the document's stated total to contradict.
    expect(plan[0].notes.some((n) => n.kind === 'warning')).toBe(false);
  });

  it('starts a new booking when the document names a different confirmation number', () => {
    const data = tripWithPlaceholders();
    data.bookings = [{ _id: 'bk_old', status: 'booked', pricing: null, confirmationNumber: 'ZZZ' }];
    data.transits = data.transits.map((t) => ({ ...t, bookingId: 'bk_old' }));
    const plan = planDocumentImport(roundTrip, data, buildTripView(data).days, []);
    expect(plan[0].existing?.merged.bookingId).not.toBe('bk_old');
  });
});

describe('endpointSearch', () => {
  const result = (label: string) => ({ id: label, label, address: '' });

  it('searches airports for a flight, and skips a beacon that Google also types as one', () => {
    const search = endpointSearch('Kotzebue (OTZ)', 'flight');
    expect(search.query).toBe('Kotzebue (OTZ) airport');
    expect(search.includedType).toBe('airport');
    expect(
      search.pick([
        result('Kotzebue VOR-DME OTZ 115.7'),
        result('Ralph Wien Memorial Airport (OTZ)'),
      ])?.label,
    ).toBe('Ralph Wien Memorial Airport (OTZ)');
  });

  it('leaves a flight endpoint unresolved rather than pin something not named an airport', () => {
    expect(
      endpointSearch('Kotzebue (OTZ)', 'flight').pick([result('OTZ Telephone Co-Op')]),
    ).toBeNull();
  });

  it('does not repeat "airport" already in the label', () => {
    expect(endpointSearch('Juneau International Airport', 'flight').query).toBe(
      'Juneau International Airport',
    );
  });

  it("searches a flight's named operator base as a plain place, not an airport", () => {
    const search = endpointSearch("Rust's Flying Service", 'flight');
    expect(search.query).toBe("Rust's Flying Service");
    expect(search.includedType).toBeUndefined();
    expect(search.pick([result("Rust's Flying Service")])?.label).toBe("Rust's Flying Service");
  });

  it('keeps the plain top result for other modes', () => {
    const search = endpointSearch('Denali Bus Depot', 'bus');
    expect(search.includedType).toBeUndefined();
    expect(search.pick([result('Denali Bus Depot')])?.label).toBe('Denali Bus Depot');
  });
});

describe('per-traveler and fixed pricing', () => {
  it('keeps a per-person rate as fares and a per-booking fee as a fixed charge', () => {
    const fields = flightFields({
      confirmationNumber: 'TOUR1',
      costAmount: 200.01,
      unitPrice: 90,
      travelerCount: 2,
      fixedCharges: [{ name: 'Transportation fee', amount: 20.01 }],
    });
    const { bookingFor, extraNotes } = draftBookings({ entities: [fields] }, travelers);
    const pricing = bookingFor[0]?.pricing;
    expect(pricing?.perTraveler.map((f) => f.fare.amount)).toEqual([90, 90]);
    expect(pricing?.fixed).toEqual([
      { label: 'Transportation fee', amount: { amount: 20.01, currency: 'USD' } },
    ]);
    expect(extraNotes.get(0)).toBeUndefined();
  });

  it('warns when the fares and fixed charges miss the stated total', () => {
    const fields = flightFields({ costAmount: 250, unitPrice: 90, travelerCount: 2 });
    const { extraNotes } = draftBookings({ entities: [fields] }, travelers);
    expect(extraNotes.get(0)?.[0].kind).toBe('warning');
  });

  it('prices a room booking as its itemized fixed charges', () => {
    const fields: ExtractedFields = {
      kind: 'stay',
      costAmount: 403.35,
      fixedCharges: [
        { name: 'Room (1 night)', amount: 375.2 },
        { name: 'Taxes & fees', amount: 28.15 },
      ],
    };
    const { bookingFor } = draftBookings({ entities: [fields] }, travelers);
    expect(bookingFor[0]?.pricing?.perTraveler).toEqual([]);
    expect(bookingFor[0]?.pricing?.fixed.map((c) => c.label)).toEqual([
      'Room (1 night)',
      'Taxes & fees',
    ]);
  });

  it('keeps the overall total as a fixed charge when the headcount is not the whole party', () => {
    const fields = flightFields({ costAmount: 100, unitPrice: 100, travelerCount: 1 });
    const { bookingFor } = draftBookings({ entities: [fields] }, travelers);
    expect(bookingFor[0]?.pricing).toEqual({
      perTraveler: [],
      fixed: [{ label: 'Total', amount: { amount: 100, currency: 'USD' } }],
    });
  });
});

describe('planIncludedMeals', () => {
  const transit: Transit = {
    ...placeholder('ph_tour', 'Float Base', 'Remote Lodge', '2027-07-08T08:00'),
    scenarioId: 'sc_ideal',
  };
  const fields = flightFields({ includedMeals: [{ mealType: 'lunch' }] });

  it('turns the same-scenario placeholder lunch into one included with the transit', () => {
    const packed: Activity = {
      ...blankActivity('leg_test', '2027-07-08', 'sc_ideal'),
      mealType: 'lunch',
      diningFormat: 'self-catered',
      text: 'Packed lunch',
      startAt: '2027-07-08T12:30',
      date: null,
    };
    const otherScenario: Activity = { ...packed, _id: 'alt_lunch', scenarioId: 'sc_alt' };
    const [meal] = planIncludedMeals(fields, transit, [otherScenario, packed]);
    expect(meal.overrideId).toBe(packed._id);
    expect(meal.activity.startAt).toBe('2027-07-08T12:30');
    expect(meal.activity.diningFormat).toBe('included-with-transit');
    expect(meal.activity.includedIn).toEqual({ entity: 'transit', id: 'ph_tour' });
    expect(meal.activity.place?.id).toBe('place_far_airport');
  });

  it('adds a new meal when the day has none to update', () => {
    const [meal] = planIncludedMeals(fields, transit, []);
    expect(meal.overrideId).toBeUndefined();
    expect(meal.activity.scenarioId).toBe('sc_ideal');
    expect(meal.activity.mealType).toBe('lunch');
  });
});
