// Conversational "Ask AI" assistant for the day list — same browser-direct
// Anthropic call as documentImport.ts (same key, same model), but a multi-turn agent
// instead of a single structured-output extraction. Within one turn the model can
// look things up on its own (askAITools.ts's read-only tools) as many times as it
// needs, answer in prose, and propose changes through propose_edit /
// propose_day_plan. Nothing is ever applied automatically — a proposal only opens
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
  applyMealOptions,
  buildNewActivity,
  NEW_ACTIVITY_PROPERTIES,
  type NewActivitySpec,
  parseAlternative,
  parseMealOptions,
  parseNewActivity,
  parseNote,
  parseRoute,
  PROPOSE_ALTERNATIVE_PROPERTIES,
  PROPOSE_NOTE_PROPERTIES,
  PROPOSE_ROUTE_PROPERTIES,
  type ProposedAlternative,
  type ProposedMealOption,
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
import {
  draftEntityFromExtraction,
  ENTITY_SCHEMA,
  entryRoster,
  type ExtractedFields,
  mergeBooking,
  mergeDraftIntoExisting,
} from './documentImport';
import { type EditKind, entityDateOnly, findByKind } from './editForms';
import { activityHeadline, formatTime, transitRouteLabel } from './tripModel';
import type { Activity, Booking, Place, Route, Stay, Transit, Traveler, TripData } from './types';

export class AskAIError extends Error {}

export interface ProposedEdit {
  kind: EditKind;
  entityId?: string;
  legId?: string;
  date?: string;
  // Which ideal/alternate Scenario branch a brand-new activity belongs to — never set
  // when editing an existing entity, which keeps whatever scenarioId it already has.
  // Not part of ExtractedFields/ENTITY_SCHEMA (documentImport.ts's shared shape) since
  // a scanned booking document never describes a weather-branch day; this is purely a
  // chat-time concept, so it's threaded through as its own sibling field instead.
  scenarioId?: string;
  // A real Google place id for an activity's place, from one of the lookup tools —
  // never invented. Lets a proposal name a resolved place instead of a bare label.
  placeId?: string;
  // An activity's meal candidates — see askAIDrafts.ts's applyMealOptions.
  mealOptions?: ProposedMealOption[];
  // Transits only: the Route a drive follows ('' takes it off its route) and the tone
  // of the variant it defaults to — see withRoute.
  routeId?: string;
  routeVariant?: string;
  summary: string;
  fields: ExtractedFields;
}

// A batch of Activity-only changes for a single date — the "re-plan this day" /
// "move things around" shape, as opposed to propose_edit's one-entity-at-a-time
// shape. Deliberately narrower than ProposedEdit: no Stay/Transit ops (those carry
// day-boundary/leg-span implications a plain time-shuffle doesn't, so they still go
// through the single-entity review path), and 'move' only touches timing — a wording
// or place change still goes through propose_edit too.
export type DayPlanOp =
  | { op: 'move'; entityId: string; startAt?: string; durationMinutes?: number }
  | { op: 'remove'; entityId: string }
  | ({
      op: 'add';
      // Set when this date has ideal/alternate Scenario branches and the new activity
      // belongs to only one of them — see buildTripContext's own Scenario listing.
      scenarioId?: string;
    } & NewActivitySpec);

export interface ProposedDayPlan {
  date: string;
  legId: string; // needed to place any 'add' ops
  summary: string;
  ops: DayPlanOp[];
}

// One change the assistant proposed for the human to review, whichever propose_* tool
// made it. `id` is that tool call's own id — unique and stable, so what's been applied
// can be tracked by it outside the append-only conversation (see ChatStore).
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

// A whole chat, persisted per trip (see src/state/store/chatStore.ts) so it survives
// a reload. `apiMessages` is the exact history sent to the API, thinking blocks
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
        `  Stay ${s._id}: ${s.lodging?.place.label || '(unnamed)'} — ${s.checkInAt} to ${s.checkOutAt} [${s.status}]`,
      );
    }
    for (const t of transits) {
      lines.push(
        `  Transit ${t._id}: ${t.from.label} -> ${t.to.label} (${t.mode}), departs ${t.departsAt} [${t.status}]${scenarioTag(t.scenarioId)}${routeTag(t)}`,
      );
    }
    for (const a of activities) {
      const when = a.startAt ?? `${a.date ?? '?'} (${a.timeLabel ?? 'unspecified time'})`;
      const place = a.place ? ` at ${a.place.label}` : '';
      lines.push(
        `  Activity ${a._id}: ${activityHeadline(a) || '(untitled)'} — ${when}${place} [${a.status}]${scenarioTag(a.scenarioId)}`,
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
  'to move/add/remove several activities on one date, use propose_day_plan with one op per change. For one ' +
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
  'confident a change is warranted, just answer in text.';

const PROPOSE_EDIT_TOOL: BetaTool = {
  name: 'propose_edit',
  description:
    'Propose a single change to the itinerary — creating a new activity/stay/transit, or editing an existing ' +
    'one by its id. The user reviews and must explicitly save it; nothing is applied automatically.',
  input_schema: {
    type: 'object',
    properties: {
      ...ENTITY_SCHEMA.properties,
      entityId: {
        type: 'string',
        description:
          'The _id of an existing activity/stay/transit to modify. Omit when proposing a brand-new entry.',
      },
      legId: {
        type: 'string',
        description:
          'Required when entityId is omitted — the _id of the Leg this new entry belongs to.',
      },
      date: {
        type: 'string',
        description:
          'Required when entityId is omitted — the ISO date (YYYY-MM-DD) this new entry falls on.',
      },
      scenarioId: {
        type: 'string',
        description:
          'Only when entityId is omitted and this new activity belongs to one specific ideal/alternate ' +
          "Scenario branch of `date` — an existing Scenario's _id from that Leg's own listing. Omit for a " +
          'date with no Scenarios, or an entry that applies regardless of branch.',
      },
      placeId: {
        type: 'string',
        description:
          "Activities only — the Google place id (from get_day, get_entity or search_places) of the activity's place, alongside placeLabel.",
      },
      mealOptions: NEW_ACTIVITY_PROPERTIES.mealOptions,
      routeId: {
        type: 'string',
        description:
          'Transits only — the _id of the Route (from the Routes listing) this drive follows; its arrival ' +
          'is then computed from the route, so omit endAt. An empty string takes the drive off its route ' +
          '(then give endAt).',
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
    required: ['kind', 'summary'],
  },
};

const EDIT_KINDS: EditKind[] = ['activity', 'stay', 'transit'];

// Tool input arrives unvalidated (eager input streaming), so check what the review UI
// relies on before queueing it; a ToolInputError goes back to the model to correct.
function parseProposal(input: unknown): ProposedEdit {
  const raw = (input ?? {}) as ExtractedFields & {
    entityId?: string;
    legId?: string;
    date?: string;
    scenarioId?: string;
    placeId?: string;
    mealOptions?: unknown;
    routeId?: string;
    routeVariant?: string;
    summary: string;
  };
  const {
    entityId,
    legId,
    date,
    scenarioId,
    placeId,
    mealOptions,
    routeId,
    routeVariant,
    summary,
    ...fields
  } = raw;
  if (!EDIT_KINDS.includes(fields.kind)) {
    throw new ToolInputError('"kind" must be activity, stay or transit.');
  }
  if (typeof summary !== 'string' || !summary) throw new ToolInputError('"summary" is required.');
  if (!entityId && !(legId && date)) {
    throw new ToolInputError('Give entityId to edit an entry, or legId and date to add one.');
  }
  if ((routeId !== undefined || routeVariant !== undefined) && fields.kind !== 'transit') {
    throw new ToolInputError('routeId and routeVariant only apply to a transit.');
  }
  if (routeId === '' && routeVariant) {
    throw new ToolInputError("routeVariant can't be set while taking a drive off its route.");
  }
  return {
    kind: fields.kind,
    entityId,
    legId,
    date,
    scenarioId,
    placeId,
    mealOptions: parseMealOptions(mealOptions),
    routeId,
    routeVariant,
    summary,
    fields: fields as ExtractedFields,
  };
}

function parseDayPlan(input: unknown): ProposedDayPlan {
  const plan = (input ?? {}) as ProposedDayPlan;
  if (typeof plan.date !== 'string' || typeof plan.legId !== 'string') {
    throw new ToolInputError('"date" and "legId" are required.');
  }
  if (typeof plan.summary !== 'string' || !Array.isArray(plan.ops) || !plan.ops.length) {
    throw new ToolInputError('"summary" and a non-empty "ops" list are required.');
  }
  const ops = plan.ops.map((op): DayPlanOp => {
    if (op.op === 'add') return { ...parseNewActivity(op), op: 'add', scenarioId: op.scenarioId };
    if (!op.entityId) throw new ToolInputError('move/remove ops need entityId.');
    return op;
  });
  return { ...plan, ops };
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
      ops: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: ['move', 'remove', 'add'] },
            entityId: {
              type: 'string',
              description: 'Required for move/remove — the existing activity _id.',
            },
            ...NEW_ACTIVITY_PROPERTIES,
            startAt: {
              type: 'string',
              description:
                'ISO 8601 local date-time. Required for add; for move, the new start time.',
            },
            scenarioId: {
              type: 'string',
              description:
                "add only — set when this date has ideal/alternate Scenario branches (see the Leg's own " +
                'Scenario listing) and this new activity belongs to only one of them. Omit otherwise.',
            },
          },
          required: ['op'],
        },
      },
    },
    required: ['date', 'legId', 'summary', 'ops'],
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
    required: ['date', 'legId', 'summary', 'label', 'activities'],
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
const PROPOSAL_PARSERS: Record<string, (input: unknown) => ProposalBody> = {
  [PROPOSE_EDIT_TOOL.name]: (input) => ({ type: 'edit', edit: parseProposal(input) }),
  [PROPOSE_DAY_PLAN_TOOL.name]: (input) => ({ type: 'dayPlan', plan: parseDayPlan(input) }),
  [PROPOSE_ALTERNATIVE_TOOL.name]: (input) => ({
    type: 'alternative',
    alternative: parseAlternative(input),
  }),
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
  tools: AskAIToolContext;
  apiKey: string;
  events?: AskAITurnEvents;
  signal?: AbortSignal;
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
  const { question, focusDate, data, tools, apiKey, events = {}, signal } = input;
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
  const replyParts: string[] = [];

  const runTool = async (use: BetaToolUseBlock): Promise<BetaToolResultBlockParam> => {
    const result = (content: string, isError = false): BetaToolResultBlockParam => ({
      type: 'tool_result',
      tool_use_id: use.id,
      content,
      ...(isError ? { is_error: true } : {}),
    });
    try {
      if (Object.hasOwn(PROPOSAL_PARSERS, use.name)) {
        proposals.push({ id: use.id, ...PROPOSAL_PARSERS[use.name](use.input) });
        return result(QUEUED_FOR_REVIEW);
      }
      if (READ_TOOL_NAMES.has(use.name)) {
        const label = readToolLabel(use.name, use.input);
        lookups.push(label);
        events.onLookup?.(label);
        return result(await runReadTool(use.name, use.input, tools));
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
      apiKey,
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

    // Every result goes back in one user message, in call order.
    const results = await Promise.all(toolUses.map(runTool));
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
  };
}

// ---------- turning a day plan into a real activities[] update ----------
//
// Unlike a single propose_edit, this never opens EditDialog — the batch itself, shown as
// a reviewed list in the assistant panel, is the human checkpoint. Applying it is one setData
// call over the whole ops list, so it's one undo-able step (one change-log batch), not N.
export function applyDayPlan(plan: ProposedDayPlan, data: TripData): TripData {
  let activities = data.activities;
  for (const op of plan.ops) {
    if (op.op === 'move') {
      activities = activities.map((a) =>
        a._id === op.entityId
          ? {
              ...a,
              startAt: op.startAt ?? a.startAt,
              durationMinutes: op.durationMinutes ?? a.durationMinutes,
            }
          : a,
      );
    } else if (op.op === 'remove') {
      activities = activities.filter((a) => a._id !== op.entityId);
    } else {
      activities = [...activities, buildNewActivity(op, plan.legId, op.scenarioId ?? null)];
    }
  }
  return { ...data, activities };
}

// One line per op, shown in the review list before Apply all. Entity ids (act_lc_d4_...)
// mean nothing to a reader, so every move/remove looks the existing activity's own text
// up out of `data` rather than showing raw ids; a move shows before → after time only
// when the time is actually changing, to avoid noise on a same-time reorder.
// One line for a new activity in a review list, naming its candidates when it's a
// meal still being decided.
export function describeNewActivity(spec: NewActivitySpec): string {
  const when = spec.startAt ? ` at ${formatTime(spec.startAt)}` : '';
  const choices =
    spec.mealOptions && spec.mealOptions.length > 1
      ? ` — choosing between ${spec.mealOptions.map((o) => o.placeLabel).join(', ')}`
      : '';
  return `+ Add "${spec.text}"${when}${choices}`;
}

export function describeDayPlanOp(op: DayPlanOp, data: TripData): string {
  if (op.op === 'add') return describeNewActivity(op);
  const existing = data.activities.find((a) => a._id === op.entityId);
  const label = existing ? `"${activityHeadline(existing)}"` : 'that activity';
  if (op.op === 'remove') return `− Remove ${label}`;
  const from = existing?.startAt ? formatTime(existing.startAt) : null;
  const to = op.startAt ? formatTime(op.startAt) : null;
  if (from && to && from !== to) return `Move ${label} ${from} → ${to}`;
  if (to) return `Move ${label} to ${to}`;
  return `Move ${label}`;
}

// ---------- turning a proposal into a real draft entity ----------

// The create case (no entityId) reuses draftEntityFromExtraction verbatim —
// same "start from blank" shape as a document import. The edit case drafts
// the same way and lays that over the real entity with the import's own
// mergeDraftIntoExisting, so a field the AI left out (an existing booking,
// images, a routed drive's walked arrival) survives untouched. Returns the
// Booking documents the draft writes alongside it — the entity's own, merged
// over whatever it already pointed at (keeping that id, so a shared booking
// stays shared) — and any travelers it names whom the trip doesn't have yet,
// added when the draft is saved (see withDocumentTravelers).
export function draftEntityFromProposal(
  kind: EditKind,
  fields: ExtractedFields,
  base: Activity | Stay | Transit,
  data: Pick<TripData, 'bookings' | 'trip'>,
): DraftedProposal {
  const roster = entryRoster(fields, data.trip.travelers);
  const current = bookingOf(data, base);
  const booking = mergeBooking(fields, current);
  const bookings = booking && booking !== current ? [booking] : [];
  const draft = draftEntityFromExtraction(
    { ...fields, kind },
    base.legId,
    entityDateOnly(kind, base),
    {},
    roster.travelers,
    booking,
  );
  const entity = mergeDraftIntoExisting({ ...fields, kind }, base, draft);
  entity.bookingId = booking?._id ?? null;
  applyStatedChanges(kind, fields, entity);
  return { entity, bookings, travelers: kind === 'transit' ? roster.added : [] };
}

// A document restates what's already known, so the import's merge keeps a
// resolved place and an existing description. An AI edit is an instruction:
// a place label or description it states replaces the old one. A renamed place
// drops its id rather than pairing the old place's id with the new name (a
// proposal's placeId, applied after this by withPlaceId, resolves it again).
function applyStatedChanges(
  kind: EditKind,
  fields: ExtractedFields,
  entity: Activity | Stay | Transit,
): void {
  const renamed = (place: Place, label: string | null | undefined): Place =>
    label && label !== place.label ? { id: null, label } : place;
  if (kind === 'stay') {
    const stay = entity as Stay;
    if (stay.lodging) stay.lodging.place = renamed(stay.lodging.place, fields.lodgingName);
  } else if (kind === 'transit') {
    const transit = entity as Transit;
    transit.from = renamed(transit.from, fields.fromLabel);
    transit.to = renamed(transit.to, fields.toLabel);
    if (fields.mode) transit.mode = fields.mode;
  } else {
    const activity = entity as Activity;
    if (fields.text) activity.text = fields.text;
    if (fields.placeLabel) {
      activity.place = activity.place
        ? renamed(activity.place, fields.placeLabel)
        : { id: null, label: fields.placeLabel };
    }
  }
}

interface DraftedProposal {
  entity: Activity | Stay | Transit;
  bookings: Booking[];
  travelers: Traveler[];
}

// `bookings` are the Booking documents the draft writes and `travelers` the
// new travelers it names (see draftEntityFromProposal) — handed to
// openFromDraft with it, so the review form opens on them and Save commits them.
export type ResolvedProposal =
  | {
      kind: EditKind;
      draft: Activity | Stay | Transit;
      bookings: Booking[];
      travelers: Traveler[];
      overrideId?: string;
    }
  | { error: string };

// Turns a ProposedEdit into what EditContext's openFromDraft needs — the edit-vs-create
// branch a proposal always carries (an existing entityId to overlay onto, or a
// legId+date to start blank from) plus the entity lookup that decides it, kept here
// rather than in the assistant panel so the resolution logic is unit-testable business logic,
// not view code.
// An activity proposal that came with a real place id (looked up via a tool) resolves
// its place to it, keeping the label the draft already has.
function withPlaceId<E extends Activity | Stay | Transit>(draft: E, proposal: ProposedEdit): E {
  if (proposal.kind !== 'activity') return draft;
  const activity = draft as Activity;
  if (proposal.placeId) {
    const label = activity.place?.label ?? proposal.fields.placeLabel ?? '';
    activity.place = { ...activity.place, id: proposal.placeId, label };
  }
  // Candidates replace any single place: a meal with options has none of its own.
  if (proposal.mealOptions) applyMealOptions(activity, proposal.mealOptions);
  return draft;
}

// A transit proposal that names a route points the drive at it. A routed drive's
// arrival is never stored — it's walked from the selected variant's drive times — so
// arrivesAt is cleared whatever endAt said. Returns an error message when the route or
// variant doesn't exist. Mutates `transit` (a fresh draft).
function withRoute(transit: Transit, proposal: ProposedEdit, data: TripData): string | null {
  const { routeId, routeVariant } = proposal;
  if (routeId === undefined && routeVariant === undefined) return null;
  if (routeId === '') {
    transit.routeId = null;
    transit.routeVariant = null;
    delete transit.showEndpointsOnMap;
    // Off its route it needs a stored arrival again — the merge skipped endAt
    // while the drive was still routed.
    if (proposal.fields.endAt) transit.arrivesAt = proposal.fields.endAt;
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
  if (!proposal.entityId && !proposal.fields.mode) transit.mode = 'drive';
  return null;
}

function finishDraft(
  { entity: draft, bookings, travelers }: DraftedProposal,
  proposal: ProposedEdit,
  data: TripData,
  overrideId?: string,
): ResolvedProposal {
  if (proposal.kind === 'transit') {
    const error = withRoute(draft as Transit, proposal, data);
    if (error) return { error };
  }
  return {
    kind: proposal.kind,
    draft: withPlaceId(draft, proposal),
    bookings,
    travelers,
    overrideId,
  };
}

export function resolveProposalDraft(proposal: ProposedEdit, data: TripData): ResolvedProposal {
  if (proposal.entityId) {
    const existing = findByKind(proposal.kind, proposal.entityId, data);
    if (!existing) {
      return { error: "Couldn't find the entry the AI was referring to — try asking again." };
    }
    return finishDraft(
      draftEntityFromProposal(proposal.kind, proposal.fields, existing, data),
      proposal,
      data,
      proposal.entityId,
    );
  }
  if (proposal.legId && proposal.date) {
    const booking = mergeBooking(proposal.fields);
    const roster = entryRoster(proposal.fields, data.trip.travelers);
    const draft = draftEntityFromExtraction(
      proposal.fields,
      proposal.legId,
      proposal.date,
      {},
      roster.travelers,
      booking,
    );
    // Stay has no scenarioId field at all (see types.ts) — only Activity/Transit branch.
    if (proposal.scenarioId && proposal.kind !== 'stay') {
      (draft as Activity | Transit).scenarioId = proposal.scenarioId;
    }
    return finishDraft(
      {
        entity: draft,
        bookings: booking ? [booking] : [],
        travelers: proposal.kind === 'transit' ? roster.added : [],
      },
      proposal,
      data,
    );
  }
  return { error: "The AI's suggestion was missing where to place it — try asking again." };
}
