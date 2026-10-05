import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type AskAIConversation,
  buildTripContext,
  type ProposedEdit,
  resolveProposalDraft,
  runAskAITurn,
  startConversation,
} from './askAI';
import type { AskAIToolContext } from './askAITools';
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

function tools(data: TripData): AskAIToolContext {
  return {
    data,
    view: { dateRange: { startDate: '2027-07-14', endDate: '2027-07-14' } } as TripView,
    byDate: new Map([[DAY.date, DAY]]),
  };
}

function turn(conversation: AskAIConversation | null, question: string, data = tripData()) {
  return runAskAITurn(conversation, { question, data, tools: tools(data), apiKey: 'sk-test' });
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
      apiKey: 'sk-test',
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
              startAt: '2027-07-14T10:00',
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
          kind: 'activity',
          entityId: 'act_1',
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
              ops: [
                {
                  op: 'add',
                  text: 'Dinner',
                  startAt: '2027-07-14T18:30',
                  mealType: 'dinner',
                  mealOptions: [{ placeLabel: 'Orso' }, { placeLabel: "Crow's Nest" }],
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
              activities: [{ text: 'Anchorage Museum', startAt: '2027-07-14T13:00' }],
            },
          },
        ],
        'tool_use',
      ),
      sse([{ type: 'text', text: 'Proposed both.' }], 'end_turn'),
    );
    const after = await turn(startConversation(tripData()), 'Plan dinner and a grounded day');
    const reply = after.messages.at(-1)!;
    // One list, in the order the assistant proposed them, each keyed by its tool call.
    const [plan, alternative] = reply.proposals ?? [];
    expect(plan).toMatchObject({ id: 'tu_1', type: 'dayPlan' });
    expect(plan.type === 'dayPlan' && plan.plan.ops[0]).toMatchObject({
      op: 'add',
      mealType: 'dinner',
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
  const edit = (extra: Partial<ProposedEdit>): ProposedEdit => ({
    kind: 'transit',
    entityId: 'tr_1',
    summary: 's',
    fields: { kind: 'transit' },
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
      edit({ routeId: '', fields: { kind: 'transit', endAt: '2027-07-14T11:30' } }),
      { ...data, transits: [routed] },
    );
    expect(resolved).toMatchObject({
      draft: { routeId: null, routeVariant: null, arrivesAt: '2027-07-14T11:30' },
    });
  });

  it('never stores an arrival on a drive that stays on its route', () => {
    const routed = { ...drive, routeId: 'route_a', routeVariant: 'scenic', arrivesAt: null };
    const resolved = resolveProposalDraft(
      edit({ fields: { kind: 'transit', endAt: '2027-07-14T12:00' } }),
      { ...data, transits: [routed] },
    );
    expect(resolved).toMatchObject({ draft: { routeId: 'route_a', arrivesAt: null } });
  });

  it('drops a renamed endpoint’s old place id, and keeps an unrenamed one', () => {
    const resolvedEnds = {
      ...drive,
      from: { id: 'place_anc', label: 'Anchorage' },
      to: { id: 'place_sew', label: 'Seward' },
    };
    const resolved = resolveProposalDraft(
      edit({ fields: { kind: 'transit', fromLabel: 'Anchorage', toLabel: 'Whittier' } }),
      { ...data, transits: [resolvedEnds] },
    );
    expect(resolved).toMatchObject({
      draft: {
        from: { id: 'place_anc', label: 'Anchorage' },
        to: { id: null, label: 'Whittier' },
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
        kind: 'transit',
        legId: 'leg_a',
        date: '2027-07-14',
        routeId: 'route_a',
        summary: 's',
        fields: { kind: 'transit', startAt: '2027-07-14T08:00' },
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

  it('adds an unrecognized passenger as a new traveler instead of resetting to the whole party', () => {
    const resolved = resolveProposalDraft(
      {
        kind: 'transit',
        entityId: 'tr_fl',
        summary: 's',
        fields: { kind: 'transit', travelerNames: ['STRANGER/PAT MS'] },
      },
      data,
    );
    if ('error' in resolved) throw new Error(resolved.error);
    expect(resolved.travelers).toEqual([{ id: expect.any(String), name: 'Pat Stranger' }]);
    expect((resolved.draft as Transit).travelers).toEqual([resolved.travelers[0].id]);
  });

  it('matches a manifest-style name to the traveler it already is', () => {
    const resolved = resolveProposalDraft(
      {
        kind: 'transit',
        entityId: 'tr_fl',
        summary: 's',
        fields: { kind: 'transit', travelerNames: ['TESTER/KIM MRS'] },
      },
      data,
    );
    if ('error' in resolved) throw new Error(resolved.error);
    expect(resolved.travelers).toEqual([]);
    expect((resolved.draft as Transit).travelers).toEqual(['t_c']);
  });
});
