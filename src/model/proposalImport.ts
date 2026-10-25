// Importing a booking document as proposals (strategy S4): the AI reads the
// document with the itinerary in view and proposes changes to specific
// entries; proposals.ts checks each one as it arrives, and a failed check
// goes straight back to the AI as a tool error to fix. When the AI calls
// finish and the bookings add up to the document's total, the accepted
// proposals become the review queue. Nothing is saved here.
import type {
  BetaContentBlock,
  BetaMessageParam,
  BetaTool,
  BetaToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';

import { createMessage, type SendMessage } from './anthropicClient';
import { buildTripContext } from './askAI';
import { type AskAIToolContext, READ_TOOLS, runReadTool, ToolInputError } from './askAITools';
import type { ClientOptions } from './clientOptions';
import { documentContent, DocumentImportError, type QueuedImport } from './documentImport';
import { NOTE_KINDS } from './formatting';
import { withPrimaryImage } from './placePhotos';
import { searchPlaces } from './places';
import {
  acceptProposal,
  ADD_TRAVELER_TOOL,
  addTraveler,
  type ChangeProposal,
  entryPlaces,
  IMPORT_CONVENTIONS,
  PROPOSAL_PROPERTIES,
  type ProposalState,
  proposalState,
  type ProposedNote,
  queueFromProposals,
  REFUND_TERMS_SCHEMA,
  type RefundTerms,
  validateFinish,
  validateNote,
} from './proposals';
import type { Activity, Booking, Note, Stay, Transit, Traveler, TripData, TripView } from './types';

const LOOKUP_TOOLS = new Set(['get_entity', 'search_places']);
const MAX_REQUESTS = 12;

const PROPOSE_CHANGE: BetaTool = {
  name: 'propose_change',
  description:
    'Propose one entry this document creates or updates, with only the fields it changes, in the trip’s own field names. Checked on arrival: an error says what to fix.',
  input_schema: {
    type: 'object',
    properties: {
      ...PROPOSAL_PROPERTIES,
      why: {
        type: 'string',
        description: 'The reason a person would accept, e.g. "Same operator and morning".',
      },
    },
    required: ['kind', 'changes', 'why'],
  },
};

const ADD_NOTE: BetaTool = {
  name: 'add_note',
  description: 'A note on an entry this import proposes.',
  input_schema: {
    type: 'object',
    properties: {
      concerns: { type: 'string', description: 'The entry id or new key.' },
      kind: { type: 'string', enum: NOTE_KINDS },
      text: { type: 'string' },
    },
    required: ['concerns', 'kind', 'text'],
  },
};

const FINISH: BetaTool = {
  name: 'finish',
  description:
    'Call once everything is proposed. documentTotal is what the booking costs as printed, without fees paid separately at the property; the proposed bookings must add up to it.',
  input_schema: {
    type: 'object',
    properties: {
      documentTotal: {
        type: 'object',
        properties: { amount: { type: 'number' }, currency: { type: 'string' } },
        required: ['amount'],
      },
      refundTerms: REFUND_TERMS_SCHEMA,
      tripName: {
        type: 'string',
        description: 'Only when starting a new trip: a short name, e.g. "Alaska Cruise".',
      },
      tripSummary: {
        type: 'string',
        description: 'Only when starting a new trip: one or two sentences, what it is and when.',
      },
    },
    required: ['documentTotal', 'refundTerms'],
  },
};

function instructions(data: TripData, newTrip: boolean): string {
  const party = data.trip.travelers
    .map((t) => `${t.name} (id ${t.id}${t.age != null ? `, age ${t.age}` : ''})`)
    .join('; ');
  return [
    'Read the attached booking document as the person who booked it, with their itinerary below, and propose what it changes: one propose_change per entry it creates or updates, add_note for what a person would want reminding of, then finish.',
    party
      ? `The party: ${party}. They are ${data.trip.pets ? '' : 'not '}traveling with pets.`
      : 'No travelers are on the trip yet.',
    ...(newTrip
      ? [
          'This document starts a new trip: its itinerary below is empty. Add each traveler it names with add_traveler before proposing their fares and seats, propose every entry as new on the one leg, and suggest tripName and tripSummary in finish.',
        ]
      : []),
    'How this trip is modeled:',
    ...IMPORT_CONVENTIONS.map((c) => `- ${c}`),
    'Look an entry up with get_entity before changing it. Find a real place with search_places and use its placeId. Leave out what the document doesn’t say.',
    '',
    buildTripContext(data),
  ].join('\n');
}

export interface ProposalImport {
  queue: QueuedImport[];
  proposals: ChangeProposal[];
  notes: ProposedNote[];
  newTravelers: Traveler[];
  tripName?: string; // new trips only
  tripSummary?: string;
  rejected: { tool: string; input: unknown; errors: string[] }[];
  requests: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

// Adds a user turn, folded into the last one when that's already the user's:
// an empty reply leaves no assistant turn between them, and the API wants the
// roles to alternate.
function withUserReminder(messages: BetaMessageParam[], text: string): BetaMessageParam[] {
  const last = messages[messages.length - 1];
  if (last?.role !== 'user') return [...messages, { role: 'user', content: text }];
  const content =
    typeof last.content === 'string'
      ? [{ type: 'text' as const, text: last.content }]
      : last.content;
  return [
    ...messages.slice(0, -1),
    { role: 'user', content: [...content, { type: 'text' as const, text }] },
  ];
}

// The import's requests, sent with its own errors. `options` are for tests.
export const importRequest =
  (options?: ClientOptions): SendMessage =>
  (request) =>
    createMessage(
      request,
      (msg) => new DocumentImportError(msg),
      'Claude declined to process this document.',
      options,
    );

export async function importByProposals(
  file: File,
  data: TripData,
  view: TripView,
  options: {
    // A different model or effort to read with — for comparing them in the
    // attachments check. Effort defaults to low: on the ten-document check it
    // scored the same as medium for about 30% less (attachments/import-check/
    // STRATEGIES.md). null leaves it out (Haiku 4.5 doesn't take it).
    model?: string;
    effort?: 'low' | 'medium' | 'high' | null;
    // The document starts a new trip rather than updating this one.
    newTrip?: boolean;
    // Sends each request, and runs search_places; tests pass stubs.
    create?: SendMessage;
    searchPlaces?: AskAIToolContext['searchPlaces'];
  } = {},
): Promise<ProposalImport> {
  const { create = importRequest(), searchPlaces: searchPlacesFor = searchPlaces } = options;
  const media = await documentContent(file);
  const state: ProposalState = proposalState(data);
  const rejected: ProposalImport['rejected'] = [];
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const tools = [
    ...READ_TOOLS.filter((t) => LOOKUP_TOOLS.has(t.name)),
    PROPOSE_CHANGE,
    ADD_TRAVELER_TOOL,
    ADD_NOTE,
    FINISH,
  ];
  let messages: BetaMessageParam[] = [
    {
      role: 'user',
      content: [
        { ...media, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: instructions(data, options.newTrip ?? false) },
      ],
    },
  ];

  let trip: { tripName?: string; tripSummary?: string } = {};
  for (let requests = 1; requests <= MAX_REQUESTS; requests++) {
    const message = await create({
      model: options.model,
      max_tokens: 16000,
      ...(options.effort === null
        ? {}
        : { output_config: { effort: options.effort ?? ('low' as const) } }),
      tools,
      messages,
    });
    tokens.input += message.usage.input_tokens;
    tokens.output += message.usage.output_tokens;
    tokens.cacheRead += message.usage.cache_read_input_tokens ?? 0;
    tokens.cacheWrite += message.usage.cache_creation_input_tokens ?? 0;
    if (message.stop_reason === 'max_tokens') {
      throw new DocumentImportError('That document produced more detail than fits in one reply.');
    }
    if (message.content.length) {
      messages = [...messages, { role: 'assistant', content: message.content }];
    }
    const calls = message.content.filter(
      (b): b is Extract<BetaContentBlock, { type: 'tool_use' }> => b.type === 'tool_use',
    );
    if (!calls.length) {
      messages = withUserReminder(
        messages,
        'Propose the changes with the tools, then call finish.',
      );
      continue;
    }
    // Lookups don't depend on each other, so a turn's searches all start at once;
    // the proposals then go through in the order the AI made them.
    const lookups = new Map(
      calls
        .filter((call) => LOOKUP_TOOLS.has(call.name))
        .map((call) => [
          call.id,
          // Settled to a reply here, so a failed lookup is never a rejection
          // left waiting while an earlier one is awaited.
          runReadTool(call.name, call.input, {
            data,
            view,
            byDate: new Map(),
            today: view.today,
            placeSearches: state.placeSearches,
            searchPlaces: searchPlacesFor,
          }).then(
            (text) => ({ text, isError: false }),
            (err: unknown) => ({
              text: err instanceof ToolInputError ? err.message : String(err),
              isError: true,
            }),
          ),
        ]),
    );
    let finished = false;
    const rejectedBefore = rejected.length;
    const results: BetaToolResultBlockParam[] = [];
    // Lookups are handled first, so a place id a search returns this turn is
    // known to a proposal sent before it; finish checks the total against
    // everything accepted, so it goes last. Whatever order they were sent in.
    const handlingOrder = (name: string) =>
      LOOKUP_TOOLS.has(name) ? 0 : name === 'finish' ? 2 : 1;
    const byFinishLast = [...calls].sort((a, b) => handlingOrder(a.name) - handlingOrder(b.name));
    for (const call of byFinishLast) {
      const reply = (content: string, isError = false) =>
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content,
          ...(isError ? { is_error: true } : {}),
        });
      const fail = (errors: string[]) => {
        rejected.push({ tool: call.name, input: call.input, errors });
        reply(errors.join('\n'), true);
      };
      if (LOOKUP_TOOLS.has(call.name)) {
        const { text, isError } = await lookups.get(call.id)!;
        reply(text, isError);
      } else if (call.name === 'propose_change') {
        const errors = acceptProposal(call.input as ChangeProposal, state);
        if (errors.length) fail(errors);
        else reply('Accepted.');
      } else if (call.name === 'add_traveler') {
        const added = addTraveler(call.input as { name?: string; age?: number }, state);
        if ('errors' in added) fail(added.errors);
        else reply(`Added as ${added.traveler.id}.`);
      } else if (call.name === 'add_note') {
        const note = call.input as ProposedNote;
        const errors = validateNote(note, state);
        if (errors.length) fail(errors);
        else {
          state.notes.push(note);
          reply('Accepted.');
        }
      } else if (call.name === 'finish') {
        const { documentTotal, refundTerms, tripName, tripSummary } = call.input as {
          documentTotal?: { amount: number; currency?: string };
          refundTerms?: RefundTerms;
          tripName?: string;
          tripSummary?: string;
        };
        // A change turned down in this same turn hasn't had its chance to be
        // fixed yet, so the import can't end on it. A turned-down add_traveler
        // is exempt: its reply names the existing id, and any entry that
        // relied on the new traveler is rejected on its own.
        const errors = rejected.slice(rejectedBefore).some((r) => r.tool !== 'add_traveler')
          ? ['Fix the calls turned down in this turn before finishing.']
          : validateFinish(state, documentTotal, refundTerms);
        if (errors.length) fail(errors);
        else {
          finished = true;
          state.refundTerms = refundTerms ?? null;
          trip = { tripName, tripSummary };
          reply('Done.');
        }
      } else {
        reply(`Unknown tool ${call.name}.`, true);
      }
    }
    const order = calls.map((c) => c.id);
    results.sort((a, b) => order.indexOf(a.tool_use_id) - order.indexOf(b.tool_use_id));
    messages = [...messages, { role: 'user', content: results }];
    if (finished) {
      const queue = withPlaceImages(queueFromProposals(state));
      return {
        queue,
        proposals: state.accepted,
        notes: state.notes,
        newTravelers: state.newTravelers,
        ...trip,
        rejected,
        requests,
        tokens,
      };
    }
  }
  throw new DocumentImportError(
    `Couldn't finish reading that document in ${MAX_REQUESTS} steps; ${state.accepted.length} entries were proposed.`,
  );
}

// A newly resolved place gets its primary photo, as one picked in the place
// picker would. The queue's entities are fresh drafts, so their places are
// filled in where they are.
function withPlaceImages(queue: QueuedImport[]): QueuedImport[] {
  for (const { entity } of queue) {
    for (const place of entryPlaces(entity)) place.images = withPrimaryImage(place).images;
  }
  return queue;
}

// ---------- Starting a new trip from a document ----------

// The leg a new trip's draft has before the real one exists; stagedFromProposals
// moves everything onto the real leg.
const NEW_TRIP_LEG = 'leg_new_trip';

// A trip with nothing on it yet — the travelers entered so far and the pets
// setting — for a document that starts it to be read against.
export function draftTripData(travelers: Traveler[], pets: boolean): TripData {
  return {
    trip: { _id: 'trip_new', name: 'New trip', travelers, images: [], ...(pets ? { pets } : {}) },
    legs: [
      {
        _id: NEW_TRIP_LEG,
        tripId: 'trip_new',
        name: 'New trip',
        skeletonAuthority: 'self',
        images: [],
      },
    ],
    stays: [],
    transits: [],
    activities: [],
    bookings: [],
    scenarios: [],
    notes: [],
    travelModeOverrides: [],
    routes: [],
  };
}

export interface StagedTripEntities {
  activities: Activity[];
  stays: Stay[];
  transits: Transit[];
  bookings: Booking[];
  notes: Note[];
}

// What a document that starts a trip proposed, as the new trip's own entries
// on its real leg — every proposal is a new entry there, saved with the trip.
export function stagedFromProposals(result: ProposalImport, legId: string): StagedTripEntities {
  const staged: StagedTripEntities = {
    activities: [],
    stays: [],
    transits: [],
    bookings: [],
    notes: [],
  };
  const bookingIds = new Set<string>();
  for (const draft of result.queue) {
    const entity = {
      ...draft.entity,
      legId: draft.entity.legId === NEW_TRIP_LEG ? legId : draft.entity.legId,
    };
    if (draft.kind === 'stay') staged.stays.push(entity as Stay);
    else if (draft.kind === 'transit') staged.transits.push(entity as Transit);
    else staged.activities.push(entity as Activity);
    for (const booking of draft.bookings) {
      if (!bookingIds.has(booking._id)) {
        bookingIds.add(booking._id);
        staged.bookings.push(booking);
      }
    }
    staged.notes.push(
      ...draft.notes.map((n) => ({
        _id: crypto.randomUUID(),
        kind: n.kind,
        text: n.text,
        concerns: [n.ref],
        images: [],
      })),
    );
  }
  return staged;
}
