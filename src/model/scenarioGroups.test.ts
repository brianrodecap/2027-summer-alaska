import { describe, expect, it } from 'vitest';

import {
  deriveScenarioGroups,
  describeScenarioGroupProblems,
  resolveActiveScenarios,
  resolveScenarioToneChange,
  scenarioDeletionBlocker,
  scenarioGroups,
  scenarioMembersOn,
  validateScenarioGroups,
} from './scenarioGroups';
import { resolveScenarioDates } from './tripModel';
import type { Activity, Scenario, Stay, Transit } from './types';

// Synthetic fixtures only — never the real scenarios.json.
function scenario(id: string, tone: 'ideal' | 'alternate', overrides: Partial<Scenario> = {}) {
  return {
    _id: id,
    legId: 'leg_test',
    tone,
    label: id,
    icon: 'help_outline',
    images: [],
    ...overrides,
  } satisfies Scenario;
}

function activity(id: string, scenarioId: string | null, startAt: string | null, extra = {}) {
  return {
    _id: id,
    legId: 'leg_test',
    scenarioId,
    status: 'planning',
    startAt,
    durationMinutes: null,
    timeLabel: null,
    date: null,
    priority: null,
    text: id,
    place: null,
    booking: null,
    mealType: null,
    diningFormat: null,
    includedIn: null,
    options: null,
    travelers: null,
    images: [],
    ...extra,
  } satisfies Activity;
}

function stay(id: string, scenarioId: string | null, checkInAt: string, checkOutAt: string) {
  return {
    _id: id,
    legId: 'leg_test',
    scenarioId,
    checkInAt,
    checkOutAt,
    status: 'planning',
    lodging: null,
    booking: null,
    images: [],
  } satisfies Stay;
}

function data(
  scenarios: Scenario[],
  activities: Activity[] = [],
  stays: Stay[] = [],
  transits: Transit[] = [],
) {
  return { scenarios, activities, stays, transits };
}

const groupKeys = (d: ReturnType<typeof data>) =>
  deriveScenarioGroups(d.scenarios, resolveScenarioDates(d.scenarios, d.activities, d.transits))
    .map((g) => g.key)
    .sort();

describe('deriveScenarioGroups / validateScenarioGroups', () => {
  it('groups same-date, same-gate scenarios; separates other dates, other gates and nested children', () => {
    const scenarios = [
      scenario('a_ideal', 'ideal'),
      scenario('a_alt', 'alternate'),
      scenario('b_ideal', 'ideal'),
      scenario('b_alt', 'alternate'),
      scenario('g_ideal', 'ideal', { requiresScenarioId: ['a_ideal'] }),
      scenario('g_alt', 'alternate', { requiresScenarioId: ['a_ideal'] }),
      scenario('h_ideal', 'ideal', { requiresScenarioId: ['a_alt'] }),
      scenario('h_alt', 'alternate', { requiresScenarioId: ['a_alt'] }),
      scenario('n_ideal', 'ideal', { parentScenarioId: 'a_alt' }),
      scenario('n_alt', 'alternate', { parentScenarioId: 'a_alt' }),
    ];
    const activities = [
      activity('1', 'a_ideal', '2027-06-01T09:00'),
      activity('2', 'a_alt', '2027-06-01T10:00'),
      activity('3', 'b_ideal', '2027-06-02T09:00'),
      activity('4', 'b_alt', '2027-06-02T10:00'),
      activity('5', 'g_ideal', '2027-06-03T09:00'),
      activity('6', 'g_alt', '2027-06-03T10:00'),
      activity('7', 'h_ideal', '2027-06-03T09:00'),
      activity('8', 'h_alt', '2027-06-03T10:00'),
      activity('9', 'n_ideal', '2027-06-01T11:00'),
      activity('10', 'n_alt', '2027-06-01T12:00'),
    ];
    expect(groupKeys(data(scenarios, activities))).toEqual(
      ['a_alt+a_ideal', 'b_alt+b_ideal', 'g_alt+g_ideal', 'h_alt+h_ideal', 'n_alt+n_ideal'].sort(),
    );
  });

  it('reports a group with no ideal or several ideals, and passes a valid one', () => {
    const scenarios = [
      scenario('ok_ideal', 'ideal'),
      scenario('ok_alt', 'alternate'),
      scenario('none_a', 'alternate', { date: '2027-06-05' }),
      scenario('none_b', 'alternate', { date: '2027-06-05' }),
      scenario('two_a', 'ideal', { date: '2027-06-06' }),
      scenario('two_b', 'ideal', { date: '2027-06-06' }),
    ];
    const activities = [
      activity('1', 'ok_ideal', '2027-06-01T09:00'),
      activity('2', 'ok_alt', '2027-06-01T09:00'),
    ];
    const groups = deriveScenarioGroups(scenarios, resolveScenarioDates(scenarios, activities, []));
    const problems = validateScenarioGroups(groups, scenarios);
    expect(problems.map((p) => [p.key, p.kind]).sort()).toEqual([
      ['none_a+none_b', 'no-ideal'],
      ['two_a+two_b', 'multiple-ideals'],
    ]);
  });
});

describe('describeScenarioGroupProblems', () => {
  it('names each broken group by label and says how to fix it; a healthy trip reports none', () => {
    const healthy = data(
      [
        scenario('a', 'ideal', { label: 'Flight goes' }),
        scenario('b', 'alternate', { label: 'Grounded' }),
      ],
      [activity('1', 'a', '2027-06-01T09:00'), activity('2', 'b', '2027-06-01T09:00')],
    );
    expect(describeScenarioGroupProblems(healthy)).toEqual([]);

    const broken = data([
      scenario('x', 'alternate', { label: 'Plan X', date: '2027-06-05' }),
      scenario('y', 'alternate', { label: 'Plan Y', date: '2027-06-05' }),
    ]);
    const [problem] = describeScenarioGroupProblems(broken);
    expect(problem.kind).toBe('no-ideal');
    expect(problem.labels.sort()).toEqual(['Plan X', 'Plan Y']);
    expect(problem.message).toMatch(/Set one to Ideal/);
  });
});

describe('resolveActiveScenarios', () => {
  const chain = () => {
    const scenarios = [
      scenario('d1_ideal', 'ideal'),
      scenario('d1_alt', 'alternate'),
      // Gated on d1: only reachable when d1_ideal is active.
      scenario('d2_ideal', 'ideal', { requiresScenarioId: ['d1_ideal'] }),
      scenario('d2_alt', 'alternate', { requiresScenarioId: ['d1_ideal'] }),
      // Gated on either of two.
      scenario('d3_ideal', 'ideal', { requiresScenarioId: ['d2_alt', 'd1_alt'] }),
      // Ungated follower: defaults to the followed scenario's tone.
      scenario('f_ideal', 'ideal', { followsScenarioId: 'd1_ideal' }),
      scenario('f_alt', 'alternate', { followsScenarioId: 'd1_ideal' }),
    ];
    const activities = [
      activity('1', 'd1_ideal', '2027-06-01T09:00'),
      activity('2', 'd1_alt', '2027-06-01T09:00'),
      activity('3', 'd2_ideal', '2027-06-02T09:00'),
      activity('4', 'd2_alt', '2027-06-02T09:00'),
      activity('5', 'd3_ideal', '2027-06-03T09:00'),
      activity('6', 'f_ideal', '2027-06-04T09:00'),
      activity('7', 'f_alt', '2027-06-04T09:00'),
    ];
    return data(scenarios, activities);
  };

  it('defaults every group to its ideal and honors a pick by scenario id', () => {
    const d = chain();
    expect([...resolveActiveScenarios(d, new Map()).activeIds].sort()).toEqual([
      'd1_ideal',
      'd2_ideal',
      'f_ideal',
    ]);
    const key = 'd1_alt+d1_ideal';
    const resolved = resolveActiveScenarios(d, new Map([[key, 'd1_alt']]));
    expect(resolved.activeIds.has('d1_alt')).toBe(true);
    expect(resolved.activeIds.has('d1_ideal')).toBe(false);
  });

  it("keeps a pick after its group's member set (and so its key) changes", () => {
    const d = chain();
    d.scenarios.push(scenario('d1_extra', 'alternate'));
    d.activities.push(activity('8', 'd1_extra', '2027-06-01T09:00'));
    // The pick was made when the group was just d1_alt + d1_ideal.
    const resolved = resolveActiveScenarios(d, new Map([['d1_alt+d1_ideal', 'd1_alt']]));
    expect(resolved.activeIds.has('d1_alt')).toBe(true);
    expect(resolved.activeIds.has('d1_ideal')).toBe(false);
  });

  it('gates a group on its required scenarios (any one active), dropping it outright otherwise', () => {
    const d = chain();
    // d1_alt picked: d2's gate (d1_ideal) is no longer satisfied.
    const resolved = resolveActiveScenarios(d, new Map([['d1_alt+d1_ideal', 'd1_alt']]));
    const d2 = resolved.groups.find((g) => g.key === 'd2_alt+d2_ideal');
    expect(d2).toMatchObject({ eligible: false, activeId: null });
    // ...while d3 (requires d2_alt OR d1_alt) is now eligible through d1_alt.
    expect(resolved.groups.find((g) => g.key === 'd3_ideal')?.activeId).toBe('d3_ideal');
    // and is NOT eligible when neither required scenario is active.
    expect(
      resolveActiveScenarios(d, new Map()).groups.find((g) => g.key === 'd3_ideal')?.eligible,
    ).toBe(false);
  });

  it("an ungated follower defaults to the followed scenario's tone, but a pick still wins", () => {
    const d = chain();
    // Followed scenario is d1_ideal (active by default) -> ideal.
    expect(resolveActiveScenarios(d, new Map()).activeIds.has('f_ideal')).toBe(true);
    const picked = resolveActiveScenarios(d, new Map([['f_alt+f_ideal', 'f_alt']]));
    expect(picked.activeIds.has('f_alt')).toBe(true);
    expect(picked.groups.find((g) => g.key === 'f_alt+f_ideal')?.defaultId).toBe('f_ideal');
  });

  it('follows an ALTERNATE followed scenario to the same tone', () => {
    const scenarios = [
      scenario('x_ideal', 'ideal'),
      scenario('x_alt', 'alternate'),
      scenario('y_ideal', 'ideal', { followsScenarioId: 'x_alt' }),
      scenario('y_alt', 'alternate', { followsScenarioId: 'x_alt' }),
    ];
    const activities = [
      activity('1', 'x_ideal', '2027-06-01T09:00'),
      activity('2', 'x_alt', '2027-06-01T09:00'),
      activity('3', 'y_ideal', '2027-06-02T09:00'),
      activity('4', 'y_alt', '2027-06-02T09:00'),
    ];
    const resolved = resolveActiveScenarios(
      data(scenarios, activities),
      new Map([['x_alt+x_ideal', 'x_alt']]),
    );
    expect(resolved.activeIds.has('y_alt')).toBe(true);
  });

  it("follows the tone active in the followed scenario's GROUP, not only that one scenario", () => {
    const scenarios = [
      scenario('x_ideal', 'ideal'),
      scenario('x_alt', 'alternate'),
      // Names x_ideal, but tracks whichever of x's branches is active.
      scenario('y_ideal', 'ideal', { followsScenarioId: 'x_ideal' }),
      scenario('y_alt', 'alternate', { followsScenarioId: 'x_ideal' }),
    ];
    const activities = [
      activity('1', 'x_ideal', '2027-06-01T09:00'),
      activity('2', 'x_alt', '2027-06-01T09:00'),
      activity('3', 'y_ideal', '2027-06-02T09:00'),
      activity('4', 'y_alt', '2027-06-02T09:00'),
    ];
    const d = data(scenarios, activities);
    expect(resolveActiveScenarios(d, new Map()).activeIds.has('y_ideal')).toBe(true);
    const alt = resolveActiveScenarios(d, new Map([['x_alt+x_ideal', 'x_alt']]));
    expect(alt.activeIds.has('y_alt')).toBe(true);
  });

  it("considers a nested group only while its parent is active, and ignores a pick that isn't a member", () => {
    const scenarios = [
      scenario('p_ideal', 'ideal'),
      scenario('p_alt', 'alternate'),
      scenario('c_ideal', 'ideal', { parentScenarioId: 'p_alt' }),
      scenario('c_alt', 'alternate', { parentScenarioId: 'p_alt' }),
    ];
    const activities = [
      activity('1', 'p_ideal', '2027-06-01T09:00'),
      activity('2', 'p_alt', '2027-06-01T09:00'),
      activity('3', 'c_ideal', '2027-06-01T10:00'),
      activity('4', 'c_alt', '2027-06-01T10:00'),
    ];
    const d = data(scenarios, activities);
    const inactive = resolveActiveScenarios(d, new Map());
    expect(inactive.activeIds.has('c_ideal')).toBe(false);
    const active = resolveActiveScenarios(
      d,
      new Map([
        ['p_alt+p_ideal', 'p_alt'],
        ['c_alt+c_ideal', 'c_alt'],
        ['p_alt+p_ideal', 'not_a_member'],
      ]),
    );
    // Last pick for the parent key names a non-member -> falls back to ideal.
    expect(active.activeIds.has('p_ideal')).toBe(true);
    const withParent = resolveActiveScenarios(
      d,
      new Map([
        ['p_alt+p_ideal', 'p_alt'],
        ['c_alt+c_ideal', 'c_alt'],
      ]),
    );
    expect(withParent.activeIds.has('c_alt')).toBe(true);
  });

  it('resolves a group that broke its invariant deterministically (label order), never by array order', () => {
    const forward = [
      scenario('z', 'alternate', { label: 'Zed', date: '2027-06-01' }),
      scenario('a', 'alternate', { label: 'Alpha', date: '2027-06-01' }),
    ];
    const reversed = [...forward].reverse();
    expect([...resolveActiveScenarios(data(forward), new Map()).activeIds]).toEqual(['a']);
    expect([...resolveActiveScenarios(data(reversed), new Map()).activeIds]).toEqual(['a']);
  });
});

describe('scenarioGroups (display)', () => {
  const pair = (activities: Activity[], stays: Stay[] = [], extra: Scenario[] = []) => {
    const d = data(
      [scenario('i', 'ideal'), scenario('a', 'alternate'), ...extra],
      activities,
      stays,
    );
    return scenarioGroups(d, resolveActiveScenarios(d, new Map()));
  };

  it("anchors on the default member's own earliest key, not a sibling's earlier content", () => {
    const [group] = pair([
      activity('1', 'i', '2027-06-01T10:00'),
      activity('2', 'a', '2027-06-01T08:00'),
    ]);
    expect(group.anchorAtByDate['2027-06-01']).toBe('2027-06-01T10:00');
  });

  it('lets a sibling anchor the box when the default member has only a Stay boundary', () => {
    const [group] = pair(
      [activity('1', 'a', '2027-06-01T08:00')],
      [stay('s', 'i', '2027-05-30T15:00', '2027-06-01T11:00')],
    );
    expect(group.anchorAtByDate['2027-06-01']).toBe('2027-06-01T08:00');
  });

  it('gives a multi-day scenario a box position on each date, and orders scenarios ideal first', () => {
    const [group] = pair([
      activity('1', 'i', '2027-06-01T09:00'),
      activity('2', 'i', '2027-06-02T13:00'),
      activity('3', 'a', '2027-06-01T09:00'),
    ]);
    expect(group.anchorAtByDate).toEqual({
      '2027-06-01': '2027-06-01T09:00',
      '2027-06-02': '2027-06-02T13:00',
    });
    expect(group.scenarios.map((s) => s._id)).toEqual(['i', 'a']);
  });

  it("gives a midnight-crossing Transit's scenario a tab on the arrival date, anchored at the depart only", () => {
    const flight: Transit = {
      _id: 't_alt',
      legId: 'leg_test',
      journeyId: null,
      scenarioId: 'a',
      status: 'planning',
      mode: 'flight',
      from: { id: null, label: 'A' },
      to: { id: null, label: 'B' },
      departsAt: '2027-06-01T23:30',
      arrivesAt: '2027-06-02T01:15',
      routeId: null,
      routeVariant: null,
      booking: null,
      images: [],
    };
    const d = data(
      [scenario('i', 'ideal'), scenario('a', 'alternate')],
      [activity('1', 'i', '2027-06-01T09:00')],
      [],
      [flight],
    );
    const [group] = scenarioGroups(d, resolveActiveScenarios(d, new Map()));
    expect(group.anchorAtByDate['2027-06-01']).toBe('2027-06-01T09:00');
    // Present on the arrival date, so the Arrive row has a box to render in;
    // only the alternate (which owns the Transit) has a tab there.
    expect(group.anchorAtByDate['2027-06-02']).toBe('2027-06-02T00:00');
    expect(group.membersByDate['2027-06-02']).toEqual(['a']);
  });

  it('gives a scenario-scoped multi-night Stay a tab on every night it spans', () => {
    const [group] = pair(
      [activity('1', 'i', '2027-06-01T09:00'), activity('2', 'a', '2027-06-01T09:30')],
      [stay('s', 'a', '2027-06-01T15:00', '2027-06-04T11:00')],
    );
    expect(Object.keys(group.anchorAtByDate)).toEqual([
      '2027-06-01',
      '2027-06-02',
      '2027-06-03',
      '2027-06-04',
    ]);
    expect(group.membersByDate['2027-06-03']).toEqual(['a']);
  });

  it("anchors a still-empty scenario at its placement hint's start of day, and omits gated-out groups", () => {
    const d = data([
      scenario('e_ideal', 'ideal', { date: '2027-06-09' }),
      scenario('g_ideal', 'ideal', { requiresScenarioId: ['nothing_active'], date: '2027-06-10' }),
    ]);
    const groups = scenarioGroups(d, resolveActiveScenarios(d, new Map()));
    expect(groups.map((g) => g.key)).toEqual(['e_ideal']);
    expect(groups[0].anchorAtByDate).toEqual({ '2027-06-09': '2027-06-09T00:00' });
  });
});

describe('edit guards', () => {
  const base = () =>
    data(
      [scenario('i', 'ideal'), scenario('a', 'alternate'), scenario('lone', 'ideal')],
      [
        activity('1', 'i', '2027-06-01T09:00'),
        activity('2', 'a', '2027-06-01T09:00'),
        activity('3', 'lone', '2027-06-05T09:00'),
      ],
    );

  it('blocks deleting the ideal of a group with alternates, but not an alternate or a lone ideal', () => {
    expect(scenarioDeletionBlocker(base(), 'i')).toMatch(/ideal/i);
    expect(scenarioDeletionBlocker(base(), 'a')).toBeNull();
    expect(scenarioDeletionBlocker(base(), 'lone')).toBeNull();
  });

  it('swaps: setting an alternate to Ideal demotes the current ideal', () => {
    const d = base();
    const outcome = resolveScenarioToneChange(d, { ...d.scenarios[1], tone: 'ideal' }, false);
    expect(outcome).toEqual({
      changed: [expect.objectContaining({ _id: 'i', tone: 'alternate' })],
    });
  });

  it('swaps: setting the ideal to Alternate promotes its single remaining sibling', () => {
    const d = base();
    const outcome = resolveScenarioToneChange(d, { ...d.scenarios[0], tone: 'alternate' }, false);
    expect(outcome).toEqual({ changed: [expect.objectContaining({ _id: 'a', tone: 'ideal' })] });
  });

  it('blocks demoting the ideal when several siblings could take over, or when it has none', () => {
    const d = base();
    d.scenarios.push(scenario('b', 'alternate'));
    d.activities.push(activity('4', 'b', '2027-06-01T09:00'));
    expect(resolveScenarioToneChange(d, { ...d.scenarios[0], tone: 'alternate' }, false)).toEqual({
      error: expect.stringMatching(/one of the other/i),
    });
    expect(resolveScenarioToneChange(d, { ...d.scenarios[2], tone: 'alternate' }, false)).toEqual({
      error: expect.stringMatching(/has to be the Ideal/i),
    });
  });

  it("does not let a brand-new ideal displace a group's existing ideal", () => {
    const d = base();
    const fresh = scenario('new', 'ideal', { date: '2027-06-01' });
    expect(resolveScenarioToneChange(d, fresh, true)).toEqual({
      error: expect.stringMatching(/already has an ideal/i),
    });
    expect(resolveScenarioToneChange(d, { ...fresh, tone: 'alternate' }, true)).toEqual({
      changed: [],
    });
  });

  it('lets an unrelated edit through when the group was already invalid', () => {
    const d = base();
    // Three members, none marked Ideal: a pre-existing violation.
    d.scenarios[0] = { ...d.scenarios[0], tone: 'alternate' };
    d.scenarios.push(scenario('b', 'alternate'));
    d.activities.push(activity('4', 'b', '2027-06-01T09:00'));
    const renamed = { ...d.scenarios[1], label: 'Renamed' };
    expect(resolveScenarioToneChange(d, renamed, false)).toEqual({ changed: [] });
  });

  it("rejects an edit that would leave the scenario's OLD group without an ideal", () => {
    const d = base();
    // Moving the ideal into a different gate strands its old sibling.
    const moved = { ...d.scenarios[0], requiresScenarioId: ['lone'] };
    expect(resolveScenarioToneChange(d, moved, false)).toEqual({
      error: expect.stringMatching(/without an Ideal/i),
    });
  });
});

describe('scenarioMembersOn', () => {
  it("lists what a scenario owns on a date, rolling a nested child's content into its parent's", () => {
    const d = data(
      [
        scenario('p_ideal', 'ideal', { date: '2027-06-01' }),
        scenario('p_alt', 'alternate', { date: '2027-06-01' }),
        scenario('child_ideal', 'ideal', { parentScenarioId: 'p_ideal' }),
      ],
      [
        activity('a_parent', 'p_ideal', '2027-06-01T09:00'),
        activity('a_child', 'child_ideal', '2027-06-01T10:00'),
        activity('a_other_day', 'p_ideal', '2027-06-02T09:00'),
        activity('a_alt', 'p_alt', '2027-06-01T11:00'),
      ],
      [stay('s_parent', 'p_ideal', '2027-06-01T15:00', '2027-06-02T11:00')],
    );
    const members = scenarioMembersOn(d, 'p_ideal', '2027-06-01');
    expect([...members.activityIds].sort()).toEqual(['a_child', 'a_parent']);
    expect(members.stayIds).toEqual(['s_parent']);
    expect(scenarioMembersOn(d, 'p_alt', '2027-06-01').activityIds).toEqual(['a_alt']);
    expect(scenarioMembersOn(d, 'p_alt', '2027-06-02').activityIds).toEqual([]);
  });
});

describe('derivation cache', () => {
  it('reuses the trip-only derivation across picks, and recomputes once an array is replaced', () => {
    const d = data(
      [
        scenario('a_ideal', 'ideal', { date: '2027-06-01' }),
        scenario('a_alt', 'alternate', { date: '2027-06-01' }),
      ],
      [activity('x', 'a_ideal', '2027-06-01T09:00')],
    );
    const first = resolveActiveScenarios(d, new Map());
    const picked = resolveActiveScenarios(d, new Map([[first.defs[0].key, 'a_alt']]));
    expect(picked.defs).toBe(first.defs);
    expect(picked.activeIds.has('a_alt')).toBe(true);

    const edited = { ...d, scenarios: [...d.scenarios] };
    expect(resolveActiveScenarios(edited, new Map()).defs).not.toBe(first.defs);
    const moved = { ...d, activities: [activity('x', 'a_ideal', '2027-06-05T09:00')] };
    expect(resolveActiveScenarios(moved, new Map()).defs[0].anchorDate).toBe('2027-06-05');
  });
});
