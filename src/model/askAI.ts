// Conversational "Ask AI" assistant for the day list — same browser-direct
// Anthropic call as the document import (proposalImport.ts: same key, same model).
// Within one turn the model can look things up on its own (askAITools.ts's
// read-only tools) as many times as it needs, answer in prose, and propose changes
// through propose_edit / propose_day_plan. propose_edit is the import's proposal
// shape, checked the same way (proposals.ts). Nothing is ever applied automatically — a proposal only opens
// the existing EditDialog (via EditContext's openFromDraft), pre-filled, or shows a
// reviewable list, for a human to accept exactly like a manual add/edit.
import type {
  BetaContentBlock,
  BetaMessageParam,
  BetaTool,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';

import { RequestAbortedError, responseText, streamMessage } from './anthropicClient';
import {
  alternativeEntry,
  applyBatch,
  idealEntityError,
  noLongerFits,
  parseAlternative,
  parseNote,
  parseRoute,
  PROPOSE_ALTERNATIVE_PROPERTIES,
  PROPOSE_NOTE_PROPERTIES,
  PROPOSE_ROUTE_PROPERTIES,
  type ProposedAlternative,
  type ProposedNote,
  type ProposedRoute,
} from './askAIDrafts';
import {
  type AskAIToolContext,
  READ_TOOL_NAMES,
  READ_TOOLS,
  readToolLabel,
  runReadTool,
  ToolInputError,
} from './askAITools';
import { bookingOf } from './bookings';
import { hashDoc } from './changeLog';
import { EDIT_KINDS, type EditKind, findByKind } from './editForms';
import {
  ADD_TRAVELER_TOOL,
  addTraveler,
  type ChangeProposal,
  checkedChanges,
  dayPlanErrors,
  IMPORT_CONVENTIONS,
  isDateTime,
  noPlaceSearches,
  type PlaceSearches,
  placeSearchesFrom,
  PROPOSAL_PROPERTIES,
  type ProposalState,
  proposalState,
  proposedTravelerIds,
  queueFromProposals,
  type SavedPlaceSearches,
  savedPlaceSearches,
  shapeErrors,
} from './proposals';
import { activityHeadline, formatTime, transitRouteLabel } from './tripModel';
import type { Activity, Booking, Route, Stay, Transit, Traveler, TripData } from './types';

export class AskAIError extends Error {}

export interface ProposedEdit {
  // The change itself, in the same shape (and checked the same way, see
  // proposals.ts) as a document import's: an entityId to update, or a legId
  // and date (and scenarioId) to add, the fields it changes, and its booking.
  change: ChangeProposal;
  // People the change names who aren't on the trip yet — the ones add_traveler
  // added this turn, with their ids (a suggestion saved before add_traveler
  // existed has names only) — joining the trip on Save.
  newTravelers?: { id?: string; name: string; age?: number }[];
  // Transits only: the Route a drive follows ('' takes it off its route) and the tone
  // of the variant it defaults to — see withRoute.
  routeId?: string;
  routeVariant?: string;
  summary: string;
}

// A batch of Activity-only changes for a single date — the "re-plan this day" /
// "move things around" shape, reviewed as one list rather than one entry at a
// time. Each change is a ChangeProposal, checked like a single edit's; no
// Stay/Transit (those carry day-boundary/leg-span implications a re-plan
// doesn't, so they still go through the single-entry review).
export interface ProposedDayPlan {
  date: string;
  legId: string; // where new activities go
  summary: string;
  changes: ChangeProposal[]; // activities to add or update, in review order
  remove: string[]; // activity ids, listed after the changes
  newTravelers?: Traveler[]; // added this turn (add_traveler) and named by the changes
}

// One change the assistant proposed for the human to review, whichever propose_* tool
// made it. `id` is that tool call's own id — unique and stable, so what's been applied
// can be tracked by it outside the append-only conversation.
type ProposalBody =
  | { type: 'edit'; edit: ProposedEdit }
  | { type: 'dayPlan'; plan: ProposedDayPlan }
  | { type: 'alternative'; alternative: ProposedAlternative }
  | { type: 'note'; note: ProposedNote }
  | { type: 'route'; route: ProposedRoute };
export type AskAIProposal = { id: string } & ProposalBody;

// One message as the chat shows it. An assistant turn can carry several proposals
// (the agent may propose more than one change while working through a question), in
// the order it made them, and the labels of the lookups it ran on the way.
export interface AskAIMessage {
  role: 'user' | 'assistant';
  text: string;
  lookups?: string[];
  proposals?: AskAIProposal[];
}

// A whole chat. `apiMessages` is the exact history sent to the API, thinking blocks
// included, and is only ever appended to: the API binds each thinking block to the
// conversation before it, so rewriting earlier turns — or rebuilding `system` — would
// invalidate them. That's also why `system` freezes the itinerary as it was when the
// conversation started; later edits reach the model as appended updates instead
// (see itineraryUpdateFor).
export interface AskAIConversation {
  system: string;
  // Hash of the itinerary listing the model was most recently given.
  itineraryHash: string;
  apiMessages: BetaMessageParam[];
  messages: AskAIMessage[];
  // What this conversation's place searches have found (proposals.ts's
  // PlaceSearches), kept as lists.
  placeSearches: SavedPlaceSearches;
}

// ---------- trip context, fed to the model as its system prompt ----------

// A plain-text, per-leg listing of every Stay/Transit/Activity with its own
// _id — compact enough to fit comfortably in a chat system prompt, and
// giving the model real ids it can hand back via propose_edit's entityId
// rather than needing a second lookup round-trip.
function groupByLegId<T extends { legId: string }>(items: T[]): Map<string, T[]> {
  const byLeg = new Map<string, T[]>();
  for (const item of items) {
    const group = byLeg.get(item.legId);
    if (group) group.push(item);
    else byLeg.set(item.legId, [item]);
  }
  return byLeg;
}

// A scenarioId tag on a Stay/Transit/Activity line — needed so the model can tell an
// ideal-branch entry apart from its alternate-branch counterpart on the same date, and
// so it knows which existing scenarioId to reuse on a new activity it's adding to one
// specific branch rather than the whole day.
function scenarioTag(scenarioId: string | null): string {
  return scenarioId ? ` [scenario: ${scenarioId}]` : '';
}

// A routed drive names its Route (and the variant it defaults to), so the model can
// find the route to change when asked about "the drive on the 14th".
function routeTag(t: Transit): string {
  if (!t.routeId) return '';
  return ` [route: ${t.routeId}${t.routeVariant ? `, variant ${t.routeVariant}` : ''}]`;
}

// The entry's booking status, when it has a booking.
function bookingTag(data: TripData, entry: { bookingId?: string | null }): string {
  const booking = bookingOf(data, entry);
  return booking ? ` [booking ${booking.status}]` : '';
}

// Routes are shared reference data, not owned by a Leg, so they get their own section.
function describeRoute(route: Route): string {
  const variants = route.variants
    .map((v) => `${v.tone} "${v.label}" (${v.places.length} stops)`)
    .join(', ');
  return `  Route ${route._id}: ${transitRouteLabel(route)} — ${variants || 'no variants'}`;
}

export function buildTripContext(data: TripData): string {
  const staysByLeg = groupByLegId(data.stays);
  const transitsByLeg = groupByLegId(data.transits);
  const activitiesByLeg = groupByLegId(data.activities);
  const scenariosByLeg = groupByLegId(data.scenarios);
  const lines: string[] = [`Trip: ${data.trip.name}`];
  for (const leg of data.legs) {
    lines.push(`\nLeg "${leg.name}" — legId: ${leg._id}`);
    const scenarios = scenariosByLeg.get(leg._id) ?? [];
    for (const sc of scenarios) {
      lines.push(`  Scenario ${sc._id}: ${sc.tone} — "${sc.label}"`);
    }
    const stays = [...(staysByLeg.get(leg._id) ?? [])].sort((a, b) =>
      a.checkInAt.localeCompare(b.checkInAt),
    );
    const transits = [...(transitsByLeg.get(leg._id) ?? [])].sort((a, b) =>
      a.departsAt.localeCompare(b.departsAt),
    );
    const activities = [...(activitiesByLeg.get(leg._id) ?? [])].sort((a, b) =>
      (a.startAt ?? a.date ?? '').localeCompare(b.startAt ?? b.date ?? ''),
    );
    for (const s of stays) {
      lines.push(
        `  Stay ${s._id}: ${s.lodging?.place.label || '(unnamed)'} — ${s.checkInAt} to ${s.checkOutAt}${bookingTag(data, s)}`,
      );
    }
    for (const t of transits) {
      lines.push(
        `  Transit ${t._id}: ${t.from.label} -> ${t.to.label} (${t.mode}), departs ${t.departsAt}${bookingTag(data, t)}${scenarioTag(t.scenarioId)}${routeTag(t)}`,
      );
    }
    for (const a of activities) {
      const when = a.startAt ?? `${a.date ?? '?'} (${a.timeLabel ?? 'unspecified time'})`;
      const place = a.place ? ` at ${a.place.label}` : '';
      // A meal still choosing between candidates says so, since a booking or
      // an offer can add to or settle that choice.
      const meal = a.mealType
        ? a.options?.length
          ? ` — ${a.mealType}, choosing between ${a.options.map((o) => o.place?.label ?? o.diningFormat).join(' / ')}`
          : ` — ${a.mealType}${a.diningFormat ? ` (${a.diningFormat})` : ''}`
        : '';
      lines.push(
        `  Activity ${a._id}: ${activityHeadline(a) || '(untitled)'} — ${when}${place}${meal}${bookingTag(data, a)}${scenarioTag(a.scenarioId)}`,
      );
    }
  }
  if (data.routes.length) {
    lines.push('\nRoutes (drive Route documents, shared across trips; get_entity shows stops):');
    lines.push(...data.routes.map(describeRoute));
  }
  return lines.join('\n');
}

// ---------- the assistant's own instructions ----------
//
// This is the one place that shapes the assistant's tone and how eager it is
// to propose changes vs. just answer — a real product/UX call, not a fixed
// rule this codebase can derive from the data model. Tune it freely.
const ASK_AI_SYSTEM_PROMPT =
  "You are a trip-planning assistant embedded in this family's itinerary site. " +
  'The itinerary below lists every Stay/Transit/Activity with its id — treat it as a map, not the whole picture. ' +
  "Whenever an answer depends on detail it doesn't show, look it up first instead of guessing: get_day for a " +
  "day's actual timeline as the reader currently sees it, get_entity for an entry's booking, cost and notes, " +
  'search_notes, get_weather (a climate average beyond the forecast window — say so when you use one), ' +
  'get_travel_time between two place ids, search_places to find a real place and its id, get_budget for money. ' +
  'Answer concisely, in plain prose — no markdown headings or bullet lists. ' +
  'You cannot change the itinerary yourself; you propose changes, which the user reviews. To re-plan a day, or ' +
  'to move/add/remove several activities on one date, use propose_day_plan with one entry in changes per activity to add or update and one id in remove per activity to drop. For one ' +
  "change to one entity — retiming or rewording an activity, or any change to a Stay's or Transit's own " +
  'fields — use propose_edit. Notes (warnings, info, footnotes on an entry or a date) are their own ' +
  "entities: add, reword or remove one with propose_note, never by editing an entry's text. A routed " +
  'drive\'s stops live on its Route (the "[route: ...]" tag), not on the Transit: add or change a route\'s ' +
  'stops and variants with propose_route, with every place id from search_places; travel times are ' +
  'computed for you, so never estimate them. To put a drive on a route, or change which route or variant ' +
  'it follows, use propose_edit on the transit with routeId/routeVariant — a route proposed in the same ' +
  "turn doesn't exist until the user saves it, so link it in a later turn. " +
  'After proposing, say briefly what you proposed; never claim a change was made. ' +
  'Always fill in "summary" with a short, human-readable description of the change. Reference an existing ' +
  "entity's exact entityId when modifying it; when adding something new, pick the correct legId and date. " +
  "Some dates have ideal/alternate weather-branch Scenarios (see each Leg's own Scenario listing, and the " +
  '"[scenario: ...]" tag on entries already using one) — when adding a new activity that belongs to only one ' +
  'branch of such a date, set its scenarioId to match; leave scenarioId unset for a date with no Scenarios, or ' +
  'for something that applies regardless of branch. ' +
  'Alternatives are data, never prose — do not write "(alts: …)" or "or" lists into an activity\'s text. ' +
  'Any activity that is eating — breakfast, lunch, dinner, a snack or coffee stop, a restaurant or cafe visit — ' +
  "is a meal: always set its mealType, even when the place is already decided. Leave a meal's durationMinutes " +
  'unset — the site estimates it from the dining format (give diningFormat instead, e.g. on its mealOptions ' +
  'entry) — unless a booking states a real length. ' +
  'When a meal is undecided between places, propose one meal activity (mealType set) whose mealOptions list ' +
  'every candidate, with place ids from search_places. When part of a day depends on a condition — weather, a ' +
  'flight going or being grounded, energy levels — that is a scenario: add to an existing option by giving the ' +
  'new activity its scenarioId, or use propose_alternative to add a new option (siblingOf an existing one), or ' +
  'to give a day with no options its first alternative (naming the existing entries that only happen in the ' +
  'plan as idealEntityIds). Never invent booking confirmation numbers, costs, place ' +
  'ids, or scenarioIds — a placeId must come from get_day, get_entity or search_places. If you are not ' +
  "confident a change is warranted, just answer in text. Someone a change names who isn't on the trip " +
  'yet is added with add_traveler first; use the id it returns. How this trip is modeled: ' +
  IMPORT_CONVENTIONS.join(' ');

const PROPOSE_EDIT_TOOL: BetaTool = {
  name: 'propose_edit',
  description:
    'Propose a single change to the itinerary — a new activity/stay/transit, or an edit to an existing one by ' +
    "its id — giving only the fields it changes, in the trip's own field names. It's checked when you propose " +
    'it, and an error says what to fix. The user reviews it and must explicitly save it.',
  input_schema: {
    type: 'object',
    properties: {
      ...PROPOSAL_PROPERTIES,
      routeId: {
        type: 'string',
        description:
          'Transits only — the _id of the Route (from the Routes listing) this drive follows; its arrival ' +
          'is then computed from the route, so leave out arrivesAt. An empty string takes the drive off its ' +
          'route (then give arrivesAt).',
      },
      routeVariant: {
        type: 'string',
        description:
          "Transits only — the tone of the route variant the drive defaults to (e.g. 'direct', 'scenic'). " +
          'Omit for the direct one.',
      },
      summary: {
        type: 'string',
        description: 'One short sentence describing this change, shown to the user for review.',
      },
    },
    required: ['kind', 'changes', 'summary'],
  },
};

// What a proposal is checked against when the assistant makes it: the trip
// as it is now, the place ids this conversation's searches found, and the
// travelers add_traveler added this turn.
interface ProposalContext {
  data: TripData;
  placeSearches: PlaceSearches;
  addedTravelers: Traveler[];
}

// The proposal checks (proposals.ts) for one chat edit, as a batch of one.
// `searches` are what place searches found, or left out when checking it
// again as it's applied.
// A drive coming off its route (routeId '') gets its arrival from withRoute
// below, not the change, so the change is checked without it.
function checkedEdit(
  edit: Pick<ProposedEdit, 'change' | 'newTravelers' | 'routeId' | 'routeVariant'>,
  data: TripData,
  searches?: PlaceSearches,
): { state: ProposalState; change: ChangeProposal } | { errors: string[] } {
  // Before anything reads `changes` as an object.
  const malformed = shapeErrors(edit.change);
  if (malformed.length) return { errors: malformed };
  const { arrivesAt, ...offRoute } = edit.change.changes;
  const change = {
    ...(edit.routeId === '' ? { ...edit.change, changes: offRoute } : edit.change),
    ...(edit.routeId ? { onRoute: true } : {}),
  };
  const checked = checkedChanges([change], data, { searches, travelers: edit.newTravelers });
  const problems = 'errors' in checked ? [...checked.errors] : [];
  // A route pick is itself a change, with nothing else in `changes`.
  const picksRoute = edit.routeId !== undefined || edit.routeVariant !== undefined;
  if (!picksRoute) problems.push(...emptyUpdates([change]));
  // The stripped arrival is stored as given (withRoute), so check it here.
  if (edit.routeId === '') {
    const existing = edit.change.entityId
      ? (findByKind('transit', edit.change.entityId, data) as Transit | undefined)
      : undefined;
    if (arrivesAt === undefined) {
      // A drive coming off its route has no computed arrival to fall back on.
      if (!existing?.arrivesAt) {
        problems.push(
          'Taking a drive off its route needs arrivesAt, since the route no longer gives one.',
        );
      }
    } else {
      const departsAt = edit.change.changes.departsAt ?? existing?.departsAt;
      if (!isDateTime(arrivesAt)) {
        problems.push('arrivesAt must be a local date-time like 2027-07-11T08:00.');
      } else if (departsAt && arrivesAt <= departsAt) {
        problems.push(`Arrives ${arrivesAt}, not after it departs ${departsAt}.`);
      }
    }
  }
  if (problems.length || 'errors' in checked) return { errors: problems };
  return { state: checked.state, change: checked.changes[0] };
}

// An update that changes nothing (no fields, booking or added option) is
// turned down by id, so it isn't reviewed as a change.
function emptyUpdates(changes: ChangeProposal[]): string[] {
  return changes
    .filter((c) => c.entityId && !Object.keys(c.changes ?? {}).length && !c.booking && !c.addOption)
    .map((c) => `Say what changes on ${c.entityId}: changes is empty.`);
}

// The travelers add_traveler added this turn whom `changes` name.
function travelersNamedIn(changes: ChangeProposal[], ctx: ProposalContext): Traveler[] {
  const named = new Set(changes.flatMap((change) => [...proposedTravelerIds(change)]));
  return ctx.addedTravelers.filter((t) => named.has(t.id));
}

// Tool input arrives unvalidated (eager input streaming), so check it before queueing
// it; a ToolInputError goes back to the model to correct in the same turn.
function parseProposal(input: unknown, ctx: ProposalContext): ProposedEdit {
  const raw = (input ?? {}) as Partial<ChangeProposal> & {
    routeId?: string;
    routeVariant?: string;
    summary?: string;
  };
  const { routeId, routeVariant, summary, ...rest } = raw;
  if (!rest.kind || !EDIT_KINDS.includes(rest.kind)) {
    throw new ToolInputError('"kind" must be activity, stay or transit.');
  }
  if (typeof summary !== 'string' || !summary) throw new ToolInputError('"summary" is required.');
  if (!rest.entityId && !(rest.legId && rest.date)) {
    throw new ToolInputError('Give entityId to edit an entry, or legId and date to add one.');
  }
  if ((routeId !== undefined || routeVariant !== undefined) && rest.kind !== 'transit') {
    throw new ToolInputError('routeId and routeVariant only apply to a transit.');
  }
  if (routeId === '' && routeVariant) {
    throw new ToolInputError("routeVariant can't be set while taking a drive off its route.");
  }
  // A routed drive's arrival comes from the route walk (withRoute drops one given here).
  if (routeId && rest.changes?.arrivesAt !== undefined) {
    throw new ToolInputError(
      "A drive on a route gets its arrival from the route walk, so arrivesAt can't be set. Leave it out.",
    );
  }
  const change: ChangeProposal = {
    ...rest,
    kind: rest.kind,
    changes: rest.changes ?? {},
    why: summary,
  };
  const newTravelers = travelersNamedIn([change], ctx);
  const edit: ProposedEdit = {
    change,
    newTravelers: newTravelers.length ? newTravelers : undefined,
    routeId,
    routeVariant,
    summary,
  };
  const checked = checkedEdit(edit, ctx.data, ctx.placeSearches);
  if ('errors' in checked) throw new ToolInputError(checked.errors.join('\n'));
  return edit;
}

// Checks a batch's changes together (proposals.ts's checkedChanges) — a
// ToolInputError naming which one goes back to the model to fix. Returns the
// travelers add_traveler added this turn whom the batch names.
function checkChanges(
  changes: ChangeProposal[],
  ctx: ProposalContext,
  removed?: ReadonlySet<string>,
): Traveler[] | undefined {
  const empty = emptyUpdates(changes);
  if (empty.length) throw new ToolInputError(empty.join('\n'));
  const travelers = travelersNamedIn(changes, ctx);
  const checked = checkedChanges(changes, ctx.data, {
    searches: ctx.placeSearches,
    travelers,
    removed,
  });
  if ('errors' in checked) throw new ToolInputError(checked.errors.join('\n'));
  return travelers.length ? travelers : undefined;
}

function parseDayPlan(input: unknown, ctx: ProposalContext): ProposedDayPlan {
  const raw = (input ?? {}) as Partial<Omit<ProposedDayPlan, 'changes'>> & {
    changes?: Partial<ChangeProposal>[];
  };
  if (typeof raw.date !== 'string' || typeof raw.legId !== 'string') {
    throw new ToolInputError('"date" and "legId" are required.');
  }
  if (typeof raw.summary !== 'string' || !raw.summary) {
    throw new ToolInputError('"summary" is required.');
  }
  const remove = raw.remove ?? [];
  if (!Array.isArray(raw.changes ?? []) || !Array.isArray(remove)) {
    throw new ToolInputError('"changes" and "remove" must be lists.');
  }
  if (!raw.changes?.length && !remove.length) {
    throw new ToolInputError('Give at least one change or removal.');
  }
  if (!(raw.changes ?? []).every((c) => c && typeof c === 'object' && !Array.isArray(c))) {
    throw new ToolInputError('Every change must be an object.');
  }
  const changes = (raw.changes ?? []).map((c): ChangeProposal => ({
    ...c,
    kind: 'activity',
    // A new activity lands on the plan's leg and date unless it says otherwise.
    legId: c.entityId ? undefined : (c.legId ?? raw.legId),
    date: c.entityId ? undefined : (c.date ?? raw.date),
    changes: c.changes ?? {},
    why: raw.summary!,
  }));
  // The same scope rules run again when the checked items are applied
  // (applyDayPlan). The scope and change problems are reported together (the
  // second set may follow from the first); the dry run below needs a plan that
  // has none, so what applying would break is reported once these are fixed.
  const errors = dayPlanErrors({ date: raw.date, legId: raw.legId, changes, remove }, ctx.data);
  let newTravelers: Traveler[] | undefined;
  try {
    newTravelers = checkChanges(changes, ctx, new Set(remove));
  } catch (err) {
    if (!(err instanceof ToolInputError)) throw err;
    errors.push(err.message);
  }
  // Whatever applying it would leave broken (a meal left pointing at a removal)
  // is found by applying it, as the user's Apply will. The place ids were
  // checked above; a check with none given skips them.
  if (!errors.length) {
    const dry = applyBatch(ctx.data, changes, newTravelers ?? [], new Set(remove));
    if ('error' in dry) errors.push(dry.error);
  }
  if (errors.length) throw new ToolInputError(errors.join('\n'));
  return { date: raw.date, legId: raw.legId, summary: raw.summary, changes, remove, newTravelers };
}

const PROPOSE_DAY_PLAN_TOOL: BetaTool = {
  name: 'propose_day_plan',
  description:
    "Propose a batch of changes to one day's activities — moving times, removing, or adding entries — " +
    'reviewed and applied together as one list rather than one change at a time. Activities only.',
  input_schema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'ISO date (YYYY-MM-DD) this plan is for.' },
      legId: { type: 'string', description: 'The _id of the Leg this date falls under.' },
      summary: {
        type: 'string',
        description:
          'One short sentence describing the overall plan, shown to the user for review.',
      },
      changes: {
        type: 'array',
        description:
          'Activities to add (no entityId; they land on this date and leg unless given their own) or ' +
          "update (entityId), each in propose_edit's shape — only the fields that change. Moving one is " +
          'a new startAt.',
        items: {
          type: 'object',
          properties: {
            entityId: PROPOSAL_PROPERTIES.entityId,
            scenarioId: {
              type: 'string',
              description:
                "New activities only — set when this date has ideal/alternate Scenario branches (see the Leg's " +
                'own Scenario listing) and it belongs to only one of them. Omit otherwise.',
            },
            changes: PROPOSAL_PROPERTIES.changes,
          },
          required: ['changes'],
        },
      },
      remove: {
        type: 'array',
        items: { type: 'string' },
        description: 'Ids of activities to remove.',
      },
    },
    required: ['date', 'legId', 'summary'],
  },
};

const PROPOSE_ALTERNATIVE_TOOL: BetaTool = {
  name: 'propose_alternative',
  description:
    "Propose a new option for part of one day — what happens instead if a condition isn't met (the flight is " +
    'grounded, it rains). It becomes a tab beside the existing plan; the user reviews the activities and applies it.',
  input_schema: {
    type: 'object',
    properties: PROPOSE_ALTERNATIVE_PROPERTIES,
    required: ['date', 'legId', 'summary', 'label', 'entries'],
  },
};

const PROPOSE_NOTE_TOOL: BetaTool = {
  name: 'propose_note',
  description:
    'Propose adding a note to an entry or a date, rewording or re-kinding an existing note, or removing ' +
    "one. A note's attachment can't change — to move one, remove it and add a new one. The user reviews " +
    'each in the note dialog.',
  input_schema: {
    type: 'object',
    properties: PROPOSE_NOTE_PROPERTIES,
    required: ['summary'],
  },
};

const PROPOSE_ROUTE_TOOL: BetaTool = {
  name: 'propose_route',
  description:
    'Propose a new drive Route, or a change to an existing one (by routeId) — its endpoints, or its ' +
    'variants and their stops. When changing variants, give only the ones that change or are new, each ' +
    'in full (every stop, in order); variants you leave out are kept. It cannot remove a variant — tell ' +
    'the user to do that in the route editor. The user reviews it in the route editor.',
  input_schema: {
    type: 'object',
    properties: PROPOSE_ROUTE_PROPERTIES,
    required: ['summary'],
  },
};

const PROPOSE_TOOLS: BetaTool[] = [
  ADD_TRAVELER_TOOL,
  PROPOSE_EDIT_TOOL,
  PROPOSE_DAY_PLAN_TOOL,
  PROPOSE_ALTERNATIVE_TOOL,
  PROPOSE_NOTE_TOOL,
  PROPOSE_ROUTE_TOOL,
].map((tool) => ({
  ...tool,
  eager_input_streaming: true,
}));
// Fixed order, so the tools part of the cached prompt prefix never changes.
const ALL_TOOLS: BetaTool[] = [...READ_TOOLS, ...PROPOSE_TOOLS];

// `display: 'updates'` returns the short notes the model writes between tool calls
// ("Checking the weather for the 14th…") as readable thinking text, which the chat
// shows as a live status line; the model's actual reasoning stays hidden.
const DISPLAY_UPDATES_BETA = 'thinking-display-updates-2026-08-18';

// A turn that keeps calling tools past this many requests is told to stop looking
// things up and answer with what it has (tool_choice: none on the last request).
const MAX_REQUESTS_PER_TURN = 8;

// Each propose_* tool only parses its input into a proposal queued for the human to
// review — nothing is applied.
const PROPOSAL_PARSERS: Record<string, (input: unknown, ctx: ProposalContext) => ProposalBody> = {
  [PROPOSE_EDIT_TOOL.name]: (input, ctx) => ({ type: 'edit', edit: parseProposal(input, ctx) }),
  [PROPOSE_DAY_PLAN_TOOL.name]: (input, ctx) => ({
    type: 'dayPlan',
    plan: parseDayPlan(input, ctx),
  }),
  [PROPOSE_ALTERNATIVE_TOOL.name]: (input, ctx) => {
    const alternative = parseAlternative(input);
    const badIdeal = idealEntityError(alternative, ctx.data);
    if (badIdeal) throw new ToolInputError(badIdeal);
    // Its branch doesn't exist until it's applied, so it's checked without one.
    const newTravelers = checkChanges(
      alternative.entries.map((changes) =>
        alternativeEntry(alternative, changes, alternative.legId, null),
      ),
      ctx,
    );
    return { type: 'alternative', alternative: { ...alternative, newTravelers } };
  },
  [PROPOSE_NOTE_TOOL.name]: (input) => ({ type: 'note', note: parseNote(input) }),
  [PROPOSE_ROUTE_TOOL.name]: (input) => ({ type: 'route', route: parseRoute(input) }),
};

const QUEUED_FOR_REVIEW =
  'Queued for the user to review; nothing has changed yet. Do not propose the same change again.';

export function startConversation(data: TripData): AskAIConversation {
  const itinerary = buildTripContext(data);
  return {
    system: `${ASK_AI_SYSTEM_PROMPT}\n\nHere is the trip itinerary:\n${itinerary}`,
    itineraryHash: hashDoc(itinerary),
    apiMessages: [],
    messages: [],
    placeSearches: savedPlaceSearches(noPlaceSearches()),
  };
}

// The itinerary listing to append for this turn, when the trip has been edited since
// the model last saw it (by an applied proposal, or by hand) — null when it's current.
function itineraryUpdateFor(
  conversation: AskAIConversation,
  data: TripData,
): { listing: string; hash: string } | null {
  const listing = buildTripContext(data);
  const hash = hashDoc(listing);
  return hash === conversation.itineraryHash ? null : { listing, hash };
}

export interface AskAITurnEvents {
  // Answer text as it streams in.
  onText?: (delta: string) => void;
  // The model's latest between-tool-calls progress note, as it streams.
  onProgress?: (delta: string) => void;
  // A lookup the assistant just ran, as its chat label.
  onLookup?: (label: string) => void;
}

export interface AskAITurnInput {
  question: string;
  // The date the reader is looking at, if any — lets "this day" mean something.
  focusDate?: string | null;
  data: TripData;
  // The turn adds the conversation's own placeSearches.
  tools: Omit<AskAIToolContext, 'placeSearches'>;
  events?: AskAITurnEvents;
  signal?: AbortSignal;
}

// The people earlier turns' proposals carry as new travelers, by id, leaving
// out anyone the trip already has.
function travelersFromHistory(messages: AskAIMessage[], data: TripData): Traveler[] {
  const known = new Set(data.trip.travelers.map((t) => t.id));
  const found = new Map<string, Traveler>();
  for (const proposal of messages.flatMap((m) => m.proposals ?? [])) {
    const people =
      proposal.type === 'edit'
        ? proposal.edit.newTravelers
        : proposal.type === 'dayPlan'
          ? proposal.plan.newTravelers
          : proposal.type === 'alternative'
            ? proposal.alternative.newTravelers
            : undefined;
    for (const t of people ?? []) {
      if (t.id && !known.has(t.id)) found.set(t.id, t as Traveler);
    }
  }
  return [...found.values()];
}

// One question and everything the assistant does to answer it: stream a reply, run
// any lookups it asks for, feed the results back, and repeat until it answers. Returns
// the conversation with the whole turn appended; a turn that fails or is stopped
// leaves the conversation exactly as it was, so the history stays append-only. With no
// conversation yet, the turn starts one from `data` (already current, so no update).
export async function runAskAITurn(
  previous: AskAIConversation | null,
  input: AskAITurnInput,
): Promise<AskAIConversation> {
  const { question, focusDate, data, tools, events = {}, signal } = input;
  const conversation = previous ?? startConversation(data);
  const update = previous ? itineraryUpdateFor(previous, data) : null;
  const prompt = focusDate
    ? `(I'm looking at ${focusDate} in the day list.)\n\n${question}`
    : question;

  let apiMessages: BetaMessageParam[] = [
    ...conversation.apiMessages,
    { role: 'user', content: prompt },
    // A mid-conversation system message: tells the model about edits without touching
    // `system` or any earlier turn.
    ...(update
      ? [
          {
            role: 'system' as const,
            content: `The itinerary has been edited since you last saw it. The current listing:\n${update.listing}`,
          },
        ]
      : []),
  ];

  const proposals: AskAIProposal[] = [];
  const lookups: string[] = [];
  // What this conversation's searches have found, in earlier turns too;
  // search_places adds to it as this turn runs (see proposals.ts's validateProposal).
  const placeSearches = placeSearchesFrom(conversation.placeSearches);
  const lookupContext = { ...tools, placeSearches };
  // People add_traveler added — this turn, or an earlier one whose proposal is
  // still pending — for proposals to name. Anyone since saved is on the trip.
  const addedTravelers: Traveler[] = travelersFromHistory(conversation.messages, data);
  const replyParts: string[] = [];

  const runTool = async (use: BetaToolUseBlock): Promise<BetaToolResultBlockParam> => {
    const result = (content: string, isError = false): BetaToolResultBlockParam => ({
      type: 'tool_result',
      tool_use_id: use.id,
      content,
      ...(isError ? { is_error: true } : {}),
    });
    try {
      if (use.name === ADD_TRAVELER_TOOL.name) {
        const state = proposalState(data);
        state.newTravelers.push(...addedTravelers);
        // No duplicate can reach addedTravelers: addTraveler refuses a name the
        // trip or these pending travelers already have, whatever their ids
        // (a reviewed false positive — don't add a second check here).
        const added = addTraveler(use.input as { name?: string; age?: number }, state);
        if ('errors' in added) return result(added.errors.join('\n'), true);
        addedTravelers.push(added.traveler);
        return result(`Added as ${added.traveler.id}.`);
      }
      if (Object.hasOwn(PROPOSAL_PARSERS, use.name)) {
        proposals.push({
          id: use.id,
          ...PROPOSAL_PARSERS[use.name](use.input, { data, placeSearches, addedTravelers }),
        });
        return result(QUEUED_FOR_REVIEW);
      }
      if (READ_TOOL_NAMES.has(use.name)) {
        const label = readToolLabel(use.name, use.input);
        lookups.push(label);
        events.onLookup?.(label);
        return result(await runReadTool(use.name, use.input, lookupContext));
      }
      return result(`Unknown tool ${use.name}.`, true);
    } catch (err) {
      // A bad input or a failed lookup goes back to the model to recover from (retry,
      // try another way, or say it couldn't check), rather than ending the turn.
      const message = err instanceof Error ? err.message : String(err);
      return result(err instanceof ToolInputError ? message : `Lookup failed: ${message}`, true);
    }
  };

  for (let request = 1; ; request++) {
    const lastRequest = request >= MAX_REQUESTS_PER_TURN;
    const message = await streamMessage(
      {
        max_tokens: 16000,
        betas: [DISPLAY_UPDATES_BETA],
        thinking: { type: 'adaptive', display: 'updates' },
        output_config: { effort: 'medium' },
        // The instructions + starting itinerary are identical for the whole
        // conversation; the top-level marker also caches the growing history, so
        // each request only pays full price for what was appended since the last one.
        system: [{ type: 'text', text: conversation.system, cache_control: { type: 'ephemeral' } }],
        cache_control: { type: 'ephemeral' },
        tools: ALL_TOOLS,
        ...(lastRequest ? { tool_choice: { type: 'none' as const } } : {}),
        messages: apiMessages,
      },
      (msg) => new AskAIError(msg),
      'Claude declined to respond to that.',
      { onText: events.onText, onThinking: events.onProgress },
      signal,
    );
    // Passed back exactly as received — thinking blocks included — on every request.
    apiMessages = [...apiMessages, { role: 'assistant', content: message.content }];
    const text = responseText(message.content);
    if (text) replyParts.push(text);

    const toolUses = message.content.filter(
      (block: BetaContentBlock): block is BetaToolUseBlock => block.type === 'tool_use',
    );
    if (message.stop_reason === 'max_tokens' && toolUses.length) {
      // A tool call cut off mid-input can look like a complete, valid one.
      throw new AskAIError('That answer ran too long to finish — try asking something narrower.');
    }
    if (message.stop_reason !== 'tool_use' || !toolUses.length || lastRequest) break;

    // Every result goes back in one user message, in call order. Lookups and
    // add_traveler run before the proposals, so a proposal can use the person
    // or place id found in the same message, whatever order they were sent in.
    const proposesLast = (use: BetaToolUseBlock) => Object.hasOwn(PROPOSAL_PARSERS, use.name);
    const byId = new Map<string, BetaToolResultBlockParam>();
    for (const group of [toolUses.filter((u) => !proposesLast(u)), toolUses.filter(proposesLast)]) {
      for (const result of await Promise.all(group.map(runTool)))
        byId.set(result.tool_use_id, result);
    }
    const results = toolUses.map((use) => byId.get(use.id) as BetaToolResultBlockParam);
    if (signal?.aborted) throw new RequestAbortedError();
    apiMessages = [...apiMessages, { role: 'user', content: results }];
  }

  const reply: AskAIMessage = {
    role: 'assistant',
    text:
      replyParts.join('\n\n') ||
      (proposals.length
        ? 'Here is what I suggest.'
        : "I didn't get a usable reply — try asking again, maybe more briefly."),
    ...(lookups.length ? { lookups } : {}),
    ...(proposals.length ? { proposals } : {}),
  };
  return {
    ...conversation,
    itineraryHash: update?.hash ?? conversation.itineraryHash,
    apiMessages,
    messages: [...conversation.messages, { role: 'user', text: question }, reply],
    placeSearches: savedPlaceSearches(placeSearches),
  };
}

// ---------- turning a day plan into a real activities[] update ----------
//
// Unlike a single propose_edit, this never opens EditDialog — the batch itself, shown as
// a reviewed list in the assistant panel, is the human checkpoint. Applying it is one setData
// call over the whole list, so it's one undo-able step (one change-log batch), not N.

// Applies the plan's items whose indexes are in `keep` — its changes, then its
// removals, in review order.
export function applyDayPlan(
  plan: ProposedDayPlan,
  data: TripData,
  keep: ReadonlySet<number> = new Set(
    Array.from({ length: plan.changes.length + plan.remove.length }, (_, i) => i),
  ),
): { data: TripData } | { error: string } {
  const changes = plan.changes.filter((_, i) => keep.has(i));
  // A removal already done (the activity is gone) has nothing left to do, so it
  // doesn't hold up the items checked with it; proposing one is still an error.
  const checkedRemovals = plan.remove.filter((_, i) => keep.has(plan.changes.length + i));
  const done = checkedRemovals.filter(
    (id) => typeof id === 'string' && !data.activities.some((a) => a._id === id),
  );
  const remove = checkedRemovals.filter((id) => !done.includes(id));
  // Nothing but removals already done was checked: say so, not a silent success.
  if (done.length && !changes.length && !remove.length) {
    return { error: `Nothing left to apply: ${done.join(', ')} is already removed.` };
  }
  // The kept subset, against the trip as it is now: leaving an item unchecked
  // can leave something pointing at a removal, and the trip may have moved.
  const errors = dayPlanErrors({ date: plan.date, legId: plan.legId, changes, remove }, data);
  if (errors.length) return { error: noLongerFits([errors.join(' ')]) };
  return applyBatch(data, changes, plan.newTravelers, new Set(remove));
}

// One line for a new activity in a review list, naming its candidates when it's a
// meal still being decided.
export function describeNewActivity(c: ChangeProposal['changes']): string {
  const what = c.text ?? c.place?.label ?? c.mealType ?? 'activity';
  const when = c.startAt ? ` at ${formatTime(c.startAt)}` : '';
  const choices =
    c.mealOptions && c.mealOptions.length > 1
      ? ` — choosing between ${c.mealOptions.map((o) => o.place.label).join(', ')}`
      : '';
  return `+ Add "${what}"${when}${choices}`;
}

// One line per item, shown in the review list before Apply all. Entity ids
// (act_lc_d4_...) mean nothing to a reader, so a change or removal names the
// existing activity; a change that only retimes it shows before → after.
export function describeDayPlan(plan: ProposedDayPlan, data: TripData): string[] {
  const find = (id: string) => data.activities.find((a) => a._id === id);
  const labelOf = (existing: Activity | undefined) =>
    existing ? `"${activityHeadline(existing)}"` : 'that activity';
  const changeLine = (change: ChangeProposal): string => {
    if (!change.entityId) return describeNewActivity(change.changes);
    const existing = find(change.entityId);
    const label = labelOf(existing);
    const fields = Object.keys(change.changes);
    if (!fields.length) return `Update ${label}`;
    const to = change.changes.startAt ? formatTime(change.changes.startAt) : null;
    if (fields.every((f) => f === 'startAt' || f === 'durationMinutes')) {
      const from = existing?.startAt ? formatTime(existing.startAt) : null;
      if (from && to && from !== to) return `Move ${label} ${from} → ${to}`;
      return to ? `Move ${label} to ${to}` : `Change ${label}'s length`;
    }
    return `Change ${label}${to ? ` (at ${to})` : ''}`;
  };
  return [
    ...plan.changes.map(changeLine),
    ...plan.remove.map((id) => `− Remove ${labelOf(find(id))}`),
  ];
}

// ---------- turning a proposal into a real draft entity ----------

// `bookings` are the Booking documents the draft writes and `travelers` the
// new travelers it names — handed to openFromDraft with it, so the review form
// opens on them and Save commits them.
export type ResolvedProposal =
  | {
      kind: EditKind;
      draft: Activity | Stay | Transit;
      bookings: Booking[];
      travelers: Traveler[];
      overrideId?: string;
    }
  | { error: string };

// A transit proposal that names a route points the drive at it. A routed drive's
// arrival is never stored — it's walked from the selected variant's drive times — so
// arrivesAt is cleared whatever the change said. Returns an error message when the route or
// variant doesn't exist. Mutates `transit` (a fresh draft).
function withRoute(transit: Transit, proposal: ProposedEdit, data: TripData): string | null {
  const { routeId, routeVariant } = proposal;
  if (routeId === undefined && routeVariant === undefined) return null;
  if (routeId === '') {
    transit.routeId = null;
    transit.routeVariant = null;
    delete transit.showEndpointsOnMap;
    // Off its route it needs a stored arrival again — the change's arrivesAt,
    // which drafting skipped while the drive was still routed.
    if (proposal.change.changes.arrivesAt) transit.arrivesAt = proposal.change.changes.arrivesAt;
    return null;
  }
  const id = routeId ?? transit.routeId;
  const route = id ? data.routes.find((r) => r._id === id) : undefined;
  if (!route) {
    return id
      ? "Couldn't find the route the AI was referring to."
      : 'The AI picked a route variant for a drive that has no route.';
  }
  if (routeVariant && !route.variants.some((v) => v.tone === routeVariant)) {
    return `That route has no "${routeVariant}" variant.`;
  }
  // Keep the drive's current variant when it's still on the same route and nothing new
  // was asked for; otherwise null, which falls back to the direct variant.
  const keepVariant =
    transit.routeId === route._id && route.variants.some((v) => v.tone === transit.routeVariant);
  transit.routeVariant = routeVariant ?? (keepVariant ? transit.routeVariant : null);
  transit.routeId = route._id;
  transit.arrivesAt = null;
  // A new drive with no endpoints or mode of its own takes the route's.
  if (!transit.from.label) transit.from = { ...route.from };
  if (!transit.to.label) transit.to = { ...route.to };
  if (!proposal.change.entityId && !proposal.change.changes.mode) transit.mode = 'drive';
  return null;
}

// Turns a ProposedEdit into what EditContext's openFromDraft needs, through the
// same checks and drafting as a document import (proposals.ts): an update laid
// over the existing entry (so whatever the change leaves out survives), or a new
// entry on the given leg and date. The trip may have changed since the proposal
// was made, so it's checked again here; a change that no longer fits says why.
// Kept here rather than in the assistant panel so it's unit-testable business
// logic, not view code.
export function resolveProposalDraft(proposal: ProposedEdit, data: TripData): ResolvedProposal {
  if (
    proposal.change.entityId &&
    !findByKind(proposal.change.kind, proposal.change.entityId, data)
  ) {
    return { error: "Couldn't find the entry the AI was referring to — try asking again." };
  }
  const checked = checkedEdit(proposal, data);
  if ('errors' in checked) return { error: noLongerFits(checked.errors) };
  const [queued] = queueFromProposals(checked.state);
  const draft = queued.entity;
  if (proposal.change.kind === 'transit') {
    const error = withRoute(draft as Transit, proposal, data);
    if (error) return { error };
  }
  return {
    kind: proposal.change.kind,
    draft,
    bookings: queued.bookings,
    travelers: queued.travelers,
    overrideId: queued.overrideId,
  };
}
