// Conversational "Ask AI" assistant for the day list — same browser-direct
// Anthropic call as documentImport.ts (same key, same model), but a
// multi-turn chat instead of a single forced-tool extraction. The model can
// answer in plain text, or call propose_edit to suggest one concrete change;
// either way nothing is ever applied automatically — a proposal only opens
// the existing EditDialog (via EditContext's openFromDraft), pre-filled, for
// a human to review and Save exactly like a manual add/edit.
import { type AnthropicTool, callAnthropicMessages } from './anthropicClient';
import {
  draftEntityFromExtraction,
  ENTITY_SCHEMA,
  type ExtractedFields,
  mergeBooking,
} from './documentImport';
import { blankActivity, type EditKind, findByKind } from './editForms';
import { formatTime } from './tripModel';
import type { Activity, Stay, Transit, TripData } from './types';

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
  | {
      op: 'add';
      text: string;
      startAt: string;
      durationMinutes?: number;
      placeLabel?: string;
      // Set when this date has ideal/alternate Scenario branches and the new activity
      // belongs to only one of them — see buildTripContext's own Scenario listing.
      scenarioId?: string;
    };

export interface ProposedDayPlan {
  date: string;
  legId: string; // needed to place any 'add' ops
  summary: string;
  ops: DayPlanOp[];
}

export interface AskAIMessage {
  role: 'user' | 'assistant';
  text: string;
  proposal?: ProposedEdit;
  dayPlan?: ProposedDayPlan;
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
        `  Stay ${s._id}: ${s.lodging?.name || '(unnamed)'} — ${s.checkInAt} to ${s.checkOutAt} [${s.status}]`,
      );
    }
    for (const t of transits) {
      lines.push(
        `  Transit ${t._id}: ${t.from.label} -> ${t.to.label} (${t.mode}), departs ${t.departsAt} [${t.status}]${scenarioTag(t.scenarioId)}`,
      );
    }
    for (const a of activities) {
      const when = a.startAt ?? `${a.date ?? '?'} (${a.timeLabel ?? 'unspecified time'})`;
      const place = a.place ? ` at ${a.place.label}` : '';
      lines.push(
        `  Activity ${a._id}: ${a.text || '(untitled)'} — ${when}${place} [${a.status}]${scenarioTag(a.scenarioId)}`,
      );
    }
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
  'Answer questions about the itinerary below (schedule, logistics, timing, what is booked vs. still planned) ' +
  'concisely, in plain prose — no markdown headings or bullet lists. ' +
  'When the user asks to re-plan a day, or to move/add/remove more than one activity on the same date, use the ' +
  'propose_day_plan tool with one op per change, so the whole plan is reviewed and applied together. For a single ' +
  "field-level change to one entity — retiming or rewording just one activity, or any change to a Stay's or " +
  "Transit's own fields — use propose_edit instead. Never use both tools in the same turn. Always fill in " +
  '"summary" with a short, human-readable description of the change. Reference an existing entity\'s exact ' +
  'entityId when modifying it; when adding something new, pick the correct legId and date from the itinerary ' +
  "below instead. Some dates have ideal/alternate weather-branch Scenarios (see each Leg's own Scenario listing, " +
  'and the "[scenario: ...]" tag on entries already using one) — when adding a new activity that belongs to only ' +
  'one branch of such a date, set its scenarioId to match; leave scenarioId unset for a date with no Scenarios, ' +
  'or for something that applies regardless of branch. Never invent booking confirmation numbers, costs, place ' +
  'ids, or scenarioIds you were not given. If you are not confident a change is warranted, just answer in text.';

const PROPOSE_EDIT_TOOL: AnthropicTool = {
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
      summary: {
        type: 'string',
        description: 'One short sentence describing this change, shown to the user for review.',
      },
    },
    required: ['kind', 'summary'],
  },
};

function parseProposal(input: unknown): ProposedEdit {
  const raw = input as ExtractedFields & {
    entityId?: string;
    legId?: string;
    date?: string;
    scenarioId?: string;
    summary: string;
  };
  const { entityId, legId, date, scenarioId, summary, ...fields } = raw;
  return {
    kind: fields.kind,
    entityId,
    legId,
    date,
    scenarioId,
    summary,
    fields: fields as ExtractedFields,
  };
}

const PROPOSE_DAY_PLAN_TOOL: AnthropicTool = {
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
            text: { type: 'string', description: 'Required for add — short description.' },
            startAt: {
              type: 'string',
              description:
                'ISO 8601 local date-time. Required for add; for move, the new start time.',
            },
            durationMinutes: { type: 'number' },
            placeLabel: { type: 'string', description: 'add only — plain text, never an id.' },
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

function parseDayPlan(input: unknown): ProposedDayPlan {
  return input as ProposedDayPlan;
}

export async function askAI(
  history: AskAIMessage[],
  question: string,
  tripContext: string,
  apiKey: string,
): Promise<AskAIMessage> {
  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.text })),
    { role: 'user', content: question },
  ];

  const body = await callAnthropicMessages(
    {
      // Bumped from 1024 now that the model is choosing between two tools and
      // propose_day_plan's ops array can run longer than a single propose_edit call —
      // a truncated tool call (stop_reason: 'max_tokens') was showing up as a silent
      // "I didn't get a response." with no diagnostic, hence also disabling thinking
      // (never requested here anyway, but this rules it out as a token sink) and
      // surfacing stop_reason in that fallback below.
      max_tokens: 2048,
      thinking: { type: 'disabled' },
      // The trip itinerary is identical on every turn of a conversation — mark it as an
      // Anthropic prompt-cache breakpoint so a multi-message chat only pays to reprocess
      // it once instead of on every send.
      system: [
        {
          type: 'text',
          text: `${ASK_AI_SYSTEM_PROMPT}\n\nHere is the trip itinerary:\n${tripContext}`,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [PROPOSE_EDIT_TOOL, PROPOSE_DAY_PLAN_TOOL],
      messages,
    },
    apiKey,
    (message) => new AskAIError(message),
    'Claude declined to respond to that.',
  );

  const text = body.content
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n')
    .trim();
  const editUse = body.content.find(
    (block) => block.type === 'tool_use' && block.name === PROPOSE_EDIT_TOOL.name,
  );
  const planUse = body.content.find(
    (block) => block.type === 'tool_use' && block.name === PROPOSE_DAY_PLAN_TOOL.name,
  );
  const proposal = editUse ? parseProposal(editUse.input) : undefined;
  const dayPlan = planUse ? parseDayPlan(planUse.input) : undefined;

  return {
    role: 'assistant',
    text:
      text ||
      proposal?.summary ||
      dayPlan?.summary ||
      `I didn't get a usable reply (stop_reason: ${body.stop_reason}) — try asking again, maybe more briefly.`,
    proposal,
    dayPlan,
  };
}

// ---------- turning a day plan into a real activities[] update ----------
//
// Unlike a single propose_edit, this never opens EditDialog — the batch itself, shown as
// a reviewed list in AskAIDialog, is the human checkpoint. Applying it is one setData
// call over the whole ops list, so it's one undo-able step and one dirty-marking, not N.
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
      activities = [
        ...activities,
        {
          ...blankActivity(plan.legId, plan.date),
          text: op.text,
          startAt: op.startAt,
          durationMinutes: op.durationMinutes ?? null,
          place: op.placeLabel ? { id: null, label: op.placeLabel } : null,
          scenarioId: op.scenarioId ?? null,
        },
      ];
    }
  }
  return { ...data, activities };
}

// One line per op, shown in the review list before Apply all. Entity ids (act_lc_d4_...)
// mean nothing to a reader, so every move/remove looks the existing activity's own text
// up out of `data` rather than showing raw ids; a move shows before → after time only
// when the time is actually changing, to avoid noise on a same-time reorder.
export function describeDayPlanOp(op: DayPlanOp, data: TripData): string {
  if (op.op === 'add') {
    const when = op.startAt ? ` at ${formatTime(op.startAt)}` : '';
    return `+ Add "${op.text}"${when}`;
  }
  const existing = data.activities.find((a) => a._id === op.entityId);
  const label = existing ? `"${existing.text}"` : 'that activity';
  if (op.op === 'remove') return `− Remove ${label}`;
  const from = existing?.startAt ? formatTime(existing.startAt) : null;
  const to = op.startAt ? formatTime(op.startAt) : null;
  if (from && to && from !== to) return `Move ${label} ${from} → ${to}`;
  if (to) return `Move ${label} to ${to}`;
  return `Move ${label}`;
}

// ---------- turning a proposal into a real draft entity ----------

// The create case (no entityId) reuses draftEntityFromExtraction verbatim —
// same "start from blank" shape as a document import. The edit case instead
// overlays only the fields the AI actually supplied onto a clone of the real
// entity, so a field it left out (an existing booking, images, etc.) survives
// untouched rather than being reset to blank.
export function draftEntityFromProposal(
  kind: EditKind,
  fields: ExtractedFields,
  base: Activity | Stay | Transit,
): Activity | Stay | Transit {
  const entity = structuredClone(base);
  const booking = mergeBooking(fields, entity.booking);

  if (kind === 'stay') {
    const stay = entity as Stay;
    if (fields.checkInAt) stay.checkInAt = fields.checkInAt;
    if (fields.checkOutAt) stay.checkOutAt = fields.checkOutAt;
    if (fields.lodgingName && stay.lodging) stay.lodging.name = fields.lodgingName;
    stay.booking = booking;
    return stay;
  }

  if (kind === 'transit') {
    const transit = entity as Transit;
    if (fields.startAt) transit.departsAt = fields.startAt;
    if (fields.endAt) transit.arrivesAt = fields.endAt;
    if (fields.fromLabel) transit.from = { ...transit.from, label: fields.fromLabel };
    if (fields.toLabel) transit.to = { ...transit.to, label: fields.toLabel };
    if (fields.mode) transit.mode = fields.mode;
    if (fields.carrier) transit.carrier = fields.carrier;
    if (fields.flightNumber) transit.flightNumber = fields.flightNumber;
    transit.booking = booking;
    return transit;
  }

  const activity = entity as Activity;
  if (fields.startAt) activity.startAt = fields.startAt;
  if (fields.text) activity.text = fields.text;
  if (fields.placeLabel) activity.place = { id: null, label: fields.placeLabel };
  if (fields.mealType) activity.mealType = fields.mealType;
  if (fields.diningFormat) activity.diningFormat = fields.diningFormat;
  activity.booking = booking;
  return activity;
}

export type ResolvedProposal =
  { kind: EditKind; draft: Activity | Stay | Transit; overrideId?: string } | { error: string };

// Turns a ProposedEdit into what EditContext's openFromDraft needs — the edit-vs-create
// branch a proposal always carries (an existing entityId to overlay onto, or a
// legId+date to start blank from) plus the entity lookup that decides it, kept here
// rather than in AskAIDialog so the resolution logic is unit-testable business logic,
// not view code.
export function resolveProposalDraft(proposal: ProposedEdit, data: TripData): ResolvedProposal {
  if (proposal.entityId) {
    const existing = findByKind(proposal.kind, proposal.entityId, data);
    if (!existing) {
      return { error: "Couldn't find the entry the AI was referring to — try asking again." };
    }
    return {
      kind: proposal.kind,
      draft: draftEntityFromProposal(proposal.kind, proposal.fields, existing),
      overrideId: proposal.entityId,
    };
  }
  if (proposal.legId && proposal.date) {
    const draft = draftEntityFromExtraction(proposal.fields, proposal.legId, proposal.date);
    // Stay has no scenarioId field at all (see types.ts) — only Activity/Transit branch.
    if (proposal.scenarioId && proposal.kind !== 'stay') {
      (draft as Activity | Transit).scenarioId = proposal.scenarioId;
    }
    return { kind: proposal.kind, draft };
  }
  return { error: "The AI's suggestion was missing where to place it — try asking again." };
}
