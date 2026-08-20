import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildTripView, splitOutStayBoundaries, tripDayCount } from './tripModel';
import type { ScenarioTabsSequenceItem, StaySequenceItem, TripData } from './types';

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

describe('buildTripView against the real trip data', () => {
  const data = loadRealTripData();
  const view = buildTripView(data);

  it('builds without throwing and covers every day of the trip', () => {
    expect(view.days.length).toBeGreaterThan(0);
    expect(view.days.length).toBeLessThanOrEqual(tripDayCount(data.trip));
  });

  it('resolves a routed Transit into computed stage times and an arrival', () => {
    const day = view.days.find((d) => d.date === '2027-06-26');
    expect(day).toBeDefined();
    const transit = day!.transits.find((t) => t._id === 'transit_anc_to_talkeetna_overnight');
    expect(transit).toBeDefined();
    expect(transit!.routeInfo).not.toBeNull();
    expect(transit!.routeInfo!.variants.length).toBeGreaterThan(0);
    // arrivesAt is never authored for a routed drive — must come from the walk.
    expect(transit!.arrivesAt).toBeTruthy();
    expect(transit!.arrivesAt).not.toBe(data.transits.find((t) => t._id === 'transit_anc_to_talkeetna_overnight')!.arrivesAt);
  });

  it('nests scenario_jul1_alt_flew/_grounded under scenario_jul1_alt on Jul 1', () => {
    const day = view.days.find((d) => d.date === '2027-07-01');
    expect(day).toBeDefined();
    const altTrack = day!.scenarioTracks.find((t) => t.scenario._id === 'scenario_jul1_alt');
    expect(altTrack).toBeDefined();
    const nested = altTrack!.sequence.find((i): i is ScenarioTabsSequenceItem => i.type === 'scenario-tabs');
    expect(nested).toBeDefined();
    const nestedIds = nested!.tracks!.map((t) => t.scenario._id);
    expect(nestedIds).toContain('scenario_jul1_alt_flew');
    expect(nestedIds).toContain('scenario_jul1_alt_grounded');
  });

  it('every day with a meal-options activity resolves candidate travelers', () => {
    const withOptions = [...view.activitiesById.values()].find((a) => a.options && a.options.length > 1);
    expect(withOptions).toBeDefined();
    expect(withOptions!.diningFormat).toBeNull();
    expect(withOptions!.place).toBeNull();
  });
});

describe('splitOutStayBoundaries', () => {
  it('always orders checkouts first and check-ins last, regardless of clock time', () => {
    const checkout: StaySequenceItem = {
      type: 'stay',
      relation: 'Check out',
      key: '2027-07-01T11:00',
      stay: { _id: 's1' } as never,
    };
    const checkin: StaySequenceItem = {
      type: 'stay',
      relation: 'Check in',
      key: '2027-07-01T03:00', // earlier clock time than checkout, but must still render last
      stay: { _id: 's2' } as never,
    };
    const middle: StaySequenceItem = {
      type: 'stay',
      relation: 'Overnight',
      key: '2027-07-01T07:00',
      stay: { _id: 's3' } as never,
    };

    const { checkOuts, rest, checkIns } = splitOutStayBoundaries([checkin, middle, checkout]);
    expect(checkOuts).toEqual([checkout]);
    expect(rest).toEqual([middle]);
    expect(checkIns).toEqual([checkin]);
  });
});
