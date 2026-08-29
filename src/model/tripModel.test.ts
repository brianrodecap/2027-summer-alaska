import { describe, expect, it } from 'vitest';

import {
  buildTripView,
  dayFullRouteUrls,
  dayMapStops,
  splitOutStayBoundaries,
  tripDateRange,
  tripDayCount,
} from './tripModel';
import type { ScenarioTabsSequenceItem, StaySequenceItem, TripData } from './types';

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
    routes: [],
  };
}

function pushMinimalActivity(data: TripData, overrides: Partial<TripData['activities'][number]>) {
  data.activities.push({
    _id: 'test_activity',
    legId: 'leg_test',
    scenarioId: null,
    status: 'planning',
    startAt: null,
    durationMinutes: null,
    timeLabel: null,
    date: null,
    order: null,
    priority: null,
    text: 'Test activity',
    place: null,
    booking: null,
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
    scenarioId: null,
    status: 'planning',
    mode: 'drive',
    from: { id: null, label: 'A' },
    to: { id: null, label: 'B' },
    departsAt: '2027-06-01T09:00',
    arrivesAt: '2027-06-01T09:30',
    routeId: null,
    routeVariant: null,
    booking: null,
    images: [],
    ...overrides,
  });
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
      variants: [{ tone: 'direct', label: 'Direct', places: [], finalLegMinutes: 60 }],
      images: [],
    });
    pushMinimalTransit(data, {
      departsAt: '2027-06-01T09:00',
      // arrivesAt is never authored for a routed drive — must come from the walk.
      arrivesAt: null,
      routeId: 'test_route',
    });
    const day = buildTripView(data).days.find((d) => d.date === '2027-06-01');
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

    const day = buildTripView(data).days.find((d) => d.date === '2027-06-01');
    expect(day).toBeDefined();
    const parentTrack = day!.scenarioTracks.find((t) => t.scenario._id === 'test_parent');
    expect(parentTrack).toBeDefined();
    const nested = parentTrack!.sequence.find(
      (i): i is ScenarioTabsSequenceItem => i.type === 'scenario-tabs',
    );
    expect(nested).toBeDefined();
    const nestedIds = nested!.tracks!.map((t) => t.scenario._id);
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
          booking: null,
        },
        {
          _id: 'opt_b',
          diningFormat: 'grab-and-go',
          place: { id: null, label: 'Restaurant B' },
          includedIn: null,
          booking: null,
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

    const day = buildTripView(data).days.find((d) => d.date === '2027-06-01')!;
    expect(day).toBeDefined();

    const gapIdx = day.sequence.findIndex(
      (i) => i.type === 'section' && i.activities.some((a) => a._id === 'test_plain_gap'),
    );
    const scenarioTabsIdx = day.sequence.findIndex((i) => i.type === 'scenario-tabs');
    expect(gapIdx).toBeGreaterThanOrEqual(0);
    expect(scenarioTabsIdx).toBeGreaterThanOrEqual(0);
    expect(gapIdx).toBeLessThan(scenarioTabsIdx);
  });

  // DaysView's "Add to this day" > Scenario flow (editForms.ts's
  // blankScenario) seeds a brand-new Scenario with no Activity/Transit of
  // its own yet, placed only via its own `date` field. buildScenarioTracks
  // must still surface it — with an empty sequence, but a real (dayStart)
  // anchorKey rather than null — so the day's own scenario-tabs placeholder
  // still splices into day.sequence and DayTimeline has somewhere to render
  // its droppable "Nothing here yet" zone (see reorder.test.ts's own test
  // for what a drop into that zone actually does).
  it('surfaces a still-empty, date-anchored scenario as its own (empty) track, and still splices a scenario-tabs placeholder into day.sequence', () => {
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
    const day = buildTripView(data).days.find((d) => d.date === '2027-06-01')!;
    expect(day).toBeDefined();

    const track = day.scenarioTracks.find((t) => t.scenario._id === 'test_scenario_empty');
    expect(track).toBeDefined();
    expect(track!.sequence).toEqual([]);

    // The track's own anchorKey (its earliest real content) legitimately
    // stays null — buildScenarioTracks' own dayStart fallback only applies
    // at the aggregate level (below), so the tab group still gets placed.
    expect(track!.anchorKey).toBeNull();
    expect(day.sequence.some((i) => i.type === 'scenario-tabs')).toBe(true);
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

    const day = buildTripView(data).days.find((d) => d.date === '2027-06-02')!;
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

    const day = buildTripView(data).days.find((d) => d.date === '2027-06-05');
    expect(day).toBeDefined();
    // day.leg resolves to whichever leg sorts first in legs' own authored order.
    expect(day!.leg._id).toBe('leg_test');
    // But entities from the incoming leg are not dropped from the sequence.
    expect(day!.transits.some((t) => t._id === 'test_transit')).toBe(true);
    const activityIds = day!.sequence
      .filter((i): i is Extract<typeof i, { type: 'section' }> => i.type === 'section')
      .flatMap((i) => i.activities.map((a) => a._id));
    expect(activityIds).toContain('test_activity');
  });
});

describe('transitOverlapWarning', () => {
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
    expect(view.activitiesById.get('test_activity')?.transitOverlapWarning).toBe(
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
    expect(view.activitiesById.get('test_activity')?.transitOverlapWarning).toBeNull();
  });

  it('still flags a non-meal Activity that starts mid-drive', () => {
    const data = minimalTripData();
    pushMinimalTransit(data, { departsAt: '2027-06-28T23:00', arrivesAt: '2027-06-28T23:30' });
    pushMinimalActivity(data, { startAt: '2027-06-28T23:10' });
    const view = buildTripView(data);
    expect(view.activitiesById.get('test_activity')?.transitOverlapWarning).toBe(
      'During transit: A → B',
    );
  });
});

describe('activityOverlapWarning', () => {
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
    expect(view.activitiesById.get('test_activity')?.activityOverlapWarning).toBe(
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
    expect(view.activitiesById.get('test_activity')?.activityOverlapWarning).toBeNull();
  });
});

describe('same-startAt Activity ordering', () => {
  it('puts a defaulted (timeLabel-anchored) startAt first, then no-duration, then ascending duration', () => {
    const data = minimalTripData();
    // TIME_LABEL_ANCHORS puts 'Morning' at 09:00 — same instant as the three
    // real-startAt activities below, so all four tie on `key`.
    pushMinimalActivity(data, { _id: 'test_fuzzy', date: '2027-06-28', timeLabel: 'Morning' });
    pushMinimalActivity(data, {
      _id: 'test_long',
      startAt: '2027-06-28T09:00',
      durationMinutes: 45,
    });
    pushMinimalActivity(data, { _id: 'test_noduration', startAt: '2027-06-28T09:00' });
    pushMinimalActivity(data, {
      _id: 'test_short',
      startAt: '2027-06-28T09:00',
      durationMinutes: 15,
    });

    const view = buildTripView(data);
    const day = view.days.find((d) => d.date === '2027-06-28');
    expect(day).toBeDefined();
    const activityIds = day!.sequence
      .filter((i): i is Extract<typeof i, { type: 'section' }> => i.type === 'section')
      .flatMap((i) => i.activities.map((a) => a._id));

    expect(activityIds).toEqual(['test_fuzzy', 'test_noduration', 'test_short', 'test_long']);
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

  it('groups a mid-stay "Staying" row with check-in rather than leaving it in rest, so it renders at the end of the day like check-in does', () => {
    const staying: StaySequenceItem = {
      type: 'stay',
      relation: 'Staying',
      key: '2027-07-01T00:00', // synthetic dayStart anchor — earliest possible key
      stay: { _id: 's1' } as never,
    };

    const { checkOuts, rest, checkIns } = splitOutStayBoundaries([staying]);
    expect(checkOuts).toEqual([]);
    expect(rest).toEqual([]);
    expect(checkIns).toEqual([staying]);
  });
});

describe('dayMapStops', () => {
  function pushMinimalStay(data: TripData, overrides: Partial<TripData['stays'][number]>) {
    data.stays.push({
      _id: 'test_stay',
      legId: 'leg_test',
      checkInAt: '2027-06-01T15:00',
      checkOutAt: '2027-06-05T11:00',
      status: 'planning',
      lodging: null,
      booking: null,
      images: [],
      ...overrides,
    });
  }

  it('includes a mid-stay lodging (relation "Staying") on the map, not just its check-in/check-out days', () => {
    const data = minimalTripData();
    pushMinimalStay(data, { lodging: { placeId: 'place_lodge', name: 'Test Lodge' } });
    // 2027-06-03 falls strictly inside the stay's checkIn/checkOut span —
    // a genuine "Staying" night, not a check-in or check-out day.
    const day = buildTripView(data).days.find((d) => d.date === '2027-06-03')!;
    expect(dayMapStops(day).flat()).toContain('Test Lodge');
  });

  // A same-day fly-in-only excursion: a non-'drive' Transit pair (a
  // floatplane out and back) whose destination — the remote lodge/lake, only
  // reachable by air — is what dropExcursionInteriors strips from a driving
  // route, keeping only the drivable near-side dock the outbound leg departs
  // from and the return leg comes back to.
  function pushExcursionPair(data: TripData) {
    pushMinimalTransit(data, {
      _id: 'test_excursion_out',
      mode: 'flight',
      from: { id: null, label: 'Test Dock' }, // drivable, no resolved placeId
      to: { id: null, label: 'Remote Lodge' }, // fly-in-only destination
      departsAt: '2027-06-03T08:00',
      arrivesAt: '2027-06-03T08:30',
    });
    pushMinimalTransit(data, {
      _id: 'test_excursion_back',
      mode: 'flight',
      from: { id: null, label: 'Remote Lodge' },
      to: { id: null, label: 'Test Dock' },
      departsAt: '2027-06-03T16:00',
      arrivesAt: '2027-06-03T16:30',
    });
  }

  it('bookends a "Staying" day\'s stops with the lodging at both the start and the end, not just the end', () => {
    const data = minimalTripData();
    pushMinimalStay(data, { lodging: { placeId: 'place_lodge', name: 'Test Lodge' } });
    pushExcursionPair(data);
    const day = buildTripView(data).days.find((d) => d.date === '2027-06-03')!;
    const segments = dayMapStops(day);
    // A same-day excursion (out and back to the same dock) never splits the
    // day into more than one drivable run — only a genuine relocation does.
    expect(segments.length).toBe(1);
    const stops = segments[0];
    expect(stops[0]).toBe('Test Lodge');
    expect(stops[stops.length - 1]).toBe('Test Lodge');
  });

  it("bookends the full Google Maps route link the same way, routes through the excursion's drivable dock as its only waypoint, and never routes through the fly-in-only destination itself despite that place carrying no resolved placeId either", () => {
    const data = minimalTripData();
    pushMinimalStay(data, { lodging: { placeId: 'place_lodge', name: 'Test Lodge' } });
    pushExcursionPair(data);
    const day = buildTripView(data).days.find((d) => d.date === '2027-06-03')!;
    const urls = dayFullRouteUrls(day);
    expect(urls.length).toBeGreaterThan(0);
    expect(new URL(urls[0]).searchParams.get('origin')).toBe('Test Lodge');
    expect(new URL(urls[urls.length - 1]).searchParams.get('destination')).toBe('Test Lodge');
    expect(new URL(urls[0]).searchParams.get('waypoints')).toBe('Test Dock');
  });

  it("drops a same-day excursion's remote destination (and everything that happened there) from the map stops entirely, keeping only its drivable near-side dock", () => {
    const data = minimalTripData();
    pushMinimalStay(data, { lodging: { placeId: 'place_lodge', name: 'Test Lodge' } });
    pushExcursionPair(data);
    const day = buildTripView(data).days.find((d) => d.date === '2027-06-03')!;
    const stops = dayMapStops(day);
    expect(stops).toEqual([['Test Lodge', 'Test Dock', 'Test Lodge']]);
    expect(stops.flat()).not.toContain('Remote Lodge');
  });

  it('still excludes a mid-voyage cruise cabin (no fixed placeId) from the map on a "Staying" night', () => {
    const data = minimalTripData();
    pushMinimalStay(data, { lodging: { placeId: null, name: 'Test Ship' } });
    const day = buildTripView(data).days.find((d) => d.date === '2027-06-03')!;
    expect(dayMapStops(day).flat()).not.toContain('Test Ship');
  });

  // A genuine relocation — a non-'drive' Transit with no same-day return —
  // splits the day into separate drivable runs instead of trying to draw
  // one continuous route across two disconnected road networks (the real
  // bug this was built to catch: a one-way flight produced a "driving
  // route" straight across two towns with no road between them at all).
  it('splits a genuine one-way relocation (no same-day return) into two separate drivable runs, never bridging them into one route', () => {
    const data = minimalTripData();
    pushMinimalActivity(data, {
      _id: 'test_before_flight',
      startAt: '2027-06-03T08:00',
      place: { id: 'place_a', label: 'Origin Cafe' },
    });
    pushMinimalTransit(data, {
      _id: 'test_relocation',
      mode: 'flight',
      from: { id: null, label: 'Origin Airport' },
      to: { id: null, label: 'Destination Airport' },
      departsAt: '2027-06-03T10:00',
      arrivesAt: '2027-06-03T12:00',
    });
    pushMinimalActivity(data, {
      _id: 'test_after_flight',
      startAt: '2027-06-03T14:00',
      place: { id: 'place_b', label: 'Destination Diner' },
    });
    const day = buildTripView(data).days.find((d) => d.date === '2027-06-03')!;

    const segments = dayMapStops(day);
    expect(segments).toEqual([
      ['Origin Cafe', 'Origin Airport'],
      ['Destination Airport', 'Destination Diner'],
    ]);

    const urls = dayFullRouteUrls(day);
    expect(urls.length).toBe(2);
    expect(new URL(urls[0]).searchParams.get('destination')).toBe('Origin Airport');
    expect(new URL(urls[1]).searchParams.get('origin')).toBe('Destination Airport');
  });
});
