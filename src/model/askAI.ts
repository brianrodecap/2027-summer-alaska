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
import { type EditKind, findByKind } from './editForms';
import type { Activity, Stay, Transit, TripData } from './types';

export class AskAIError extends Error {}

export interface ProposedEdit {
  kind: EditKind;
  entityId?: string;
  legId?: string;
  date?: string;
  summary: string;
  fields: ExtractedFields;
}

export interface AskAIMessage {
  role: 'user' | 'assistant';
  text: string;
  proposal?: ProposedEdit;
}

// ---------- trip context, fed to the model as its system prompt ----------

// A plain-text, per-leg listing of every Stay/Transit/Activity with its own
// _id — compact enough to fit comfortably in a chat system prompt, and
// giving the model real ids it can hand back via propose_edit's entityId
// rather than needing a second lookup round-trip.
export function buildTripContext(data: TripData): string {
  const lines: string[] = [`Trip: ${data.trip.name}`];
  for (const leg of data.legs) {
    lines.push(`\nLeg "${leg.name}" — legId: ${leg._id}`);
    const stays = [...data.stays.filter((s) => s.legId === leg._id)].sort((a, b) =>
      a.checkInAt.localeCompare(b.checkInAt),
    );
    const transits = [...data.transits.filter((t) => t.legId === leg._id)].sort((a, b) =>
      a.departsAt.localeCompare(b.departsAt),
    );
    const activities = [...data.activities.filter((a) => a.legId === leg._id)].sort((a, b) =>
      (a.startAt ?? a.date ?? '').localeCompare(b.startAt ?? b.date ?? ''),
    );
    for (const s of stays) {
      lines.push(
        `  Stay ${s._id}: ${s.lodging?.name || '(unnamed)'} — ${s.checkInAt} to ${s.checkOutAt} [${s.status}]`,
      );
    }
    for (const t of transits) {
      lines.push(
        `  Transit ${t._id}: ${t.from.label} -> ${t.to.label} (${t.mode}), departs ${t.departsAt} [${t.status}]`,
      );
    }
    for (const a of activities) {
      const when = a.startAt ?? `${a.date ?? '?'} (${a.timeLabel ?? 'unspecified time'})`;
      const place = a.place ? ` at ${a.place.label}` : '';
      lines.push(`  Activity ${a._id}: ${a.text || '(untitled)'} — ${when}${place} [${a.status}]`);
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
  'When the user asks for a change, or you notice a genuine improvement worth flagging, propose exactly ONE ' +
  'concrete change via the propose_edit tool rather than describing it in prose. Always fill in "summary" with a ' +
  "short, human-readable description of the change. Reference an existing entity's exact entityId when modifying " +
  'it; when adding something new, pick the correct legId and date from the itinerary below instead. Never invent ' +
  'booking confirmation numbers, costs, or place ids you were not given. If you are not confident a change is ' +
  'warranted, just answer in text.';

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
    summary: string;
  };
  const { entityId, legId, date, summary, ...fields } = raw;
  return { kind: fields.kind, entityId, legId, date, summary, fields: fields as ExtractedFields };
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
      max_tokens: 1024,
      system: `${ASK_AI_SYSTEM_PROMPT}\n\nHere is the trip itinerary:\n${tripContext}`,
      tools: [PROPOSE_EDIT_TOOL],
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
  const toolUse = body.content.find(
    (block) => block.type === 'tool_use' && block.name === PROPOSE_EDIT_TOOL.name,
  );
  const proposal = toolUse ? parseProposal(toolUse.input) : undefined;

  return {
    role: 'assistant',
    text: text || proposal?.summary || "I didn't get a response.",
    proposal,
  };
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
    return {
      kind: proposal.kind,
      draft: draftEntityFromExtraction(proposal.fields, proposal.legId, proposal.date),
    };
  }
  return { error: "The AI's suggestion was missing where to place it — try asking again." };
}
