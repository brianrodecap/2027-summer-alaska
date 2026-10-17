import { describe, expect, it } from 'vitest';

import { applyBatch } from './askAIDrafts';
import { blankActivity, blankPackage, blankStay, blankTransit } from './editForms';
import {
  addTraveler,
  type ChangeProposal,
  checkedChanges,
  isDateTime,
  mergePackages,
  noPlaceSearches,
  proposalState,
  queueFromProposals,
  validateFinish,
  validateNote,
  validateProposal,
} from './proposals';
import type { Activity, Stay, Transit, TripData } from './types';

function trip(): TripData {
  const out: Transit = {
    ...blankTransit('leg_t', '2027-07-11'),
    _id: 'ph_out',
    mode: 'flight',
    from: { id: 'place_base', label: 'Test Air Base' },
    to: { id: 'place_lodge', label: 'Remote Lodge' },
    departsAt: '2027-07-11T08:30',
    arrivesAt: '2027-07-11T09:30',
  };
  const lunch: Activity = {
    ...blankActivity('leg_t', '2027-07-11'),
    _id: 'act_lunch',
    startAt: '2027-07-11T12:30',
    date: null,
    mealType: 'lunch',
    diningFormat: 'self-catered',
  };
  const breakfast: Activity = {
    ...blankActivity('leg_t', '2027-06-28'),
    _id: 'act_breakfast',
    startAt: '2027-06-28T07:45',
    date: null,
    mealType: 'breakfast',
    options: [
      {
        _id: 'o1',
        diningFormat: 'sit-down',
        place: { id: 'place_cafe', label: 'Café' },
        includedIn: null,
        bookingId: null,
      },
    ],
  };
  const hotel: Stay = {
    ...blankStay('leg_t', '2027-06-27'),
    _id: 'stay_hotel',
    lodging: { place: { id: 'place_hotel', label: 'Test Hotel' } },
  };
  return {
    trip: {
      _id: 'trip_t',
      name: 'Test',
      travelers: [
        { id: 't1', name: 'Alex Tester', age: 45 },
        { id: 't2', name: 'Kid Tester', age: 10 },
      ],
      images: [],
    },
    legs: [{ _id: 'leg_t', tripId: 'trip_t', name: 'Leg', skeletonAuthority: 'self', images: [] }],
    stays: [hotel],
    transits: [out],
    activities: [lunch, breakfast],
    scenarios: [],
    notes: [],
    bookings: [],
    travelModeOverrides: [],
    routes: [],
  };
}

const flight: ChangeProposal = {
  entityId: 'ph_out',
  kind: 'transit',
  changes: {
    departsAt: '2027-07-11T08:00',
    travelers: null,
    packages: [{ name: 'Included with your tour', benefits: ['Headsets'], requires: 'none' }],
  },
  booking: {
    ref: 'tour',
    status: 'booked',
    confirmationNumber: 'T1',
    perTraveler: [
      { travelerId: 't1', amount: 1000, payable: 'paid' },
      { travelerId: 't2', amount: 1000, payable: 'paid' },
    ],
    fixed: [{ label: 'Transportation fee', amount: 50, payable: 'paid' }],
  },
  why: 'Same operator and morning',
};

describe('validateProposal', () => {
  it('accepts an update in the trip’s own fields', () => {
    expect(validateProposal(flight, proposalState(trip()))).toEqual([]);
  });

  it('names what to fix: an unknown entry, traveler, place, or a time that runs backwards', () => {
    const state = proposalState(trip());
    const errors = validateProposal(
      {
        ...flight,
        entityId: 'nope',
        changes: { from: { placeId: 'made_up', label: 'Somewhere' } },
        booking: {
          ref: 'x',
          status: 'booked',
          perTraveler: [{ travelerId: 'ghost', amount: 1, payable: 'paid' }],
        },
      },
      state,
    );
    expect(errors.join('\n')).toMatch(/No transit nope/);
    expect(errors.join('\n')).toMatch(/No traveler ghost/);
    expect(errors.join('\n')).toMatch(/search for "Somewhere"/);
    expect(
      validateProposal({ ...flight, changes: { arrivesAt: '2027-07-11T08:00' } }, state),
    ).toEqual(['Arrives 2027-07-11T08:00, not after it departs 2027-07-11T08:30.']);
  });

  it('accepts a place id from a search this import made', () => {
    const state = proposalState(trip());
    state.placeSearches.placeIds.add('found');
    expect(
      validateProposal(
        { ...flight, changes: { from: { placeId: 'found', label: 'Base' } } },
        state,
      ),
    ).toEqual([]);
  });

  it('turns down parking at a stay nobody drives to, and a second update of one entry', () => {
    const state = proposalState(trip());
    const parking: ChangeProposal = {
      entityId: 'stay_hotel',
      kind: 'stay',
      changes: {
        packages: [
          {
            name: 'Parking',
            cost: { amount: 10 },
            payable: 'atProperty',
            per: 'night',
            requires: 'car',
          },
        ],
      },
      why: 'Same hotel',
    };
    expect(validateProposal(parking, state)[0]).toMatch(/no car to park/);
    state.accepted.push(flight);
    expect(validateProposal(flight, state)[0]).toMatch(/already updated/);
  });

  it('takes a booking named by an earlier ref without its price as that booking', () => {
    const state = proposalState(trip());
    state.accepted.push(flight);
    const back: ChangeProposal = {
      entityId: 'act_lunch',
      kind: 'activity',
      changes: {},
      booking: { ref: 'tour', status: 'booked' },
      why: 'Same tour',
    };
    expect(validateProposal(back, state)).toEqual([]);
    const repriced = { ...back, booking: { ...flight.booking!, fixed: [] } };
    expect(validateProposal(repriced, state)[0]).toMatch(/already proposed at 2050.00/);
  });

  it('adds an option only to a meal still being decided', () => {
    const state = proposalState(trip());
    const option = (entityId: string): ChangeProposal => ({
      entityId,
      kind: 'activity',
      changes: {},
      addOption: {
        place: { label: 'Test Hotel', placeId: 'place_hotel' },
        diningFormat: 'sit-down',
      },
      booking: {
        ref: `est_${entityId}`,
        status: 'planning',
        perTraveler: [{ travelerId: 't1', amount: 25, payable: 'paid' }],
      },
      why: 'Offered by the hotel',
    });
    expect(validateProposal(option('act_breakfast'), state)).toEqual([]);
    expect(validateProposal(option('act_lunch'), state)[0]).toMatch(/already decided/);
  });
});

describe('validateFinish', () => {
  it('turns down a document total that isn’t a number', () => {
    const state = proposalState(trip());
    state.accepted.push(flight);
    const terms = { policy: 'none' as const };
    expect(validateFinish(state, undefined, terms).join()).toMatch(/Give documentTotal/);
    expect(validateFinish(state, {} as never, terms).join()).toMatch(/Give documentTotal/);
    expect(validateFinish(state, { amount: '2050' } as never, terms).join()).toMatch(
      /Give documentTotal/,
    );
  });

  it('checks the bought bookings add up to the document total, estimates aside', () => {
    const state = proposalState(trip());
    state.accepted.push(flight);
    expect(
      validateFinish(state, { amount: 2050 }, { policy: 'nonrefundable', text: 'Nonrefundable' }),
    ).toEqual([]);
    expect(
      validateFinish(
        state,
        { amount: 2100 },
        { policy: 'nonrefundable', text: 'Nonrefundable' },
      )[0],
    ).toMatch(/add up to 2050.00.*total is 2100.00/);
  });
});

describe('when each line is paid, and the refund terms', () => {
  it('needs every fare and charge to say when it’s paid', () => {
    const unsaid = {
      ...flight,
      booking: { ...flight.booking!, fixed: [{ label: 'Room', amount: 50 }] },
    } as unknown as ChangeProposal;
    expect(validateProposal(unsaid, proposalState(trip()))[0]).toMatch(/Room: say when it's paid/);
  });

  it('needs the refund terms, and queues them as a note on the booked entry', () => {
    const state = proposalState(trip());
    state.accepted.push(flight);
    expect(validateFinish(state, { amount: 2050 }, undefined)[0]).toMatch(/Give refundTerms/);
    state.refundTerms = { policy: 'nonrefundable', text: 'Nonrefundable' };
    const [draft] = queueFromProposals(state);
    expect(draft.notes[0]).toMatchObject({ kind: 'warning', text: 'Nonrefundable' });
    state.refundTerms = { policy: 'partial', text: '50% refund until Jun 26, 2027' };
    expect(queueFromProposals(state)[0].notes[0]).toMatchObject({
      kind: 'info',
      text: '50% refund until Jun 26, 2027',
    });
    state.refundTerms = { policy: 'none' };
    expect(queueFromProposals(state)[0].notes).toEqual([]);
    expect(validateFinish(state, { amount: 2050 }, { policy: 'partial' })[0]).toMatch(
      /refundTerms.text/,
    );
    expect(draft.bookings[0].pricing?.fixed[0].payable).toBeUndefined();
  });
});

describe('queueFromProposals', () => {
  it('drafts the update, its shared booking, an included meal and its notes', () => {
    const data = trip();
    const state = proposalState(data);
    state.accepted.push(flight, {
      entityId: 'act_lunch',
      kind: 'activity',
      changes: { diningFormat: 'included-with-transit', includedWith: 'ph_out' },
      why: 'Lunch at the lodge is included',
    });
    expect(
      validateNote({ concerns: 'ph_out', kind: 'info', text: 'Refund until May 1.' }, state),
    ).toEqual([]);
    state.notes.push({ concerns: 'ph_out', kind: 'info', text: 'Refund until May 1.' });

    const [out, lunch] = queueFromProposals(state);
    const transit = out.entity as Transit;
    expect(transit.departsAt).toBe('2027-07-11T08:00');
    expect(transit.arrivesAt).toBe('2027-07-11T09:30');
    expect(transit.packages?.[0]).toMatchObject({
      name: 'Included with your tour',
      benefits: ['Headsets'],
    });
    expect(transit.bookingId).toBe(out.bookings[0]._id);
    expect(out.bookings[0].pricing?.perTraveler.map((f) => f.fare.amount)).toEqual([1000, 1000]);
    expect(out.notes).toEqual([
      { ref: { entity: 'transit', id: 'ph_out' }, kind: 'info', text: 'Refund until May 1.' },
    ]);
    expect((lunch.entity as Activity).includedIn).toEqual({ entity: 'transit', id: 'ph_out' });
  });

  it('points a package meal at a package named by key in the same import', () => {
    const state = proposalState(trip());
    const keyed: ChangeProposal = {
      ...flight,
      changes: {
        ...flight.changes,
        packages: [{ name: 'Included with your tour', key: 'tour_pkg', requires: 'none' }],
      },
    };
    const meal: ChangeProposal = {
      entityId: 'act_lunch',
      kind: 'activity',
      changes: { diningFormat: 'package', includedWith: 'tour_pkg' },
      why: 'Lunch is part of the tour package',
    };
    expect(validateProposal(keyed, state)).toEqual([]);
    state.accepted.push(keyed);
    expect(validateProposal(meal, state)).toEqual([]);
    state.accepted.push(meal);
    const [out, lunch] = queueFromProposals(state);
    const packageId = (out.entity as Transit).packages?.[0]._id;
    expect(packageId).toBeTruthy();
    expect((lunch.entity as Activity).includedIn).toEqual({ entity: 'package', id: packageId });
  });

  it('turns down a package meal that points at something else', () => {
    const state = proposalState(trip());
    const meal: ChangeProposal = {
      entityId: 'act_lunch',
      kind: 'activity',
      changes: { diningFormat: 'package', includedWith: 'ph_out' },
      why: 'Lunch is included',
    };
    expect(validateProposal(meal, state)[0]).toMatch(/package's id or key/);
  });

  it('gives an entry naming a priced booking by ref that same price', () => {
    const state = proposalState(trip());
    state.accepted.push(flight, {
      entityId: 'act_lunch',
      kind: 'activity',
      changes: {},
      booking: { ref: 'tour', status: 'booked' },
      why: 'Same tour',
    });
    const [out, lunch] = queueFromProposals(state);
    expect(lunch.bookings[0]).toEqual(out.bookings[0]);
  });

  it('writes a stateroom’s details and who a package covers', () => {
    const state = proposalState(trip());
    const cabin: ChangeProposal = {
      entityId: 'stay_hotel',
      kind: 'stay',
      changes: {
        roomNumber: 'L232',
        deckGroup: 'Upper',
        shipZone: 'Mid-Forward',
        packages: [{ name: 'Premier', travelers: ['t1'], requires: 'none' }],
      },
      why: 'Same sailing',
    };
    expect(validateProposal(cabin, state)).toEqual([]);
    state.accepted.push(cabin);
    const stay = queueFromProposals(state)[0].entity as Stay;
    expect(stay.lodging).toMatchObject({
      roomNumber: 'L232',
      deckGroup: 'Upper',
      shipZone: 'Mid-Forward',
    });
    expect(stay.packages?.[0].travelers).toEqual(['t1']);
  });

  it('writes a cruise’s port calls, turning down one outside the sailing', () => {
    const state = proposalState(trip());
    state.placeSearches.placeIds.add('place_port');
    const call = (arrivesAt: string, departsAt: string) => ({
      kind: 'port' as const,
      place: { placeId: 'place_port', label: 'Port' },
      arrivesAt,
      departsAt,
    });
    const cruise = (portCalls: ReturnType<typeof call>[]): ChangeProposal => ({
      entityId: 'stay_hotel',
      kind: 'stay',
      changes: { portCalls },
      why: 'Same sailing',
    });
    expect(
      validateProposal(cruise([call('2027-06-29T06:00', '2027-06-29T10:00')]), state)[0],
    ).toMatch(/outside the cruise/);
    const ok = cruise([call('2027-06-27T18:00', '2027-06-27T22:00')]);
    expect(validateProposal(ok, state)).toEqual([]);
    state.accepted.push(ok);
    expect((queueFromProposals(state)[0].entity as Stay).portCalls).toEqual([
      {
        kind: 'port',
        place: { id: 'place_port', label: 'Port' },
        arrivesAt: '2027-06-27T18:00',
        departsAt: '2027-06-27T22:00',
      },
    ]);
  });

  it('keeps a booking’s price and confirmation when a proposal only changes its status', () => {
    const data = trip();
    data.bookings = [
      {
        _id: 'bk_lunch',
        status: 'planning',
        confirmationNumber: 'L1',
        pricing: {
          perTraveler: [],
          fixed: [{ label: 'Lunch', amount: { amount: 80, currency: 'USD' } }],
        },
      },
    ];
    data.activities = data.activities.map((a) =>
      a._id === 'act_lunch' ? { ...a, bookingId: 'bk_lunch' } : a,
    );
    const state = proposalState(data);
    state.accepted.push({
      entityId: 'act_lunch',
      kind: 'activity',
      changes: {},
      booking: { ref: 'lunch', status: 'booked' },
      why: 'Reserved',
    });
    const [draft] = queueFromProposals(state);
    expect(draft.bookings[0]).toMatchObject({
      _id: 'bk_lunch',
      status: 'booked',
      confirmationNumber: 'L1',
      pricing: { fixed: [{ label: 'Lunch' }] },
    });
  });

  it('puts an estimate on a new candidate, not on the meal', () => {
    const state = proposalState(trip());
    state.accepted.push({
      entityId: 'act_breakfast',
      kind: 'activity',
      changes: {},
      addOption: {
        place: { placeId: 'place_hotel', label: 'Test Hotel' },
        diningFormat: 'sit-down',
      },
      booking: {
        ref: 'est',
        status: 'planning',
        perTraveler: [
          { travelerId: 't1', amount: 25, payable: 'paid' },
          { travelerId: 't2', amount: 15, payable: 'paid' },
        ],
      },
      why: 'The hotel sells breakfast',
    });
    const [draft] = queueFromProposals(state);
    const meal = draft.entity as Activity;
    expect(meal.bookingId).toBeNull();
    expect(meal.options?.[1]).toMatchObject({
      place: { id: 'place_hotel' },
      bookingId: draft.bookings[0]._id,
    });
    expect(draft.bookings[0].status).toBe('planning');
  });

  it('gives a new entry an id its notes and included meals point at', () => {
    const state = proposalState(trip());
    state.accepted.push({
      key: 'shuttle_in',
      kind: 'transit',
      legId: 'leg_t',
      date: '2027-07-03',
      changes: {
        mode: 'shuttle',
        departsAt: '2027-07-03T14:00',
        from: { label: 'Footbridge' },
        to: { label: 'Lodge' },
      },
      why: 'The lodge shuttle meets guests at the footbridge',
    });
    state.notes.push({ concerns: 'shuttle_in', kind: 'info', text: 'Pickups on the hour.' });
    const [draft] = queueFromProposals(state);
    expect(draft.overrideId).toBeUndefined();
    expect(draft.notes[0].ref).toEqual({ entity: 'transit', id: draft.entity._id });
  });
});

describe('addTraveler', () => {
  it('adds someone new with an id proposals can use, and joins them with the first draft', () => {
    const state = proposalState(trip());
    const added = addTraveler({ name: 'Pat Guest', age: 30 }, state);
    expect(added).toEqual({ traveler: { id: 'trav_pat_guest', name: 'Pat Guest', age: 30 } });
    const withPat: ChangeProposal = {
      ...flight,
      booking: {
        ...flight.booking!,
        perTraveler: [{ travelerId: 'trav_pat_guest', amount: 50, payable: 'paid' }],
        fixed: [],
      },
    };
    expect(validateProposal(withPat, state)).toEqual([]);
    state.accepted.push(withPat);
    expect(queueFromProposals(state)[0].travelers).toEqual([
      { id: 'trav_pat_guest', name: 'Pat Guest', age: 30 },
    ]);
  });

  it('refuses someone already on the trip', () => {
    const state = proposalState(trip());
    expect(addTraveler({ name: 'alex tester' }, state)).toEqual({
      errors: ['alex tester is already on the trip as t1; use that id.'],
    });
  });
});

describe('code-review fixes', () => {
  it('puts new travelers on every draft, so skipping the first can’t lose them', () => {
    const state = proposalState(trip());
    addTraveler({ name: 'Pat Guest' }, state);
    state.accepted.push(flight, {
      entityId: 'act_lunch',
      kind: 'activity',
      changes: { travelers: ['trav_pat_guest'] },
      why: 'Pat joins lunch',
    });
    const queue = queueFromProposals(state);
    expect(queue.map((d) => d.travelers.map((t) => t.id))).toEqual([
      ['trav_pat_guest'],
      ['trav_pat_guest'],
    ]);
  });

  it('needs a booking ref and a known status', () => {
    const state = proposalState(trip());
    const noRef = {
      ...flight,
      booking: { ...flight.booking!, ref: '', status: 'confirmed' },
    } as unknown as ChangeProposal;
    const errors = validateProposal(noRef, state).join('\n');
    expect(errors).toMatch(/needs a ref/);
    expect(errors).toMatch(/status must be one of/);
  });

  it('counts a status-only update at the price on file, and leaves cancellations out', () => {
    const data = trip();
    data.bookings = [
      {
        _id: 'bk_out',
        status: 'planning',
        confirmationNumber: null,
        pricing: {
          perTraveler: [],
          fixed: [{ label: 'Fare', amount: { amount: 300, currency: 'USD' } }],
        },
      },
    ];
    data.transits = data.transits.map((t) => ({ ...t, bookingId: 'bk_out' }));
    const state = proposalState(data);
    state.accepted.push({
      entityId: 'ph_out',
      kind: 'transit',
      changes: {},
      booking: { ref: 'b', status: 'booked' },
      why: 'Confirmed',
    });
    expect(validateFinish(state, { amount: 300 }, { policy: 'none' })).toEqual([]);
    state.accepted[0] = { ...state.accepted[0], booking: { ref: 'b', status: 'cancelled' } };
    expect(validateFinish(state, { amount: 0 }, { policy: 'none' })).toEqual([]);
  });

  it('turns down a new entry dated outside the trip', () => {
    const state = proposalState(trip());
    const late: ChangeProposal = {
      key: 'late',
      kind: 'activity',
      legId: 'leg_t',
      date: '2028-07-11',
      changes: { text: 'Next year' },
      why: 'Misread year',
    };
    expect(validateProposal(late, state)[0]).toMatch(/2028-07-11 is outside this trip/);
  });

  it('lets parking through when this import also books the drive', () => {
    const state = proposalState(trip());
    state.accepted.push({
      key: 'drive',
      kind: 'transit',
      legId: 'leg_t',
      date: '2027-06-27',
      changes: {
        mode: 'drive',
        departsAt: '2027-06-27T09:00',
        from: { label: 'A' },
        to: { label: 'B' },
      },
      why: 'Rental car drive',
    });
    const parking: ChangeProposal = {
      entityId: 'stay_hotel',
      kind: 'stay',
      changes: {
        packages: [
          {
            name: 'Parking',
            cost: { amount: 10 },
            payable: 'atProperty',
            per: 'night',
            requires: 'car',
          },
        ],
      },
      why: 'Same hotel',
    };
    expect(validateProposal(parking, state)).toEqual([]);
  });
});

describe('what a package requires', () => {
  it('must be said, so the car and pet checks always run', () => {
    const silent = {
      ...flight,
      changes: { packages: [{ name: 'Fee', cost: { amount: 5 }, payable: 'atProperty' }] },
    } as unknown as ChangeProposal;
    expect(validateProposal(silent, proposalState(trip())).join('\n')).toMatch(
      /Fee: say what it requires/,
    );
  });
});

describe('second code-review fixes', () => {
  it('keeps a resolved place only by its id or exact name, never by shared words', () => {
    const to = (place: { label: string; placeId?: string }): ChangeProposal => ({
      entityId: 'ph_out',
      kind: 'transit',
      changes: { to: place },
      why: 's',
    });
    const keptTo = (proposal: ChangeProposal) => {
      const state = proposalState(trip());
      state.accepted.push(proposal);
      return (queueFromProposals(state)[0].entity as Transit).to;
    };
    expect(keptTo(to({ label: 'remote lodge ' })).id).toBe('place_lodge');
    expect(keptTo(to({ label: 'Lodge', placeId: 'place_lodge' }))).toMatchObject({
      id: 'place_lodge',
      label: 'Remote Lodge',
    });

    // Any other spelling is turned down with the id to restate, not guessed at.
    const errors = validateProposal(to({ label: 'The Remote Lodge' }), proposalState(trip()));
    expect(errors.join()).toMatch(/Remote Lodge \(placeId place_lodge\)/);
    expect(errors.join()).toMatch(/search_places for "The Remote Lodge"/);
  });

  it('resolves an unresolved place of the same name with the id a proposal gives', () => {
    const data = trip();
    data.transits = data.transits.map((t) => ({
      ...t,
      to: { id: null, label: 'Remote Lodge', showWeather: true },
    }));
    const state = proposalState(data);
    state.placeSearches.placeIds.add('place_found');
    const proposal: ChangeProposal = {
      entityId: 'ph_out',
      kind: 'transit',
      changes: { to: { placeId: 'place_found', label: 'remote lodge' } },
      why: 's',
    };
    expect(validateProposal(proposal, state)).toEqual([]);
    state.accepted.push(proposal);
    // The place it restates keeps its own label and settings, and gains the id.
    expect((queueFromProposals(state)[0].entity as Transit).to).toEqual({
      id: 'place_found',
      label: 'Remote Lodge',
      showWeather: true,
    });
  });

  it('keeps a resolved port call restated by its exact name', () => {
    const data = trip();
    data.stays = data.stays.map((s) => ({
      ...s,
      checkInAt: '2027-06-27T16:00',
      checkOutAt: '2027-07-02T08:00',
      portCalls: [
        {
          kind: 'port' as const,
          place: { id: 'place_port', label: 'Test Port' },
          arrivesAt: '2027-06-28T07:00',
          departsAt: '2027-06-28T17:00',
        },
      ],
    }));
    const state = proposalState(data);
    const proposal: ChangeProposal = {
      entityId: 'stay_hotel',
      kind: 'stay',
      changes: { portCalls: [{ kind: 'port', place: { label: 'test port' } }] },
      why: 's',
    };
    expect(validateProposal(proposal, state)).toEqual([]);
    state.accepted.push(proposal);
    expect((queueFromProposals(state)[0].entity as Stay).portCalls?.[0]).toMatchObject({
      place: { id: 'place_port', label: 'Test Port' },
      arrivesAt: '2027-06-28T07:00',
    });
  });

  it('never drops the place of a port call named like two resolved calls', () => {
    const cruise = (ids: [string, string]) => {
      const data = trip();
      const call = (day: string, id: string) => ({
        kind: 'port' as const,
        place: { id, label: 'Test Port' },
        arrivesAt: `${day}T07:00`,
        departsAt: `${day}T17:00`,
      });
      data.stays = data.stays.map((s) => ({
        ...s,
        checkInAt: '2027-06-27T16:00',
        checkOutAt: '2027-07-02T08:00',
        portCalls: [call('2027-06-28', ids[0]), call('2027-07-01', ids[1])],
      }));
      return data;
    };
    const proposal = (place: { label: string; placeId?: string }): ChangeProposal => ({
      entityId: 'stay_hotel',
      kind: 'stay',
      changes: { portCalls: [{ kind: 'port', place }] },
      why: 's',
    });
    // Two places by that name can't be told apart: its id is the way out.
    const twoPorts = cruise(['place_port_a', 'place_port_b']);
    expect(
      validateProposal(proposal({ label: 'Test Port' }), proposalState(twoPorts)).join(),
    ).toMatch(
      /Test Port has no placeId.*Test Port \(placeId place_port_a\), Test Port \(placeId place_port_b\)/,
    );
    const state = proposalState(twoPorts);
    const restated = proposal({ label: 'Test Port', placeId: 'place_port_a' });
    expect(validateProposal(restated, state)).toEqual([]);
    state.accepted.push(restated);
    expect((queueFromProposals(state)[0].entity as Stay).portCalls?.[0].place.id).toBe(
      'place_port_a',
    );
    // Two calls at one place keep that place, even when the call itself can't be told apart.
    const onePort = proposalState(cruise(['place_port', 'place_port']));
    const named = proposal({ label: 'Test Port' });
    expect(validateProposal(named, onePort)).toEqual([]);
    onePort.accepted.push(named);
    expect((queueFromProposals(onePort)[0].entity as Stay).portCalls?.[0].place.id).toBe(
      'place_port',
    );
  });

  it('lets a shipboard venue take over from a resolved place only when it names it', () => {
    const onboard = (place: Record<string, unknown>): ChangeProposal => ({
      entityId: 'ph_out',
      kind: 'transit',
      changes: { to: { label: 'Ship Theater', onboard: true, ...place } },
      why: 's',
    });
    // A respelling marked aboard can't drop the resolved place.
    expect(validateProposal(onboard({}), proposalState(trip())).join()).toMatch(
      /Ship Theater is aboard the ship, but it would take over from Remote Lodge \(placeId place_lodge\)/,
    );
    expect(
      validateProposal(onboard({ replaces: 'place_other' }), proposalState(trip())).join(),
    ).toMatch(/give replaces: that placeId/);
    // Naming the place it takes over from is the way through, with no search.
    const state = proposalState(trip());
    const replacing = onboard({ replaces: 'place_lodge' });
    expect(validateProposal(replacing, state)).toEqual([]);
    state.accepted.push(replacing);
    expect((queueFromProposals(state)[0].entity as Transit).to).toEqual({
      id: null,
      label: 'Ship Theater',
      onboard: true,
    });
    // A venue aboard needs no search where nothing resolved is replaced.
    const meal: ChangeProposal = {
      entityId: 'act_lunch',
      kind: 'activity',
      changes: { place: { label: 'Main Dining Room', onboard: true } },
      why: 's',
    };
    expect(validateProposal(meal, proposalState(trip()))).toEqual([]);
  });

  it('needs every new place to have a placeId, or a search that found nothing', () => {
    const data = trip();
    const newDrive = (to: Record<string, unknown>): ChangeProposal => ({
      kind: 'transit',
      legId: 'leg_t',
      date: '2027-07-11',
      changes: {
        departsAt: '2027-07-11T14:00',
        arrivesAt: '2027-07-11T15:00',
        from: { label: 'Test Air Base', placeId: 'place_base' },
        to: { label: 'Glacier Overlook', ...to },
      },
      why: 's',
    });
    const errors = (to: Record<string, unknown>, empty: string[] = []) => {
      const state = proposalState(data);
      for (const q of empty) state.placeSearches.emptyQueries.add(q);
      return validateProposal(newDrive(to), state).join();
    };
    expect(errors({})).toMatch(
      /to: Glacier Overlook has no placeId\. Give its placeId from search_places \(search for "Glacier Overlook"\), or, when that search finds nothing, notOnGoogle: true\./,
    );
    // notOnGoogle holds only after a search for that very name found nothing.
    expect(errors({ notOnGoogle: true })).toMatch(/Glacier Overlook has no placeId/);
    expect(errors({ notOnGoogle: true }, ['Glacier'])).toMatch(/Glacier Overlook has no placeId/);
    expect(errors({ notOnGoogle: true }, ['glacier overlook'])).toBe('');
    // A searched id is the usual way through.
    const state = proposalState(data);
    state.placeSearches.placeIds.add('place_overlook');
    expect(validateProposal(newDrive({ placeId: 'place_overlook' }), state)).toEqual([]);
    // A place the trip already has by exactly that name is that place.
    expect(errors({ label: 'remote lodge' })).toBe('');
    const named = proposalState(data);
    named.accepted.push(newDrive({ label: 'remote lodge' }));
    expect((queueFromProposals(named)[0].entity as Transit).to).toMatchObject({
      id: 'place_lodge',
      label: 'Remote Lodge',
    });
    // Two resolved places by that name aren't picked between.
    const twice = trip();
    twice.stays = twice.stays.map((s) => ({
      ...s,
      lodging: { place: { id: 'place_lodge_2', label: 'Remote Lodge' } },
    }));
    expect(
      validateProposal(newDrive({ label: 'Remote Lodge' }), proposalState(twice)).join(),
    ).toMatch(
      /Remote Lodge has no placeId\. The trip has more than one place by that name: Remote Lodge \(placeId place_lodge\), Remote Lodge \(placeId place_lodge_2\)/,
    );
    // Applying changes already checked doesn't search again.
    expect('state' in checkedChanges([newDrive({ notOnGoogle: true })], data)).toBe(true);
    expect('errors' in checkedChanges([newDrive({})], data)).toBe(true);
  });

  it('lets a place not on Google take over from a resolved one only when it names it', () => {
    const data = trip();
    const renamed = (to: Record<string, unknown>) => {
      const state = proposalState(data);
      state.placeSearches.emptyQueries.add('Remote Lodge Annex');
      return validateProposal(
        {
          entityId: 'ph_out',
          kind: 'transit',
          changes: { to: { label: 'Remote Lodge Annex', notOnGoogle: true, ...to } },
          why: 's',
        },
        state,
      ).join();
    };
    expect(renamed({})).toMatch(
      /Remote Lodge Annex isn’t on Google, but it would take over from Remote Lodge \(placeId place_lodge\)/,
    );
    expect(renamed({ replaces: 'place_lodge' })).toBe('');
    // A replaces naming nothing it takes over from is turned down, not ignored.
    const theater: ChangeProposal = {
      entityId: 'act_lunch',
      kind: 'activity',
      changes: { place: { label: 'Theater', onboard: true, replaces: 'place_nowhere' } },
      why: 's',
    };
    expect(validateProposal(theater, proposalState(data)).join()).toMatch(
      /Theater takes over from no resolved place, so replaces place_nowhere names nothing/,
    );
  });

  it('doesn’t take a venue aboard for a place ashore of the same name', () => {
    const data = trip();
    data.activities = data.activities.map((a) =>
      a._id === 'act_lunch'
        ? { ...a, place: { id: 'place_ship_lounge', label: 'Lounge', onboard: true } }
        : a,
    );
    const ashore: ChangeProposal = {
      kind: 'activity',
      legId: 'leg_t',
      date: '2027-07-11',
      changes: { text: 'Drinks', startAt: '2027-07-11T20:00', place: { label: 'Lounge' } },
      why: 's',
    };
    expect(validateProposal(ashore, proposalState(data)).join()).toMatch(
      /place: Lounge has no placeId/,
    );
  });

  it('turns down a candidate list that drops a resolved one for a place with no id', () => {
    const state = proposalState(trip());
    state.placeSearches.emptyQueries.add('Cafe Bar');
    const swapped = (place: Record<string, unknown>): ChangeProposal => ({
      entityId: 'act_breakfast',
      kind: 'activity',
      changes: { mealOptions: [{ place: { label: 'Cafe Bar', ...place } }] },
      why: 's',
    });
    expect(validateProposal(swapped({ onboard: true }), state).join()).toMatch(
      /Cafe Bar is aboard the ship, but it would take over from Café \(placeId place_cafe\)/,
    );
    expect(validateProposal(swapped({}), state).join()).toMatch(
      /mealOptions: Cafe Bar has no placeId, and the meal would drop Café \(placeId place_cafe\)/,
    );
    expect(validateProposal(swapped({ onboard: true, replaces: 'place_cafe' }), state)).toEqual([]);
    expect(validateProposal(swapped({ notOnGoogle: true, replaces: 'place_cafe' }), state)).toEqual(
      [],
    );
  });

  it('needs a placeId on a new meal candidate and an added option too', () => {
    const state = proposalState(trip());
    const candidates: ChangeProposal = {
      entityId: 'act_lunch',
      kind: 'activity',
      changes: {
        mealOptions: [
          { place: { label: 'Café', placeId: 'place_cafe' } },
          { place: { label: 'Bakery' } },
        ],
      },
      why: 's',
    };
    expect(validateProposal(candidates, state).join()).toMatch(
      /mealOptions: Bakery has no placeId/,
    );
    const added: ChangeProposal = {
      entityId: 'act_breakfast',
      kind: 'activity',
      changes: {},
      addOption: { place: { label: 'Bakery' }, diningFormat: 'sit-down' },
      why: 's',
    };
    expect(validateProposal(added, state).join()).toMatch(/addOption: Bakery has no placeId/);
    // Restating a candidate the meal already has needs no id.
    expect(
      validateProposal(
        { ...added, addOption: { place: { label: 'café' }, diningFormat: 'sit-down' } },
        state,
      ),
    ).toEqual([]);
  });

  it('puts a new stay on its scenario', () => {
    const state = proposalState(trip());
    state.accepted.push({
      key: 'rain_stay',
      kind: 'stay',
      legId: 'leg_t',
      date: '2027-06-27',
      scenarioId: 'scn_rain',
      changes: {},
      why: 's',
    });
    expect((queueFromProposals(state)[0].entity as Stay).scenarioId).toBe('scn_rain');
  });

  it('needs a priced package to say when it’s paid, and stores paid as no payable', () => {
    const withFee = (payable: unknown): ChangeProposal => ({
      entityId: 'stay_hotel',
      kind: 'stay',
      changes: {
        packages: [
          { name: 'Resort fee', cost: { amount: 30 }, requires: 'none', payable } as never,
        ],
      },
      why: 's',
    });
    const state = proposalState(trip());
    expect(validateProposal(withFee(undefined), state).join()).toMatch(/say when it's paid/);
    expect(validateProposal(withFee({ dueBy: 'soon' }), state).join()).toMatch(/say when/);
    expect(validateProposal(withFee('paid'), state)).toEqual([]);
    expect(validateProposal(withFee({ paidAt: '2026-08-06' }), state)).toEqual([]);
    expect(validateProposal(withFee({ paidAt: 'yesterday' }), state).join()).toMatch(/say when/);
    state.accepted.push(withFee('paid'));
    const [fee] = (queueFromProposals(state)[0].entity as Stay).packages!;
    expect(fee).not.toHaveProperty('payable');
  });

  it('adds a meal candidate with no booking yet, unbooked', () => {
    const state = proposalState(trip());
    state.accepted.push({
      entityId: 'act_breakfast',
      kind: 'activity',
      addOption: { place: { label: 'Lodge Buffet' }, diningFormat: 'sit-down' },
      changes: {},
      why: 's',
    });
    const meal = queueFromProposals(state)[0].entity as Activity;
    expect(meal.options?.map((o) => [o.place?.label, o.bookingId])).toEqual([
      ['Café', null],
      ['Lodge Buffet', null],
    ]);
  });

  it('turns down an arrival on a routed drive', () => {
    const data = trip();
    data.transits = data.transits.map((t) => ({ ...t, routeId: 'route_a' }));
    const late: ChangeProposal = {
      entityId: 'ph_out',
      kind: 'transit',
      changes: { arrivesAt: '2027-07-11T10:00' },
      why: 's',
    };
    expect(validateProposal(late, proposalState(data)).join()).toMatch(/routed drive/);
  });

  it('checks the port calls already on a cruise it moves', () => {
    const data = trip();
    data.stays = data.stays.map((s) => ({
      ...s,
      checkInAt: '2027-06-27T16:00',
      checkOutAt: '2027-06-30T08:00',
      portCalls: [
        {
          kind: 'port' as const,
          place: { id: 'place_port', label: 'Test Port' },
          arrivesAt: '2027-06-29T07:00',
          departsAt: '2027-06-29T17:00',
        },
      ],
    }));
    const earlier: ChangeProposal = {
      entityId: 'stay_hotel',
      kind: 'stay',
      changes: { checkOutAt: '2027-06-28T08:00' },
      why: 's',
    };
    expect(validateProposal(earlier, proposalState(data)).join()).toMatch(
      /Test Port at 2027-06-29T07:00 is outside the cruise.*Restate portCalls/,
    );
  });

  it('turns down malformed tool input instead of throwing', () => {
    const state = proposalState(trip());
    const bad = (changes: unknown): ChangeProposal =>
      ({ entityId: 'stay_hotel', kind: 'stay', changes, why: 's' }) as ChangeProposal;
    expect(
      validateProposal(
        bad({ portCalls: [{ kind: 'port', arrivesAt: '2027-06-27T18:00' }] }),
        state,
      ).join(),
    ).toMatch(/needs a place with a label/);
    expect(validateProposal(bad({ packages: { name: 'x' } }), state).join()).toMatch(
      /packages must be a list/,
    );
    expect(validateProposal(bad({ packages: [null] }), state).join()).toMatch(/must be an object/);
    expect(
      validateProposal({ ...bad({}), why: 5 } as unknown as ChangeProposal, state).join(),
    ).toMatch(/why/);
    expect(validateProposal(bad({ packages: [{ name: 123 }] }), state).join()).toMatch(
      /name must be text/,
    );
  });

  it('checks a package’s per and requires before the checks that read them', () => {
    const state = proposalState(trip());
    const errors = validateProposal(
      {
        entityId: 'stay_hotel',
        kind: 'stay',
        changes: {
          packages: [
            { name: 'Parking', cost: { amount: 5 }, payable: 'paid', per: 'week' },
          ] as never,
        },
        why: 's',
      },
      state,
    ).join();
    expect(errors).toMatch(/per can only be 'night'/);
    expect(errors).toMatch(/say what it requires/);
  });

  it('keeps each port call’s own times when one port is called at on two days', () => {
    const data = trip();
    const port = { id: 'place_port', label: 'Test Port' };
    data.stays = data.stays.map((s) => ({
      ...s,
      checkInAt: '2027-06-27T16:00',
      checkOutAt: '2027-07-02T08:00',
      portCalls: [
        {
          kind: 'port' as const,
          place: port,
          arrivesAt: '2027-06-28T07:00',
          departsAt: '2027-06-28T17:00',
        },
        {
          kind: 'port' as const,
          place: port,
          arrivesAt: '2027-07-01T07:00',
          departsAt: '2027-07-01T17:00',
        },
      ],
    }));
    const state = proposalState(data);
    state.placeSearches.placeIds.add('place_port');
    const restate: ChangeProposal = {
      entityId: 'stay_hotel',
      kind: 'stay',
      changes: {
        portCalls: [
          {
            kind: 'scenic',
            place: { placeId: 'place_port', label: 'Test Port' },
            arrivesAt: '2027-07-01T08:00',
          },
        ],
      },
      why: 's',
    };
    state.accepted.push(restate);
    const calls = (queueFromProposals(state)[0].entity as Stay).portCalls;
    expect(calls?.[0]).toMatchObject({
      kind: 'scenic',
      arrivesAt: '2027-07-01T08:00',
      departsAt: '2027-07-01T17:00',
    });
  });

  it('turns down a port call that names a resolved port without its id', () => {
    const data = trip();
    data.stays = data.stays.map((s) => ({
      ...s,
      checkInAt: '2027-06-27T16:00',
      checkOutAt: '2027-07-02T08:00',
      portCalls: [
        {
          kind: 'port' as const,
          place: { id: 'place_port', label: 'Test Port' },
          arrivesAt: '2027-06-28T07:00',
          departsAt: '2027-06-28T17:00',
        },
        {
          kind: 'scenic' as const,
          place: { id: null, label: 'Glacier Bay' },
          arrivesAt: '2027-06-29T07:00',
          departsAt: null,
        },
      ],
    }));
    const calls = (...portCalls: NonNullable<ChangeProposal['changes']['portCalls']>) =>
      ({
        entityId: 'stay_hotel',
        kind: 'stay',
        changes: { portCalls },
        why: 's',
      }) as ChangeProposal;
    const guessed = calls({
      kind: 'port',
      place: { label: 'Port of Test' },
      arrivesAt: '2027-06-28T07:00',
    });
    expect(validateProposal(guessed, proposalState(data)).join()).toMatch(
      /Port of Test has no placeId.*Test Port \(placeId place_port\) on 2027-06-28/,
    );
    // A timeless scenic passage beside resolved ports is a new stop, not a respelled port.
    const passage = calls(
      { kind: 'port', place: { placeId: 'place_port', label: 'Test Port' } },
      { kind: 'scenic', place: { label: 'Tracy Arm', notOnGoogle: true } },
    );
    const searched = proposalState(data);
    searched.placeSearches.emptyQueries.add('Tracy Arm');
    expect(validateProposal(passage, searched)).toEqual([]);
    // A timeless port call without an id still can't stand in for a resolved port.
    expect(
      validateProposal(
        calls({ kind: 'port', place: { label: 'Port of Test' } }),
        proposalState(data),
      ).join(),
    ).toMatch(/Port of Test has no placeId/);
    // An unresolved port is still restated by its exact name, and keeps its times.
    const scenic = calls({ kind: 'scenic', place: { label: 'glacier bay' } });
    const state = proposalState(data);
    expect(validateProposal(scenic, state)).toEqual([]);
    state.accepted.push(scenic);
    expect((queueFromProposals(state)[0].entity as Stay).portCalls?.[0]).toMatchObject({
      place: { id: null, label: 'Glacier Bay' },
      arrivesAt: '2027-06-29T07:00',
    });
  });

  it('puts the refund terms on a booked entry, not a cancelled one', () => {
    const state = proposalState(trip());
    state.refundTerms = { policy: 'nonrefundable', text: 'Nonrefundable.' };
    state.accepted.push(
      {
        entityId: 'ph_out',
        kind: 'transit',
        changes: {},
        booking: { ref: 'old', status: 'cancelled' },
        why: 's',
      },
      {
        entityId: 'act_lunch',
        kind: 'activity',
        changes: {},
        booking: { ref: 'new', status: 'booked' },
        why: 's',
      },
    );
    const queue = queueFromProposals(state);
    expect(queue.map((q) => q.notes.length)).toEqual([0, 1]);
  });
});

describe('third code-review fixes', () => {
  it('keeps a candidate the same change restates, with its id', () => {
    const state = proposalState(trip());
    state.accepted.push({
      entityId: 'act_breakfast',
      kind: 'activity',
      changes: {
        diningFormat: 'sit-down',
        mealOptions: [
          { place: { placeId: 'place_cafe', label: 'Café' } },
          { place: { label: 'Bakery' } },
        ],
      },
      why: 'Add a second candidate',
    });
    const [draft] = queueFromProposals(state);
    const options = (draft.entity as Activity).options ?? [];
    expect(options.map((o) => o.place?.label)).toEqual(['Café', 'Bakery']);
    expect(options[0]._id).toBe('o1');
  });

  it('marks a proposed place as aboard the ship', () => {
    const state = proposalState(trip());
    state.accepted.push({
      entityId: 'act_lunch',
      kind: 'activity',
      changes: { place: { placeId: 'place_theater', label: 'Ship Theater', onboard: true } },
      why: 'A show on the ship',
    });
    const [draft] = queueFromProposals(state);
    expect((draft.entity as Activity).place?.onboard).toBe(true);
  });

  it('stores no payable on a package with no cost', () => {
    const state = proposalState(trip());
    state.accepted.push({
      ...flight,
      changes: {
        packages: [{ name: 'Included with your tour', payable: 'atProperty', requires: 'none' }],
      },
    });
    const [draft] = queueFromProposals(state);
    expect((draft.entity as Transit).packages?.[0].payable).toBeUndefined();
  });
});

describe('isDateTime', () => {
  it('accepts real local date-times', () => {
    expect(isDateTime('2027-07-11T08:00')).toBe(true);
    expect(isDateTime('2028-02-29T23:59')).toBe(true);
  });

  it('rejects dates and clock times that do not exist', () => {
    expect(isDateTime('2027-07-32T10:00')).toBe(false);
    expect(isDateTime('2027-02-30T10:00')).toBe(false);
    expect(isDateTime('2027-07-11T24:75')).toBe(false);
    expect(isDateTime('2027-07-11')).toBe(false);
  });
});

// The tool input is the model's, unchecked: whatever a field holds, validation
// answers with errors (or accepts) and never throws. Each field of each sample
// is replaced in turn with a value of the wrong type — the net under the
// hand-written shape checks, so a new field can't reopen a TypeError.
describe('validation of malformed tool input', () => {
  const garbage: unknown[] = [null, 5, -1, NaN, '', 'x', true, [], [null], {}, { label: 5 }];
  const cruise: ChangeProposal = {
    entityId: 'stay_hotel',
    kind: 'stay',
    changes: {
      checkOutAt: '2027-06-30T08:00',
      portCalls: [
        {
          kind: 'port',
          place: { placeId: 'place_port', label: 'Port' },
          arrivesAt: '2027-06-28T07:00',
          departsAt: '2027-06-28T17:00',
        },
      ],
      packages: [{ name: 'Parking', cost: { amount: 5 }, payable: 'paid', requires: 'car' }],
    },
    booking: {
      ref: 'cruise',
      status: 'booked',
      perTraveler: [{ travelerId: 't1', amount: 100, payable: 'paid' }],
      fixed: [{ label: 'Fee', amount: 5, payable: 'atProperty' }],
    },
    why: 's',
  };
  const meal: ChangeProposal = {
    entityId: 'act_lunch',
    kind: 'activity',
    changes: {
      mealOptions: [{ place: { label: 'Cafe', notOnGoogle: true }, diningFormat: 'sit-down' }],
      travelers: ['t1'],
    },
    addOption: {
      place: { label: 'Bistro', onboard: true, replaces: 'place_cafe' },
      diningFormat: 'sit-down',
    },
    why: 's',
  };

  // Every copy of `value` with one nested field replaced by `bad`.
  function* mutations(value: unknown, bad: unknown): Generator<unknown> {
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      const child = (value as Record<string, unknown>)[key];
      const copy = (next: unknown) =>
        Array.isArray(value)
          ? Object.assign([...value], { [key]: next })
          : { ...value, [key]: next };
      yield copy(bad);
      for (const inner of mutations(child, bad)) yield copy(inner);
    }
  }

  it.each([
    ['flight', flight],
    ['cruise', cruise],
    ['meal', meal],
    [
      'seated flight',
      {
        ...flight,
        changes: {
          ...flight.changes,
          travelers: ['t1', 't2'],
          seats: [{ travelerId: 't1', seat: '1A' }],
        },
      },
    ],
  ])('never throws on a mutated %s', (_name, sample) => {
    for (const bad of garbage) {
      for (const mutated of mutations(sample, bad)) {
        expect(() => {
          // The entry point the callers use (it remaps travelers first), then
          // what passes is queued at finish, which must hold too.
          const checked = checkedChanges([mutated as ChangeProposal], trip(), {
            searches: { placeIds: new Set(['place_port']), emptyQueries: new Set() },
            travelers: [{ id: 't1', name: 'Someone New' }],
          });
          if ('state' in checked) queueFromProposals(checked.state);
        }).not.toThrow();
      }
    }
  });

  it('never throws on a malformed note', () => {
    const state = proposalState(trip());
    state.accepted.push(flight);
    const note = { kind: 'info', text: 'x', concerns: 'ph_out' };
    expect(validateNote(note as never, state)).toEqual([]);
    for (const bad of garbage) {
      for (const key of Object.keys(note)) {
        expect(() => validateNote({ ...note, [key]: bad } as never, state)).not.toThrow();
      }
      expect(() => validateNote(bad as never, state)).not.toThrow();
    }
  });

  it('turns down an added option with no place, and a total in another currency', () => {
    const state = proposalState(trip());
    const noPlace = {
      ...meal,
      addOption: { diningFormat: 'sit-down' },
    } as unknown as ChangeProposal;
    expect(validateProposal(noPlace, state).join()).toMatch(/addOption needs a place/);
    state.accepted.push(flight);
    expect(
      validateFinish(state, { amount: 2050, currency: 'EUR' }, { policy: 'none' }).join(),
    ).toMatch(/different currencies/);
  });

  it('turns down an empty traveler list and a new activity timed on another day', () => {
    const state = proposalState(trip());
    const lunch = (changes: ChangeProposal['changes'], date = '2027-07-11'): ChangeProposal => ({
      kind: 'activity',
      legId: 'leg_t',
      date,
      changes: { text: 'Dinner', ...changes },
      why: 's',
    });
    expect(validateProposal(lunch({ travelers: [] }), state).join()).toMatch(/use null/);
    expect(validateProposal(lunch({ startAt: '2027-07-12T19:00' }), state).join()).toMatch(
      /isn't on the entry's date/,
    );
    expect(validateProposal(lunch({ startAt: '2027-07-11T19:00' }), state)).toEqual([]);
  });

  it('checks places, durations, package travelers and a new stay’s own start', () => {
    const state = proposalState(trip());
    const act = (changes: unknown): ChangeProposal =>
      ({ kind: 'activity', legId: 'leg_t', date: '2027-07-11', changes, why: 's' }) as never;
    expect(validateProposal(act({ text: 'x', place: 'Anchorage' }), state).join()).toMatch(
      /place must be a place with a label/,
    );
    expect(validateProposal(act({ text: 'x', durationMinutes: '90' }), state).join()).toMatch(
      /durationMinutes must be a positive number/,
    );
    expect(
      validateProposal(
        {
          entityId: 'ph_out',
          kind: 'transit',
          changes: { packages: [{ name: 'x', requires: 'none', travelers: 't1' }] },
          why: 's',
        } as never,
        state,
      ).join(),
    ).toMatch(/travelers must be a list/);
    const stay: ChangeProposal = {
      kind: 'stay',
      legId: 'leg_t',
      date: '2027-07-11',
      changes: { checkInAt: '2030-01-01T15:00', checkOutAt: '2030-01-02T11:00' },
      why: 's',
    };
    expect(validateProposal(stay, state).join()).toMatch(/2030-01-01 is outside this trip/);
  });

  it('turns down package benefits that aren’t a list, and an empty seats list', () => {
    const state = proposalState(trip());
    const edit = (changes: unknown): ChangeProposal =>
      ({ entityId: 'ph_out', kind: 'transit', changes, why: 's' }) as never;
    expect(
      validateProposal(
        edit({ packages: [{ name: 'x', requires: 'none', benefits: 'Headset' }] }),
        state,
      ).join(),
    ).toMatch(/benefits must be a list/);
    expect(validateProposal(edit({ seats: [] }), state).join()).toMatch(/seats is empty/);
  });

  it('keeps a package’s nightly rate when a restatement corrects only its price', () => {
    const parking = {
      ...blankPackage(),
      name: 'Parking',
      per: 'night' as const,
      payable: 'atProperty' as const,
      cost: { amount: 20, currency: 'USD' },
    };
    const [merged] = mergePackages(
      [parking],
      [{ ...blankPackage(), name: 'parking', cost: { amount: 30, currency: 'USD' } }],
    );
    expect(merged).toMatchObject({ per: 'night', cost: { amount: 30 } });
  });

  it('gives one booking one price, split included', () => {
    const state = proposalState(trip());
    const priced = (booking: ChangeProposal['booking']): ChangeProposal => ({ ...flight, booking });
    state.accepted.push(flight);
    const resplit = priced({
      ref: 'tour',
      status: 'booked',
      fixed: [{ label: 'All of it', amount: 2050, payable: 'paid' }],
    });
    expect(
      validateProposal(
        { ...resplit, entityId: 'act_lunch', kind: 'activity', changes: {} },
        state,
      ).join(),
    ).toMatch(/Give one booking one price/);
  });

  it('keeps an entry’s curated place label when a change restates its place id', () => {
    const data = trip();
    data.transits[0].from = {
      id: 'place_base',
      label: 'Ted Stevens Anchorage International (ANC)',
    };
    const state = proposalState(data);
    state.accepted.push({
      entityId: 'ph_out',
      kind: 'transit',
      changes: { from: { placeId: 'place_base', label: 'Anchorage Airport' } },
      why: 's',
    });
    const [queued] = queueFromProposals(state);
    expect((queued.entity as Transit).from.label).toBe('Ted Stevens Anchorage International (ANC)');
  });

  it('turns down fares and seats with no traveler, and a traveler with a bad age', () => {
    const state = proposalState(trip());
    const edit = (extra: object): ChangeProposal =>
      ({ ...flight, ...extra }) as unknown as ChangeProposal;
    expect(
      validateProposal(
        edit({
          booking: { ref: 'r', status: 'booked', perTraveler: [{ amount: 5, payable: 'paid' }] },
        }),
        state,
      ).join(),
    ).toMatch(/each fare needs a travelerId/);
    expect(
      validateProposal(edit({ changes: { seats: [{ travelerId: 't1' }] } }), state).join(),
    ).toMatch(/each seat needs/);
    expect(addTraveler({ name: 'Kid', age: '12' as never }, state)).toHaveProperty('errors');
  });

  it('counts a booking’s price on file only when the queue will reuse that booking', () => {
    const data = trip();
    data.bookings = [
      {
        _id: 'bk_lunch',
        status: 'booked',
        confirmationNumber: 'OLD',
        pricing: {
          perTraveler: [],
          fixed: [{ label: 'x', amount: { amount: 40, currency: 'USD' }, payable: 'paid' }],
        },
      } as never,
    ];
    data.transits[0].bookingId = 'bk_lunch';
    const state = proposalState(data);
    state.accepted.push({
      entityId: 'ph_out',
      kind: 'transit',
      changes: {},
      booking: { ref: 'r', status: 'booked', confirmationNumber: 'NEW' },
      why: 's',
    });
    expect(validateFinish(state, { amount: 0 }, { policy: 'none' })).toEqual([]);
    expect(validateFinish(state, { amount: 40 }, { policy: 'none' }).join()).toMatch(
      /add up to 0.00/,
    );
  });

  it('requires includedWith for a covered meal format, and only then, and text for text fields', () => {
    const state = proposalState(trip());
    const meal = (changes: object): ChangeProposal =>
      ({ entityId: 'act_lunch', kind: 'activity', changes, why: 's' }) as never;
    expect(validateProposal(meal({ diningFormat: 'included-with-transit' }), state).join()).toMatch(
      /needs includedWith/,
    );
    expect(
      validateProposal(meal({ diningFormat: 'sit-down', includedWith: 'ph_out' }), state).join(),
    ).toMatch(/includedWith only goes with/);
    expect(
      validateProposal(
        meal({ diningFormat: 'included-with-transit', includedWith: 'ph_out' }),
        state,
      ),
    ).toEqual([]);
    expect(validateProposal(meal({ text: 5 }), state).join()).toMatch(/text must be text/);
  });

  it('restates a package by name, and tells same-named ones apart by who they cover', () => {
    const drinks = (travelers: string[], amount: number) => ({
      ...blankPackage(),
      name: 'Drinks',
      travelers,
      cost: { amount, currency: 'USD' },
    });
    const two = [drinks(['t1'], 50), drinks(['t2'], 30)];
    expect(mergePackages(two, [drinks(['t2'], 35)]).map((p) => p.cost?.amount)).toEqual([50, 35]);
    expect(mergePackages([two[0]], [drinks(['t2'], 35)])).toHaveLength(1);
    const state = proposalState(trip());
    const twice: ChangeProposal = {
      entityId: 'ph_out',
      kind: 'transit',
      changes: {
        packages: [
          { name: 'Drinks', requires: 'none' },
          { name: 'drinks', requires: 'none' },
        ],
      },
      why: 's',
    };
    expect(validateProposal(twice, state).join()).toMatch(/Two packages are named/);
  });

  it('lets a restatement make a nightly fee a flat one, and turns down credits as packages', () => {
    const parking = {
      ...blankPackage(),
      name: 'Parking',
      per: 'night' as const,
      cost: { amount: 10, currency: 'USD' },
    };
    const flat = {
      ...blankPackage(),
      name: 'Parking',
      per: 'once' as const,
      cost: { amount: 10, currency: 'USD' },
    };
    expect(mergePackages([parking], [flat])[0].per).toBeUndefined();
    const state = proposalState(trip());
    const credit: ChangeProposal = {
      entityId: 'ph_out',
      kind: 'transit',
      changes: {
        packages: [{ name: 'Credit', cost: { amount: -100 }, payable: 'paid', requires: 'none' }],
      },
      why: 's',
    };
    expect(validateProposal(credit, state).join()).toMatch(/credit isn't a package/);
    const fare = {
      ...flight,
      booking: {
        ref: 'r',
        status: 'booked' as const,
        perTraveler: [{ travelerId: 't1', amount: -5, payable: 'paid' as const }],
      },
    };
    expect(validateProposal(fare, state).join()).toMatch(/fare can't be negative/);
  });

  it('counts a moved drive on its new day only when checking a car package', () => {
    const data = trip();
    data.transits[0] = {
      ...data.transits[0],
      mode: 'drive',
      departsAt: '2027-07-11T08:30',
      arrivesAt: '2027-07-11T09:30',
    };
    const state = proposalState(data);
    state.accepted.push({
      entityId: 'ph_out',
      kind: 'transit',
      changes: { departsAt: '2027-07-12T08:30', arrivesAt: '2027-07-12T09:30' },
      why: 's',
    });
    const parking: ChangeProposal = {
      kind: 'activity',
      legId: 'leg_t',
      date: '2027-07-11',
      changes: {
        text: 'Visit',
        packages: [{ name: 'Parking', cost: { amount: 5 }, payable: 'paid', requires: 'car' }],
      },
      why: 's',
    };
    expect(validateProposal(parking, state).join()).toMatch(/no drive happens on 2027-07-11/);
  });

  it('never throws finishing on a malformed total or terms', () => {
    const state = proposalState(trip());
    state.accepted.push(flight);
    const finish = {
      total: { amount: 2050, currency: 'USD' },
      terms: { policy: 'partial', text: 't' },
    };
    for (const bad of garbage) {
      expect(() => validateFinish(state, bad as never, bad as never)).not.toThrow();
      for (const mutated of mutations(finish, bad) as Generator<typeof finish>) {
        expect(() => {
          validateFinish(state, mutated.total as never, mutated.terms as never);
          state.refundTerms = mutated.terms as never;
          queueFromProposals(state);
        }).not.toThrow();
      }
    }
  });
});

// Every way a change reaches the trip must refuse the same input. A rule that
// lives in one path (the import, the chat's propose_edit, a day plan's apply)
// but not the next is how most review findings arose, so the same hostile
// changes go through the shared check and through the apply path, and both
// must turn them down — a new entry point or rule added to one is tested here.
describe('entry point parity', () => {
  const onNewActivity = (changes: unknown): ChangeProposal =>
    ({
      kind: 'activity',
      legId: 'leg_t',
      date: '2027-07-11',
      changes,
      why: 's',
    }) as never;
  const hostile: [string, unknown][] = [
    ['a text that is a number', { text: 5 }],
    ['a place that is a bare string', { text: 'x', place: 'Anchorage' }],
    ['a duration that is text', { text: 'x', durationMinutes: '90' }],
    ['an empty traveler list', { text: 'x', travelers: [] }],
    ['packages that are not a list', { text: 'x', packages: { name: 'p' } }],
    ['a start on another day', { text: 'x', startAt: '2027-07-12T19:00' }],
    ['a covered meal with nothing covering it', { text: 'x', diningFormat: 'included' }],
    ['a new place with no placeId', { text: 'x', place: { label: 'Somewhere' } }],
    ['a place with a placeId that is not text', { text: 'x', place: { label: 'x', placeId: 5 } }],
    [
      'a package costing less than nothing',
      {
        text: 'x',
        packages: [{ name: 'Credit', cost: { amount: -5 }, payable: 'paid', requires: 'none' }],
      },
    ],
  ];

  it.each(hostile)('turns down %s everywhere', (_name, changes) => {
    const proposal = onNewActivity(changes);
    const checked = checkedChanges([proposal], trip(), { searches: noPlaceSearches() });
    expect('errors' in checked).toBe(true);
    expect('error' in applyBatch(trip(), [proposal])).toBe(true);
  });

  it('turns down a resolved place renamed without its id everywhere, and takes its id back', () => {
    const renamed = (to: { label: string; placeId?: string }): ChangeProposal => ({
      entityId: 'ph_out',
      kind: 'transit',
      changes: { to },
      why: 's',
    });
    const hostile = renamed({ label: 'The Remote Lodge' });
    const checked = checkedChanges([hostile], trip(), { searches: noPlaceSearches() });
    expect('errors' in checked && checked.errors.join()).toMatch(
      /Remote Lodge \(placeId place_lodge\)/,
    );
    expect('error' in applyBatch(trip(), [hostile])).toBe(true);
    const restated = renamed({ label: 'The Remote Lodge', placeId: 'place_lodge' });
    expect('state' in checkedChanges([restated], trip(), { searches: noPlaceSearches() })).toBe(
      true,
    );
    expect('data' in applyBatch(trip(), [restated])).toBe(true);
  });

  it('takes a new place by its searched id, or as notOnGoogle after an empty search, through both', () => {
    const at = (place: Record<string, unknown>) =>
      onNewActivity({ text: 'Walk', startAt: '2027-07-11T10:00', place });
    const found = at({ label: 'Trailhead', placeId: 'place_trailhead' });
    const searches = noPlaceSearches();
    searches.placeIds.add('place_trailhead');
    expect('state' in checkedChanges([found], trip(), { searches })).toBe(true);
    expect('data' in applyBatch(trip(), [found])).toBe(true);
    // Applying it trusts the search checked when it was proposed (placesChecked),
    // so only the proposing half can show the empty search is needed.
    const unlisted = at({ label: 'Trailhead', notOnGoogle: true });
    expect('errors' in checkedChanges([unlisted], trip(), { searches })).toBe(true);
    searches.emptyQueries.add('Trailhead');
    expect('state' in checkedChanges([unlisted], trip(), { searches })).toBe(true);
    expect('data' in applyBatch(trip(), [unlisted])).toBe(true);
  });

  it('turns down a ship venue taking over from a resolved place unless it names it, through both', () => {
    const aboard = (place: Record<string, unknown>): ChangeProposal => ({
      entityId: 'ph_out',
      kind: 'transit',
      changes: { to: { label: 'Ship Theater', onboard: true, ...place } },
      why: 's',
    });
    const hostile = aboard({});
    expect('errors' in checkedChanges([hostile], trip(), { searches: noPlaceSearches() })).toBe(
      true,
    );
    expect('error' in applyBatch(trip(), [hostile])).toBe(true);
    const named = aboard({ replaces: 'place_lodge' });
    expect('state' in checkedChanges([named], trip(), { searches: noPlaceSearches() })).toBe(true);
    expect('data' in applyBatch(trip(), [named])).toBe(true);
  });

  it('accepts a plain new activity through both', () => {
    const proposal = onNewActivity({ text: 'Walk', startAt: '2027-07-11T10:00' });
    expect('state' in checkedChanges([proposal], trip(), { searches: noPlaceSearches() })).toBe(
      true,
    );
    expect('data' in applyBatch(trip(), [proposal])).toBe(true);
  });
});
