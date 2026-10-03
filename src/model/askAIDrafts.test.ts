import { describe, expect, it } from 'vitest';

import {
  applyAlternative,
  applyMealOptions,
  buildNewActivity,
  changedActivities,
  parseAlternative,
  parseNote,
  parseRoute,
  placeIdsMissingImages,
  type ProposedAlternative,
  resolveNoteProposal,
  resolveRouteProposal,
  withPlaceImages,
} from './askAIDrafts';
import { blankActivity } from './editForms';
import type { Activity, Image, Note, Route, Scenario, TripData } from './types';

const DATE = '2027-07-13';

function activity(id: string, overrides: Partial<Activity> = {}): Activity {
  return {
    ...blankActivity('leg_a', DATE),
    _id: id,
    startAt: `${DATE}T09:00`,
    date: null,
    text: id,
    ...overrides,
  };
}

function scenario(id: string, tone: Scenario['tone'], overrides: Partial<Scenario> = {}): Scenario {
  return {
    _id: id,
    legId: 'leg_a',
    tone,
    label: id,
    icon: 'help_outline',
    images: [],
    ...overrides,
  };
}

function trip(activities: Activity[], scenarios: Scenario[] = []): TripData {
  return {
    trip: { _id: 't', name: 'T', travelers: [], images: [] },
    legs: [],
    stays: [],
    transits: [],
    activities,
    scenarios,
    notes: [],
    travelModeOverrides: [],
    routes: [],
  } as unknown as TripData;
}

describe('applyMealOptions', () => {
  it('turns a meal into undecided candidates, keeping a booked existing choice', () => {
    const booking = { status: 'booked' as const, cost: null, confirmationNumber: 'ABC' };
    const dinner = activity('dinner', {
      mealType: 'dinner',
      place: { id: 'p_simon', label: "Simon & Seafort's" },
      diningFormat: 'sit-down',
      booking,
    });
    applyMealOptions(dinner, [
      { placeLabel: "Simon & Seafort's", placeId: 'p_simon' },
      { placeLabel: 'Orso', placeId: 'p_orso' },
    ]);
    expect(dinner.place).toBeNull();
    expect(dinner.booking).toBeNull();
    expect(dinner.options?.map((o) => o.place?.label)).toEqual(["Simon & Seafort's", 'Orso']);
    // The reservation moved onto its candidate rather than being dropped.
    expect(dinner.options?.[0].booking).toEqual(booking);
    expect(dinner.options?.[1].place?.id).toBe('p_orso');
  });

  it('keeps an existing candidate’s id when the list is revised', () => {
    const dinner = activity('dinner', { mealType: 'dinner' });
    applyMealOptions(dinner, [{ placeLabel: 'Orso' }, { placeLabel: "Crow's Nest" }]);
    const orsoId = dinner.options?.[0]._id;
    applyMealOptions(dinner, [{ placeLabel: 'orso' }, { placeLabel: 'Marx Bros. Cafe' }]);
    expect(dinner.options?.[0]._id).toBe(orsoId);
  });

  it('treats a single candidate as a decision', () => {
    const dinner = activity('dinner', { mealType: 'dinner' });
    applyMealOptions(dinner, [{ placeLabel: 'Orso', placeId: 'p_orso', diningFormat: 'sit-down' }]);
    expect(dinner.options).toBeNull();
    expect(dinner.place).toEqual({ id: 'p_orso', label: 'Orso' });
    expect(dinner.diningFormat).toBe('sit-down');
  });
});

describe('buildNewActivity', () => {
  it('builds a timed activity in the given branch, with meal candidates', () => {
    const a = buildNewActivity(
      {
        text: 'Dinner',
        startAt: `${DATE}T18:30`,
        mealType: 'dinner',
        mealOptions: [{ placeLabel: 'Orso' }, { placeLabel: "Crow's Nest" }],
      },
      'leg_a',
      'sc_grounded',
    );
    expect(a).toMatchObject({
      legId: 'leg_a',
      scenarioId: 'sc_grounded',
      startAt: `${DATE}T18:30`,
      date: null,
      mealType: 'dinner',
      place: null,
    });
    expect(a.options).toHaveLength(2);
  });
});

describe('applyAlternative', () => {
  const museum = { text: 'Anchorage Museum', startAt: `${DATE}T13:00` };
  const creek = { text: 'Ship Creek salmon', startAt: `${DATE}T17:00` };

  it('adds another option to an existing group, copying its gating', () => {
    const gate = { requiresScenarioId: ['sc_prev_ideal'] };
    const data = trip(
      [
        activity('fly', { scenarioId: 'sc_go' }),
        activity('wait', { scenarioId: 'sc_grounded' }),
        activity('prev', { scenarioId: 'sc_prev_ideal', startAt: '2027-07-12T09:00' }),
      ],
      [
        scenario('sc_go', 'ideal', gate),
        scenario('sc_grounded', 'alternate', gate),
        scenario('sc_prev_ideal', 'ideal'),
        scenario('sc_prev_alt', 'alternate', { date: '2027-07-12' }),
      ],
    );
    const alt: ProposedAlternative = {
      date: DATE,
      legId: 'leg_a',
      summary: 'A rainy-day plan',
      label: 'Rain',
      siblingOf: 'sc_grounded',
      activities: [museum, creek],
    };
    const result = applyAlternative(alt, data);
    if ('error' in result) throw new Error(result.error);
    const added = result.data.scenarios.find((s) => s.label === 'Rain')!;
    expect(added).toMatchObject({ tone: 'alternate', requiresScenarioId: ['sc_prev_ideal'] });
    const newActivities = result.data.activities.filter((a) => a.scenarioId === added._id);
    expect(newActivities.map((a) => a.text)).toEqual(['Anchorage Museum', 'Ship Creek salmon']);
  });

  it('adds only the activities left checked in review', () => {
    const data = trip(
      [activity('fly', { scenarioId: 'sc_go' }), activity('wait', { scenarioId: 'sc_grounded' })],
      [scenario('sc_go', 'ideal'), scenario('sc_grounded', 'alternate')],
    );
    const result = applyAlternative(
      {
        date: DATE,
        legId: 'leg_a',
        summary: 's',
        label: 'Rain',
        siblingOf: 'sc_go',
        activities: [museum, creek],
      },
      data,
      new Set([1]),
    );
    if ('error' in result) throw new Error(result.error);
    expect(result.data.activities.map((a) => a.text)).toContain('Ship Creek salmon');
    expect(result.data.activities.map((a) => a.text)).not.toContain('Anchorage Museum');
  });

  it("starts a day's first group: the named entries become the ideal branch", () => {
    const data = trip([activity('flight'), activity('hike'), activity('dinner')]);
    const result = applyAlternative(
      {
        date: DATE,
        legId: 'leg_a',
        summary: 'If the flight is grounded',
        label: 'Grounded',
        idealLabel: 'Flight goes',
        idealEntityIds: ['flight', 'hike'],
        activities: [museum],
      },
      data,
    );
    if ('error' in result) throw new Error(result.error);
    const ideal = result.data.scenarios.find((s) => s.label === 'Flight goes')!;
    const grounded = result.data.scenarios.find((s) => s.label === 'Grounded')!;
    expect(ideal.tone).toBe('ideal');
    expect(grounded.tone).toBe('alternate');
    const scenarioOf = (id: string) => result.data.activities.find((a) => a._id === id)?.scenarioId;
    expect(scenarioOf('flight')).toBe(ideal._id);
    expect(scenarioOf('hike')).toBe(ideal._id);
    // Dinner happens either way, so it stays out of both branches.
    expect(scenarioOf('dinner')).toBeNull();
  });

  it('refuses to move an entry that already belongs to an option', () => {
    const data = trip(
      [activity('fly', { scenarioId: 'sc_go' }), activity('wait', { scenarioId: 'sc_grounded' })],
      [scenario('sc_go', 'ideal'), scenario('sc_grounded', 'alternate')],
    );
    const result = applyAlternative(
      {
        date: DATE,
        legId: 'leg_a',
        summary: 's',
        label: 'Rain',
        idealLabel: 'Dry',
        idealEntityIds: ['fly'],
        activities: [museum],
      },
      data,
    );
    expect(result).toEqual({ error: 'Some of those entries already belong to an option.' });
  });

  it('asks for a sibling instead when the day already has options', () => {
    const data = trip(
      [
        activity('fly', { scenarioId: 'sc_go' }),
        activity('wait', { scenarioId: 'sc_grounded' }),
        activity('lunch'),
      ],
      [scenario('sc_go', 'ideal'), scenario('sc_grounded', 'alternate')],
    );
    const result = applyAlternative(
      {
        date: DATE,
        legId: 'leg_a',
        summary: 's',
        label: 'Rain',
        idealLabel: 'Dry',
        idealEntityIds: ['lunch'],
        activities: [museum],
      },
      data,
    );
    expect(result).toEqual({
      error: 'That day already has options — ask for this to be added beside one of them instead.',
    });
  });

  it('reports a sibling that no longer exists', () => {
    const result = applyAlternative(
      {
        date: DATE,
        legId: 'leg_a',
        summary: 's',
        label: 'Rain',
        siblingOf: 'gone',
        activities: [museum],
      },
      trip([]),
    );
    expect('error' in result).toBe(true);
  });
});

describe('parseAlternative', () => {
  it('needs either a sibling or the pieces to start a group', () => {
    expect(() =>
      parseAlternative({
        date: DATE,
        legId: 'l',
        summary: 's',
        label: 'Rain',
        activities: [museumSpec()],
      }),
    ).toThrow('siblingOf');
  });

  it('validates each activity', () => {
    expect(() =>
      parseAlternative({
        date: DATE,
        legId: 'l',
        summary: 's',
        label: 'Rain',
        siblingOf: 'x',
        activities: [{ text: 'No time' }],
      }),
    ).toThrow('startAt');
  });
});

function museumSpec() {
  return { text: 'Museum', startAt: `${DATE}T13:00` };
}

describe('place images', () => {
  const photo: Image = { uri: 'https://example.test/p1.jpg', credit: null, caption: null };
  const images = new Map([['p1', photo]]);

  it('collects imageless place ids from a place and its meal candidates', () => {
    const meal = activity('a');
    applyMealOptions(meal, [{ placeLabel: 'One', placeId: 'p1' }, { placeLabel: 'Two' }]);
    const own: Image = { uri: 'https://example.test/own.jpg', credit: null, caption: null };
    const pictured = activity('b', { place: { id: 'p2', label: 'Two', images: [own] } });
    const plain = activity('c', { place: { id: 'p3', label: 'Three' } });
    expect(placeIdsMissingImages([meal, pictured, plain])).toEqual(['p1', 'p3']);
  });

  it('finds only the activities an apply added or changed', () => {
    const kept = activity('a');
    const moved = activity('b');
    const prev = { activities: [kept, moved] } as TripData;
    const added = activity('c');
    const next = { activities: [kept, { ...moved, startAt: `${DATE}T15:00` }, added] } as TripData;
    expect(changedActivities(prev, next).map((a) => a._id)).toEqual(['b', 'c']);
  });

  it('fills an imageless place and each imageless meal candidate', () => {
    const a = activity('a', { place: { id: 'p1', label: 'One' } });
    expect(withPlaceImages(a, images).place?.images).toEqual([photo]);

    const meal = activity('m');
    applyMealOptions(meal, [
      { placeLabel: 'One', placeId: 'p1' },
      { placeLabel: 'Two', placeId: 'p9' },
    ]);
    const filled = withPlaceImages(meal, images);
    expect(filled.options?.map((o) => o.place?.images)).toEqual([[photo], undefined]);
  });

  it('keeps an existing image and returns the same activity when nothing changes', () => {
    const own: Image = { uri: 'https://example.test/own.jpg', credit: null, caption: null };
    const a = activity('a', { place: { id: 'p1', label: 'One', images: [own] } });
    expect(withPlaceImages(a, images)).toBe(a);
  });
});

describe('notes', () => {
  const note: Note = {
    _id: 'note_1',
    kind: 'info',
    text: 'Bring cash',
    concerns: [{ entity: 'activity', id: 'tour' }],
    images: [],
  };
  const data = { ...trip([activity('tour')]), notes: [note] };

  it('requires exactly one attachment for a new note', () => {
    expect(() => parseNote({ summary: 's', kind: 'info', text: 'x' })).toThrow(/exactly one/);
    expect(() =>
      parseNote({
        summary: 's',
        kind: 'info',
        text: 'x',
        entityKind: 'activity',
        entityId: 'tour',
        date: DATE,
      }),
    ).toThrow(/exactly one/);
    expect(() => parseNote({ summary: 's', remove: true })).toThrow(/noteId/);
  });

  it('drafts a new note against an entry, a date, or a date range', () => {
    const onEntry = parseNote({
      summary: 's',
      kind: 'warning',
      text: 'Closes at 4',
      entityKind: 'activity',
      entityId: 'tour',
    });
    expect(resolveNoteProposal(onEntry, data)).toEqual({
      mode: 'create',
      ref: { entity: 'activity', id: 'tour' },
      kind: 'warning',
      text: 'Closes at 4',
    });
    const range = parseNote({
      summary: 's',
      kind: 'info',
      text: 'Smoke season',
      date: DATE,
      endDate: '2027-07-15',
    });
    expect(resolveNoteProposal(range, data)).toMatchObject({
      ref: { dateRange: [DATE, '2027-07-15'] },
    });
  });

  it("won't attach to an entry that doesn't exist or is a different kind", () => {
    const wrongKind = parseNote({
      summary: 's',
      kind: 'info',
      text: 'x',
      entityKind: 'stay',
      entityId: 'tour',
    });
    expect(resolveNoteProposal(wrongKind, data)).toHaveProperty('error');
  });

  it('overlays only the changed fields on an edit, and leaves a removal unchanged', () => {
    const edit = parseNote({ summary: 's', noteId: 'note_1', kind: 'warning' });
    expect(resolveNoteProposal(edit, data)).toEqual({
      mode: 'edit',
      note: { ...note, kind: 'warning' },
    });
    const removal = parseNote({ summary: 's', noteId: 'note_1', remove: true });
    expect(resolveNoteProposal(removal, data)).toEqual({ mode: 'edit', note });
  });
});

describe('routes', () => {
  const photo: Image = {
    uri: 'https://example.test/stop.jpg',
    credit: null,
    caption: null,
  } as Image;
  const existing: Route = {
    _id: 'route_a',
    from: { id: 'p_from', label: 'From' },
    to: { id: 'p_to', label: 'To' },
    variants: [
      {
        tone: 'direct',
        label: 'Highway',
        places: [
          {
            kind: 'waypoint',
            place: { id: 'p_stop', label: 'Stop', images: [photo] },
            travel: { minutes: 40, miles: 30 },
            durationMinutes: 45,
            note: 'Restrooms',
          },
        ],
        finalTravel: { minutes: 20 },
      },
      { tone: 'scenic', label: 'Coast', places: [], finalTravel: { minutes: 90 } },
      { tone: 'scenic', label: 'Pass', places: [], finalTravel: { minutes: 80 } },
    ],
    images: [],
  };
  const data = { ...trip([]), routes: [existing] };

  it('needs endpoints and variants for a new route', () => {
    expect(() => parseRoute({ summary: 's', variants: [] })).toThrow();
    expect(() =>
      parseRoute({
        summary: 's',
        from: { label: 'A', placeId: 'p_a' },
        to: { label: 'B', placeId: 'p_b' },
      }),
    ).toThrow(/new route/);
    expect(() =>
      parseRoute({
        summary: 's',
        routeId: 'route_a',
        variants: [{ tone: 'direct', label: 'x', places: [{ kind: 'stop', label: 'y' }] }],
      }),
    ).toThrow(/waypoint or via/);
  });

  it('drafts a new route with a fresh id and zeroed travel for recomputing', () => {
    const proposal = parseRoute({
      summary: 's',
      from: { label: 'A', placeId: 'p_a' },
      to: { label: 'B', placeId: 'p_b' },
      variants: [
        {
          tone: 'direct',
          label: 'Fast',
          places: [{ kind: 'waypoint', label: 'Cafe', placeId: 'p_cafe' }],
        },
      ],
    });
    const resolved = resolveRouteProposal(proposal, data);
    if ('error' in resolved) throw new Error(resolved.error);
    expect(resolved.isNew).toBe(true);
    expect(resolved.route._id).not.toBe('route_a');
    expect(resolved.route.from).toEqual({ id: 'p_a', label: 'A' });
    expect(resolved.route.variants[0].places[0]).toEqual({
      kind: 'waypoint',
      place: { id: 'p_cafe', label: 'Cafe' },
      travel: { minutes: 0 },
      note: null,
    });
  });

  it("keeps a revised stop's stored place, duration and note, and the endpoints left out", () => {
    const proposal = parseRoute({
      summary: 's',
      routeId: 'route_a',
      variants: [
        {
          tone: 'direct',
          label: 'Highway',
          places: [
            { kind: 'waypoint', label: 'Diner', placeId: 'p_diner' },
            { kind: 'waypoint', label: 'Stop', placeId: 'p_stop' },
          ],
        },
      ],
    });
    const resolved = resolveRouteProposal(proposal, data);
    if ('error' in resolved) throw new Error(resolved.error);
    expect(resolved.isNew).toBe(false);
    expect(resolved.route.from).toBe(existing.from);
    const direct = resolved.route.variants.find((v) => v.tone === 'direct')!;
    expect(direct.places[1]).toEqual(existing.variants[0].places[0]);
    expect(direct.finalTravel).toEqual({ minutes: 20 });
  });

  it('matches a scenic variant by label, never by position', () => {
    const proposal = parseRoute({
      summary: 's',
      routeId: 'route_a',
      variants: [{ tone: 'scenic', label: 'Pass', places: [] }],
    });
    const resolved = resolveRouteProposal(proposal, data);
    if ('error' in resolved) throw new Error(resolved.error);
    const pass = resolved.route.variants.find((v) => v.label === 'Pass')!;
    expect(pass.finalTravel).toEqual({ minutes: 80 });
  });

  const revise = (variants: unknown[]) => {
    const resolved = resolveRouteProposal(
      parseRoute({ summary: 's', routeId: 'route_a', variants }),
      data,
    );
    if ('error' in resolved) throw new Error(resolved.error);
    return resolved.route.variants;
  };

  it('patches: a revised variant is replaced in place and the rest are kept', () => {
    const variants = revise([
      {
        tone: 'scenic',
        label: 'Coast',
        places: [{ kind: 'waypoint', label: 'Beluga Point', placeId: 'p_beluga' }],
      },
    ]);
    expect(variants.map((v) => v.label)).toEqual(['Highway', 'Coast', 'Pass']);
    expect(variants[1].places.map((p) => p.place?.id)).toEqual(['p_beluga']);
    expect(variants[0]).toEqual(existing.variants[0]);
  });

  it('adds a variant that revises none, and renames the only one of its tone', () => {
    const variants = revise([
      { tone: 'scenic', label: 'Glacier', places: [] },
      { tone: 'direct', label: 'Hwy 1', places: [] },
    ]);
    expect(variants.map((v) => v.label)).toEqual(['Hwy 1', 'Coast', 'Pass', 'Glacier']);
    expect(variants.filter((v) => v.tone === 'direct')).toHaveLength(1);
  });

  it('adds the second of two proposals that revise the same variant', () => {
    const variants = revise([
      { tone: 'direct', label: 'Highway', places: [] },
      { tone: 'direct', label: 'Old road', places: [] },
    ]);
    expect(variants.map((v) => v.label)).toEqual(['Highway', 'Coast', 'Pass', 'Old road']);
  });

  it('reports a routeId that does not exist', () => {
    const proposal = parseRoute({
      summary: 's',
      routeId: 'nope',
      from: { label: 'A', placeId: 'a' },
    });
    expect(resolveRouteProposal(proposal, data)).toHaveProperty('error');
  });
});
