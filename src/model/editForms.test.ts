import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { applyRouteForm, routeFormFrom } from './editForms';
import type { Route } from './types';

const routesPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../public/data/routes.json');

function loadRealRoute(): Route {
  const routes: Route[] = JSON.parse(readFileSync(routesPath, 'utf-8'));
  return routes[0];
}

describe('Route edit form apply logic', () => {
  it('round-trips an unchanged real route through the form with no error', () => {
    const route = loadRealRoute();
    const form = routeFormFrom(route);
    const clone = structuredClone(route);
    const message = applyRouteForm(clone, form);
    expect(message).toBeNull();
    expect(clone.variants).toEqual(route.variants);
    expect(clone.from.label).toBe(route.from.label);
  });

  it('rejects a route with no variants', () => {
    const form: Route = { _id: 'x', from: { id: null, label: 'A' }, to: { id: null, label: 'B' }, variants: [], images: [] };
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
          places: [{ kind: 'waypoint', place: { id: null, label: 'Somewhere' }, durationMinutes: 10 }],
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
