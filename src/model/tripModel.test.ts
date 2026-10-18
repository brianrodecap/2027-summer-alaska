import { describe, expect, it } from 'vitest';

import { filterRows } from './filters';
import { buildLiveDays, type LiveDayCache } from './liveDays';
import { liveWarnings } from './mealOptions';
import {
  buildTripView,
  diffMinutesIso,
  optionShows,
  portCallsOn,
  portCallWarningFor,
  rowShows,
  sheetNotes,
  splitOutStayBoundaries,
  tripDateRange,
  tripDayCount,
} from './tripModel';
import type {
  BoxRow,
  Day,
  DayRow,
  EnrichedActivity,
  EnrichedStay,
  EnrichedTransit,
  MealOption,
  StayRelation,
  StayRow,
  TripData,
  TripView,
} from './types';

// A bare-minimum, synthetic TripData — one Trip and one Leg, nothing else —
// for tests to extend with only the specific entities/fields they exercise.
// Never load or assert against the real public/data/2027-summer-alaska/*.json
// content: those files are the site's live, actively-edited itinerary, not a
// fixed test fixture, so a test built on them can break because someone
// edited the trip rather than because of a real code regression.
function minimalTripData(): TripData {
  return {
    trip: { _id: 'trip_test', name: 'Test Trip', travelers: [], images: [] },
    legs: [
      {
        _id: 'leg_test',
        tripId: 'trip_test',
        name: 'Test Leg',
        skeletonAuthority: 'self',
        images: [],
      },
    ],
    stays: [],
    transits: [],
    activities: [],
    scenarios: [],
    notes: [],
    bookings: [],
    travelModeOverrides: [],
    routes: [],
  };
}

function pushMinimalActivity(data: TripData, overrides: Partial<TripData['activities'][number]>) {
  data.activities.push({
    _id: 'test_activity',
    legId: 'leg_test',
    scenarioId: null,
    startAt: null,
    durationMinutes: null,
    timeLabel: null,
    date: null,
    priority: null,
    text: 'Test activity',
    place: null,
    bookingId: null,
    mealType: null,
    diningFormat: null,
    includedIn: null,
    options: null,
    travelers: null,
    images: [],
    ...overrides,
  });
}

function pushMinimalTransit(data: TripData, overrides: Partial<TripData['transits'][number]>) {
  data.transits.push({
    _id: 'test_transit',
    legId: 'leg_test',
    journeyId: null,
    travelers: null,
    scenarioId: null,
    mode: 'drive',
    from: { id: null, label: 'A' },
    to: { id: null, label: 'B' },
    departsAt: '2027-06-01T09:00',
    arrivesAt: '2027-06-01T09:30',
    routeId: null,
    routeVariant: null,
    bookingId: null,
    images: [],
    ...overrides,
  });
}

// A day as the reader sees it (rows, scenario tabs): the static frame from
// buildTripView laid out for the given scenario picks.
function liveDay(
  data: TripData,
  date: string,
  picks = new Map<string, string>(),
  meals = new Map<string, number>(),
) {
  return liveDays(buildTripView(data), data, picks, undefined, meals).days.find(
    (d) => d.date === date,
  );
}

function liveDays(
  view: TripView,
  data: TripData,
  picks: Map<string, string>,
  previous?: Map<string, LiveDayCache>,
  meals = new Map<string, number>(),
) {
  return buildLiveDays(
    view,
    data,
    { scenarioPicks: picks, routeTones: new Map(), mealOptionIndex: meals },
    previous,
  );
}

describe('buildTripView', () => {
  it('builds without throwing and covers every day of the trip', () => {
    const data = minimalTripData();
    pushMinimalActivity(data, { startAt: '2027-06-01T09:00' });
    pushMinimalActivity(data, { _id: 'test_activity_2', startAt: '2027-06-03T09:00' });
    const view = buildTripView(data);
    expect(view.days.length).toBeGreaterThan(0);
    const range = tripDateRange(data.stays, data.transits, data.activities);
    expect(range).not.toBeNull();
    expect(view.days.length).toBeLessThanOrEqual(tripDayCount(range!));
  });

  it('resolves a routed Transit into computed stage times and an arrival', () => {
    const data = minimalTripData();
    data.routes.push({
      _id: 'test_route',
      from: { id: null, label: 'A' },
      to: { id: null, label: 'B' },
      variants: [{ tone: 'direct', label: 'Direct', places: [], finalTravel: { minutes: 60 } }],
      images: [],
    });
    pushMinimalTransit(data, {
      departsAt: '2027-06-01T09:00',
      // arrivesAt is never authored for a routed drive — must come from the walk.
      arrivesAt: null,
      routeId: 'test_route',
    });
    const day = liveDay(data, '2027-06-01');
    expect(day).toBeDefined();
    const transit = day!.transits.find((t) => t._id === 'test_transit');
    expect(transit).toBeDefined();
    expect(transit!.routeInfo).not.toBeNull();
    expect(transit!.routeInfo!.variants.length).toBeGreaterThan(0);
    expect(transit!.arrivesAt).toBeTruthy();
    expect(transit!.arrivesAt).not.toBe(null);
  });

  it('nests a child scenario (parentScenarioId) under its parent as a scenario-tabs split in the parent track', () => {
    const data = minimalTripData();
    data.scenarios.push(
      {
        _id: 'test_parent',
        legId: 'leg_test',
        tone: 'alternate',
        label: 'Parent',
        icon: 'cloud',
        images: [],
      },
      {
        _id: 'test_child_a',
        legId: 'leg_test',
        tone: 'ideal',
        label: 'Child A',
        icon: 'flight_takeoff',
        parentScenarioId: 'test_parent',
        images: [],
      },
      {
        _id: 'test_child_b',
        legId: 'leg_test',
        tone: 'alternate',
        label: 'Child B',
        icon: 'cloud',
        parentScenarioId: 'test_parent',
        images: [],
      },
    );
    pushMinimalActivity(data, { scenarioId: 'test_parent', startAt: '2027-06-01T08:00' });
    pushMinimalActivity(data, {
      _id: 'test_child_a_activity',
      scenarioId: 'test_child_a',
      startAt: '2027-06-01T09:00',
    });
    pushMinimalActivity(data, {
      _id: 'test_child_b_activity',
      scenarioId: 'test_child_b',
      startAt: '2027-06-01T09:00',
    });

    const day = liveDay(data, '2027-06-01');
    expect(day).toBeDefined();
    const parentTrack = day!.scenarioTracks.find((t) => t.scenario._id === 'test_parent');
    expect(parentTrack).toBeDefined();
    const nested = parentTrack!.rows.find((r): r is BoxRow => r.type === 'box');
    expect(nested).toBeDefined();
    const nestedIds = nested!.tracks.map((t) => t.scenario._id);
    expect(nestedIds).toContain('test_child_a');
    expect(nestedIds).toContain('test_child_b');
  });

  it('a meal-options Activity leaves diningFormat/place null on the Activity itself (each candidate carries its own)', () => {
    const data = minimalTripData();
    pushMinimalActivity(data, {
      startAt: '2027-06-01T12:00',
      mealType: 'lunch',
      options: [
        {
          _id: 'opt_a',
          diningFormat: 'sit-down',
          place: { id: null, label: 'Restaurant A' },
          includedIn: null,
          bookingId: null,
        },
        {
          _id: 'opt_b',
          diningFormat: 'grab-and-go',
          place: { id: null, label: 'Restaurant B' },
          includedIn: null,
          bookingId: null,
        },
      ],
    });
    const view = buildTripView(data);
    const withOptions = view.activitiesById.get('test_activity');
    expect(withOptions).toBeDefined();
    expect(withOptions!.options?.length).toBe(2);
    expect(withOptions!.diningFormat).toBeNull();
    expect(withOptions!.place).toBeNull();
  });

  // The Homer-Spit bug: a day's scenario-tabs placeholder used to anchor to
  // the earliest key across every sibling candidate scenario for that date,
  // not just the ideal-or-first track actually shown. A sibling alternate
  // track can carry its own earlier content than the displayed ideal track
  // — anchoring the badge there stranded a plain Activity landing in the gap
  // between the two (chronologically after the alternate's early content but
  // before the ideal track's own start) so it rendered after the whole
  // badge despite being chronologically earlier than what the badge shows.
  it("anchors a day's scenario-tabs placeholder to the ideal-or-first track's own real content, not a sibling's earlier one", () => {
    const data = minimalTripData();
    data.scenarios.push(
      {
        _id: 'test_scenario_ideal',
        legId: 'leg_test',
        tone: 'ideal',
        label: 'Test ideal',
        icon: 'flight_takeoff',
        images: [],
      },
      {
        _id: 'test_scenario_alt',
        legId: 'leg_test',
        tone: 'alternate',
        label: 'Test alternate',
        icon: 'cloud',
        images: [],
      },
    );
    // The alternate track's own content starts well before the ideal
    // track's — the borrowed-anchor bug would place the badge here.
    pushMinimalActivity(data, {
      _id: 'test_alt_early',
      scenarioId: 'test_scenario_alt',
      startAt: '2027-06-01T06:00',
    });
    // The ideal-or-first track actually displayed — its own earliest real
    // content is what the badge should anchor to.
    pushMinimalActivity(data, {
      _id: 'test_ideal_noon',
      scenarioId: 'test_scenario_ideal',
      startAt: '2027-06-01T12:00',
    });
    // A plain Activity landing in the gap: after the alternate's early
    // content, but before the ideal track's own start.
    pushMinimalActivity(data, {
      _id: 'test_plain_gap',
      scenarioId: null,
      startAt: '2027-06-01T10:45',
    });

    const day = liveDay(data, '2027-06-01')!;
    expect(day).toBeDefined();

    const gapIdx = day.rows.findIndex(
      (r) => r.type === 'activity' && r.activity._id === 'test_plain_gap',
    );
    const scenarioTabsIdx = day.rows.findIndex((r) => r.type === 'box');
    expect(gapIdx).toBeGreaterThanOrEqual(0);
    expect(scenarioTabsIdx).toBeGreaterThanOrEqual(0);
    expect(gapIdx).toBeLessThan(scenarioTabsIdx);
  });

  // The reverse of the Homer-Spit case above: here the ideal-or-first track
  // carries nothing but a Stay checkout (trackBoundaryKind === 'checkout'),
  // so its own anchorKey (the checkout's literal, administrative clock time)
  // isn't real content the day is organized around — borrowing a sibling
  // track's own earlier real content is correct here, not the bug the
  // Homer-Spit test guards against. Without that, a same-day plain Transit
  // sorting between the sibling's real content and the checkout's clock time
  // wrongly rendered before the whole scenario-tabs badge instead of after.
  it("anchors a day's scenario-tabs placeholder to a sibling's real content when the ideal-or-first track is a pure checkout boundary", () => {
    const data = minimalTripData();
    data.scenarios.push(
      {
        _id: 'test_scenario_ideal',
        legId: 'leg_test',
        tone: 'ideal',
        label: 'Test ideal',
        icon: 'flight_takeoff',
        images: [],
      },
      {
        _id: 'test_scenario_alt',
        legId: 'leg_test',
        tone: 'alternate',
        label: 'Test alternate',
        icon: 'cloud',
        images: [],
      },
    );
    // The ideal track's entire same-day content is a Stay checkout — purely
    // administrative, not a moment the day is organized around.
    data.stays.push({
      _id: 'test_ideal_checkout',
      legId: 'leg_test',
      scenarioId: 'test_scenario_ideal',
      checkInAt: '2027-05-31T15:00',
      checkOutAt: '2027-06-01T11:00',
      lodging: null,
      bookingId: null,
      images: [],
    });
    // The alternate track's entire same-day content is the same checkout,
    // plus its own real activity well before the checkout's clock time.
    data.stays.push({
      _id: 'test_alt_checkout',
      legId: 'leg_test',
      scenarioId: 'test_scenario_alt',
      checkInAt: '2027-05-31T15:00',
      checkOutAt: '2027-06-01T11:00',
      lodging: null,
      bookingId: null,
      images: [],
    });
    pushMinimalActivity(data, {
      _id: 'test_alt_breakfast',
      scenarioId: 'test_scenario_alt',
      startAt: '2027-06-01T06:00',
    });
    // A plain same-day Transit chronologically after the alternate's real
    // content but well before the checkout's own clock time.
    pushMinimalTransit(data, {
      departsAt: '2027-06-01T06:30',
      arrivesAt: '2027-06-01T07:00',
    });

    const day = liveDay(data, '2027-06-01')!;
    expect(day).toBeDefined();

    const transitIdx = day.rows.findIndex((r) => r.type === 'transit');
    const scenarioTabsIdx = day.rows.findIndex((r) => r.type === 'box');
    expect(transitIdx).toBeGreaterThanOrEqual(0);
    expect(scenarioTabsIdx).toBeGreaterThanOrEqual(0);
    expect(scenarioTabsIdx).toBeLessThan(transitIdx);
  });

  // DaysView's "Add to this day" > Scenario flow (editForms.ts's
  // blankScenario) seeds a brand-new Scenario with no Activity/Transit of
  // its own yet, placed only via its own `date` field. buildScenarioTracks
  // must still surface it — with an empty sequence, but a real (dayStart)
  // anchorKey rather than null — so the day's own scenario-tabs placeholder
  // still splices into day.rows and DayTimeline has somewhere to render
  // its droppable "Nothing here yet" zone (see reorder.test.ts's own test
  // for what a drop into that zone actually does).
  it('surfaces a still-empty, date-anchored scenario as its own (empty) track, and still splices a scenario box into day.rows', () => {
    const data = minimalTripData();
    // Gives leg_test's computed date range coverage of 2027-06-01, so the
    // day actually gets built — a Scenario alone doesn't contribute to that.
    pushMinimalActivity(data, { startAt: '2027-06-01T09:00' });
    data.scenarios.push({
      _id: 'test_scenario_empty',
      legId: 'leg_test',
      tone: 'ideal',
      label: 'Test empty scenario',
      icon: 'help_outline',
      date: '2027-06-01',
      images: [],
    });
    const day = liveDay(data, '2027-06-01')!;
    expect(day).toBeDefined();

    const track = day.scenarioTracks.find((t) => t.scenario._id === 'test_scenario_empty');
    expect(track).toBeDefined();
    expect(track!.rows).toEqual([]);

    // A still-empty scenario has no real content to anchor on, so its box sits
    // at the start of its placement-hint day — which is what lets the tab group
    // be placed (and stay droppable) at all.
    expect(day.rows.some((r) => r.type === 'box')).toBe(true);
  });

  // A same-day (non-midnight-crossing) Transit's scenarioId used to leak
  // into the *following* day's candidate track set too — buildDay folds a
  // Transit into the next day's list purely so an overnight one's
  // post-midnight stages still render there, but a same-day Transit that
  // doesn't cross midnight has zero real items to show for it on that next
  // day. includableTrack's own sequence check keeps that phantom, empty tab/
  // drop-zone from surfacing on a day the scenario has nothing to do with —
  // while still keeping a genuinely-empty, date-anchored new scenario (the
  // test right above this one) visible.
  it("doesn't surface a same-day Transit's scenario as a phantom empty track on the following day", () => {
    const data = minimalTripData();
    data.scenarios.push({
      _id: 'test_scenario_sameday',
      legId: 'leg_test',
      tone: 'ideal',
      label: 'Same-day scenario',
      icon: 'help_outline',
      images: [],
    });
    pushMinimalTransit(data, {
      scenarioId: 'test_scenario_sameday',
      departsAt: '2027-06-01T09:00',
      arrivesAt: '2027-06-01T10:00', // same day, no midnight crossing
    });
    // Gives the following day its own leg coverage.
    pushMinimalActivity(data, { startAt: '2027-06-02T09:00' });

    const day = liveDay(data, '2027-06-02')!;
    expect(day).toBeDefined();
    expect(day.scenarioTracks.some((t) => t.scenario._id === 'test_scenario_sameday')).toBe(false);
  });

  it('a same-day leg handoff renders entities from every leg claiming that date, with day.leg resolving to whichever leg sorts first', () => {
    const data = minimalTripData();
    data.legs.push({
      _id: 'leg_test_2',
      tripId: 'trip_test',
      name: 'Test Leg 2',
      skeletonAuthority: 'self',
      images: [],
    });
    pushMinimalActivity(data, { legId: 'leg_test', startAt: '2027-06-05T08:00' });
    pushMinimalTransit(data, {
      legId: 'leg_test_2',
      mode: 'ferry',
      from: { id: null, label: 'Port A' },
      to: { id: null, label: 'Port B' },
      departsAt: '2027-06-05T14:00',
      arrivesAt: '2027-06-05T18:00',
    });

    const day = liveDay(data, '2027-06-05');
    expect(day).toBeDefined();
    // day.leg resolves to whichever leg sorts first in legs' own authored order.
    expect(day!.leg._id).toBe('leg_test');
    // But entities from the incoming leg are not dropped from the sequence.
    expect(day!.transits.some((t) => t._id === 'test_transit')).toBe(true);
    const activityIds = day!.rows.flatMap((r) => (r.type === 'activity' ? [r.activity._id] : []));
    expect(activityIds).toContain('test_activity');
  });
});

describe('activity warnings: overlapping a transit', () => {
  it('flags a Transit that departs partway through an Activity, not just the reverse', () => {
    const data = minimalTripData();
    pushMinimalActivity(data, {
      startAt: '2027-06-28T23:00',
      durationMinutes: 30,
      mealType: 'dinner',
      diningFormat: 'sit-down',
    });
    pushMinimalTransit(data, { departsAt: '2027-06-28T23:15', arrivesAt: '2027-06-28T23:45' });
    const view = buildTripView(data);
    expect(view.activitiesById.get('test_activity')?.warnings[0] ?? null).toBe(
      'A departs before this ends.',
    );
  });

  it('still exempts a meal that starts mid-drive (the original direction)', () => {
    const data = minimalTripData();
    pushMinimalTransit(data, { departsAt: '2027-06-28T23:00', arrivesAt: '2027-06-28T23:30' });
    pushMinimalActivity(data, {
      startAt: '2027-06-28T23:10',
      mealType: 'snack',
      diningFormat: 'drivethru',
    });
    const view = buildTripView(data);
    expect(view.activitiesById.get('test_activity')?.warnings[0] ?? null).toBeNull();
  });

  it('still flags a non-meal Activity that starts mid-drive', () => {
    const data = minimalTripData();
    pushMinimalTransit(data, { departsAt: '2027-06-28T23:00', arrivesAt: '2027-06-28T23:30' });
    pushMinimalActivity(data, { startAt: '2027-06-28T23:10' });
    const view = buildTripView(data);
    expect(view.activitiesById.get('test_activity')?.warnings[0] ?? null).toBe(
      'During transit: A → B',
    );
  });
});

describe('a routed drive and the Activities along it', () => {
  // Departs 09:00 on the scenic variant: 60 min to a waypoint, its stop, then
  // a via 30 min on, then 60 min to the destination. (The direct variant can't
  // carry a via, so it's a plain two-hour drive.)
  function routedDrive(waypointMinutes?: number): TripData {
    const data = minimalTripData();
    data.routes.push({
      _id: 'test_route',
      from: { id: null, label: 'A' },
      to: { id: null, label: 'B' },
      variants: [
        { tone: 'direct', label: 'Direct', places: [], finalTravel: { minutes: 120 } },
        {
          tone: 'scenic',
          label: 'Direct',
          places: [
            {
              kind: 'waypoint',
              place: { id: 'p_view', label: 'View' },
              travel: { minutes: 60 },
              ...(waypointMinutes === undefined ? {} : { durationMinutes: waypointMinutes }),
            },
            { kind: 'via', place: { id: 'p_fork', label: 'Fork' }, travel: { minutes: 30 } },
          ],
          finalTravel: { minutes: 60 },
        },
      ],
      images: [],
    });
    pushMinimalTransit(data, {
      departsAt: '2027-06-01T09:00',
      arrivesAt: null,
      routeId: 'test_route',
      routeVariant: 'scenic',
    });
    return data;
  }
  const routeOf = (data: TripData) => buildTripView(data).transitsById.get('test_transit')!;

  it('stops at a waypoint for the default 15 minutes, and a via not at all', () => {
    const transit = routeOf(routedDrive());
    expect(
      transit.routeInfo!.variants.find((v) => v.tone === 'scenic')!.stages.map((s) => s.key),
    ).toEqual([
      '2027-06-01T10:00', // arrive at View
      '2027-06-01T10:45', // 15 min stop, then 30 min to the Fork
    ]);
    expect(transit.arrivesAt).toBe('2027-06-01T11:45');
  });

  it("uses a waypoint's own stop duration when it has one", () => {
    expect(routeOf(routedDrive(40)).arrivesAt).toBe('2027-06-01T12:10');
    expect(routeOf(routedDrive(0)).arrivesAt).toBe('2027-06-01T11:30');
  });

  it('folds an Activity inside the drive into its timing, and flags it', () => {
    const data = routedDrive();
    pushMinimalActivity(data, { startAt: '2027-06-01T10:30', durationMinutes: 20 });
    const view = buildTripView(data);
    // 10:15 leave View, drive 15 min, stop 20 min at 10:30, 15 min to the Fork.
    expect(view.transitsById.get('test_transit')!.arrivesAt).toBe('2027-06-01T12:05');
    expect(view.activitiesById.get('test_activity')?.warnings[0] ?? null).toBe(
      'During transit: A → B',
    );
  });

  it('folds a meal inside the drive into its timing, without flagging it', () => {
    const data = routedDrive();
    pushMinimalActivity(data, {
      startAt: '2027-06-01T11:00',
      mealType: 'lunch',
      diningFormat: 'sit-down',
    });
    const view = buildTripView(data);
    expect(view.transitsById.get('test_transit')!.arrivesAt).toBe('2027-06-01T12:45');
    expect(view.activitiesById.get('test_activity')?.warnings[0] ?? null).toBeNull();
  });

  it('places an Activity at the exact departure time before the drive, not inside it', () => {
    const data = routedDrive();
    pushMinimalActivity(data, { startAt: '2027-06-01T09:00' });
    const view = buildTripView(data);
    expect(view.transitsById.get('test_transit')!.arrivesAt).toBe('2027-06-01T11:45');
    expect(view.activitiesById.get('test_activity')?.warnings[0] ?? null).toBeNull();
    const rows = liveDay(data, '2027-06-01')!.rows.map((r) =>
      r.type === 'transit' ? `transit:${r.phase}` : r.type,
    );
    expect(rows.slice(0, 2)).toEqual(['activity', 'transit:depart']);
  });

  it('leaves an Activity after the arrival out of the drive', () => {
    const data = routedDrive();
    pushMinimalActivity(data, { startAt: '2027-06-01T11:45', durationMinutes: 60 });
    const view = buildTripView(data);
    expect(view.transitsById.get('test_transit')!.arrivesAt).toBe('2027-06-01T11:45');
    expect(view.activitiesById.get('test_activity')?.warnings[0] ?? null).toBeNull();
  });
});

describe('the direct route variant', () => {
  // Scenic is listed first on purpose: the default must never come from array order.
  function twoTones(): TripData {
    const data = minimalTripData();
    data.routes.push({
      _id: 'test_route',
      from: { id: null, label: 'A' },
      to: { id: null, label: 'B' },
      variants: [
        {
          tone: 'scenic',
          label: 'Scenic',
          places: [
            { kind: 'via', place: { id: 'p_fork', label: 'Fork' }, travel: { minutes: 60 } },
          ],
          finalTravel: { minutes: 120 },
        },
        { tone: 'direct', label: 'Direct', places: [], finalTravel: { minutes: 60 } },
      ],
      images: [],
    });
    pushMinimalTransit(data, {
      departsAt: '2027-06-01T09:00',
      arrivesAt: null,
      routeId: 'test_route',
    });
    return data;
  }

  it('is the default when the Transit names no valid variant', () => {
    for (const routeVariant of [null, 'no-such-tone']) {
      const data = twoTones();
      data.transits[0].routeVariant = routeVariant;
      const transit = buildTripView(data).transitsById.get('test_transit')!;
      expect(transit.routeInfo!.selectedTone).toBe('direct');
      expect(transit.arrivesAt).toBe('2027-06-01T10:00');
    }
  });

  it('must exist exactly once and carry no vias', () => {
    const noDirect = twoTones();
    noDirect.routes[0].variants[1].tone = 'scenic';
    expect(() => buildTripView(noDirect)).toThrow(/exactly one 'direct' variant \(has 0\)/);

    const twoDirect = twoTones();
    twoDirect.routes[0].variants[0].tone = 'direct';
    expect(() => buildTripView(twoDirect)).toThrow(/exactly one 'direct' variant \(has 2\)/);

    const viaOnDirect = twoTones();
    viaOnDirect.routes[0].variants[1].places = [
      { kind: 'via', place: { id: 'p_fork', label: 'Fork' }, travel: { minutes: 30 } },
    ];
    expect(() => buildTripView(viaOnDirect)).toThrow(/'direct' variant can't have vias/);
  });

  it('rechecks "during transit" when the route tab switches', () => {
    const data = twoTones();
    // 10:30 is after the direct arrival (10:00) but inside the scenic drive (12:00).
    pushMinimalActivity(data, { startAt: '2027-06-01T10:30', durationMinutes: 15 });
    const warningFor = (tone: string) => {
      const { days } = buildLiveDays(buildTripView(data), data, {
        scenarioPicks: new Map(),
        routeTones: new Map([['test_transit', tone]]),
        mealOptionIndex: new Map(),
      });
      const day = days.find((d) => d.date === '2027-06-01')!;
      const activity = buildTripView(data).activitiesById.get('test_activity')!;
      return liveWarnings(activity, day)[0] ?? null;
    };
    expect(warningFor('direct')).toBeNull();
    expect(warningFor('scenic')).toBe('During transit: A → B');
  });

  it('hands every reader the same live Transit for the selected tab', () => {
    const data = twoTones();
    const live = buildLiveDays(buildTripView(data), data, {
      scenarioPicks: new Map(),
      routeTones: new Map([['test_transit', 'scenic']]),
      mealOptionIndex: new Map(),
    });
    const day = live.days.find((d) => d.date === '2027-06-01')!;
    const row = day.rows.find((r) => r.type === 'transit' && r.phase === 'depart');
    const transit = live.transitsById.get('test_transit')!;
    expect(transit.routeInfo!.selectedTone).toBe('scenic');
    expect(transit.arrivesAt).toBe('2027-06-01T12:00');
    expect(row?.type === 'transit' && row.transit).toBe(transit);
    expect(day.transits[0]).toBe(transit);
  });
});

describe('activity warnings: overlapping another activity', () => {
  it('flags two Activities on the same leg/scenario whose timed spans overlap', () => {
    const data = minimalTripData();
    pushMinimalActivity(data, {
      _id: 'test_container',
      text: 'Root Glacier guided half-day hike',
      startAt: '2027-06-28T09:00',
      durationMinutes: 300,
    });
    pushMinimalActivity(data, {
      startAt: '2027-06-28T13:30',
      mealType: 'lunch',
      diningFormat: 'self-catered',
    });
    const view = buildTripView(data);
    expect(view.activitiesById.get('test_activity')?.warnings[0] ?? null).toBe(
      'Overlaps with "Root Glacier guided half-day hike".',
    );
  });

  it("exempts a meal explicitly modeled as diningFormat 'included-with-activity'", () => {
    const data = minimalTripData();
    pushMinimalActivity(data, {
      _id: 'test_container',
      text: 'Root Glacier guided half-day hike',
      startAt: '2027-06-28T09:00',
      durationMinutes: 300,
    });
    pushMinimalActivity(data, {
      startAt: '2027-06-28T13:30',
      mealType: 'lunch',
      diningFormat: 'included-with-activity',
      includedIn: { entity: 'activity', id: 'test_container' },
    });
    const view = buildTripView(data);
    expect(view.activitiesById.get('test_activity')?.warnings[0] ?? null).toBeNull();
  });
});

describe('overlap warnings are scoped to one leg + scenario branch', () => {
  it('does not flag two time-overlapping Activities on different scenario branches', () => {
    const data = minimalTripData();
    pushMinimalActivity(data, {
      _id: 'test_a',
      startAt: '2027-06-28T09:00',
      durationMinutes: 120,
      scenarioId: 'scenario_one',
    });
    pushMinimalActivity(data, {
      _id: 'test_b',
      startAt: '2027-06-28T10:00',
      durationMinutes: 60,
      scenarioId: 'scenario_two',
    });
    const view = buildTripView(data);
    expect(view.activitiesById.get('test_a')?.warnings[0] ?? null).toBeNull();
    expect(view.activitiesById.get('test_b')?.warnings[0] ?? null).toBeNull();
  });

  it("flags a point-in-time Activity landing inside another's span, and vice versa", () => {
    const data = minimalTripData();
    pushMinimalActivity(data, {
      _id: 'test_span',
      text: 'Long hike',
      startAt: '2027-06-28T09:00',
      durationMinutes: 120,
    });
    pushMinimalActivity(data, {
      _id: 'test_point',
      text: 'Photo stop',
      startAt: '2027-06-28T10:00',
    });
    const view = buildTripView(data);
    expect(view.activitiesById.get('test_point')?.warnings[0] ?? null).toBe(
      'Overlaps with "Long hike".',
    );
    expect(view.activitiesById.get('test_span')?.warnings[0] ?? null).toBe(
      'Overlaps with "Photo stop".',
    );
  });

  it('does not flag a Transit departure against an Activity on a different leg', () => {
    const data = minimalTripData();
    pushMinimalActivity(data, {
      startAt: '2027-06-28T23:00',
      durationMinutes: 30,
      mealType: 'dinner',
      diningFormat: 'sit-down',
    });
    pushMinimalTransit(data, {
      legId: 'leg_other',
      departsAt: '2027-06-28T23:15',
      arrivesAt: '2027-06-28T23:45',
    });
    const view = buildTripView(data);
    expect(view.activitiesById.get('test_activity')?.warnings[0] ?? null).toBeNull();
  });
});

describe('entity notes', () => {
  it('attaches each note to every entity it names, once, and flags warning notes', () => {
    const data = minimalTripData();
    pushMinimalActivity(data, { _id: 'test_activity', startAt: '2027-06-28T09:00' });
    pushMinimalActivity(data, { _id: 'test_other', startAt: '2027-06-28T15:00' });
    data.notes.push(
      {
        _id: 'note_warn',
        kind: 'warning',
        text: 'Heads up',
        // Two refs to the same activity still yield one note for it.
        concerns: [
          { entity: 'activity', id: 'test_activity' },
          { entity: 'activity', id: 'test_activity' },
        ],
        images: [],
      },
      {
        _id: 'note_info',
        kind: 'info',
        text: 'FYI',
        concerns: [{ entity: 'leg', id: 'leg_test' }],
        images: [],
      },
    );
    const view = buildTripView(data);
    const withNote = view.activitiesById.get('test_activity');
    expect(withNote?.notes.map((n) => n._id)).toEqual(['note_warn']);
    expect(withNote?.hasWarningNote).toBe(true);
    const without = view.activitiesById.get('test_other');
    expect(without?.notes).toEqual([]);
    expect(without?.hasWarningNote).toBe(false);
  });
});

describe('a booking several entries share', () => {
  // Two connecting flights on one ticket, listed (and named) so that neither
  // array order nor id order picks the first flight — only its departure does.
  function connection(): TripData {
    const data = minimalTripData();
    data.bookings.push({
      _id: 'booking_ticket',
      status: 'booked',
      pricing: null,
      confirmation: 'ABC123',
    } as never);
    pushMinimalTransit(data, {
      _id: 'a_second',
      mode: 'flight',
      departsAt: '2027-06-26T09:45',
      arrivesAt: '2027-06-26T13:35',
      bookingId: 'booking_ticket',
    });
    pushMinimalTransit(data, {
      _id: 'z_first',
      mode: 'flight',
      departsAt: '2027-06-26T06:15',
      arrivesAt: '2027-06-26T08:37',
      bookingId: 'booking_ticket',
    });
    const note = (id: string, concerns: string[]) => ({
      _id: id,
      kind: 'info' as const,
      text: id,
      concerns: concerns.map((t) => ({ entity: 'transit' as const, id: t })),
      images: [],
    });
    data.notes.push(
      note('note_refund', ['a_second']),
      note('note_seat', ['z_first']),
      note('note_both', ['z_first', 'a_second']),
    );
    return data;
  }

  const depart = (transit: EnrichedTransit) =>
    rowShows({ type: 'transit', transit, phase: 'depart' });

  it('shows the booking only on the first departure', () => {
    const view = buildTripView(connection());
    expect(depart(view.transitsById.get('z_first')!).booking?._id).toBe('booking_ticket');
    expect(depart(view.transitsById.get('a_second')!).booking).toBeNull();
    // Never on an Arrive.
    expect(
      rowShows({ type: 'transit', transit: view.transitsById.get('z_first')!, phase: 'arrive' }),
    ).toEqual({ booking: null, notes: [] });
  });

  it('gathers every sharer’s notes on the first departure, each once', () => {
    const view = buildTripView(connection());
    const second = view.transitsById.get('a_second')!;
    const ids = (t: EnrichedTransit) =>
      depart(t)
        .notes.map((n) => n._id)
        .sort();
    expect(ids(view.transitsById.get('z_first')!)).toEqual([
      'note_both',
      'note_refund',
      'note_seat',
    ]);
    expect(ids(second)).toEqual([]);
    // The entry's own notes stay its own, for its detail sheet.
    expect(second.notes.map((n) => n._id).sort()).toEqual(['note_both', 'note_refund']);
  });

  it('leaves a booking with one entry, and its notes, where they are', () => {
    const data = connection();
    data.transits = data.transits.filter((t) => t._id === 'a_second');
    const only = buildTripView(data).transitsById.get('a_second')!;
    expect(only.bookingShare).toBeUndefined();
    expect(depart(only).booking?._id).toBe('booking_ticket');
    expect(
      depart(only)
        .notes.map((n) => n._id)
        .sort(),
    ).toEqual(['note_both', 'note_refund']);
  });

  it('shows a stay’s booking and notes on its Check in or one Overnight only', () => {
    const stay = {
      _id: 'stay_cruise',
      booking: { _id: 'booking_cruise' },
      notes: [{ _id: 'note_deposit' }],
    } as unknown as EnrichedStay;
    const shown = (relation: StayRelation) => rowShows({ type: 'stay', stay, relation });
    expect(shown('Check in')).toEqual({ booking: stay.booking, notes: stay.notes });
    expect(shown('Overnight')).toEqual({ booking: stay.booking, notes: stay.notes });
    expect(shown('Staying')).toEqual({ booking: null, notes: [] });
    expect(shown('Check out')).toEqual({ booking: null, notes: [] });
  });

  // One booking held across a weather window: an earlier flight on the
  // alternate branch, the ideal branch's, and the next day's.
  function weatherWindow(): TripData {
    const data = minimalTripData();
    data.bookings.push({ _id: 'booking_window', status: 'booked', pricing: null } as never);
    data.scenarios.push(
      {
        _id: 'sc_good',
        legId: 'leg_test',
        tone: 'ideal',
        label: 'Good',
        icon: 'sunny',
        images: [],
      },
      {
        _id: 'sc_bad',
        legId: 'leg_test',
        tone: 'alternate',
        label: 'Bad',
        icon: 'cloud',
        images: [],
      },
    );
    const flight = (id: string, scenarioId: string | null, startAt: string) =>
      pushMinimalActivity(data, { _id: id, scenarioId, startAt, bookingId: 'booking_window' });
    flight('act_bad', 'sc_bad', '2027-06-01T08:00');
    flight('act_good', 'sc_good', '2027-06-01T09:00');
    flight('act_next', null, '2027-06-02T09:00');
    return data;
  }
  // The rows on a day as the reader sees them: the picked branches' only.
  const visibleRows = (day: Day): DayRow[] => {
    const visible = (rows: DayRow[]): DayRow[] =>
      rows.flatMap((r) =>
        r.type === 'box' ? r.tracks.filter((t) => t.active).flatMap((t) => visible(t.rows)) : [r],
      );
    return visible(day.rows);
  };
  // A meal row's selected candidate.
  const selectedOf = (day: Day, activity: EnrichedActivity) =>
    activity.options?.find((o) => o._id === day.selectedMeals.get(activity._id)?._id);
  // The entries (or selected meal candidates) on a day showing the booking chip.
  const showing = (
    data: TripData,
    date: string,
    picks?: Map<string, string>,
    meals?: Map<string, number>,
  ) => {
    const day = liveDay(data, date, picks, meals)!;
    return visibleRows(day).flatMap((r) => {
      if (r.type === 'activity') {
        const candidate = selectedOf(day, r.activity);
        if (candidate?.bookingId) return optionShows(candidate).booking ? [candidate._id] : [];
        return rowShows(r).booking ? [r.activity._id] : [];
      }
      if (r.type === 'stay') return rowShows(r).booking ? [r.stay._id] : [];
      if (r.type === 'transit') return rowShows(r).booking ? [r.transit._id] : [];
      return [];
    });
  };
  const badPick = new Map([['sc_bad+sc_good', 'sc_bad']]);

  it('shows the booking on the first sharer on a branch the reader picked', () => {
    const data = weatherWindow();
    expect(showing(data, '2027-06-01')).toEqual(['act_good']);
    expect(showing(data, '2027-06-01', badPick)).toEqual(['act_bad']);
    expect(showing(data, '2027-06-02')).toEqual([]);
  });

  it('moves to the next day when no picked branch has a sharer', () => {
    const data = weatherWindow();
    data.activities.find((a) => a._id === 'act_good')!.bookingId = null;
    expect(showing(data, '2027-06-01')).toEqual([]);
    expect(showing(data, '2027-06-02')).toEqual(['act_next']);
  });

  it('rebuilds a cached day whose sharer stops being first after a pick on another day', () => {
    const data = weatherWindow();
    data.activities.find((a) => a._id === 'act_good')!.bookingId = null;
    const view = buildTripView(data);
    const first = liveDays(view, data, new Map());
    const next = liveDays(view, data, badPick, first.cache);
    const day = next.days.find((d) => d.date === '2027-06-02')!;
    const row = day.rows.find((r) => r.type === 'activity')!;
    expect(row.type === 'activity' && rowShows(row).booking).toBeNull();
  });

  it('gathers only the picked branches’ notes', () => {
    const data = weatherWindow();
    data.notes.push({
      _id: 'note_rebook',
      kind: 'info',
      text: 'Rebook fee if weather cancels',
      concerns: [{ entity: 'activity', id: 'act_bad' }],
      images: [],
    });
    const notesOn = (picks?: Map<string, string>) =>
      liveDay(data, '2027-06-01', picks)!
        .rows.flatMap((r) => (r.type === 'box' ? r.tracks.filter((t) => t.active) : []))
        .flatMap((t) => t.rows)
        .flatMap((r) => (r.type === 'activity' ? rowShows(r).notes.map((n) => n._id) : []));
    expect(notesOn()).toEqual([]);
    expect(notesOn(badPick)).toEqual(['note_rebook']);
  });

  it('follows the picks across a stay and a transit sharing the booking', () => {
    // The branches' own flights hold them together as one choice; the
    // booking moves to a drive on one and a stay on the other.
    const data = weatherWindow();
    for (const a of data.activities) a.bookingId = null;
    pushMinimalTransit(data, {
      _id: 'tr_bad',
      scenarioId: 'sc_bad',
      departsAt: '2027-06-01T14:00',
      arrivesAt: '2027-06-01T16:00',
      bookingId: 'booking_window',
    });
    data.stays.push({
      _id: 'stay_good',
      legId: 'leg_test',
      scenarioId: 'sc_good',
      checkInAt: '2027-06-01T15:00',
      checkOutAt: '2027-06-02T11:00',
      lodging: null,
      bookingId: 'booking_window',
      images: [],
    });
    expect(showing(data, '2027-06-01')).toEqual(['stay_good']);
    expect(showing(data, '2027-06-01', badPick)).toEqual(['tr_bad']);
    // The stay's sheet carries what its Check in row does.
    data.notes.push({
      _id: 'note_late',
      kind: 'info',
      text: 'Late check-in',
      concerns: [{ entity: 'stay', id: 'stay_good' }],
      images: [],
    });
    const built = liveDays(buildTripView(data), data, new Map());
    expect(sheetNotes(built.staysById.get('stay_good')!).map((n) => n._id)).toEqual(['note_late']);
    expect(sheetNotes(built.transitsById.get('tr_bad')!)).toEqual([]);
  });

  // A dinner choosing between a candidate the cruise fare covers (sharing its
  // booking) and one paid apart.
  const mealOn = (data: TripData, id: string, startAt: string, scenarioId: string | null) =>
    pushMinimalActivity(data, {
      _id: id,
      scenarioId,
      startAt,
      mealType: 'dinner',
      options: [
        {
          _id: `${id}_fare`,
          diningFormat: 'sit-down',
          place: { id: null, label: 'Main dining room' },
          includedIn: null,
          bookingId: 'booking_window',
        },
        {
          _id: `${id}_paid`,
          diningFormat: 'sit-down',
          place: { id: null, label: 'Steakhouse' },
          includedIn: null,
          bookingId: null,
        },
      ],
    });

  it('leaves a meal candidate’s shared booking to an earlier sharer', () => {
    const data = weatherWindow();
    mealOn(data, 'dinner_1', '2027-06-02T19:00', null);
    expect(showing(data, '2027-06-02')).toEqual([]);
  });

  it('shows a booking only candidates share on the first of them', () => {
    const data = weatherWindow();
    data.activities = [];
    mealOn(data, 'dinner_1', '2027-06-01T19:00', null);
    mealOn(data, 'dinner_2', '2027-06-02T19:00', null);
    expect(showing(data, '2027-06-01')).toEqual(['dinner_1_fare']);
    expect(showing(data, '2027-06-02')).toEqual([]);
  });

  it('moves a meal candidate’s booking with the picks', () => {
    const data = weatherWindow();
    data.activities.find((a) => a._id === 'act_good')!.bookingId = null;
    mealOn(data, 'dinner_good', '2027-06-01T09:30', 'sc_good');
    expect(showing(data, '2027-06-01')).toEqual(['dinner_good_fare']);
    expect(showing(data, '2027-06-01', badPick)).toEqual(['act_bad']);
  });

  it('moves a candidate’s booking on when the reader picks another candidate', () => {
    const data = weatherWindow();
    data.activities = [];
    mealOn(data, 'dinner_1', '2027-06-01T19:00', null);
    mealOn(data, 'dinner_2', '2027-06-02T19:00', null);
    const paidFirst = new Map([['dinner_1', 1]]);
    expect(showing(data, '2027-06-01', undefined, paidFirst)).toEqual([]);
    expect(showing(data, '2027-06-02', undefined, paidFirst)).toEqual(['dinner_2_fare']);
  });

  it('shows the other sharers’ notes on a first candidate, and filters by them', () => {
    const data = weatherWindow();
    data.activities = [];
    mealOn(data, 'dinner_1', '2027-06-01T19:00', null);
    pushMinimalTransit(data, {
      _id: 'tr_home',
      departsAt: '2027-06-02T09:00',
      arrivesAt: '2027-06-02T10:00',
      bookingId: 'booking_window',
    });
    data.notes.push({
      _id: 'note_docs',
      kind: 'warning',
      text: 'Bring passports',
      concerns: [{ entity: 'transit', id: 'tr_home' }],
      images: [],
    });
    const day = liveDay(data, '2027-06-01')!;
    const row = visibleRows(day).find((r) => r.type === 'activity')!;
    const dinner = row.type === 'activity' ? row.activity : null;
    expect(optionShows(selectedOf(day, dinner!)!).notes.map((n) => n._id)).toEqual(['note_docs']);
    expect(filterRows(day.rows, day, new Set(['attr:attention']))).toContain(row);
  });

  it('shows on the first sharer’s sheet what its row shows, and only its own on the rest', () => {
    const data = weatherWindow();
    const note = (id: string, on: string) => ({
      _id: id,
      kind: 'info' as const,
      text: id,
      concerns: [{ entity: 'activity' as const, id: on }],
      images: [],
    });
    data.notes.push(note('note_good', 'act_good'), note('note_next', 'act_next'));
    const built = liveDays(buildTripView(data), data, new Map());
    const ids = (id: string) =>
      sheetNotes(built.activitiesById.get(id)!)
        .map((n) => n._id)
        .sort();
    expect(ids('act_good')).toEqual(['note_good', 'note_next']);
    expect(ids('act_next')).toEqual(['note_next']);
  });

  it('filters a meal by its selected candidate’s own warning', () => {
    const data = weatherWindow();
    data.activities = [];
    mealOn(data, 'dinner_1', '2027-06-01T19:00', null);
    data.notes.push({
      _id: 'note_dress',
      kind: 'warning',
      text: 'Formal dress',
      concerns: [{ entity: 'mealOption', id: 'dinner_1_fare' }],
      images: [],
    });
    const attention = (meals?: Map<string, number>) => {
      const day = liveDay(data, '2027-06-01', undefined, meals)!;
      return filterRows(day.rows, day, new Set(['attr:attention'])).length;
    };
    expect(attention()).toBe(1);
    expect(attention(new Map([['dinner_1', 1]]))).toBe(0);
  });

  it('hands back the same entry for the same picks', () => {
    const data = weatherWindow();
    const view = buildTripView(data);
    const good = (built: ReturnType<typeof liveDays>) =>
      built.days
        .find((d) => d.date === '2027-06-01')!
        .rows.flatMap((r) => (r.type === 'box' ? r.tracks.filter((t) => t.active) : []))
        .flatMap((t) => t.rows)
        .find((r) => r.type === 'activity');
    const a = good(liveDays(view, data, new Map()));
    const b = good(liveDays(view, data, new Map()));
    expect(a?.type === 'activity' && b?.type === 'activity' && a.activity === b.activity).toBe(
      true,
    );
  });
});

describe('same-startAt Activity ordering', () => {
  it('puts a defaulted (timeLabel-anchored) startAt first; two real-startAt Activities left tied keep their own array order regardless of durationMinutes', () => {
    const data = minimalTripData();
    // TIME_LABEL_ANCHORS puts 'Morning' at 09:00 — same instant as the two
    // real-startAt activities below, so all three tie on `key`.
    pushMinimalActivity(data, { _id: 'test_fuzzy', date: '2027-06-28', timeLabel: 'Morning' });
    pushMinimalActivity(data, {
      _id: 'test_long',
      startAt: '2027-06-28T09:00',
      durationMinutes: 45,
    });
    pushMinimalActivity(data, {
      _id: 'test_short',
      startAt: '2027-06-28T09:00',
      durationMinutes: 15,
    });

    const day = liveDay(data, '2027-06-28');
    expect(day).toBeDefined();
    const activityIds = day!.rows.flatMap((r) => (r.type === 'activity' ? [r.activity._id] : []));

    // durationMinutes is never used as a tie-break — test_long (45min) stays
    // ahead of test_short (15min) here purely because it was pushed first;
    // this array-order fallback is what reorder.ts's drag-and-drop depends
    // on to resolve a dropped Activity's own exact-instant tie (see
    // reorder.test.ts), not something the day list orders by on its own.
    expect(activityIds).toEqual(['test_fuzzy', 'test_long', 'test_short']);
  });

  it('breaks a tie between two fuzzy (timeLabel-only) Activities alphabetically by their own headline, not array order', () => {
    const data = minimalTripData();
    pushMinimalActivity(data, {
      _id: 'test_zebra',
      date: '2027-06-28',
      timeLabel: 'Morning',
      text: 'Zebra viewing',
    });
    pushMinimalActivity(data, {
      _id: 'test_apple',
      date: '2027-06-28',
      timeLabel: 'Morning',
      text: 'Apple picking',
    });

    const day = liveDay(data, '2027-06-28');
    expect(day).toBeDefined();
    const activityIds = day!.rows.flatMap((r) => (r.type === 'activity' ? [r.activity._id] : []));

    // test_zebra was authored first, but alphabetically 'Apple picking'
    // comes before 'Zebra viewing'.
    expect(activityIds).toEqual(['test_apple', 'test_zebra']);
  });
});

describe('splitOutStayBoundaries', () => {
  it('always orders checkouts first and check-ins last, regardless of clock time', () => {
    const checkout: StayRow = {
      type: 'stay',
      event: null,
      relation: 'Check out',
      key: '2027-07-01T11:00',
      stay: { _id: 's1' } as never,
    };
    const checkin: StayRow = {
      type: 'stay',
      event: null,
      relation: 'Check in',
      key: '2027-07-01T03:00', // earlier clock time than checkout, but must still render last
      stay: { _id: 's2' } as never,
    };
    const middle: StayRow = {
      type: 'stay',
      event: null,
      relation: 'Overnight',
      key: '2027-07-01T07:00',
      stay: { _id: 's3' } as never,
    };

    const { checkOuts, rest, checkIns } = splitOutStayBoundaries([checkin, middle, checkout]);
    expect(checkOuts).toEqual([checkout]);
    expect(rest).toEqual([middle]);
    expect(checkIns).toEqual([checkin]);
  });

  it('groups a mid-stay "Staying" row with check-in rather than leaving it in rest, so it renders at the end of the day like check-in does', () => {
    const staying: StayRow = {
      type: 'stay',
      event: null,
      relation: 'Staying',
      key: '2027-07-01T00:00', // synthetic dayStart anchor — earliest possible key
      stay: { _id: 's1' } as never,
    };

    const { checkOuts, rest, checkIns } = splitOutStayBoundaries([staying]);
    expect(checkOuts).toEqual([]);
    expect(rest).toEqual([]);
    expect(checkIns).toEqual([staying]);
  });

  it('treats a scenario box whose ACTIVE branch is only stay boundaries as a boundary itself — the inactive tabs carry no rows and cannot disagree', () => {
    const track = (active: boolean, rows: StayRow[]) =>
      ({ scenario: { _id: active ? 'a' : 'b' }, rows, active }) as never;
    const checkoutRow: StayRow = {
      type: 'stay',
      event: null,
      relation: 'Check out',
      key: '2027-07-01T11:00',
      stay: { _id: 's1' } as never,
    };
    const box: BoxRow = {
      type: 'box',
      key: '2027-07-01T10:00',
      tracks: [track(true, [checkoutRow]), track(false, [])],
    };
    const { checkOuts, rest, checkIns } = splitOutStayBoundaries([box]);
    expect(checkOuts).toEqual([box]);
    expect(rest).toEqual([]);
    expect(checkIns).toEqual([]);
  });
});

describe('diffMinutesIso', () => {
  it('returns positive minutes when b is later than a', () => {
    expect(diffMinutesIso('2027-06-01T08:00', '2027-06-01T09:30')).toBe(90);
  });

  it('returns negative minutes when b is earlier than a', () => {
    expect(diffMinutesIso('2027-06-01T09:30', '2027-06-01T08:00')).toBe(-90);
  });

  it('returns zero for the same instant', () => {
    expect(diffMinutesIso('2027-06-01T08:00', '2027-06-01T08:00')).toBe(0);
  });

  it('crosses a calendar day boundary correctly', () => {
    expect(diffMinutesIso('2027-06-01T23:30', '2027-06-02T00:15')).toBe(45);
  });
});

describe('budget: Stay packages', () => {
  function minimalStay(
    overrides: Partial<TripData['stays'][number]> = {},
  ): TripData['stays'][number] {
    return {
      _id: 'test_stay',
      legId: 'leg_test',
      scenarioId: null,
      checkInAt: '2027-06-01T15:00',
      checkOutAt: '2027-06-02T11:00',
      lodging: { place: { id: 'place_lodge', label: 'Test Lodge' } },
      bookingId: null,
      packages: null,
      images: [],
      ...overrides,
    };
  }

  it('counts a package cost in the trip totals, on top of the room rate', () => {
    const data = minimalTripData();
    data.trip.travelers = [{ id: 't1', name: 'Alex' }];
    data.bookings.push({
      _id: 'booking_room',
      status: 'booked',
      pricing: {
        perTraveler: [],
        fixed: [{ label: 'Total', amount: { amount: 100, currency: 'USD' } }],
      },
      confirmationNumber: null,
    });
    data.stays.push(
      minimalStay({
        bookingId: 'booking_room',
        packages: [
          {
            _id: 'pkg_1',
            name: 'Resort fee',
            status: 'booked',
            cost: { amount: 20, currency: 'USD' },
            confirmationNumber: null,
            benefits: null,
            travelers: null,
          },
        ],
      }),
    );
    const view = buildTripView(data);
    expect(view.budget.totals.spent).toBe(120);
  });

  it('charges a nightly rate once per night, following the stay’s dates', () => {
    const data = minimalTripData();
    data.stays.push(
      minimalStay({
        checkInAt: '2027-06-01T15:00',
        checkOutAt: '2027-06-04T11:00',
        packages: [
          {
            _id: 'pkg_parking',
            name: 'Parking',
            status: 'booked',
            cost: { amount: 9.95, currency: 'USD' },
            confirmationNumber: null,
            benefits: null,
            travelers: null,
            per: 'night',
          },
        ],
      }),
    );
    const view = buildTripView(data);
    expect(view.budget.totals.spent).toBeCloseTo(29.85);
    const labels = view.budget.byLeg.flatMap((g) => g.rows.map((r) => r.label));
    expect(labels).toContain('Parking (3 nights × $9.95)');

    data.stays[0] = { ...data.stays[0], checkOutAt: '2027-06-02T11:00' };
    expect(buildTripView(data).budget.totals.spent).toBeCloseTo(9.95);
  });

  // A 'booked' package with no separately-broken-out cost (a perk bundled
  // into the room rate, say) used to crash the by-traveler split, which
  // assumed every booked row it saw had a real cost to divide up.
  it('does not crash splitting a booked-but-uncosted package across travelers', () => {
    const data = minimalTripData();
    data.trip.travelers = [
      { id: 't1', name: 'Alex' },
      { id: 't2', name: 'Sam' },
    ];
    data.stays.push(
      minimalStay({
        packages: [
          {
            _id: 'pkg_2',
            name: 'Bundled perk',
            status: 'booked',
            cost: null,
            confirmationNumber: null,
            benefits: null,
            travelers: null,
          },
        ],
      }),
    );
    expect(() => buildTripView(data)).not.toThrow();
    const alex = buildTripView(data).budget.byTraveler.find((t) => t.name === 'Alex');
    expect(alex?.totals.spent).toBe(0);
  });
});

describe('budget: when each price line is paid', () => {
  const usd = (amount: number) => ({ amount, currency: 'USD' });
  const lineView = (date: string, booking: TripData['bookings'][number]) => {
    const data = minimalTripData();
    data.trip.travelers = [{ id: 't1', name: 'Alex' }];
    data.bookings.push(booking);
    data.stays.push({
      _id: 'test_stay',
      legId: 'leg_test',
      scenarioId: null,
      checkInAt: `${date}T15:00`,
      checkOutAt: `${date}T23:00`,
      lodging: { place: { id: 'place_lodge', label: 'Test Lodge' } },
      bookingId: booking._id,
      images: [],
    });
    return buildTripView(data).budget;
  };
  const booked = (fixed: TripData['bookings'][number]['pricing']) => ({
    _id: 'booking_room',
    status: 'booked' as const,
    pricing: fixed,
    confirmationNumber: null,
  });

  it('counts a leg’s at-the-property charge as spent once the leg has started', () => {
    const budgetFor = (date: string) => {
      const data = minimalTripData();
      data.legs[0] = { ...data.legs[0], bookingId: 'bk_leg' };
      data.bookings.push({
        _id: 'bk_leg',
        status: 'booked',
        confirmationNumber: null,
        pricing: {
          perTraveler: [],
          fixed: [{ label: 'Gratuities', amount: usd(100), payable: 'atProperty' }],
        },
      });
      data.stays.push({
        _id: 'test_stay',
        legId: 'leg_test',
        scenarioId: null,
        checkInAt: `${date}T15:00`,
        checkOutAt: `${date}T23:00`,
        lodging: { place: { id: 'place_ship', label: 'Ship' } },
        bookingId: null,
        images: [],
      });
      return buildTripView(data).budget.totals;
    };
    expect(budgetFor('2020-01-01')).toMatchObject({ spent: 100, pending: 0 });
    expect(budgetFor('2099-01-01')).toMatchObject({ spent: 0, pending: 100 });
  });

  it('counts a requested booking as pending, whatever its lines say', () => {
    const budget = lineView('2020-01-01', {
      ...booked({ perTraveler: [], fixed: [{ label: 'Tour', amount: usd(300) }] }),
      status: 'requested',
    });
    expect(budget.totals.pending).toBe(300);
    expect(budget.totals.spent).toBe(0);
  });

  it('keeps an at-the-property charge pending until its day, and spent after', () => {
    const pricing = {
      perTraveler: [{ travelerId: 't1', fare: usd(30) }],
      fixed: [{ label: 'Room', amount: usd(100), payable: 'atProperty' as const }],
    };
    const ahead = lineView('2999-06-01', booked(pricing));
    expect(ahead.totals.pending).toBe(100);
    expect(ahead.totals.spent).toBe(30);
    expect(ahead.byLeg[0].rows[0].bucket).toBe('pending');
    const past = lineView('2000-06-01', booked(pricing));
    expect(past.totals.spent).toBe(130);
  });

  it('counts an at-the-property charge as spent from check-in day on any live booking', () => {
    const pricing = {
      perTraveler: [],
      fixed: [{ label: 'Room', amount: usd(100), payable: 'atProperty' as const }],
    };
    for (const status of ['requested', 'planning'] as const) {
      const past = lineView('2000-06-01', { ...booked(pricing), status });
      expect(past.totals.spent).toBe(100);
    }
    const ahead = lineView('2999-06-01', { ...booked(pricing), status: 'requested' });
    expect(ahead.totals.pending).toBe(100);
  });

  it('reads a due date per line', () => {
    const pricing = {
      perTraveler: [],
      fixed: [
        { label: 'Deposit', amount: usd(50) },
        { label: 'Balance', amount: usd(70), payable: { dueBy: '2999-01-01' } },
      ],
    };
    const budget = lineView('2999-06-01', booked(pricing));
    expect(budget.totals.spent).toBe(50);
    expect(budget.totals.pending).toBe(70);
  });

  it('counts a payment made on a date as spent, beside a balance still due', () => {
    const pricing = {
      perTraveler: [],
      fixed: [
        { label: 'Deposit', amount: usd(50), payable: { paidAt: '2026-08-06' } },
        { label: 'Balance', amount: usd(70), payable: { dueBy: '2999-01-01' } },
      ],
    };
    const budget = lineView('2999-06-01', booked(pricing));
    expect(budget.totals.spent).toBe(50);
    expect(budget.totals.pending).toBe(70);
  });

  it('counts a package on a transit in the totals and in booking progress', () => {
    const data = minimalTripData();
    data.transits.push({
      _id: 'test_transit',
      legId: 'leg_test',
      journeyId: null,
      scenarioId: null,
      mode: 'flight',
      travelers: null,
      from: { id: null, label: 'Float Base' },
      to: { id: null, label: 'Remote Lodge' },
      departsAt: '2999-07-01T08:00',
      arrivesAt: '2999-07-01T09:00',
      routeId: null,
      routeVariant: null,
      bookingId: null,
      packages: [
        {
          _id: 'pkg_tour',
          name: 'Bear guide',
          status: 'planning',
          cost: usd(40),
          confirmationNumber: null,
          benefits: null,
          travelers: null,
        },
      ],
      images: [],
    });
    const view = buildTripView(data);
    expect(view.budget.totals.estimated).toBe(40);
    expect(view.budget.byBasis.fixed.estimated).toBe(40);
    expect(view.legSummaries[0].bookingProgress).toBe('unplanned');
  });
});

describe('port calls', () => {
  const cruise = {
    checkInAt: '2027-07-17T15:00',
    checkOutAt: '2027-07-24T07:30',
    portCalls: [
      {
        kind: 'port' as const,
        place: { id: 'place_juneau', label: 'Juneau' },
        arrivesAt: '2027-07-21T06:30',
        departsAt: '2027-07-21T16:15',
      },
      {
        kind: 'scenic' as const,
        place: { id: 'place_glacier', label: 'Hubbard Glacier' },
        arrivesAt: '2027-07-18T15:00',
        departsAt: '2027-07-18T20:00',
      },
    ],
  };
  const ashore = (startAt: string, durationMinutes: number, placeId = 'place_tram') => ({
    _id: 'a',
    startAt,
    durationMinutes,
    place: { id: placeId, label: 'Somewhere' },
    mealType: null,
    diningFormat: null,
    options: null,
  });

  it('lists the stops a cruise makes on a day', () => {
    expect(portCallsOn([cruise], '2027-07-21').map((c) => c.place.label)).toEqual(['Juneau']);
    expect(portCallsOn([cruise], '2027-07-19')).toEqual([]);
  });

  it('lists an overnight stop on the day between its arrival and departure', () => {
    const overnight = {
      portCalls: [
        {
          kind: 'port' as const,
          place: { id: null, label: 'Overnight' },
          arrivesAt: '2027-07-20T18:00',
          departsAt: '2027-07-22T08:00',
        },
      ],
    };
    expect(portCallsOn([overnight], '2027-07-21')).toHaveLength(1);
    expect(portCallsOn([overnight], '2027-07-23')).toEqual([]);
  });

  it('flags an activity ashore outside the ship’s time in port', () => {
    expect(portCallWarningFor(ashore('2027-07-21T13:00', 120), [cruise])).toBeNull();
    expect(portCallWarningFor(ashore('2027-07-21T15:00', 120), [cruise])).toBe(
      'Ends after all aboard in Juneau at 4:15pm.',
    );
    expect(portCallWarningFor(ashore('2027-07-21T06:00', 60), [cruise])).toBe(
      'Starts before the ship arrives in Juneau at 6:30am.',
    );
    expect(portCallWarningFor(ashore('2027-07-18T16:00', 60), [cruise])).toBe(
      'The ship is cruising past Hubbard Glacier — no going ashore.',
    );
  });

  it('stops calling the ship "cruising past" a scenic stop once it is over', () => {
    expect(portCallWarningFor(ashore('2027-07-18T21:00', 60), [cruise])).toBeNull();
  });

  it('doesn’t let a later scenic stop make an earlier activity wrong', () => {
    const scenicFirst = { ...cruise, portCalls: [cruise.portCalls[1]] };
    expect(portCallWarningFor(ashore('2027-07-18T08:00', 60), [scenicFirst])).toBeNull();
  });

  it('says nothing for an activity while the ship is at sea between two stops', () => {
    const twoStops = {
      ...cruise,
      portCalls: [
        {
          kind: 'port' as const,
          place: { id: 'place_icy', label: 'Icy Strait Point' },
          arrivesAt: '2027-07-20T06:00',
          departsAt: '2027-07-20T10:00',
        },
        {
          kind: 'port' as const,
          place: { id: 'place_juneau', label: 'Juneau' },
          arrivesAt: '2027-07-20T14:00',
          departsAt: '2027-07-20T20:00',
        },
      ],
    };
    expect(portCallWarningFor(ashore('2027-07-20T11:30', 60), [twoStops])).toBeNull();
    expect(portCallWarningFor(ashore('2027-07-20T21:00', 60), [twoStops])).toBe(
      'Starts after all aboard in Juneau at 8:00pm.',
    );
  });

  it('checks an activity at the port’s own place, but not at a scenic stop’s', () => {
    expect(portCallWarningFor(ashore('2027-07-21T15:30', 60, 'place_juneau'), [cruise])).toBe(
      'Ends after all aboard in Juneau at 4:15pm.',
    );
    expect(
      portCallWarningFor(ashore('2027-07-18T16:00', 60, 'place_glacier'), [cruise]),
    ).toBeNull();
  });

  it('skips a venue aboard the ship, but flags a place ashore after the ship has sailed', () => {
    const diningRoom = {
      ...ashore('2027-07-21T06:00', 60),
      place: { id: 'place_dining', label: 'Dining Room', onboard: true },
    };
    expect(portCallWarningFor(diningRoom, [cruise])).toBeNull();
    expect(portCallWarningFor({ ...diningRoom, startAt: '2027-07-21T19:00' }, [cruise])).toBeNull();
    expect(portCallWarningFor(ashore('2027-07-21T19:00', 60), [cruise])).toBe(
      'Starts after all aboard in Juneau at 4:15pm.',
    );
  });

  it('checks a meal still choosing by its selected candidate’s place', () => {
    const lunch = { ...ashore('2027-07-21T15:30', 60), place: null };
    expect(portCallWarningFor(lunch, [cruise])).toBeNull();
    const crabShack: MealOption = {
      _id: 'opt_crab',
      diningFormat: 'sit-down',
      place: { id: 'place_crab', label: 'Crab Shack' },
      includedIn: null,
      bookingId: null,
    };
    expect(portCallWarningFor(lunch, [cruise], new Map([[lunch._id, crabShack]]))).toBe(
      'Ends after all aboard in Juneau at 4:15pm.',
    );
  });

  it('judges an activity by the stop it happens during, on a day with two', () => {
    const twoStops = {
      ...cruise,
      portCalls: [
        {
          kind: 'scenic' as const,
          place: { id: 'place_glacier', label: 'Glacier' },
          arrivesAt: '2027-07-21T06:00',
          departsAt: '2027-07-21T09:00',
        },
        {
          kind: 'port' as const,
          place: { id: 'place_port', label: 'Port' },
          arrivesAt: '2027-07-21T12:00',
          departsAt: '2027-07-21T18:00',
        },
      ],
    };
    expect(portCallWarningFor(ashore('2027-07-21T13:00', 120), [twoStops])).toBeNull();
    expect(portCallWarningFor(ashore('2027-07-21T07:00', 60), [twoStops])).toBe(
      'The ship is cruising past Glacier — no going ashore.',
    );
  });

  it('leaves alone an activity ashore before boarding', () => {
    const boardingDay = {
      ...cruise,
      portCalls: [
        { ...cruise.portCalls[1], arrivesAt: '2027-07-17T19:00', departsAt: '2027-07-17T22:00' },
      ],
    };
    expect(portCallWarningFor(ashore('2027-07-17T10:00', 60), [boardingDay])).toBeNull();
  });

  it('leaves alone an activity aboard, or at the stop itself', () => {
    const aboard = { ...ashore('2027-07-21T19:30', 90), place: null };
    expect(portCallWarningFor(aboard, [cruise])).toBeNull();
    expect(
      portCallWarningFor(ashore('2027-07-18T16:00', 60, 'place_glacier'), [cruise]),
    ).toBeNull();
  });
});
