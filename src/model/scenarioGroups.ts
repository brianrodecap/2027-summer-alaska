// Scenario groups: which scenarios are alternatives to one another, which one
// is in effect for the reader's current picks, and where each group's tab
// strip belongs. Pure, framework-free — the scenario half of the
// timeline-first design (see the "Timeline First" design artifact): the
// timeline itself only ever sees the resulting set of active scenario ids.
//
// A GROUP is a set of mutually exclusive alternatives. Nothing in the data
// names one directly, so it is derived: top-level scenarios that resolve to
// the same anchor date (resolveScenarioDates) AND share the same gate — the
// same requiresScenarioId set, or the same followsScenarioId, or neither —
// form one group; scenarios with a parentScenarioId form a nested group
// under that parent. Every group must carry exactly one `tone: 'ideal'`
// member, the default (validateScenarioGroups; the edit UI keeps it true via
// resolveScenarioToneChange/scenarioDeletionBlocker).
import {
  activityTimelineKey,
  addDaysStr,
  compareScenariosByToneAndLabel,
  dateOnly,
  earliestKey,
  resolveScenarioDates,
  resolveTransitRoute,
  type ScenarioDateInfo,
  transitTouchedDates,
} from './tripModel';
import type { Activity, Scenario, Stay, Transit, TripData } from './types';

type ScenarioGuardData = Pick<TripData, 'scenarios' | 'transits' | 'activities'>;
// `routes` is optional: with it a scenario's routed Transit also gets a tab on
// every date any of its route variants reaches; without, only the dates its own
// depart/arrive fields name.
type ScenarioData = ScenarioGuardData & Pick<TripData, 'stays'> & Partial<Pick<TripData, 'routes'>>;

// Raw UI picks, keyed by GROUP (ScenarioGroupDef.key), valued by scenario id.
export type ScenarioPicks = ReadonlyMap<string, string>;

export interface ScenarioGroupDef {
  key: string; // sorted member ids joined with '+': stable while membership is
  memberIds: string[];
  parentId: string | null;
  requires: string[]; // shared gate: eligible once any of these is active
  followsId: string | null; // ungated only: default to the followed scenario's tone
  anchorDate: string | null;
}

function gateKeyOf(scenario: Scenario): string {
  if (scenario.parentScenarioId) return `parent:${scenario.parentScenarioId}`;
  const requires = scenario.requiresScenarioId ?? [];
  if (requires.length) return `req:${[...requires].sort().join(',')}`;
  if (scenario.followsScenarioId) return `follows:${scenario.followsScenarioId}`;
  return 'free';
}

// Deterministic, never JSON array order: ideal first, then label, then _id.
function compareMembers(a: Scenario, b: Scenario): number {
  return compareScenariosByToneAndLabel(a, b) || a._id.localeCompare(b._id);
}

export function deriveScenarioGroups(
  scenarios: Scenario[],
  dateInfoById: Map<string, ScenarioDateInfo>,
): ScenarioGroupDef[] {
  const buckets = new Map<string, Scenario[]>();
  for (const scenario of scenarios) {
    const date = scenario.parentScenarioId ? null : (dateInfoById.get(scenario._id)?.date ?? null);
    const bucketKey = `${date ?? ''}|${gateKeyOf(scenario)}`;
    const list = buckets.get(bucketKey);
    if (list) list.push(scenario);
    else buckets.set(bucketKey, [scenario]);
  }
  return [...buckets.values()].map((members) => {
    const sorted = [...members].sort(compareMembers);
    const first = sorted[0];
    return {
      key: members
        .map((m) => m._id)
        .sort()
        .join('+'),
      memberIds: sorted.map((m) => m._id),
      parentId: first.parentScenarioId ?? null,
      requires: [...(first.requiresScenarioId ?? [])],
      followsId: first.requiresScenarioId?.length ? null : (first.followsScenarioId ?? null),
      anchorDate: first.parentScenarioId ? null : (dateInfoById.get(first._id)?.date ?? null),
    };
  });
}

// What the trip's scenarios resolve to on their own — each one's date, the
// groups they form, and (for a full ScenarioData) the per-date keys and member
// ids — depends only on the data, never on the reader's picks. Cached by the
// (immutably replaced) arrays it was derived from, so a tab or meal click
// re-resolves only the picks, and every caller that needs the same derivation
// (live days, the problems banner, the edit guards) shares one.
interface ScenarioDerivation {
  activities: Activity[];
  transits: Transit[];
  dateInfo: Map<string, ScenarioDateInfo>;
  defs: ScenarioGroupDef[];
  keyed?: {
    stays: Stay[];
    routes: TripData['routes'] | undefined;
    keys: Map<string, Map<string, MemberKeys>>;
  };
}

const derivations = new WeakMap<Scenario[], ScenarioDerivation>();

function derivationOf(data: ScenarioGuardData): ScenarioDerivation {
  const scenarios = data.scenarios as Scenario[];
  const activities = data.activities as Activity[];
  const transits = data.transits as Transit[];
  const hit = derivations.get(scenarios);
  if (hit && hit.activities === activities && hit.transits === transits) return hit;
  const dateInfo = resolveScenarioDates(scenarios, activities, transits);
  const derived: ScenarioDerivation = {
    activities,
    transits,
    dateInfo,
    defs: deriveScenarioGroups(scenarios, dateInfo),
  };
  derivations.set(scenarios, derived);
  return derived;
}

function keysOf(data: ScenarioData): Map<string, Map<string, MemberKeys>> {
  const derived = derivationOf(data);
  const { keyed } = derived;
  if (keyed && keyed.stays === data.stays && keyed.routes === data.routes) return keyed.keys;
  const keys = keysByScenarioAndDate(data);
  derived.keyed = { stays: data.stays as Stay[], routes: data.routes, keys };
  return keys;
}

export interface ScenarioGroupProblem {
  key: string;
  memberIds: string[];
  kind: 'no-ideal' | 'multiple-ideals';
}

export function validateScenarioGroups(
  groups: ScenarioGroupDef[],
  scenarios: Scenario[],
): ScenarioGroupProblem[] {
  const byId = new Map(scenarios.map((s) => [s._id, s]));
  const problems: ScenarioGroupProblem[] = [];
  for (const group of groups) {
    const ideals = group.memberIds.filter((id) => byId.get(id)?.tone === 'ideal').length;
    if (ideals === 1) continue;
    problems.push({
      key: group.key,
      memberIds: group.memberIds,
      kind: ideals === 0 ? 'no-ideal' : 'multiple-ideals',
    });
  }
  return problems;
}

// The problems for a whole trip, described for a person: each names its
// scenarios by label and says what to do. This is what the app surfaces (the
// scenario dialog and the Manage-scenarios button) — the model itself never
// throws on a broken group, because ordinary edits (dragging a scenario's
// last item to another day, adding an undated scenario) can split or merge
// groups; resolution just falls back deterministically.
export interface ScenarioGroupProblemView extends ScenarioGroupProblem {
  labels: string[];
  message: string;
}

export function describeScenarioGroupProblems(data: ScenarioGuardData): ScenarioGroupProblemView[] {
  const { defs: groups } = derivationOf(data);
  const labelOf = new Map(data.scenarios.map((s) => [s._id, s.label]));
  return validateScenarioGroups(groups, data.scenarios).map((problem) => ({
    ...problem,
    labels: problem.memberIds.map((id) => labelOf.get(id) ?? id),
    message:
      problem.kind === 'no-ideal'
        ? 'None of these scenarios is marked Ideal, so the default is picked by label. Set one to Ideal.'
        : 'More than one of these scenarios is marked Ideal. Only one can be the default; set the others to Alternate.',
  }));
}

// ---------- resolveActiveScenarios ----------

export interface ScenarioGroupState {
  key: string;
  memberIds: string[];
  parentId: string | null;
  eligible: boolean;
  activeId: string | null; // null when the group is gated out
  defaultId: string | null; // what it resolves to with no pick of its own
}

export interface ResolvedScenarios {
  activeIds: ReadonlySet<string>;
  groups: ScenarioGroupState[];
  defs: ScenarioGroupDef[];
}

// The member a group falls back to with no pick: the same tone as whichever
// branch is active in the FOLLOWED scenario's group (ungated groups only —
// `followsScenarioId` names a scenario only to say which day/group to track,
// not that one branch), otherwise the ideal. A group that broke its invariant
// (no/several ideals) still resolves deterministically — first by
// compareMembers — rather than by array order.
function defaultMember(members: Scenario[], followedTone: Scenario['tone'] | undefined): Scenario {
  if (followedTone) {
    const sameTone = members.filter((m) => m.tone === followedTone);
    if (sameTone.length === 1) return sameTone[0];
  }
  return members.find((m) => m.tone === 'ideal') ?? members[0];
}

// A pick is keyed by its group's member set (deriveScenarioGroups' `key`), so
// adding, removing or regrouping a member changes the key and would silently
// drop the reader's choice. Falling back to any pick that names a current
// member keeps it; where several stale picks name members, the latest wins.
function pickedIdFor(def: ScenarioGroupDef, picks: ScenarioPicks): string | undefined {
  const exact = picks.get(def.key);
  if (exact) return exact;
  let carried: string | undefined;
  for (const id of picks.values()) if (def.memberIds.includes(id)) carried = id;
  return carried;
}

export function resolveActiveScenarios(
  data: ScenarioData,
  picks: ScenarioPicks,
): ResolvedScenarios {
  const { defs } = derivationOf(data);
  const byId = new Map(data.scenarios.map((s) => [s._id, s]));
  const groupOf = new Map<string, ScenarioGroupDef>();
  for (const def of defs) for (const id of def.memberIds) groupOf.set(id, def);

  const activeIds = new Set<string>();
  const states = new Map<string, ScenarioGroupState>();
  const visiting = new Set<string>();

  // A group is resolved only after every group it depends on (the parent's,
  // and any required or followed scenario's) — a gate that never resolves
  // (a cycle, or a reference to nothing) leaves it ineligible.
  function resolve(def: ScenarioGroupDef): ScenarioGroupState {
    const cached = states.get(def.key);
    if (cached) return cached;
    const blocked: ScenarioGroupState = {
      key: def.key,
      memberIds: def.memberIds,
      parentId: def.parentId,
      eligible: false,
      activeId: null,
      defaultId: null,
    };
    if (visiting.has(def.key)) return blocked;
    visiting.add(def.key);

    const dependencies = [def.parentId, ...def.requires, def.followsId].filter(
      (id): id is string => id !== null,
    );
    for (const id of dependencies) {
      const dependency = groupOf.get(id);
      if (dependency) resolve(dependency);
    }

    const eligible = def.parentId
      ? activeIds.has(def.parentId)
      : def.requires.length === 0 || def.requires.some((id) => activeIds.has(id));
    let state = blocked;
    if (eligible) {
      const members = def.memberIds.map((id) => byId.get(id) as Scenario);
      const followedGroup = def.followsId ? groupOf.get(def.followsId) : undefined;
      const followedActiveId = followedGroup ? states.get(followedGroup.key)?.activeId : null;
      const followedTone = followedActiveId ? byId.get(followedActiveId)?.tone : undefined;
      const fallback = defaultMember(members, followedTone);
      const picked = pickedIdFor(def, picks);
      const chosen = members.find((m) => m._id === picked) ?? fallback;
      activeIds.add(chosen._id);
      state = { ...blocked, eligible: true, activeId: chosen._id, defaultId: fallback._id };
    }
    visiting.delete(def.key);
    states.set(def.key, state);
    return state;
  }

  // Anchor-date order (undated last) keeps the walk stable; dependencies
  // above are what actually decide correctness.
  const ordered = [...defs].sort(
    (a, b) =>
      (a.anchorDate ?? '9999').localeCompare(b.anchorDate ?? '9999') || a.key.localeCompare(b.key),
  );
  const groups = ordered.map(resolve);
  return { activeIds, groups, defs };
}

// ---------- scenarioGroups (display) ----------

export interface ScenarioGroup {
  key: string;
  scenarios: Scenario[]; // members, ideal first
  activeId: string;
  parentId: string | null;
  // Where the group's box sits on each date it has content (or a placement
  // hint) — the same whichever member is selected, so the box never jumps
  // when the reader switches tabs.
  anchorAtByDate: Record<string, string>;
  // Which members have a tab on each date — the ones with content there (or
  // a still-empty member's own placement hint). A multi-day scenario's
  // sibling can be absent on the second day.
  membersByDate: Record<string, string[]>;
}

interface MemberKeys {
  real: string[]; // Activity/Transit keys
  stay: string[]; // Stay check-in/out keys — "which hotel", not a moment
  // The entities behind those keys — what a scenario owns on this date.
  activityIds: string[];
  transitIds: string[];
  stayIds: string[];
}

function keysByScenarioAndDate(data: ScenarioData): Map<string, Map<string, MemberKeys>> {
  const result = new Map<string, Map<string, MemberKeys>>();
  const bucket = (scenarioId: string, date: string): MemberKeys => {
    let byDate = result.get(scenarioId);
    if (!byDate) result.set(scenarioId, (byDate = new Map()));
    let keys = byDate.get(date);
    if (!keys) {
      byDate.set(
        date,
        (keys = { real: [], stay: [], activityIds: [], transitIds: [], stayIds: [] }),
      );
    }
    return keys;
  };
  for (const a of data.activities as Activity[]) {
    const key = a.scenarioId ? activityTimelineKey(a) : null;
    if (a.scenarioId && key) {
      const keys = bucket(a.scenarioId, key.date);
      keys.real.push(key.at);
      keys.activityIds.push(a._id);
    }
  }
  const routesById = new Map((data.routes ?? []).map((r) => [r._id, r]));
  for (const t of data.transits as Transit[]) {
    if (!t.scenarioId) continue;
    // The scenario has rows on every date the Transit reaches (a stage or the
    // Arrive row past midnight), not just where it departs — otherwise the
    // group has no box there and those rows would appear nowhere. Only the
    // departure is a real key that can anchor the box; a later date just
    // needs to exist.
    const info = resolveTransitRoute(t, routesById, data.activities as Activity[]);
    for (const date of transitTouchedDates(t, info)) {
      const keys = bucket(t.scenarioId, date);
      keys.real.push(date === dateOnly(t.departsAt) ? t.departsAt : `${date}T00:00`);
      keys.transitIds.push(t._id);
    }
  }
  for (const s of data.stays as Stay[]) {
    if (!s.scenarioId) continue;
    // Every night the stay overlaps gets a Stay-boundary key: the check-in and
    // check-out ones are the real boundaries, the nights between (a "Staying"
    // row) sit at midnight.
    const checkInDate = dateOnly(s.checkInAt);
    const checkOutDate = dateOnly(s.checkOutAt);
    for (let date = checkInDate; date <= checkOutDate; date = addDaysStr(date, 1)) {
      const key = date === checkInDate ? s.checkInAt : date === checkOutDate ? s.checkOutAt : null;
      const keys = bucket(s.scenarioId, date);
      keys.stay.push(key ?? `${date}T00:00`);
      keys.stayIds.push(s._id);
    }
  }
  return result;
}

// One group's box position on one date, the rule layoutDay applies: anchor on the default member's OWN earliest key (a sibling's
// earlier content must not steal the position — see the "Homer-Spit bug"
// regression test), unless that member has only a Stay boundary there, which
// says "which hotel", not a moment the day is organized around — then the
// earliest real content across every member wins.
function anchorOn(
  memberKeys: Array<MemberKeys | undefined>,
  anchorIndex: number,
  date: string,
): string {
  const own = memberKeys[anchorIndex];
  const ownReal = earliestKey(own?.real ?? []);
  if (ownReal) return earliestKey([ownReal, ...(own?.stay ?? [])]) as string;
  const siblingReal = earliestKey(memberKeys.flatMap((keys) => keys?.real ?? []));
  return siblingReal ?? earliestKey(own?.stay ?? []) ?? `${date}T00:00`;
}

export function scenarioGroups(data: ScenarioData, resolved: ResolvedScenarios): ScenarioGroup[] {
  const byId = new Map(data.scenarios.map((s) => [s._id, s]));
  const defByKey = new Map(resolved.defs.map((d) => [d.key, d]));
  const keys = keysOf(data);
  const result: ScenarioGroup[] = [];

  for (const state of resolved.groups) {
    if (!state.eligible || !state.activeId || !state.defaultId) continue;
    const def = defByKey.get(state.key) as ScenarioGroupDef;
    const members = def.memberIds.map((id) => byId.get(id) as Scenario);

    // Every date any member has content on, plus a still-empty member's own
    // placement hint (the deliberately date-anchored new scenario).
    const dates = new Set<string>();
    for (const m of members) {
      for (const date of keys.get(m._id)?.keys() ?? []) dates.add(date);
      if (m.date && !keys.has(m._id)) dates.add(m.date);
    }

    const anchorAtByDate: Record<string, string> = {};
    const membersByDate: Record<string, string[]> = {};
    for (const date of [...dates].sort()) {
      membersByDate[date] = members
        .filter((m) => keys.get(m._id)?.has(date) || (m.date === date && !keys.has(m._id)))
        .map((m) => m._id);
      const memberKeys = members.map((m) => keys.get(m._id)?.get(date));
      // The default member, if it has anything on this date; otherwise the
      // first member that does (ideal-or-first, by the deterministic order).
      const defaultIndex = members.findIndex((m) => m._id === state.defaultId);
      const anchorIndex = memberKeys[defaultIndex]
        ? defaultIndex
        : Math.max(
            0,
            memberKeys.findIndex((k) => k !== undefined),
          );
      anchorAtByDate[date] = anchorOn(memberKeys, anchorIndex, date);
    }
    if (!Object.keys(anchorAtByDate).length && def.anchorDate) {
      anchorAtByDate[def.anchorDate] = `${def.anchorDate}T00:00`;
      membersByDate[def.anchorDate] = [...def.memberIds];
    }

    result.push({
      key: state.key,
      scenarios: members,
      activeId: state.activeId,
      parentId: state.parentId,
      anchorAtByDate,
      membersByDate,
    });
  }
  return result;
}

// Every Activity/Transit/Stay id a scenario owns on one date — including a
// nested group's scenarios, which ride inside their parent's box (see
// ScenarioTrack.members) — whether or not the scenario is active, since an
// inactive one's events aren't in the timeline.
export function scenarioMembersOn(
  data: ScenarioData,
  scenarioId: string,
  date: string,
): { activityIds: string[]; transitIds: string[]; stayIds: string[] } {
  const keys = keysOf(data);
  const owned = new Set([scenarioId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of data.scenarios) {
      if (s.parentScenarioId && owned.has(s.parentScenarioId) && !owned.has(s._id)) {
        owned.add(s._id);
        grew = true;
      }
    }
  }
  const members = {
    activityIds: [] as string[],
    transitIds: [] as string[],
    stayIds: [] as string[],
  };
  for (const id of owned) {
    const here = keys.get(id)?.get(date);
    if (!here) continue;
    members.activityIds.push(...here.activityIds);
    members.transitIds.push(...here.transitIds);
    members.stayIds.push(...here.stayIds);
  }
  return members;
}

// ---------- Edit guards ----------

// Deleting a group's ideal while alternates remain would leave it without a
// default — blocked rather than silently promoting one (an implicit data
// change). The ideal's own group is found after the delete would happen, so
// removing a lone member (the group just disappears) or an alternate is fine.
export function scenarioDeletionBlocker(
  data: ScenarioGuardData,
  scenarioId: string,
): string | null {
  const scenario = data.scenarios.find((s) => s._id === scenarioId);
  if (!scenario || scenario.tone !== 'ideal') return null;
  const group = derivationOf(data).defs.find((g) => g.memberIds.includes(scenarioId));
  if (!group || group.memberIds.length <= 1) return null;
  return 'This is the ideal (default) scenario of a group that still has alternatives. Make another one the ideal first — edit it and set its tone to Ideal — then delete this one.';
}

export type ScenarioToneOutcome = { error: string } | { changed: Scenario[] };

// The scenario dialog/wizard's Save: `edited` is the already-applied scenario
// (applyScenarioForm's clone), `allScenarios` the store BEFORE the edit.
// Returns the OTHER scenarios whose tone must change for the invariant to
// hold — an ideal edited in demotes the previous one, an ideal edited out
// promotes the lone remaining member — or an error naming why the edit can't
// be made to satisfy it. A brand-new scenario never demotes an existing one
// (adding a sibling isn't a tone change): a second ideal is an error.
// Only what the edit itself breaks is an error: a group that was ALREADY
// invalid (no ideal, several) doesn't block an edit that leaves its tone and
// membership alone, so an unrelated rename never forces a tone repair first.
export function resolveScenarioToneChange(
  data: ScenarioGuardData,
  edited: Scenario,
  isNew: boolean,
): ScenarioToneOutcome {
  const before = data.scenarios;
  const nextScenarios = isNew
    ? [...before, edited]
    : before.map((s) => (s._id === edited._id ? edited : s));
  const groupsFor = (scenarios: Scenario[]) =>
    derivationOf({ scenarios, activities: data.activities, transits: data.transits }).defs;

  const priorGroup = isNew
    ? undefined
    : groupsFor(before).find((g) => g.memberIds.includes(edited._id));
  const nextGroup = groupsFor(nextScenarios).find((g) => g.memberIds.includes(edited._id));
  if (!nextGroup) return { changed: [] };

  const membersKey = (ids: string[] | undefined) => [...(ids ?? [])].sort().join('+');
  const priorTone = before.find((s) => s._id === edited._id)?.tone;
  const touchesInvariant =
    isNew ||
    priorTone !== edited.tone ||
    membersKey(priorGroup?.memberIds) !== membersKey(nextGroup.memberIds);
  if (!touchesInvariant) return { changed: [] };

  const others = nextGroup.memberIds
    .filter((id) => id !== edited._id)
    .map((id) => nextScenarios.find((s) => s._id === id) as Scenario);
  const otherIdeals = others.filter((s) => s.tone === 'ideal');

  const changed: Scenario[] = [];
  if (edited.tone === 'ideal' && otherIdeals.length) {
    if (isNew) {
      return {
        error:
          'This group already has an ideal scenario. Set this one to Alternate, or edit the existing ideal instead.',
      };
    }
    for (const s of otherIdeals) changed.push({ ...s, tone: 'alternate' });
  } else if (edited.tone !== 'ideal' && otherIdeals.length === 0) {
    if (others.length === 0) {
      return { error: 'A scenario with no alternatives has to be the Ideal one.' };
    }
    if (others.length > 1) {
      return { error: 'Make one of the other scenarios in this group the Ideal first.' };
    }
    changed.push({ ...others[0], tone: 'ideal' });
  }

  // Whatever the swap did, no group this edit touched may end up invalid —
  // including the edited scenario's OLD group, when a date/gate/parent change
  // moved it out (leaving that group's remaining members without an ideal).
  const applied = nextScenarios.map((s) => changed.find((c) => c._id === s._id) ?? s);
  const touched = new Set([...(priorGroup?.memberIds ?? []), ...nextGroup.memberIds]);
  const problemKey = (p: ScenarioGroupProblem) => `${p.kind}:${membersKey(p.memberIds)}`;
  const existing = new Set(
    validateScenarioGroups(groupsFor(before), before).map((p) => problemKey(p)),
  );
  const problem = validateScenarioGroups(groupsFor(applied), applied).find(
    (p) =>
      !existing.has(problemKey(p)) &&
      p.memberIds.some((id) => touched.has(id) && id !== edited._id),
  );
  if (problem) {
    return {
      error:
        problem.kind === 'no-ideal'
          ? 'That change would leave another group without an Ideal scenario.'
          : 'That change would leave a group with more than one Ideal scenario.',
    };
  }
  return { changed };
}
