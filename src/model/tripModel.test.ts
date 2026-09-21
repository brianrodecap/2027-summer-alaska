import { describe, expect, it } from 'vitest';

import { buildLiveDays } from './liveDays';
import {
  buildTripView,
  diffMinutesIso,
  splitOutStayBoundaries,
  tripDateRange,
  tripDayCount,
} from './tripModel';
import type { BoxRow, StayRow, TripData } from './types';

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
    travelModeOverrides: [],
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

// A day as the reader sees it (rows, scenario tabs): the static frame from
// buildTripView laid out for the given scenario picks.
function liveDay(data: TripData, date: string, picks = new Map<string, string>()) {
  const { days } = buildLiveDays(buildTripView(data), data, {
    scenarioPicks: picks,
    routeTones: new Map(),
    mealOptionIndex: new Map(),
  });
  return days.find((d) => d.date === date);
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
      status: 'planning',
      lodging: null,
      booking: null,
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
      status: 'planning',
      lodging: null,
      booking: null,
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
    expect(view.activitiesById.get('test_a')?.activityOverlapWarning).toBeNull();
    expect(view.activitiesById.get('test_b')?.activityOverlapWarning).toBeNull();
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
    expect(view.activitiesById.get('test_point')?.activityOverlapWarning).toBe(
      'Overlaps with "Long hike".',
    );
    expect(view.activitiesById.get('test_span')?.activityOverlapWarning).toBe(
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
    expect(view.activitiesById.get('test_activity')?.transitOverlapWarning).toBeNull();
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
      status: 'planning',
      lodging: { place: { id: 'place_lodge', label: 'Test Lodge' } },
      booking: null,
      packages: null,
      images: [],
      ...overrides,
    };
  }

  it('counts a package cost in the trip totals, on top of the room rate', () => {
    const data = minimalTripData();
    data.trip.travelers = [{ id: 't1', name: 'Alex' }];
    data.stays.push(
      minimalStay({
        booking: {
          status: 'booked',
          cost: { amount: 100, currency: 'USD' },
          confirmationNumber: null,
        },
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
