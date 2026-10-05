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
import { EXTRACTABLE_DINING_FORMATS } from './documentImport';
import {
  applyScenarioSave,
  blankActivity,
  blankScenario,
  decideMeal,
  nextRouteId,
  optionFromDecided,
  setMealOptions,
} from './editForms';
import { MEAL_TYPES, NOTE_KINDS } from './formatting';
import { isIsoDate } from './isoDate';
import { fetchPlaceImages } from './places';
import { DEFAULT_ROUTE_TONE } from './tripModel';
import type {
  Activity,
  DiningFormat,
  Image,
  MealOption,
  MealType,
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
  TripData,
} from './types';

// ---------- meal options ----------

export interface ProposedMealOption {
  placeLabel: string;
  placeId?: string;
  diningFormat?: DiningFormat;
}

export const MEAL_OPTIONS_SCHEMA = {
  type: 'array',
  description:
    'For a meal that is still being decided between several places: one entry per candidate (two or more), in ' +
    'order of preference. Never list alternatives in the text instead. In an edit, give the full list — include ' +
    'the existing candidates that should stay. A single entry means the meal is decided on that place.',
  items: {
    type: 'object',
    properties: {
      placeLabel: { type: 'string', description: 'The restaurant or place name.' },
      placeId: {
        type: 'string',
        description: 'Its Google place id, from search_places, get_day or get_entity.',
      },
      diningFormat: { type: 'string', enum: EXTRACTABLE_DINING_FORMATS },
    },
    required: ['placeLabel'],
  },
} as const;

// Deliberately stricter than documentImport.ts's placesShare (any shared
// distinctive word): the AI can look up a real place id, so a name-only match
// must be exact — "Salmon Bake" and "Salmon Smokehouse" are two candidates.
function sameCandidate(option: MealOption, proposed: ProposedMealOption): boolean {
  if (proposed.placeId && option.place?.id) return proposed.placeId === option.place.id;
  return option.place?.label.trim().toLowerCase() === proposed.placeLabel.trim().toLowerCase();
}

// Sets an activity's candidates. A candidate that matches one the meal already has
// (by place id, else by name) keeps its id, booking and includedIn, so revising the
// list never drops a reservation already made. Mutates `activity` (a fresh clone).
export function applyMealOptions(activity: Activity, proposed: ProposedMealOption[]): void {
  const existing: MealOption[] =
    activity.options ?? (activity.place ? [optionFromDecided(activity)] : []);
  const options = proposed.map((p): MealOption => {
    const match = existing.find((o) => sameCandidate(o, p));
    return {
      _id: match?._id ?? crypto.randomUUID(),
      diningFormat: p.diningFormat ?? match?.diningFormat ?? 'sit-down',
      place: { ...match?.place, id: p.placeId ?? match?.place?.id ?? null, label: p.placeLabel },
      includedIn: match?.includedIn ?? null,
      bookingId: match?.bookingId ?? null,
    };
  });
  // One candidate is a decision: the meal takes that place directly.
  if (options.length === 1) decideMeal(activity, options[0]);
  else setMealOptions(activity, options);
}

export function parseMealOptions(value: unknown): ProposedMealOption[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.length) {
    throw new ToolInputError('"mealOptions" must be a non-empty list.');
  }
  return value.map((o: Partial<ProposedMealOption>) => {
    if (typeof o?.placeLabel !== 'string' || !o.placeLabel) {
      throw new ToolInputError('Each meal option needs a placeLabel.');
    }
    if (o.diningFormat && !EXTRACTABLE_DINING_FORMATS.includes(o.diningFormat)) {
      throw new ToolInputError(`Unsupported diningFormat ${o.diningFormat}.`);
    }
    return { placeLabel: o.placeLabel, placeId: o.placeId, diningFormat: o.diningFormat };
  });
}

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

// ---------- new activities ----------

// One brand-new activity the assistant wants added — the shape both a day plan's
// 'add' op and an alternative's activities use.
export interface NewActivitySpec {
  text: string;
  startAt: string;
  durationMinutes?: number;
  placeLabel?: string;
  placeId?: string;
  mealType?: MealType;
  mealOptions?: ProposedMealOption[];
}

export const NEW_ACTIVITY_PROPERTIES = {
  text: { type: 'string', description: 'Short description.' },
  startAt: { type: 'string', description: 'ISO 8601 local date-time, e.g. 2027-07-13T19:00.' },
  durationMinutes: {
    type: 'number',
    description:
      "Omit for a meal — its length is estimated from the candidate's diningFormat — unless a booking states one.",
  },
  placeLabel: { type: 'string', description: 'Plain text, never an id.' },
  placeId: {
    type: 'string',
    description: 'A Google place id from get_day, get_entity or search_places.',
  },
  mealType: {
    type: 'string',
    enum: MEAL_TYPES,
    description:
      'Required whenever this activity is eating (a restaurant, cafe or snack stop), decided or not — ' +
      'without it the entry shows as a plain activity instead of a meal.',
  },
  mealOptions: MEAL_OPTIONS_SCHEMA,
} as const;

export function buildNewActivity(
  spec: NewActivitySpec,
  legId: string,
  scenarioId: string | null,
): Activity {
  const activity: Activity = {
    ...blankActivity(legId, spec.startAt.slice(0, 10), scenarioId),
    text: spec.text,
    startAt: spec.startAt,
    // `date` is only for entries with no real start time.
    date: null,
    durationMinutes: spec.durationMinutes ?? null,
    place: spec.placeLabel ? { id: spec.placeId ?? null, label: spec.placeLabel } : null,
    mealType: spec.mealType ?? null,
  };
  if (spec.mealOptions?.length) applyMealOptions(activity, spec.mealOptions);
  return activity;
}

export function parseNewActivity(value: unknown): NewActivitySpec {
  const spec = (value ?? {}) as NewActivitySpec;
  if (typeof spec.text !== 'string' || !spec.text || typeof spec.startAt !== 'string') {
    throw new ToolInputError('Each new activity needs text and startAt.');
  }
  if (spec.mealType && !MEAL_TYPES.includes(spec.mealType)) {
    throw new ToolInputError(`Unknown mealType ${spec.mealType}.`);
  }
  return { ...spec, mealOptions: parseMealOptions(spec.mealOptions) };
}

// ---------- alternatives (scenarios) ----------

// A new branch of a day. Either it joins an existing group of options as another
// alternate (`siblingOf`), or — on a day with no options yet — it creates the group:
// the entries in `idealEntityIds` become the ideal (planned) branch and the new
// activities make up the alternate.
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
  activities: NewActivitySpec[];
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
  if (!Array.isArray(raw.activities) || !raw.activities.length) {
    throw new ToolInputError('"activities" must list what happens in the alternative.');
  }
  return { ...raw, activities: raw.activities.map(parseNewActivity) };
}

type AlternativeResult = { data: TripData } | { error: string };

// Applies an alternative, adding only the activities whose indexes are in `keep`
// (the ones the user left checked in review). Scenario saves go through
// applyScenarioSave, the same write path the scenario dialogs use, so the
// one-ideal-per-group rule holds.
export function applyAlternative(
  proposal: ProposedAlternative,
  data: TripData,
  keep: ReadonlySet<number> = new Set(proposal.activities.map((_, i) => i)),
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
  const added = proposal.activities
    .filter((_, i) => keep.has(i))
    .map((spec) => buildNewActivity(spec, alternate.legId, alternate._id));
  return { data: { ...next, activities: [...next.activities, ...added] } };
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
  activities: {
    type: 'array',
    description: 'What happens in the new option.',
    items: {
      type: 'object',
      properties: NEW_ACTIVITY_PROPERTIES,
      required: ['text', 'startAt'],
    },
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
