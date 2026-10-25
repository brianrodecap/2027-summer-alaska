import { describe, expect, it } from 'vitest';

import {
  activityFormFrom,
  applyActivityForm,
  applyRouteForm,
  applyScenarioSave,
  applyStayForm,
  applyTransitForm,
  applyTripForm,
  blankActivity,
  blankRouteVariant,
  blankStay,
  blankTransit,
  bookingCoverageLabels,
  NO_BOOKINGS,
  packagesFromForm,
  routeFormFrom,
  stayFormFrom,
  transitFormFrom,
  tripFormFrom,
} from './editForms';
import type { Leg, Package, Route, Scenario, Transit, Trip } from './types';

// Synthetic fixture only — never the real public/data/routes.json, which is the
// site's live, actively-edited reference data rather than a fixed test fixture.
function syntheticRoute(): Route {
  return {
    _id: 'route_test',
    from: { id: 'place_a', label: 'Town A' },
    to: { id: 'place_b', label: 'Town B' },
    variants: [
      {
        tone: 'direct',
        label: 'Highway',
        places: [
          {
            kind: 'waypoint',
            place: { id: 'place_w', label: 'Viewpoint' },
            travel: { minutes: 40 },
          },
        ],
        finalTravel: { minutes: 25 },
      },
      {
        tone: 'scenic',
        label: 'Back road',
        places: [{ kind: 'via', place: { id: 'place_v', label: 'Pass' }, travel: { minutes: 15 } }],
        finalTravel: { minutes: 90 },
      },
    ],
    images: [],
  };
}

describe('Route edit form apply logic', () => {
  it('round-trips an unchanged route through the form with no error', () => {
    const route = syntheticRoute();
    const form = routeFormFrom(route);
    const clone = structuredClone(route);
    const message = applyRouteForm(clone, form);
    expect(message).toBeNull();
    expect(clone.variants).toEqual(route.variants);
    expect(clone.from.label).toBe(route.from.label);
  });

  it('rejects a route with no variants', () => {
    const form: Route = {
      _id: 'x',
      from: { id: null, label: 'A' },
      to: { id: null, label: 'B' },
      variants: [],
      images: [],
    };
    const message = applyRouteForm(structuredClone(form), form);
    expect(message).toMatch(/at least one variant/);
  });

  it('rejects a variant place entry missing a Google Place ID', () => {
    const form: Route = {
      _id: 'x',
      from: { id: null, label: 'A' },
      to: { id: null, label: 'B' },
      variants: [
        {
          tone: 'direct',
          label: 'Direct',
          places: [
            { kind: 'waypoint', place: { id: null, label: 'Somewhere' }, travel: { minutes: 10 } },
          ],
          finalTravel: { minutes: 5 },
        },
      ],
      images: [],
    };
    const message = applyRouteForm(structuredClone(form), form);
    expect(message).toMatch(/Google Place ID/);
  });

  it('rejects a negative final travel time', () => {
    const form: Route = {
      _id: 'x',
      from: { id: null, label: 'A' },
      to: { id: null, label: 'B' },
      variants: [{ tone: 'direct', label: 'Direct', places: [], finalTravel: { minutes: -1 } }],
      images: [],
    };
    const message = applyRouteForm(structuredClone(form), form);
    expect(message).toMatch(/final travel time/);
  });

  it("rejects a negative waypoint stop duration, but accepts one that's left unset", () => {
    const form = syntheticRoute();
    expect(applyRouteForm(structuredClone(form), form)).toBeNull();
    form.variants[0].places[0].durationMinutes = -5;
    expect(applyRouteForm(structuredClone(form), form)).toMatch(/stop duration/);
  });
});

describe('the direct-variant rule in the route form', () => {
  it('rejects a via on the direct variant, and a second direct variant', () => {
    const viaOnDirect = syntheticRoute();
    viaOnDirect.variants[0].places.push({
      kind: 'via',
      place: { id: 'place_x', label: 'Cutoff' },
      travel: { minutes: 5 },
    });
    expect(applyRouteForm(structuredClone(viaOnDirect), viaOnDirect)).toMatch(/can't have vias/);

    const twoDirect = syntheticRoute();
    twoDirect.variants[1].tone = 'direct';
    expect(applyRouteForm(structuredClone(twoDirect), twoDirect)).toMatch(/exactly one 'direct'/);
  });

  it('starts a new route on direct and any later variant on scenic', () => {
    expect(blankRouteVariant().tone).toBe('direct');
    expect(blankRouteVariant(syntheticRoute().variants).tone).toBe('scenic');
  });
});

describe('Transit show-endpoints-on-maps opt-in', () => {
  const routed = (): Transit => ({
    ...blankTransit('leg_test', '2027-06-01'),
    routeId: 'route_test',
    routeVariant: 'direct',
  });

  it('stores the opt-in only when set on a routed Transit', () => {
    const transit = routed();
    const form = transitFormFrom(transit, NO_BOOKINGS);
    expect(form.showEndpointsOnMap).toBe(false);
    expect(applyTransitForm(transit, { ...form, showEndpointsOnMap: true })).toBeNull();
    expect(transit.showEndpointsOnMap).toBe(true);
    expect(applyTransitForm(transit, { ...form, showEndpointsOnMap: false })).toBeNull();
    expect('showEndpointsOnMap' in transit).toBe(false);
  });

  it('drops the opt-in once the route is cleared', () => {
    const transit = { ...routed(), showEndpointsOnMap: true };
    const form = {
      ...transitFormFrom(transit, NO_BOOKINGS),
      routeId: null,
      arrivesDate: '2027-06-01',
      arrivesTime: '12:00',
    };
    expect(applyTransitForm(transit, form)).toBeNull();
    expect('showEndpointsOnMap' in transit).toBe(false);
  });
});

describe('Transit seats', () => {
  it('drops the seat of a traveler no longer on board', () => {
    const transit = blankTransit('leg_test', '2027-06-01');
    const form = {
      ...transitFormFrom(transit, NO_BOOKINGS),
      arrivesDate: '2027-06-01',
      arrivesTime: '12:00',
      travelerIds: ['t_a'],
      seats: [
        { travelerId: 't_a', seat: '1A' },
        { travelerId: 't_b', seat: '1B' },
      ],
    };
    expect(applyTransitForm(transit, form)).toBeNull();
    expect(transit.seats).toEqual([{ travelerId: 't_a', seat: '1A' }]);
    expect(applyTransitForm(transit, { ...form, travelerIds: [] })).toBeNull();
    expect(transit.seats).toHaveLength(2);
  });
});

describe('applyScenarioSave', () => {
  const scenario = (id: string, tone: Scenario['tone']): Scenario => ({
    _id: id,
    legId: 'leg_test',
    tone,
    label: id,
    icon: 'help_outline',
    images: [],
    date: '2027-06-01',
  });
  const store = (scenarios: Scenario[]) => ({ scenarios, activities: [], transits: [] });

  it('refuses a brand-new second ideal with a message instead of writing anything', () => {
    const before = store([scenario('ideal', 'ideal')]);
    const result = applyScenarioSave(before, scenario('another', 'ideal'), true);
    expect(result).toEqual({ error: expect.stringContaining('already has an ideal') });
  });

  it('demotes the previous ideal and upserts both scenarios when an alternate is promoted', () => {
    const before = store([scenario('ideal', 'ideal'), scenario('alt', 'alternate')]);
    const result = applyScenarioSave(before, scenario('alt', 'ideal'), false);
    if (!('data' in result)) throw new Error('expected a saved store');
    expect(Object.fromEntries(result.data.scenarios.map((s) => [s._id, s.tone]))).toEqual({
      ideal: 'alternate',
      alt: 'ideal',
    });
  });
});

describe('trip form: pets', () => {
  const trip: Trip = { _id: 'trip_t', name: 'Test Trip', travelers: [], images: [] };

  it('stores pets only when the party brings them', () => {
    const on = applyTripForm(trip, { ...tripFormFrom(trip, 'test-trip'), pets: true }, []);
    expect(typeof on !== 'string' && on.trip.pets).toBe(true);
    const off = applyTripForm({ ...trip, pets: true }, tripFormFrom(trip, 'test-trip'), []);
    expect(typeof off !== 'string' && 'pets' in off.trip).toBe(false);
  });
});

describe('packagesFromForm', () => {
  const row = (overrides: Partial<Package>): Package => ({
    _id: 'p',
    name: 'Fee',
    status: 'booked',
    cost: { amount: 10, currency: 'USD' },
    confirmationNumber: null,
    benefits: null,
    travelers: null,
    ...overrides,
  });

  it('drops unnamed rows and a due date never picked', () => {
    expect(packagesFromForm([row({ name: ' ' })])).toBeNull();
    const [kept] = packagesFromForm([row({ payable: { dueBy: '' } })]) ?? [];
    expect('payable' in kept).toBe(false);
    const [atProperty] = packagesFromForm([row({ payable: 'atProperty' })]) ?? [];
    expect(atProperty.payable).toBe('atProperty');
  });

  it('keeps no charge settings on a package with no cost', () => {
    const [free] =
      packagesFromForm([row({ cost: null, per: 'night', payable: 'atProperty' })]) ?? [];
    expect('per' in free || 'payable' in free).toBe(false);
  });

  it('drops an emptied list from a transit instead of storing null', () => {
    const transit = { ...blankTransit('leg_t', '2027-07-01'), packages: [row({})] };
    const form = { ...transitFormFrom(transit, NO_BOOKINGS), packages: [] };
    form.departsTime = '08:00';
    form.arrivesDate = '2027-07-01';
    form.arrivesTime = '09:00';
    expect(applyTransitForm(transit, form)).toBeNull();
    expect('packages' in transit).toBe(false);
  });
});

describe('stay form: port calls', () => {
  it('keeps named stops, drops unfinished rows, and leaves a hotel with none', () => {
    const stay = blankStay('leg_t', '2027-07-17');
    const form = {
      ...stayFormFrom(stay, NO_BOOKINGS),
      checkInDate: '2027-07-17',
      checkInTime: '16:00',
      checkOutDate: '2027-07-24',
      checkOutTime: '08:00',
    };
    const juneau = {
      kind: 'port' as const,
      place: { id: 'place_juneau', label: 'Juneau' },
      arrivesAt: '2027-07-21T06:30',
      departsAt: '2027-07-21T16:15',
    };
    const blank = { ...juneau, place: { id: null, label: ' ' }, arrivesAt: null, departsAt: null };
    expect(applyStayForm(stay, { ...form, portCalls: [juneau, blank] })).toBeNull();
    expect(stay.portCalls).toEqual([juneau]);

    // Times entered with no port would be lost silently, so it is an error instead.
    const timedBlank = { ...juneau, place: { id: null, label: ' ' } };
    expect(applyStayForm(stay, { ...form, portCalls: [juneau, timedBlank] })).toMatch(/no port/);

    expect(applyStayForm(stay, { ...form, portCalls: [] })).toBeNull();
    expect('portCalls' in stay).toBe(false);
  });

  it('turns down a named stop with no time, or one outside the stay', () => {
    const stay = blankStay('leg_t', '2027-07-17');
    const form = {
      ...stayFormFrom(stay, NO_BOOKINGS),
      checkInDate: '2027-07-17',
      checkInTime: '16:00',
      checkOutDate: '2027-07-24',
      checkOutTime: '08:00',
    };
    const call = {
      kind: 'port' as const,
      place: { id: 'place_juneau', label: 'Juneau' },
      arrivesAt: null,
      departsAt: null,
    };
    expect(applyStayForm(stay, { ...form, portCalls: [call] })).toMatch(/arrival or departure/);
    expect(
      applyStayForm(stay, {
        ...form,
        portCalls: [{ ...call, arrivesAt: '2027-07-21T16:00', departsAt: '2027-07-21T07:00' }],
      }),
    ).toBe('Juneau: leaves 2027-07-21T07:00, not after it arrives 2027-07-21T16:00.');
    expect(
      applyStayForm(stay, { ...form, portCalls: [{ ...call, arrivesAt: '2027-08-01T06:00' }] }),
    ).toMatch(/Juneau at .* is outside the cruise \(2027-07-17T16:00 to 2027-07-24T08:00\)\./);
  });
});

describe('bookingCoverageLabels', () => {
  it('names what else a booking pays for, leaving out the entry it is shown on', () => {
    const leg = { _id: 'leg1', name: 'Test leg', bookingId: 'b1' } as Leg;
    const ship = {
      ...blankStay('leg1', '2027-07-01'),
      _id: 'stay1',
      bookingId: 'b1',
      lodging: { place: { id: null, label: 'Test ship' } },
    };
    const other = { ...blankStay('leg1', '2027-07-01'), _id: 'stay2', bookingId: 'b2' };
    const data = { legs: [leg], stays: [ship, other], transits: [], activities: [] };
    expect(bookingCoverageLabels(data, 'b1', 'stay1')).toEqual(['Test leg']);
    expect(bookingCoverageLabels(data, 'b1')).toEqual(['Test leg', 'Test ship']);
  });
});

describe('form times, held to the same rules as every AI proposal', () => {
  const flight = (from?: string, to?: string) => {
    const transit = blankTransit('leg_test', '2027-07-11');
    transit.from = { id: 'p_hnd', label: 'Haneda', ...(from ? { timeZone: from } : {}) };
    transit.to = { id: 'p_anc', label: 'Anchorage', ...(to ? { timeZone: to } : {}) };
    return transit;
  };
  // Leaves Tokyo 23:30 (14:30 UTC); lands Anchorage 08:00 the same day (16:00 UTC).
  const tokyoToAnchorage = (transit: Transit) =>
    applyTransitForm(transit, {
      ...transitFormFrom(transit, NO_BOOKINGS),
      departsDate: '2027-07-11',
      departsTime: '23:30',
      arrivesDate: '2027-07-11',
      arrivesTime: '08:00',
    });

  it('takes an arrival that reads earlier once both places’ zones are known', () => {
    expect(tokyoToAnchorage(flight('Asia/Tokyo', 'America/Anchorage'))).toBeNull();
  });

  it('turns down an earlier-reading arrival without zones, saying how to give them', () => {
    expect(tokyoToAnchorage(flight())).toBe(
      'Arrives 2027-07-11T08:00, not after it departs 2027-07-11T23:30. If the two places keep different clocks, pick each one from the place search so its time zone is known.',
    );
  });

  it('turns down a port-call time that isn’t a date-time, as the AI paths do', () => {
    const stay = blankStay('leg_t', '2027-07-17');
    const form = {
      ...stayFormFrom(stay, NO_BOOKINGS),
      checkInDate: '2027-07-17',
      checkInTime: '16:00',
      checkOutDate: '2027-07-24',
      checkOutTime: '08:00',
      portCalls: [
        {
          kind: 'port' as const,
          place: { id: 'place_juneau', label: 'Juneau' },
          arrivesAt: '2027-07-21T7:00',
          departsAt: null,
        },
      ],
    };
    expect(applyStayForm(stay, form)).toBe('Juneau: times look like 2027-07-21T06:30.');
  });

  it('keeps a port call at the last port inside a cruise that ends in another zone', () => {
    // The ship's zone is its embarkation port's (UTC-7); it checks out in Seward
    // (UTC-8). The 07:30 Seward stop is before the 08:00 check-out on the clock.
    const stay = blankStay('leg_t', '2027-07-17');
    stay.lodging = { place: { id: 'p_ship', label: 'Ship', timeZone: 'America/Vancouver' } };
    const form = {
      ...stayFormFrom(stay, NO_BOOKINGS),
      checkInDate: '2027-07-17',
      checkInTime: '16:00',
      checkOutDate: '2027-07-24',
      checkOutTime: '08:00',
      portCalls: [
        {
          kind: 'port' as const,
          place: { id: 'p_seward', label: 'Seward', timeZone: 'America/Anchorage' },
          arrivesAt: '2027-07-24T07:30',
          departsAt: null,
        },
      ],
    };
    expect(applyStayForm(stay, form)).toBeNull();
  });

  it('turns down a check-out at or before check-in', () => {
    const stay = blankStay('leg_t', '2027-07-17');
    const form = {
      ...stayFormFrom(stay, NO_BOOKINGS),
      checkInDate: '2027-07-17',
      checkInTime: '16:00',
      checkOutDate: '2027-07-17',
      checkOutTime: '16:00',
    };
    expect(applyStayForm(stay, form)).toBe(
      'Checks out 2027-07-17T16:00, not after check-in 2027-07-17T16:00.',
    );
  });
});

describe("a booking's own clock in the forms", () => {
  const tour = () => {
    const activity = blankActivity('leg_t', '2027-07-11');
    activity.startAt = '2027-07-11T10:00';
    activity.date = null;
    activity.text = 'Tour';
    return activity;
  };
  const withClock = (clockZone: string, activity = tour()) => {
    const error = applyActivityForm(activity, {
      ...activityFormFrom(activity, NO_BOOKINGS),
      clockZone,
    });
    return error ?? activity.clockZone;
  };

  it('stores any spelling of a known zone by its canonical name', () => {
    expect(withClock('us/arizona')).toBe('America/Phoenix');
  });

  it("leaves it off when the form's clock is cleared", () => {
    const activity = { ...tour(), clockZone: 'America/Phoenix' };
    expect(withClock('', activity)).toBeUndefined();
    expect('clockZone' in activity).toBe(false);
  });

  it('turns down a clock that is not a time zone', () => {
    expect(withClock('Arizona time')).toMatch(/isn't a time zone/);
  });

  it('drops the clock when the activity moves to another place, unless the form restates it', () => {
    const canyon = { id: 'p_canyon', label: 'Canyon' };
    const at = (
      place: { id: string | null; label: string } | null,
      clockZone = 'America/Phoenix',
    ) => {
      const activity = { ...tour(), place: canyon, clockZone: 'America/Phoenix' };
      applyActivityForm(activity, { ...activityFormFrom(activity, NO_BOOKINGS), place, clockZone });
      return activity.clockZone;
    };
    expect(at({ id: 'p_lodge', label: 'Lodge' })).toBeUndefined();
    expect(at({ ...canyon, label: 'Upper Canyon' })).toBe('America/Phoenix');
    expect(at({ id: 'p_lodge', label: 'Lodge' }, 'America/Denver')).toBe('America/Denver');
  });

  it('drops the clock from a rough time of day', () => {
    const activity = { ...tour(), clockZone: 'America/Phoenix' };
    applyActivityForm(activity, {
      ...activityFormFrom(activity, NO_BOOKINGS),
      startsTime: null,
      timeLabel: 'Morning',
    });
    expect(activity.clockZone).toBeUndefined();
  });

  it('keeps a stay’s clock when the lodging box is emptied, since the lodging stays', () => {
    const stay = {
      ...blankStay('leg_t', '2027-07-17'),
      lodging: { place: { id: 'p_ship', label: 'Ship' } },
      clockZone: 'America/Vancouver',
    };
    expect(applyStayForm(stay, { ...stayFormFrom(stay, NO_BOOKINGS), place: null })).toBeNull();
    expect(stay.clockZone).toBe('America/Vancouver');
  });

  it("checks a cruise's port calls on the clock the form gives it", () => {
    // Boarding at 16:00 on Vancouver time is 15:00 in Juneau, so a 15:30 call
    // is inside the cruise only on that clock.
    const stay = blankStay('leg_t', '2027-07-17');
    const form = (clockZone: string) => ({
      ...stayFormFrom(stay, NO_BOOKINGS),
      checkInDate: '2027-07-17',
      checkInTime: '16:00',
      checkOutDate: '2027-07-24',
      checkOutTime: '08:00',
      clockZone,
      portCalls: [
        {
          kind: 'port' as const,
          place: { id: 'p_juneau', label: 'Juneau', timeZone: 'America/Juneau' },
          arrivesAt: '2027-07-17T15:30',
          departsAt: '2027-07-17T20:00',
        },
      ],
    });
    expect(applyStayForm(stay, form(''))).toMatch(/outside the cruise/);
    expect(applyStayForm(stay, form('America/Vancouver'))).toBeNull();
    expect(stay.clockZone).toBe('America/Vancouver');
  });
});
