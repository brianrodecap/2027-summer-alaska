import { describe, expect, it } from 'vitest';

import {
  applyRouteForm,
  applyScenarioSave,
  applyStayForm,
  applyTransitForm,
  applyTripForm,
  blankRouteVariant,
  blankStay,
  blankTransit,
  NO_BOOKINGS,
  packagesFromForm,
  routeFormFrom,
  stayFormFrom,
  transitFormFrom,
  tripFormFrom,
} from './editForms';
import type { Package, Route, Scenario, Transit, Trip } from './types';

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
    ).toMatch(/after the ship arrives/);
    expect(
      applyStayForm(stay, { ...form, portCalls: [{ ...call, arrivesAt: '2027-08-01T06:00' }] }),
    ).toMatch(/between check-in and check-out/);
  });
});
