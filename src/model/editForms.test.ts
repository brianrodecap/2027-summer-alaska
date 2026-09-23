import { describe, expect, it } from 'vitest';

import {
  applyRouteForm,
  applyScenarioSave,
  applyTransitForm,
  blankRouteVariant,
  blankTransit,
  routeFormFrom,
  transitFormFrom,
} from './editForms';
import type { Route, Scenario, Transit } from './types';

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
    const form = transitFormFrom(transit);
    expect(form.showEndpointsOnMap).toBe(false);
    expect(applyTransitForm(transit, { ...form, showEndpointsOnMap: true })).toBeNull();
    expect(transit.showEndpointsOnMap).toBe(true);
    expect(applyTransitForm(transit, { ...form, showEndpointsOnMap: false })).toBeNull();
    expect('showEndpointsOnMap' in transit).toBe(false);
  });

  it('drops the opt-in once the route is cleared', () => {
    const transit = { ...routed(), showEndpointsOnMap: true };
    const form = {
      ...transitFormFrom(transit),
      routeId: null,
      arrivesDate: '2027-06-01',
      arrivesTime: '12:00',
    };
    expect(applyTransitForm(transit, form)).toBeNull();
    expect('showEndpointsOnMap' in transit).toBe(false);
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
