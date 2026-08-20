import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildTripView } from './tripModel';
import { buildFilterGroups, dayHasVisibleContent, filterSequenceItems, rowMatches } from './filters';
import type { TripData } from './types';

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../public/data/2027-summer-alaska');

function readJson(name: string) {
  return JSON.parse(readFileSync(path.join(dataDir, `${name}.json`), 'utf-8'));
}

function loadRealTripData(): TripData {
  return {
    trip: readJson('trip'),
    legs: readJson('legs'),
    stays: readJson('stays'),
    transits: readJson('transits'),
    activities: readJson('activities'),
    scenarios: readJson('scenarios'),
    notes: readJson('notes'),
    routes: JSON.parse(readFileSync(path.join(dataDir, '../routes.json'), 'utf-8')),
  };
}

describe('filters against the real trip data', () => {
  const data = loadRealTripData();
  const view = buildTripView(data);

  it('builds a Booking/Attributes group plus one Leg option per leg, in leg order', () => {
    const groups = buildFilterGroups(view.legSummaries);
    expect(groups.map((g) => g.id)).toEqual(['booking', 'attr', 'leg']);
    expect(groups.find((g) => g.id === 'leg')!.options.map((o) => o.token)).toEqual(
      data.legs.map((l) => `leg:${l._id}`),
    );
  });

  it('rowMatches ANDs across groups but ORs within one', () => {
    const tags = ['leg:leg_parks', 'attr:highlight'];
    expect(rowMatches(tags, new Set())).toBe(true); // no active filters matches everything
    expect(rowMatches(tags, new Set(['leg:leg_parks']))).toBe(true);
    expect(rowMatches(tags, new Set(['leg:leg_cruise']))).toBe(false);
    expect(rowMatches(tags, new Set(['leg:leg_parks', 'leg:leg_cruise']))).toBe(true); // OR within the leg group
    expect(rowMatches(tags, new Set(['leg:leg_parks', 'attr:attention']))).toBe(false); // AND across groups
    expect(rowMatches(tags, new Set(['leg:leg_parks', 'attr:highlight']))).toBe(true);
  });

  it('dayHasVisibleContent hides a day once its own leg is filtered out, and keeps it once that leg is active', () => {
    const cruiseDay = view.days.find((d) => d.leg._id === 'leg_cruise');
    expect(cruiseDay).toBeDefined();
    expect(dayHasVisibleContent(cruiseDay!, new Set())).toBe(true);
    expect(dayHasVisibleContent(cruiseDay!, new Set(['leg:leg_parks']))).toBe(false);
    expect(dayHasVisibleContent(cruiseDay!, new Set(['leg:leg_cruise']))).toBe(true);
  });

  it("filterSequenceItems drops a day's other-leg... (n/a within one day) and keeps every item when nothing is active", () => {
    const day = view.days[0];
    expect(filterSequenceItems(day.sequence, day, new Set())).toBe(day.sequence); // identity short-circuit
  });

  it('filterSequenceItems narrows a section to just the still-matching activities, dropping the section once none match', () => {
    const dayWithHighlight = view.days.find((d) => d.sequence.some((i) => i.type === 'section' && i.activities.some((a) => a.priority)));
    expect(dayWithHighlight).toBeDefined();
    const filtered = filterSequenceItems(dayWithHighlight!.sequence, dayWithHighlight!, new Set(['attr:highlight']));
    const survivingActivities = filtered.filter((i) => i.type === 'section').flatMap((i) => (i.type === 'section' ? i.activities : []));
    expect(survivingActivities.every((a) => a.priority)).toBe(true);
    expect(survivingActivities.length).toBeGreaterThan(0);
  });
});
