// Turning the assistant's proposals for new or changed entries into real entities —
// in particular the two ways this trip models "alternatives":
//
//  - Meal options: one meal Activity whose `options` hold each still-open candidate
//    (restaurant) as a MealOption; the day list shows them as tabs. A decided meal has
//    a `place` and no options instead.
//  - Scenarios: whole branches of a day ("Flight goes" / "Grounded"). Scenarios on the
//    same anchor date with the same gating (requires / follows / parent) form a group
//    with exactly one ideal member; entries join a branch through their scenarioId.
//
// Also notes (warnings/info/footnotes attached to an entry or a date) and routes (the
// shared From→To documents a routed drive's Transit points at).
//
// Pure: no React, no storage. Applying any of this still goes through a human review
// in the assistant panel first.
import { findEntity, ToolInputError } from './askAITools';
import {
  applyScenarioSave,
  blankScenario,
  nextRouteId,
  upsertById,
  withTripTravelers,
} from './editForms';
import { NOTE_KINDS } from './formatting';
import { isIsoDate } from './isoDate';
import { fetchPlaceImages } from './places';
import {
  type ChangeProposal,
  checkedChanges,
  PROPOSAL_PROPERTIES,
  type ProposedChanges,
  proposedTravelerIds,
  queueFromProposals,
} from './proposals';
import { dateOnly, DEFAULT_ROUTE_TONE, resolveActivityDate } from './tripModel';
import type {
  Activity,
  Booking,
  Image,
  Note,
  NoteKind,
  Place,
  Ref,
  RefEntityKind,
  Route,
  RoutePlaceEntry,
  RoutePlaceKind,
  RouteVariant,
  Scenario,
  Traveler,
  TripData,
} from './types';

// ---------- place images ----------
//
// The assistant names places by id and label only, so an entry it drafts has no
// photo. Whatever it produces — one drafted activity, or everything an applied plan
// adds or changes — goes through the same two steps before it's reviewed or applied:
// fetchMissingPlaceImages looks up a photo for each place still without one, and
// withPlaceImages/withPlaceImagesInData fill them in, the same way document import and
// PlacePickerField give a newly-picked place its first photo.

// Every real place id the activities name (their own place and each meal candidate's)
// whose place has no image yet.
export function placeIdsMissingImages(activities: Activity[]): string[] {
  return activities.flatMap((a) =>
    [a.place, ...(a.options ?? []).map((o) => o.place)].flatMap((p) =>
      p?.id && !p.images?.length ? [p.id] : [],
    ),
  );
}

export function fetchMissingPlaceImages(activities: Activity[]): Promise<Map<string, Image>> {
  return fetchPlaceImages(placeIdsMissingImages(activities));
}

// The activities `next` adds or changes relative to `prev` — by identity, since the
// apply functions keep every untouched activity as the same object.
export function changedActivities(prev: TripData, next: TripData): Activity[] {
  const before = new Set(prev.activities);
  return next.activities.filter((a) => !before.has(a));
}

// Gives each of the activity's places that has no image yet its fetched one. Returns
// the activity itself when nothing changes, so a whole-trip pass stays cheap.
export function withPlaceImages(activity: Activity, images: ReadonlyMap<string, Image>): Activity {
  const fill = (place: Place | null): Place | null => {
    const image = place?.id && !place.images?.length ? images.get(place.id) : undefined;
    return image ? { ...place!, images: [image] } : place;
  };
  const place = fill(activity.place);
  const options = activity.options?.map((o) => {
    const filled = fill(o.place);
    return filled === o.place ? o : { ...o, place: filled };
  });
  const optionsChanged = options?.some((o, i) => o !== activity.options![i]);
  if (place === activity.place && !optionsChanged) return activity;
  return { ...activity, place, options: optionsChanged ? options! : activity.options };
}

export function withPlaceImagesInData(
  data: TripData,
  images: ReadonlyMap<string, Image>,
): TripData {
  if (!images.size) return data;
  return { ...data, activities: data.activities.map((a) => withPlaceImages(a, images)) };
}

// ---------- batches of changes ----------
//
// A day plan and an alternative are lists of the same ChangeProposals a single
// edit is (proposals.ts), so every entry in them is checked the same way, place
// ids included, and drafted by the same code.

// What a suggestion that no longer fits the trip says, naming its first problem.
export function noLongerFits(errors: string[]): string {
  return `The AI's suggestion no longer fits the trip: ${errors[0]}`;
}

// `data` with a batch of activity changes applied — checked again together
// (proposals.ts's checkedChanges, since the trip may have changed since they
// were proposed), drafted, and written with their bookings and the new
// travelers they name — and the `removed` activity ids gone.
export function applyBatch(
  data: TripData,
  changes: ChangeProposal[],
  travelers: Traveler[] = [],
  removed: ReadonlySet<string> = new Set(),
): { data: TripData } | { error: string } {
  // Only people the kept changes name join the trip; an unchecked item's don't.
  const named = new Set(changes.flatMap((change) => [...proposedTravelerIds(change)]));
  const checked = checkedChanges(changes, data, {
    travelers: travelers.filter((t) => named.has(t.id)),
  });
  if ('errors' in checked) return { error: noLongerFits(checked.errors) };
  const queued = queueFromProposals(checked.state);
  // Removed last, so an activity both changed and removed stays removed.
  const activities = queued
    .reduce((list, q) => upsertById(list, q.entity as Activity), data.activities)
    .filter((a) => !removed.has(a._id));
  // The checked items may leave an activity's cover removed with the thing it
  // covers kept; nothing may point at one that's gone.
  const dangling = activities.find((a) => {
    const ref = a.includedIn;
    return ref && 'entity' in ref && ref.entity === 'activity' && removed.has(ref.id);
  });
  if (dangling) {
    return {
      error: `${dangling._id} is covered by an activity this plan removes; change or remove it too.`,
    };
  }
  const bookings = queued
    .flatMap((q) => q.bookings)
    .reduce((list: Booking[], b) => upsertById(list, b), data.bookings);
  return {
    data: withTripTravelers({ ...data, activities, bookings }, checked.state.newTravelers),
  };
}

// ---------- alternatives (scenarios) ----------

// A new branch of a day. Either it joins an existing group of options as another
// alternate (`siblingOf`), or — on a day with no options yet — it creates the group:
// the entries in `idealEntityIds` become the ideal (planned) branch and the new
// activities (`entries`, each one's fields) make up the alternate.
export interface ProposedAlternative {
  date: string;
  legId: string;
  summary: string;
  label: string;
  icon?: string;
  siblingOf?: string;
  idealLabel?: string;
  idealIcon?: string;
  idealEntityIds?: string[];
  entries: ProposedChanges[];
  // People add_traveler added this turn whom the entries name; they join the
  // trip when it's applied.
  newTravelers?: Traveler[];
}

// One of an alternative's activities as a new-entry proposal on its date, in
// the branch `scenarioId` (none yet while it's only being checked).
export function alternativeEntry(
  proposal: ProposedAlternative,
  changes: ProposedChanges,
  legId: string,
  scenarioId: string | null,
): ChangeProposal {
  return {
    kind: 'activity',
    legId,
    date: proposal.date,
    scenarioId,
    changes,
    why: proposal.summary,
  };
}

export function parseAlternative(input: unknown): ProposedAlternative {
  const raw = (input ?? {}) as ProposedAlternative;
  for (const key of ['date', 'legId', 'summary', 'label'] as const) {
    if (typeof raw[key] !== 'string' || !raw[key])
      throw new ToolInputError(`"${key}" is required.`);
  }
  const creatingGroup = !raw.siblingOf;
  if (creatingGroup && (!raw.idealLabel || !raw.idealEntityIds?.length)) {
    throw new ToolInputError(
      'Give siblingOf to add to an existing group of options, or idealLabel and idealEntityIds to start one.',
    );
  }
  if (!Array.isArray(raw.entries) || !raw.entries.length) {
    throw new ToolInputError('"entries" must list what happens in the alternative.');
  }
  return raw;
}

// The entries a new group's "as planned" option takes in must exist, on the
// alternative's own date and leg — or null when they do (or it joins a group).
export function idealEntityError(proposal: ProposedAlternative, data: TripData): string | null {
  if (proposal.siblingOf) return null;
  const ids = Array.isArray(proposal.idealEntityIds) ? proposal.idealEntityIds : [];
  if (!ids.every((id) => typeof id === 'string')) return '"idealEntityIds" must list entry ids.';
  const entries = [...data.activities, ...data.transits];
  const elsewhere = ids.filter((id) => {
    const e = entries.find((x) => x._id === id);
    if (!e) return true;
    const on = 'startAt' in e ? resolveActivityDate(e) : dateOnly(e.departsAt);
    return e.legId !== proposal.legId || on !== proposal.date;
  });
  return elsewhere.length
    ? `${elsewhere.join(', ')} isn't an activity or drive on ${proposal.date} in leg ${proposal.legId}; idealEntityIds are the entries already planned for that day.`
    : null;
}

type AlternativeResult = { data: TripData } | { error: string };

// Applies an alternative, adding only the entries whose indexes are in `keep`
// (the ones the user left checked in review). Scenario saves go through
// applyScenarioSave, the same write path the scenario dialogs use, so the
// one-ideal-per-group rule holds.
export function applyAlternative(
  proposal: ProposedAlternative,
  data: TripData,
  keep: ReadonlySet<number> = new Set(proposal.entries.map((_, i) => i)),
): AlternativeResult {
  let next = data;
  const save = (scenario: Scenario): string | null => {
    const outcome = applyScenarioSave(next, scenario, true);
    if ('error' in outcome) return outcome.error;
    next = outcome.data;
    return null;
  };

  const alternate: Scenario = {
    ...blankScenario(proposal.legId, proposal.date),
    tone: 'alternate',
    label: proposal.label,
    icon: proposal.icon || 'alt_route',
  };

  if (proposal.siblingOf) {
    const sibling = data.scenarios.find((s) => s._id === proposal.siblingOf);
    if (!sibling) return { error: "Couldn't find the option this was meant to sit beside." };
    // Same gating as the sibling, so it lands in the sibling's group.
    alternate.legId = sibling.legId;
    alternate.requiresScenarioId = sibling.requiresScenarioId;
    alternate.followsScenarioId = sibling.followsScenarioId;
    alternate.parentScenarioId = sibling.parentScenarioId;
  } else {
    const wrong = idealEntityError(proposal, data);
    if (wrong) return { error: wrong };
    const ids = new Set(proposal.idealEntityIds);
    const taken = [...data.activities, ...data.transits].filter(
      (e) => ids.has(e._id) && e.scenarioId,
    );
    if (taken.length) return { error: 'Some of those entries already belong to an option.' };
    const ideal: Scenario = {
      ...blankScenario(proposal.legId, proposal.date),
      tone: 'ideal',
      label: proposal.idealLabel ?? 'As planned',
      icon: proposal.idealIcon || 'check_circle',
    };
    // The only way a lone new ideal fails is by landing in a group that already has
    // one — i.e. the day already has options and this should have been a sibling.
    if (save(ideal)) {
      return {
        error:
          'That day already has options — ask for this to be added beside one of them instead.',
      };
    }
    next = {
      ...next,
      activities: next.activities.map((a) =>
        ids.has(a._id) ? { ...a, scenarioId: ideal._id } : a,
      ),
      transits: next.transits.map((t) => (ids.has(t._id) ? { ...t, scenarioId: ideal._id } : t)),
    };
  }

  const error = save(alternate);
  if (error) return { error };
  return applyBatch(
    next,
    proposal.entries
      .filter((_, i) => keep.has(i))
      .map((changes) => alternativeEntry(proposal, changes, alternate.legId, alternate._id)),
    proposal.newTravelers,
  );
}

export const PROPOSE_ALTERNATIVE_PROPERTIES = {
  date: { type: 'string', description: 'ISO date (YYYY-MM-DD) the alternative happens on.' },
  legId: { type: 'string', description: 'The _id of the Leg this date falls under.' },
  summary: {
    type: 'string',
    description: 'One short sentence describing the alternative, shown to the user for review.',
  },
  label: { type: 'string', description: 'Short tab label for the new option, e.g. "Grounded".' },
  icon: {
    type: 'string',
    description: 'Optional Material Symbols icon name, e.g. "rainy", "museum", "flight_land".',
  },
  siblingOf: {
    type: 'string',
    description:
      'To add another option to a day that already has options: the scenarioId of any existing option in that group.',
  },
  idealLabel: {
    type: 'string',
    description:
      'Only when the day has no options yet: the tab label for the existing plan, e.g. "Flight goes".',
  },
  idealIcon: { type: 'string', description: 'Optional icon for the existing plan.' },
  idealEntityIds: {
    type: 'array',
    items: { type: 'string' },
    description:
      'Only when the day has no options yet: the ids of the existing activities/transits that only happen in the existing plan (they become its branch). Entries that happen either way stay out.',
  },
  entries: {
    type: 'array',
    description:
      "What happens in the new option: each activity's fields, as in propose_edit's changes (startAt, text, place, mealType, mealOptions…).",
    items: PROPOSAL_PROPERTIES.changes,
  },
} as const;

// ---------- notes ----------
//
// A note is created against one target — an entry, a date or a date range — and that
// target never changes afterwards (NoteEditDialog only edits kind and text), so
// "moving" a note is a removal plus a new one. A removal opens the note in its own
// edit dialog, where the user confirms Delete; nothing is deleted from the chat.

const NOTE_ENTITY_KINDS: RefEntityKind[] = [
  'activity',
  'stay',
  'transit',
  'scenario',
  'leg',
  'route',
  'mealOption',
];

export interface ProposedNote {
  noteId?: string;
  remove?: boolean;
  kind?: NoteKind;
  text?: string;
  entityKind?: RefEntityKind;
  entityId?: string;
  date?: string;
  endDate?: string;
  summary: string;
}

export const PROPOSE_NOTE_PROPERTIES = {
  noteId: {
    type: 'string',
    description: 'The _id of an existing note to change or remove. Omit to add a new note.',
  },
  remove: {
    type: 'boolean',
    description: 'With noteId: propose deleting that note. The user confirms the delete.',
  },
  kind: {
    type: 'string',
    enum: NOTE_KINDS,
    description:
      'warning — something that could go wrong or needs action; info — useful context; footnote — a minor aside. Required for a new note.',
  },
  text: {
    type: 'string',
    description: 'The note itself, in plain prose. Required for a new note.',
  },
  entityKind: {
    type: 'string',
    enum: NOTE_ENTITY_KINDS,
    description:
      'New note only: the kind of entry it attaches to (mealOption = one candidate of an undecided meal). Use with entityId.',
  },
  entityId: { type: 'string', description: 'New note only: the _id of the entry it attaches to.' },
  date: {
    type: 'string',
    description:
      'New note only, instead of an entry: the ISO date (YYYY-MM-DD) of the whole day it concerns.',
  },
  endDate: {
    type: 'string',
    description: 'With date: the last ISO date, for a note spanning several days.',
  },
  summary: {
    type: 'string',
    description: 'One short sentence describing this change, shown to the user for review.',
  },
} as const;

export function parseNote(input: unknown): ProposedNote {
  const raw = (input ?? {}) as ProposedNote;
  if (typeof raw.summary !== 'string' || !raw.summary) {
    throw new ToolInputError('"summary" is required.');
  }
  if (raw.kind && !NOTE_KINDS.includes(raw.kind)) {
    throw new ToolInputError(`"kind" must be one of ${NOTE_KINDS.join(', ')}.`);
  }
  if (raw.noteId) {
    if (!raw.remove && !raw.kind && !raw.text) {
      throw new ToolInputError('To change a note, give its new text and/or kind.');
    }
    return raw;
  }
  if (raw.remove) throw new ToolInputError('"remove" needs the noteId to remove.');
  if (!raw.kind || typeof raw.text !== 'string' || !raw.text) {
    throw new ToolInputError('A new note needs kind and text.');
  }
  const byEntity = Boolean(raw.entityKind && raw.entityId);
  const byDate = typeof raw.date === 'string' && isIsoDate(raw.date);
  if (byEntity === byDate) {
    throw new ToolInputError(
      'A new note attaches to exactly one thing: entityKind + entityId, or date (+ endDate).',
    );
  }
  if (raw.entityKind && !NOTE_ENTITY_KINDS.includes(raw.entityKind)) {
    throw new ToolInputError(`Notes can't attach to a ${raw.entityKind}.`);
  }
  if (raw.endDate && !(isIsoDate(raw.endDate) && raw.date && raw.endDate >= raw.date)) {
    throw new ToolInputError('"endDate" must be an ISO date on or after "date".');
  }
  return raw;
}

function noteTargetExists(kind: RefEntityKind, id: string, data: TripData): boolean {
  if (kind === 'mealOption') {
    return data.activities.some((a) => a.options?.some((o) => o._id === id));
  }
  return findEntity(data, id)?.kind === kind;
}

type ResolvedNote =
  | { mode: 'create'; ref: Ref; kind: NoteKind; text: string }
  | { mode: 'edit'; note: Note }
  | { error: string };

// What NoteEditContext needs to open the review: a drafted new note, or the existing
// note with the proposed kind/text already in place (for a removal, unchanged — the
// user deletes it from that dialog).
export function resolveNoteProposal(proposal: ProposedNote, data: TripData): ResolvedNote {
  if (proposal.noteId) {
    const existing = data.notes.find((n) => n._id === proposal.noteId);
    if (!existing) return { error: "Couldn't find the note the AI was referring to." };
    if (proposal.remove) return { mode: 'edit', note: existing };
    return {
      mode: 'edit',
      note: {
        ...existing,
        kind: proposal.kind ?? existing.kind,
        text: proposal.text ?? existing.text,
      },
    };
  }
  let ref: Ref;
  if (proposal.entityKind && proposal.entityId) {
    if (!noteTargetExists(proposal.entityKind, proposal.entityId, data)) {
      return { error: "Couldn't find the entry the AI wanted to attach this note to." };
    }
    ref = { entity: proposal.entityKind, id: proposal.entityId };
  } else if (proposal.endDate && proposal.endDate !== proposal.date) {
    ref = { dateRange: [proposal.date!, proposal.endDate] };
  } else {
    ref = { date: proposal.date! };
  }
  return { mode: 'create', ref, kind: proposal.kind!, text: proposal.text! };
}

// ---------- routes ----------
//
// The assistant names a route's places by id and label only; travel times are never
// proposed — the panel recomputes every stretch from Google Directions
// (directions.ts's recomputeRouteTravel) before the route editor opens for review,
// the same as picking places by hand in RouteEditForm.

interface ProposedRoutePlace {
  kind: RoutePlaceKind;
  label: string;
  placeId: string;
  durationMinutes?: number;
  note?: string;
}

export interface ProposedRouteVariant {
  tone: string;
  label: string;
  places: ProposedRoutePlace[];
}

interface ProposedEndpoint {
  label: string;
  placeId: string;
}

export interface ProposedRoute {
  routeId?: string;
  from?: ProposedEndpoint;
  to?: ProposedEndpoint;
  variants?: ProposedRouteVariant[];
  summary: string;
}

const ENDPOINT_SCHEMA = {
  type: 'object',
  properties: {
    label: { type: 'string' },
    placeId: { type: 'string', description: 'Its Google place id, from search_places.' },
  },
  required: ['label', 'placeId'],
} as const;

export const PROPOSE_ROUTE_PROPERTIES = {
  routeId: {
    type: 'string',
    description: 'The _id of an existing route to change. Omit to add a new route.',
  },
  from: { ...ENDPOINT_SCHEMA, description: 'Where the drive starts. Required for a new route.' },
  to: { ...ENDPOINT_SCHEMA, description: 'Where the drive ends. Required for a new route.' },
  variants: {
    type: 'array',
    description:
      'The ways to drive it. Exactly one has tone "direct" (the default path, waypoints only); any ' +
      'others are "scenic". Required for a new route. When changing a route, list only the variants ' +
      'that change or are new: one with the same tone and label (or the only one of its tone) is ' +
      'replaced, any other is added, and variants you leave out stay as they are.',
    items: {
      type: 'object',
      properties: {
        tone: { type: 'string', enum: [DEFAULT_ROUTE_TONE, 'scenic'] },
        label: { type: 'string', description: 'Short tab label, e.g. "Via Hatcher Pass".' },
        places: {
          type: 'array',
          description: 'The stops and steering points between From and To, in driving order.',
          items: {
            type: 'object',
            properties: {
              kind: {
                type: 'string',
                enum: ['waypoint', 'via'],
                description:
                  'waypoint — a real stop worth calling out; via — a point that only steers the route onto the right road, no stop.',
              },
              label: { type: 'string' },
              placeId: { type: 'string', description: 'Its Google place id, from search_places.' },
              durationMinutes: {
                type: 'number',
                description: 'Waypoints only: minutes stopped there. Omit for the default.',
              },
              note: { type: 'string', description: 'Optional short note shown on this stop.' },
            },
            required: ['kind', 'label', 'placeId'],
          },
        },
      },
      required: ['tone', 'label', 'places'],
    },
  },
  summary: {
    type: 'string',
    description: 'One short sentence describing this change, shown to the user for review.',
  },
} as const;

function parseEndpoint(value: unknown, key: string): ProposedEndpoint | undefined {
  if (value === undefined) return undefined;
  const e = value as Partial<ProposedEndpoint>;
  if (typeof e?.label !== 'string' || !e.label || typeof e.placeId !== 'string' || !e.placeId) {
    throw new ToolInputError(`"${key}" needs a label and a placeId.`);
  }
  return { label: e.label, placeId: e.placeId };
}

export function parseRoute(input: unknown): ProposedRoute {
  const raw = (input ?? {}) as ProposedRoute;
  if (typeof raw.summary !== 'string' || !raw.summary) {
    throw new ToolInputError('"summary" is required.');
  }
  const from = parseEndpoint(raw.from, 'from');
  const to = parseEndpoint(raw.to, 'to');
  if (raw.variants !== undefined && (!Array.isArray(raw.variants) || !raw.variants.length)) {
    throw new ToolInputError('"variants" must be a non-empty list.');
  }
  const variants = raw.variants?.map((v): ProposedRouteVariant => {
    if (typeof v?.label !== 'string' || !v.label || typeof v.tone !== 'string') {
      throw new ToolInputError('Each variant needs a tone and a label.');
    }
    if (!Array.isArray(v.places)) throw new ToolInputError('Each variant needs a places list.');
    for (const p of v.places) {
      if (p?.kind !== 'waypoint' && p?.kind !== 'via') {
        throw new ToolInputError("Each place's kind must be waypoint or via.");
      }
      if (!p.label || !p.placeId) throw new ToolInputError('Each place needs a label and placeId.');
    }
    return v;
  });
  if (!raw.routeId && !(from && to && variants)) {
    throw new ToolInputError('A new route needs from, to and variants.');
  }
  if (raw.routeId && !from && !to && !variants) {
    throw new ToolInputError('To change a route, give its new from, to and/or variants.');
  }
  return { routeId: raw.routeId, from, to, variants, summary: raw.summary };
}

// One proposed variant as a real RouteVariant. A stop the route already has at the
// same place (in the variant of the same tone) keeps its stored Place — photos and
// all — and its own stop duration and note unless the proposal sets them; travel
// is left for recomputeRouteTravel.
function buildVariant(spec: ProposedRouteVariant, existing?: RouteVariant): RouteVariant {
  const places = spec.places.map((p): RoutePlaceEntry => {
    const match = existing?.places.find((e) => e.place?.id === p.placeId);
    const durationMinutes = p.durationMinutes ?? match?.durationMinutes;
    return {
      kind: p.kind,
      place: { ...match?.place, id: p.placeId, label: p.label },
      travel: match?.travel ?? { minutes: 0 },
      // A via is a pass-through, so it never carries a stop duration.
      ...(p.kind === 'waypoint' && durationMinutes !== undefined ? { durationMinutes } : {}),
      note: p.note ?? match?.note ?? null,
    };
  });
  return {
    tone: spec.tone,
    label: spec.label,
    places,
    finalTravel: existing?.finalTravel ?? { minutes: 0 },
  };
}

// The existing variant a proposed one revises: same tone and label, else the only
// variant of that tone. Never the first of several by array position — a route can
// have more than one scenic variant.
function matchingVariant(
  variants: RouteVariant[],
  spec: Pick<RouteVariant, 'tone' | 'label'>,
): RouteVariant | undefined {
  const sameTone = variants.filter((v) => v.tone === spec.tone);
  const label = spec.label.trim().toLowerCase();
  return (
    sameTone.find((v) => v.label.trim().toLowerCase() === label) ??
    (sameTone.length === 1 ? sameTone[0] : undefined)
  );
}

// When the assistant changes an existing route, its proposed variants patch the
// route's: each replaces the variant it revises (matchingVariant) in place, one that
// revises nothing is added at the end, and every variant it doesn't mention stays.
// The assistant never removes a variant — that's done in the route editor. `proposed`
// is already built (matched stops keep their stored data).
function mergeRouteVariants(existing: RouteVariant[], proposed: RouteVariant[]): RouteVariant[] {
  const replacements = new Map<RouteVariant, RouteVariant>();
  const added: RouteVariant[] = [];
  for (const variant of proposed) {
    const match = matchingVariant(existing, variant);
    // Two proposals revising the same variant: the first replaces it, the second is new.
    if (match && !replacements.has(match)) replacements.set(match, variant);
    else added.push(variant);
  }
  return [...existing.map((v) => replacements.get(v) ?? structuredClone(v)), ...added];
}

type ResolvedRoute = { route: Route; isNew: boolean } | { error: string };

// The draft RouteEditDialog opens with — travel times not yet recomputed.
export function resolveRouteProposal(proposal: ProposedRoute, data: TripData): ResolvedRoute {
  const existing = proposal.routeId
    ? data.routes.find((r) => r._id === proposal.routeId)
    : undefined;
  if (proposal.routeId && !existing) {
    return { error: "Couldn't find the route the AI was referring to." };
  }
  const endpoint = (e: ProposedEndpoint | undefined, fallback: Route['from'] | undefined) =>
    e ? { id: e.placeId, label: e.label } : fallback!;
  const built = proposal.variants?.map((spec) =>
    buildVariant(spec, existing && matchingVariant(existing.variants, spec)),
  );
  const route: Route = {
    _id: existing?._id ?? nextRouteId(data.routes),
    from: endpoint(proposal.from, existing?.from),
    to: endpoint(proposal.to, existing?.to),
    variants: existing
      ? built
        ? mergeRouteVariants(existing.variants, built)
        : structuredClone(existing.variants)
      : built!,
    images: existing?.images ?? [],
  };
  return { route, isNew: !existing };
}
