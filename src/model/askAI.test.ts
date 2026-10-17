import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setAnthropicApiKey } from '../config/apiKeys';
import {
  applyDayPlan,
  type AskAIConversation,
  buildTripContext,
  describeDayPlan,
  type ProposedDayPlan,
  type ProposedEdit,
  resolveProposalDraft,
  runAskAITurn,
  startConversation,
} from './askAI';
import type { AskAIToolContext } from './askAITools';
import { dayPlanErrors } from './proposals';
import type { Day, Route, Transit, TripData, TripView } from './types';

// The turn loop streams, so the stubbed API answers with server-sent events. Each
// queued reply is one request's whole response; nothing reaches the real API.

type Block =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown };

function sse(blocks: Block[], stopReason: string): string {
  const events: unknown[] = [
    {
      type: 'message_start',
      message: {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    },
  ];
  blocks.forEach((block, index) => {
    if (block.type === 'text') {
      events.push({
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '' },
      });
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: block.text },
      });
    } else if (block.type === 'thinking') {
      events.push({
        type: 'content_block_start',
        index,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      });
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'thinking_delta', thinking: block.thinking },
      });
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'signature_delta', signature: 'sig' },
      });
    } else {
      events.push({
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
      });
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
      });
    }
    events.push({ type: 'content_block_stop', index });
  });
  events.push({
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 10 },
  });
  events.push({ type: 'message_stop' });
  return events
    .map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join('');
}

// Queues one SSE reply per expected request and records every request body sent.
function stubTurns(...replies: string[]) {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      const next = replies.shift();
      if (!next) throw new Error('No more stubbed replies');
      return new Response(next, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }),
  );
  return bodies;
}

beforeEach(() => setAnthropicApiKey('sk-test'));

afterEach(() => {
  vi.unstubAllGlobals();
});

function tripData(activityText = 'Kayak tour'): TripData {
  return {
    trip: { _id: 'trip_t', name: 'Test Trip', travelers: [], images: [] },
    legs: [
      { _id: 'leg_a', tripId: 'trip_t', name: 'Leg A', skeletonAuthority: 'self', images: [] },
    ],
    stays: [],
    transits: [],
    activities: [
      {
        _id: 'act_1',
        legId: 'leg_a',
        scenarioId: null,
        status: 'planning',
        startAt: '2027-07-14T09:00',
        durationMinutes: 120,
        timeLabel: null,
        date: null,
        priority: null,
        text: activityText,
        place: null,
        bookingId: null,
        mealType: null,
      },
    ],
    scenarios: [],
    notes: [],
    bookings: [],
    travelModeOverrides: [],
    routes: [],
  } as unknown as TripData;
}

// get_day only reads the header fields and rows of a live Day.
const DAY = {
  date: '2027-07-14',
  dateLabel: 'Wed Jul 14',
  title: 'Seward',
  location: 'Seward',
  leg: { _id: 'leg_a', name: 'Leg A' },
  rows: [],
  notes: [{ _id: 'note_1', kind: 'warning', text: 'Bring rain gear', concerns: [], images: [] }],
} as unknown as Day;

function tools(data: TripData): Omit<AskAIToolContext, 'placeSearches'> {
  return {
    data,
    view: { dateRange: { startDate: '2027-07-14', endDate: '2027-07-14' } } as TripView,
    byDate: new Map([[DAY.date, DAY]]),
  };
}

function turn(conversation: AskAIConversation | null, question: string, data = tripData()) {
  return runAskAITurn(conversation, { question, data, tools: tools(data) });
}

describe('runAskAITurn', () => {
  it('runs a lookup, feeds the result back, and passes thinking blocks back unchanged', async () => {
    const bodies = stubTurns(
      sse(
        [
          { type: 'thinking', thinking: 'Checking the 14th.' },
          { type: 'tool_use', id: 'tu_1', name: 'get_day', input: { date: '2027-07-14' } },
        ],
        'tool_use',
      ),
      sse([{ type: 'text', text: 'Bring rain gear on the 14th.' }], 'end_turn'),
    );
    const start = startConversation(tripData());
    const lookups: string[] = [];
    const after = await runAskAITurn(start, {
      question: 'Anything to know about the 14th?',
      data: tripData(),
      tools: tools(tripData()),
      events: { onLookup: (label) => lookups.push(label) },
    });

    expect(bodies).toHaveLength(2);
    const [, second] = bodies as { messages: { role: string; content: unknown }[] }[];
    // The assistant turn goes back with its thinking block (and signature) intact…
    expect(second.messages[1]).toMatchObject({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Checking the 14th.', signature: 'sig' },
        { type: 'tool_use' },
      ],
    });
    // …followed by the lookup's result.
    const results = second.messages[2].content as { type: string; content: string }[];
    expect(results[0].type).toBe('tool_result');
    expect(results[0].content).toContain('Bring rain gear');

    expect(lookups).toEqual(['Looked at 2027-07-14']);
    expect(after.messages.at(-1)).toMatchObject({
      role: 'assistant',
      text: 'Bring rain gear on the 14th.',
      lookups: ['Looked at 2027-07-14'],
    });
    expect(after.system).toBe(start.system);
  });

  it('queues a proposal for review instead of applying anything', async () => {
    const bodies = stubTurns(
      sse(
        [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'propose_edit',
            input: {
              kind: 'activity',
              entityId: 'act_1',
              changes: { startAt: '2027-07-14T10:00' },
              summary: 'Later kayak',
            },
          },
        ],
        'tool_use',
      ),
      sse([{ type: 'text', text: 'I proposed moving the kayak tour to 10am.' }], 'end_turn'),
    );
    const after = await turn(startConversation(tripData()), 'Move the kayak later');

    const toolResult = (bodies[1].messages as { content: { content: string }[] }[])[2].content[0];
    expect(toolResult.content).toMatch(/Queued for the user to review/);
    expect(after.messages.at(-1)?.proposals).toEqual([
      {
        id: 'tu_1',
        type: 'edit',
        edit: expect.objectContaining({
          change: expect.objectContaining({ kind: 'activity', entityId: 'act_1' }),
          summary: 'Later kayak',
        }),
      },
    ]);
  });

  it('queues alternatives and meal-option adds as data, not text', async () => {
    stubTurns(
      sse(
        [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'propose_day_plan',
            input: {
              date: '2027-07-14',
              legId: 'leg_a',
              summary: 'Dinner choices',
              changes: [
                {
                  changes: {
                    text: 'Dinner',
                    startAt: '2027-07-14T18:30',
                    mealType: 'dinner',
                    mealOptions: [
                      { place: { label: 'Orso', placeId: 'p_orso' } },
                      { place: { label: "Crow's Nest", placeId: 'p_crows_nest' } },
                    ],
                  },
                },
              ],
            },
          },
          {
            type: 'tool_use',
            id: 'tu_2',
            name: 'propose_alternative',
            input: {
              date: '2027-07-14',
              legId: 'leg_a',
              summary: 'If the flight is grounded',
              label: 'Grounded',
              idealLabel: 'Flight goes',
              idealEntityIds: ['act_1'],
              entries: [{ text: 'Anchorage Museum', startAt: '2027-07-14T13:00' }],
            },
          },
        ],
        'tool_use',
      ),
      sse([{ type: 'text', text: 'Proposed both.' }], 'end_turn'),
    );
    const searched = {
      ...startConversation(tripData()),
      placeSearches: { placeIds: ['p_orso', 'p_crows_nest'], emptyQueries: [] },
    };
    const after = await turn(searched, 'Plan dinner and a grounded day');
    const reply = after.messages.at(-1)!;
    // One list, in the order the assistant proposed them, each keyed by its tool call.
    const [plan, alternative] = reply.proposals ?? [];
    expect(plan).toMatchObject({ id: 'tu_1', type: 'dayPlan' });
    expect(plan.type === 'dayPlan' && plan.plan.changes[0]).toMatchObject({
      kind: 'activity',
      legId: 'leg_a',
      date: '2027-07-14',
      changes: { mealType: 'dinner' },
    });
    expect(alternative).toMatchObject({
      id: 'tu_2',
      type: 'alternative',
      alternative: { label: 'Grounded', idealEntityIds: ['act_1'] },
    });
  });

  it('starts the conversation itself when there is none yet, with no itinerary update', async () => {
    const bodies = stubTurns(sse([{ type: 'text', text: 'Hello.' }], 'end_turn'));
    const after = await turn(null, 'Hi');
    expect(after.system).toBe(startConversation(tripData()).system);
    const sent = bodies[0].messages as { role: string }[];
    expect(sent.map((m) => m.role)).toEqual(['user']);
  });

  it('returns a malformed tool input to the model as an error it can correct', async () => {
    const bodies = stubTurns(
      sse(
        [{ type: 'tool_use', id: 'tu_1', name: 'get_day', input: { date: 'July 14' } }],
        'tool_use',
      ),
      sse([{ type: 'text', text: 'Sorry, which day?' }], 'end_turn'),
    );
    await turn(startConversation(tripData()), 'What about that day?');

    const result = (
      bodies[1].messages as { content: { is_error?: boolean; content: string }[] }[]
    )[2].content[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('YYYY-MM-DD');
  });

  it('keeps history append-only and announces trip edits in an appended system message', async () => {
    stubTurns(sse([{ type: 'text', text: 'First answer.' }], 'end_turn'));
    const first = await turn(startConversation(tripData()), 'First question');

    const bodies = stubTurns(sse([{ type: 'text', text: 'Second answer.' }], 'end_turn'));
    const edited = tripData('Glacier kayak tour');
    const second = await turn(first, 'Second question', edited);

    const sent = bodies[0] as { system: { text: string }[]; messages: unknown[] };
    expect(sent.system[0].text).toBe(first.system);
    // Every earlier message is resent exactly as it was…
    expect(sent.messages.slice(0, first.apiMessages.length)).toEqual(first.apiMessages);
    // …then the new question, then the itinerary update after it.
    const appended = sent.messages.slice(first.apiMessages.length) as {
      role: string;
      content: string;
    }[];
    expect(appended.map((m) => m.role)).toEqual(['user', 'system']);
    expect(appended[1].content).toContain('Glacier kayak tour');
    expect(second.itineraryHash).not.toBe(first.itineraryHash);
  });

  it('sends no itinerary update when the trip is unchanged', async () => {
    stubTurns(sse([{ type: 'text', text: 'One.' }], 'end_turn'));
    const first = await turn(startConversation(tripData()), 'Q1');
    const bodies = stubTurns(sse([{ type: 'text', text: 'Two.' }], 'end_turn'));
    await turn(first, 'Q2');
    const roles = (bodies[0].messages as { role: string }[]).map((m) => m.role);
    expect(roles).not.toContain('system');
  });

  it('tells the model to stop looking things up once the request limit is reached', async () => {
    const lookup = sse(
      [{ type: 'tool_use', id: 'tu', name: 'get_day', input: { date: '2027-07-14' } }],
      'tool_use',
    );
    const bodies = stubTurns(
      ...Array.from({ length: 7 }, () => lookup),
      sse([{ type: 'text', text: 'Here is what I found.' }], 'end_turn'),
    );
    const after = await turn(startConversation(tripData()), 'Dig deep');
    expect(bodies).toHaveLength(8);
    expect(bodies[6].tool_choice).toBeUndefined();
    expect(bodies[7].tool_choice).toEqual({ type: 'none' });
    expect(after.messages.at(-1)?.text).toBe('Here is what I found.');
  });
});

describe('propose_edit with a route', () => {
  const route: Route = {
    _id: 'route_a',
    from: { id: 'p_anc', label: 'Anchorage' },
    to: { id: 'p_sew', label: 'Seward' },
    variants: [
      { tone: 'direct', label: 'Seward Hwy', places: [], finalTravel: { minutes: 150 } },
      { tone: 'scenic', label: 'With stops', places: [], finalTravel: { minutes: 150 } },
    ],
    images: [],
  };
  const drive: Transit = {
    _id: 'tr_1',
    legId: 'leg_a',
    journeyId: null,
    travelers: null,
    scenarioId: null,
    status: 'planning',
    mode: 'drive',
    from: { id: null, label: 'Anchorage' },
    to: { id: null, label: 'Seward' },
    departsAt: '2027-07-14T08:00',
    arrivesAt: '2027-07-14T11:00',
    routeId: null,
    routeVariant: null,
    bookingId: null,
    images: [],
  };
  const data = { ...tripData(), transits: [drive], routes: [route] };
  const edit = (
    extra: Partial<Omit<ProposedEdit, 'change'>>,
    changes: ProposedEdit['change']['changes'] = {},
  ): ProposedEdit => ({
    change: { kind: 'transit', entityId: 'tr_1', changes, why: 's' },
    summary: 's',
    ...extra,
  });

  it('puts a drive on a route, clearing its stored arrival', () => {
    const resolved = resolveProposalDraft(
      edit({ routeId: 'route_a', routeVariant: 'scenic' }),
      data,
    );
    expect(resolved).toMatchObject({
      overrideId: 'tr_1',
      draft: { routeId: 'route_a', routeVariant: 'scenic', arrivesAt: null },
    });
  });

  it("keeps the drive's variant when only something else changes", () => {
    const routed = { ...drive, routeId: 'route_a', routeVariant: 'scenic', arrivesAt: null };
    const resolved = resolveProposalDraft(edit({ routeId: 'route_a' }), {
      ...data,
      transits: [routed],
    });
    expect(resolved).toMatchObject({ draft: { routeVariant: 'scenic' } });
  });

  it('takes a drive off its route with an empty routeId', () => {
    const routed = { ...drive, routeId: 'route_a', routeVariant: 'scenic', arrivesAt: null };
    const resolved = resolveProposalDraft(
      edit({ routeId: '' }, { arrivesAt: '2027-07-14T11:30' }),
      { ...data, transits: [routed] },
    );
    expect(resolved).toMatchObject({
      draft: { routeId: null, routeVariant: null, arrivesAt: '2027-07-14T11:30' },
    });
  });

  it('turns down an arrival on a drive that stays on its route', () => {
    const routed = { ...drive, routeId: 'route_a', routeVariant: 'scenic', arrivesAt: null };
    const resolved = resolveProposalDraft(edit({}, { arrivesAt: '2027-07-14T12:00' }), {
      ...data,
      transits: [routed],
    });
    expect('error' in resolved && resolved.error).toMatch(/routed drive/);
  });

  it('turns down renaming a resolved endpoint without a placeId, and keeps an unrenamed one', () => {
    const resolvedEnds = {
      ...drive,
      from: { id: 'place_anc', label: 'Anchorage' },
      to: { id: 'place_sew', label: 'Seward' },
    };
    const trip = { ...data, transits: [resolvedEnds] };
    const guessed = resolveProposalDraft(
      edit({}, { from: { label: 'Anchorage' }, to: { label: 'Whittier' } }),
      trip,
    );
    expect(guessed).toHaveProperty('error', expect.stringContaining('placeId place_sew'));

    const searched = resolveProposalDraft(
      edit({}, { from: { label: 'Anchorage' }, to: { placeId: 'place_whit', label: 'Whittier' } }),
      trip,
    );
    expect(searched).toMatchObject({
      draft: {
        from: { id: 'place_anc', label: 'Anchorage' },
        to: { id: 'place_whit', label: 'Whittier' },
      },
    });
  });

  it('rejects an unknown route or variant', () => {
    expect(resolveProposalDraft(edit({ routeId: 'nope' }), data)).toHaveProperty('error');
    expect(
      resolveProposalDraft(edit({ routeId: 'route_a', routeVariant: 'coastal' }), data),
    ).toHaveProperty('error');
    expect(resolveProposalDraft(edit({ routeVariant: 'scenic' }), data)).toHaveProperty('error');
  });

  it("gives a new routed drive the route's endpoints and the drive mode", () => {
    const resolved = resolveProposalDraft(
      {
        change: {
          kind: 'transit',
          key: 'new',
          legId: 'leg_a',
          date: '2027-07-14',
          changes: { departsAt: '2027-07-14T08:00' },
          why: 's',
        },
        routeId: 'route_a',
        summary: 's',
      },
      data,
    );
    expect(resolved).toMatchObject({
      draft: { from: route.from, to: route.to, mode: 'drive', routeId: 'route_a' },
    });
  });

  it('lists routes and tags routed drives in the itinerary', () => {
    const routed = { ...drive, routeId: 'route_a', routeVariant: 'scenic' };
    const context = buildTripContext({ ...data, transits: [routed] });
    expect(context).toContain('[route: route_a, variant scenic]');
    expect(context).toContain('Route route_a: Anchorage → Seward');
  });
});

describe('propose_edit naming travelers', () => {
  const flight: Transit = {
    _id: 'tr_fl',
    legId: 'leg_a',
    journeyId: null,
    travelers: ['t_a', 't_b'],
    scenarioId: null,
    status: 'planning',
    mode: 'flight',
    from: { id: null, label: 'Hometown' },
    to: { id: null, label: 'Faraway' },
    departsAt: '2027-07-14T08:00',
    arrivesAt: '2027-07-14T11:00',
    routeId: null,
    routeVariant: null,
    bookingId: null,
    images: [],
  };
  const data: TripData = {
    ...tripData(),
    trip: {
      _id: 'trip_x',
      name: 'X',
      images: [],
      travelers: [
        { id: 't_a', name: 'Alex Tester' },
        { id: 't_b', name: 'Sam Tester' },
        { id: 't_c', name: 'Kim Tester' },
      ],
    },
    transits: [flight],
  };

  const travelersEdit = (travelers: string[], newTravelers?: ProposedEdit['newTravelers']) => ({
    change: { kind: 'transit' as const, entityId: 'tr_fl', changes: { travelers }, why: 's' },
    newTravelers,
    summary: 's',
  });

  it('adds a passenger the trip doesn’t have as a new traveler', () => {
    const resolved = resolveProposalDraft(
      travelersEdit(['t_a', 'trav_pat_stranger'], [{ name: 'Pat Stranger' }]),
      data,
    );
    if ('error' in resolved) throw new Error(resolved.error);
    expect(resolved.travelers).toEqual([{ id: 'trav_pat_stranger', name: 'Pat Stranger' }]);
    expect((resolved.draft as Transit).travelers).toEqual(['t_a', 'trav_pat_stranger']);
  });

  it('points a new traveler the trip already has, in any case, at who’s there', () => {
    const withPat = {
      ...data,
      trip: {
        ...data.trip,
        travelers: [...data.trip.travelers, { id: 't_pat', name: 'pat guest' }],
      },
    };
    const resolved = resolveProposalDraft(
      travelersEdit(['t_a', 'trav_pat_guest'], [{ name: 'Pat Guest' }]),
      withPat,
    );
    if ('error' in resolved) throw new Error(resolved.error);
    expect(resolved.travelers).toEqual([]);
    expect((resolved.draft as Transit).travelers).toEqual(['t_a', 't_pat']);
  });

  it('turns down a traveler id the trip doesn’t have, saying which', () => {
    expect(resolveProposalDraft(travelersEdit(['t_zzz']), data)).toEqual({
      error: "The AI's suggestion no longer fits the trip: No traveler t_zzz on the trip.",
    });
  });
});

describe('place ids from earlier turns', () => {
  it('accepts a place a search in an earlier turn found', async () => {
    const earlier: AskAIConversation = {
      ...startConversation(tripData()),
      placeSearches: { placeIds: ['p_found'], emptyQueries: [] },
      apiMessages: [
        { role: 'user', content: 'Where could we eat?' },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tu_0', name: 'search_places', input: { query: 'cafe' } },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_0',
              content: 'Found Café — 1 Main St (placeId p_found)',
            },
          ],
        },
        { role: 'assistant', content: [{ type: 'text', text: 'Found Café is close.' }] },
      ],
    };
    stubTurns(
      sse(
        [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'propose_edit',
            input: {
              kind: 'activity',
              entityId: 'act_1',
              changes: { place: { placeId: 'p_found', label: 'Found Café' } },
              summary: 'Kayak at the café instead',
            },
          },
        ],
        'tool_use',
      ),
      sse([{ type: 'text', text: 'Proposed.' }], 'end_turn'),
    );
    const after = await turn(earlier, 'Use that café');
    expect(after.messages.at(-1)?.proposals).toHaveLength(1);
  });
});

describe('add_traveler in the chat', () => {
  it('adds someone new and hands a proposal naming them their real id', async () => {
    stubTurns(
      sse(
        [
          { type: 'tool_use', id: 'tu_1', name: 'add_traveler', input: { name: 'Pat Guest' } },
          {
            type: 'tool_use',
            id: 'tu_2',
            name: 'propose_edit',
            input: {
              kind: 'activity',
              entityId: 'act_1',
              changes: { travelers: ['trav_pat_guest'] },
              summary: 'Pat joins the kayak tour',
            },
          },
        ],
        'tool_use',
      ),
      sse([{ type: 'text', text: 'Proposed.' }], 'end_turn'),
    );
    const after = await turn(startConversation(tripData()), 'Pat Guest is coming kayaking');
    const [proposal] = after.messages.at(-1)?.proposals ?? [];
    expect(proposal).toMatchObject({
      type: 'edit',
      edit: { newTravelers: [{ id: 'trav_pat_guest', name: 'Pat Guest' }] },
    });
    if (proposal?.type !== 'edit') throw new Error('expected an edit');
    const resolved = resolveProposalDraft(proposal.edit, tripData());
    if ('error' in resolved) throw new Error(resolved.error);
    expect(resolved.travelers).toEqual([{ id: 'trav_pat_guest', name: 'Pat Guest' }]);
  });
});

describe('a day plan', () => {
  it('turns down a place id no search found, so the model can look it up', async () => {
    const bodies = stubTurns(
      sse(
        [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'propose_day_plan',
            input: {
              date: '2027-07-14',
              legId: 'leg_a',
              summary: 'Lunch',
              changes: [
                {
                  changes: {
                    text: 'Lunch',
                    startAt: '2027-07-14T12:00',
                    place: { label: 'Made up', placeId: 'p_invented' },
                  },
                },
              ],
            },
          },
        ],
        'tool_use',
      ),
      sse([{ type: 'text', text: 'Let me search.' }], 'end_turn'),
    );
    const after = await turn(startConversation(tripData()), 'Add lunch');
    expect(after.messages.at(-1)?.proposals ?? []).toEqual([]);
    const result = (
      bodies[1].messages as { content: { is_error?: boolean; content: string }[] }[]
    ).at(-1)!.content[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/placeId p_invented/);
  });

  it('turns down a plan that both changes and removes one activity', async () => {
    const bodies = stubTurns(
      sse(
        [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'propose_day_plan',
            input: {
              date: '2027-07-14',
              legId: 'leg_a',
              summary: 'Shuffle',
              changes: [{ entityId: 'act_1', changes: { startAt: '2027-07-14T15:00' } }],
              remove: ['act_1'],
            },
          },
        ],
        'tool_use',
      ),
      sse([{ type: 'text', text: 'Fixed.' }], 'end_turn'),
    );
    await turn(startConversation(tripData()), 'Shuffle');
    const result = (
      bodies[1].messages as { content: { is_error?: boolean; content: string }[] }[]
    ).at(-1)!.content[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/act_1 is both changed and removed/);
  });

  it('turns down removing an activity that is on another day', async () => {
    const bodies = stubTurns(
      sse(
        [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'propose_day_plan',
            input: { date: '2027-07-15', legId: 'leg_a', summary: 'Clear', remove: ['act_1'] },
          },
        ],
        'tool_use',
      ),
      sse([{ type: 'text', text: 'Fixed.' }], 'end_turn'),
    );
    await turn(startConversation(tripData()), 'Clear');
    const result = (
      bodies[1].messages as { content: { is_error?: boolean; content: string }[] }[]
    ).at(-1)!.content[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/act_1 isn't on 2027-07-15/);
  });

  it('turns down changing an activity that is on another day', async () => {
    const bodies = stubTurns(
      sse(
        [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'propose_day_plan',
            input: {
              date: '2027-07-15',
              legId: 'leg_a',
              summary: 'Shuffle',
              changes: [{ entityId: 'act_1', changes: { startAt: '2027-07-15T15:00' } }],
            },
          },
        ],
        'tool_use',
      ),
      sse([{ type: 'text', text: 'Fixed.' }], 'end_turn'),
    );
    await turn(startConversation(tripData()), 'Shuffle');
    const result = (
      bodies[1].messages as { content: { is_error?: boolean; content: string }[] }[]
    ).at(-1)!.content[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/act_1 isn't on 2027-07-15/);
  });

  it('turns down an alternative whose ideal entries are on another day', async () => {
    const bodies = stubTurns(
      sse(
        [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'propose_alternative',
            input: {
              date: '2027-07-15',
              legId: 'leg_a',
              summary: 'Rainy',
              label: 'Grounded',
              idealLabel: 'As planned',
              idealEntityIds: ['act_1'],
              entries: [{ text: 'Museum' }],
            },
          },
        ],
        'tool_use',
      ),
      sse([{ type: 'text', text: 'Fixed.' }], 'end_turn'),
    );
    await turn(startConversation(tripData()), 'Rainy day');
    const result = (
      bodies[1].messages as { content: { is_error?: boolean; content: string }[] }[]
    ).at(-1)!.content[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/act_1 isn't an activity or drive on 2027-07-15/);
  });

  it('turns down a new plan entry dated on another day', async () => {
    const bodies = stubTurns(
      sse(
        [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'propose_day_plan',
            input: {
              date: '2027-07-14',
              legId: 'leg_a',
              summary: 'Add',
              changes: [{ date: '2027-07-20', changes: { text: 'Dinner' } }],
            },
          },
        ],
        'tool_use',
      ),
      sse([{ type: 'text', text: 'Fixed.' }], 'end_turn'),
    );
    await turn(startConversation(tripData()), 'Add dinner');
    const result = (
      bodies[1].messages as { content: { is_error?: boolean; content: string }[] }[]
    ).at(-1)!.content[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/must be on that date and leg/);
  });

  it('turns down removing an activity another one is covered by', async () => {
    const data = tripData();
    data.activities.push({
      ...data.activities[0],
      _id: 'act_meal',
      includedIn: { entity: 'activity', id: 'act_1' },
    });
    const bodies = stubTurns(
      sse(
        [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'propose_day_plan',
            input: { date: '2027-07-14', legId: 'leg_a', summary: 'Clear', remove: ['act_1'] },
          },
        ],
        'tool_use',
      ),
      sse([{ type: 'text', text: 'Fixed.' }], 'end_turn'),
    );
    await turn(startConversation(data), 'Clear', data);
    const result = (
      bodies[1].messages as { content: { is_error?: boolean; content: string }[] }[]
    ).at(-1)!.content[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/act_meal is covered by act_1, which is being removed/);
  });

  it('applies only the items left checked: a move, an addition, a removal', () => {
    const data = tripData();
    const plan: ProposedDayPlan = {
      date: '2027-07-14',
      legId: 'leg_a',
      summary: 'Shuffle',
      changes: [
        { kind: 'activity', entityId: 'act_1', changes: { startAt: '2027-07-14T15:00' }, why: 's' },
        {
          kind: 'activity',
          legId: 'leg_a',
          date: '2027-07-14',
          changes: { text: 'Coffee', startAt: '2027-07-14T08:00' },
          why: 's',
        },
      ],
      remove: ['act_1'],
    };
    expect(describeDayPlan(plan, data)[0]).toMatch(/^Move /);
    expect(describeDayPlan(plan, data)[1]).toBe('+ Add "Coffee" at 8:00am');
    const applied = applyDayPlan(plan, data, new Set([0, 1]));
    if ('error' in applied) throw new Error(applied.error);
    expect(applied.data.activities.find((a) => a._id === 'act_1')?.startAt).toBe(
      '2027-07-14T15:00',
    );
    expect(applied.data.activities.some((a) => a.text === 'Coffee')).toBe(true);
    const removed = applyDayPlan(plan, data, new Set([2]));
    if ('error' in removed) throw new Error(removed.error);
    expect(removed.data.activities.some((a) => a._id === 'act_1')).toBe(false);
  });

  it('refuses a removal that leaves a kept meal pointing at it', () => {
    const data = tripData();
    data.activities.push({
      ...data.activities[0],
      _id: 'act_meal',
      includedIn: { entity: 'activity', id: 'act_1' },
    });
    const plan: ProposedDayPlan = {
      date: '2027-07-14',
      legId: 'leg_a',
      summary: 'Clear',
      changes: [{ kind: 'activity', entityId: 'act_meal', changes: { text: 'Lunch' }, why: 's' }],
      remove: ['act_1'],
    };
    // Only the removal is left checked, so the meal keeps its cover reference.
    const refused = applyDayPlan(plan, data, new Set([1]));
    expect('error' in refused && refused.error).toMatch(/act_meal is covered by act_1/);
    // Removing the covered meal too leaves nothing pointing at it.
    const both = { ...plan, changes: [], remove: ['act_1', 'act_meal'] };
    expect('error' in applyDayPlan(both, data, new Set([0, 1]))).toBe(false);
  });
});

// A day plan's rules are checked the same way whenever it is applied: its scope
// by one shared check (proposals.ts's dayPlanErrors), and what applying leaves
// broken by applying it (applyBatch). The plan is checked when proposed (the
// tool-call tests above) and again when its checked items are applied, so what
// the user reviews and what is applied can't disagree. Each hostile plan must be
// refused on apply, with the rule's own message.
describe('day plan parity', () => {
  const data = () => {
    const d = tripData();
    d.activities.push(
      {
        ...d.activities[0],
        _id: 'act_other_day',
        startAt: '2027-07-20T09:00',
      },
      { ...d.activities[0], _id: 'act_same_day', startAt: '2027-07-14T18:00' },
      { ...d.activities[0], _id: 'act_meal', includedIn: { entity: 'activity', id: 'act_1' } },
    );
    return d;
  };
  const plan = (over: Partial<ProposedDayPlan>): ProposedDayPlan => ({
    date: '2027-07-14',
    legId: 'leg_a',
    summary: 'Plan',
    changes: [],
    remove: [],
    ...over,
  });
  type PlanChange = ProposedDayPlan['changes'][number];
  const update = (
    entityId: string,
    changes: PlanChange['changes'] = { text: 'Changed' },
  ): PlanChange => ({ kind: 'activity', entityId, changes, why: 's' });
  const addEntry = (changes: PlanChange['changes'], date = '2027-07-14'): PlanChange => ({
    kind: 'activity',
    legId: 'leg_a',
    date,
    changes,
    why: 's',
  });
  // A meal's change to be covered by another activity.
  const cover = (includedWith: string) => ({
    diningFormat: 'included-with-activity' as const,
    includedWith,
  });
  // The trip, with the meal's cover moved onto `n` of its candidate options.
  const mealWithOptions = (n: number) => {
    const d = data();
    const meal = d.activities.find((a) => a._id === 'act_meal')!;
    meal.includedIn = null;
    meal.options = Array.from({ length: n }, (_, i) => ({
      _id: `opt_${i + 1}`,
      diningFormat: 'included-with-activity' as const,
      place: null,
      includedIn: { entity: 'activity' as const, id: 'act_1' },
      bookingId: null,
    }));
    return d;
  };
  // [name, plan, whether dayPlanErrors (the scope check) is what refuses it, the refusal]
  const hostile: [string, ProposedDayPlan, boolean, RegExp][] = [
    ['removing another day’s activity', plan({ remove: ['act_other_day'] }), true, /isn't on/],
    [
      'changing another day’s activity',
      plan({ changes: [update('act_other_day')] }),
      true,
      /isn't on/,
    ],
    ['removing a non-id', plan({ remove: [5 as never] }), true, /activity ids/],
    [
      'changing and removing the same activity',
      plan({ changes: [update('act_1')], remove: ['act_1'] }),
      true,
      /both changed and removed/,
    ],
    [
      'adding an entry on another date',
      plan({ changes: [addEntry({ text: 'x' }, '2027-07-20')] }),
      true,
      /must be on that date/,
    ],
    [
      'changing the same activity twice',
      plan({ changes: [update('act_1'), update('act_1', { text: 'Again' })] }),
      false,
      /combine them/,
    ],
    [
      'removing what a kept meal is covered by',
      plan({ remove: ['act_1'] }),
      false,
      /act_meal is covered by act_1/,
    ],
    [
      'adding an entry covered by a removal',
      plan({
        changes: [addEntry({ text: 'Lunch', ...cover('act_1') })],
        remove: ['act_1', 'act_meal'],
      }),
      false,
      /is covered by act_1, which is being removed/,
    ],
    [
      'moving a meal onto an activity the plan also removes',
      plan({
        changes: [update('act_meal', cover('act_same_day'))],
        remove: ['act_1', 'act_same_day'],
      }),
      false,
      /act_meal is covered by act_same_day/,
    ],
  ];

  it.each(hostile)('refuses %s', (_name, hostilePlan, byScope, message) => {
    const applied = applyDayPlan(hostilePlan, data());
    expect('error' in applied && applied.error).toMatch(message);
    if (byScope) {
      // The refusal is the shared scope check's own.
      expect('error' in applied && applied.error).toContain(dayPlanErrors(hostilePlan, data())[0]);
    }
  });

  it('refuses a checked subset that leaves a meal pointing at a removal', () => {
    const subset = plan({
      changes: [update('act_meal', { diningFormat: 'self-catered' })],
      remove: ['act_1'],
    });
    expect('data' in applyDayPlan(subset, data(), new Set([0, 1]))).toBe(true);
    // Only the removal is left checked: the meal keeps its cover.
    const refused = applyDayPlan(subset, data(), new Set([1]));
    expect('error' in refused && refused.error).toMatch(/act_meal is covered by act_1/);
  });

  it('names the removed cover once per meal, however many candidate options rely on it', () => {
    for (const n of [1, 3]) {
      const result = applyDayPlan(plan({ remove: ['act_1'] }), mealWithOptions(n));
      const message = 'error' in result ? result.error : '';
      expect(message).toMatch(
        /a candidate of act_meal is covered by act_1, which is being removed/,
      );
      expect(message.match(/is covered by/g)).toHaveLength(1);
    }
  });

  it('refuses a removal of an activity that is not there when proposed, and says nothing is left when applied', () => {
    const proposal = plan({ remove: ['act_nope'] });
    expect(dayPlanErrors(proposal, data()).join()).toMatch(/No activity act_nope to remove/);
    const applied = applyDayPlan(proposal, data());
    expect('error' in applied && applied.error).toMatch(/Nothing left to apply/);
  });

  it('names an off-day activity once, however often the plan lists it', () => {
    const [message] = dayPlanErrors(
      plan({ changes: [update('act_other_day')], remove: ['act_other_day', 'act_other_day'] }),
      data(),
    );
    expect(message).toMatch(/^act_other_day isn't on/);
  });

  it('says so when the only checked removal is already done, and applies the rest', () => {
    const onlyDone = applyDayPlan(plan({ remove: ['act_already_gone'] }), data());
    expect('error' in onlyDone && onlyDone.error).toMatch(
      /Nothing left to apply.*act_already_gone/,
    );
    // The unchecked item doesn't count: with nothing checked there is nothing to refuse.
    const none = applyDayPlan(plan({ remove: ['act_already_gone'] }), data(), new Set());
    expect('data' in none).toBe(true);
  });

  it('names a missing activity once, however often the plan lists it', () => {
    const [message] = dayPlanErrors(plan({ remove: ['act_nope', 'act_nope'] }), data());
    expect(message).toBe('No activity act_nope to remove.');
  });

  it('tells whoever reads a refused cover how to resolve it', () => {
    const result = applyDayPlan(plan({ remove: ['act_1'] }), data());
    expect('error' in result && result.error).toMatch(
      /Keep act_1, take act_meal off it \(change its includedWith or diningFormat\), or remove act_meal too\./,
    );
  });

  it('still applies the checked changes when a checked removal is already done', () => {
    const result = applyDayPlan(
      plan({ changes: [update('act_1', { text: 'Changed' })], remove: ['act_already_gone'] }),
      data(),
    );
    if ('error' in result) throw new Error(result.error);
    expect(result.data.activities.find((a) => a._id === 'act_1')?.text).toBe('Changed');
  });

  it('checks a new entry against the plan whether or not its leg and date were filled in', () => {
    const bare = { kind: 'activity', changes: { text: 'x' }, why: 's' } as PlanChange;
    expect(dayPlanErrors(plan({ changes: [bare] }), data())).toEqual([]);
    expect(
      dayPlanErrors(plan({ changes: [{ ...bare, date: '2027-07-20' }] }), data()),
    ).toHaveLength(1);
    expect(dayPlanErrors(plan({ changes: [{ ...bare, legId: 'leg_a' }] }), data())).toEqual([]);
  });

  it('reports every scope rule a plan breaks at once', () => {
    const result = applyDayPlan(
      plan({
        changes: [update('act_1'), addEntry({ text: 'x' }, '2027-07-20')],
        remove: ['act_1', 'act_other_day', 7 as never],
      }),
      data(),
    );
    const message = 'error' in result ? result.error : '';
    for (const part of [
      /activity ids/,
      /must be on that date/,
      /act_other_day isn't on/,
      /act_1 is both changed and removed/,
    ]) {
      expect(message).toMatch(part);
    }
  });

  it('refuses a change to an activity the trip no longer has', () => {
    const result = applyDayPlan(plan({ changes: [update('act_deleted')] }), data());
    expect('error' in result && result.error).toMatch(/act_deleted/);
  });

  it('refuses applying once the trip has moved an activity off the day', () => {
    const moved = data();
    moved.activities.find((a) => a._id === 'act_1')!.startAt = '2027-07-21T09:00';
    const result = applyDayPlan(plan({ changes: [update('act_1')] }), moved);
    expect('error' in result && result.error).toMatch(/isn't on 2027-07-14/);
  });

  it('accepts removing a cover when the plan moves the meal off it', () => {
    const move = (changes: PlanChange['changes']) =>
      plan({ changes: [update('act_meal', changes)], remove: ['act_1'] });
    expect('data' in applyDayPlan(move({ diningFormat: 'self-catered' }), data())).toBe(true);
    expect('data' in applyDayPlan(move(cover('act_same_day')), data())).toBe(true);
    // Anything else about the meal leaves it pointing at the removed cover.
    const refused = applyDayPlan(move({ text: 'Lunch' }), data());
    expect('error' in refused && refused.error).toMatch(/act_meal is covered by act_1/);
  });

  it('accepts a plan that stays on its day', () => {
    const ok = plan({ changes: [update('act_1')] });
    expect(dayPlanErrors(ok, data())).toEqual([]);
    expect('data' in applyDayPlan(ok, data())).toBe(true);
  });
});
