import { describe, expect, it } from 'vitest';

import { applyRouteForm, applyScenarioSave, routeFormFrom } from './editForms';
import type { Route, Scenario } from './types';

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
          { kind: 'waypoint', place: { id: 'place_w', label: 'Viewpoint' }, durationMinutes: 40 },
          { kind: 'via', place: { id: 'place_v', label: 'Pass' }, durationMinutes: 15 },
        ],
        finalLegMinutes: 25,
      },
      {
        tone: 'scenic',
        label: 'Back road',
        places: [],
        finalLegMinutes: 90,
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
            { kind: 'waypoint', place: { id: null, label: 'Somewhere' }, durationMinutes: 10 },
          ],
          finalLegMinutes: 5,
        },
      ],
      images: [],
    };
    const message = applyRouteForm(structuredClone(form), form);
    expect(message).toMatch(/Google Place ID/);
  });

  it('rejects a negative final-leg duration', () => {
    const form: Route = {
      _id: 'x',
      from: { id: null, label: 'A' },
      to: { id: null, label: 'B' },
      variants: [{ tone: 'direct', label: 'Direct', places: [], finalLegMinutes: -1 }],
      images: [],
    };
    const message = applyRouteForm(structuredClone(form), form);
    expect(message).toMatch(/final-leg duration/);
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
