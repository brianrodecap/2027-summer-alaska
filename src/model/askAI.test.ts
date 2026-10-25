import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { describe, expect, it } from 'vitest';

import { fakeAnthropic, fakeMessage, streamedBody } from '../test/fakeAnthropic';
import { TEST_TODAY } from '../test/today';
import type { StreamMessage } from './anthropicClient';
import {
  applyDayPlan,
  type AskAIConversation,
  AskAIError,
  askAIStream,
  type AskAITurnInput,
  buildTripContext,
  describeDayPlan,
  type ProposedDayPlan,
  type ProposedEdit,
  resolveProposalDraft,
  runAskAITurn,
  startConversation,
} from './askAI';
import { dayPlanErrors } from './proposals';
import type { Booking, Day, Route, Transit, TripData, TripView } from './types';

// Each queued reply is one request's whole response, handed back by a stub stream;
// nothing reaches the API.

// A stream answering each request with the next reply, and each request as it was
// sent; the stream hands each reply's text and thinking to the handlers.
function stubTurns(...replies: BetaMessage[]) {
  const bodies: Record<string, unknown>[] = [];
  const stream: StreamMessage = async (request, handlers) => {
    bodies.push(structuredClone(request) as Record<string, unknown>);
    const next = replies.shift();
    if (!next) throw new Error('No more stubbed replies');
    for (const block of next.content) {
      if (block.type === 'text') handlers.onText?.(block.text);
      if (block.type === 'thinking') handlers.onThinking?.(block.thinking);
    }
    return next;
  };
  return { bodies, stream };
}

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

function tools(data: TripData): AskAITurnInput['tools'] {
  return {
    data,
    view: { dateRange: { startDate: '2027-07-14', endDate: '2027-07-14' } } as TripView,
    byDate: new Map([[DAY.date, DAY]]),
    today: TEST_TODAY,
  };
}

function turn(
  stream: StreamMessage,
  conversation: AskAIConversation | null,
  question: string,
  data = tripData(),
) {
  return runAskAITurn(conversation, { question, data, tools: tools(data), stream });
}

describe('runAskAITurn', () => {
  it('hands the streamed answer and progress notes to the turn’s events', async () => {
    const { stream } = stubTurns(
      fakeMessage(
        [
          { type: 'thinking', thinking: 'Checking the 14th.', signature: 'sig' },
          { type: 'text', text: 'Bring rain gear.' },
        ],
        'end_turn',
      ),
    );
    const text: string[] = [];
    const progress: string[] = [];
    await runAskAITurn(null, {
      question: 'Anything for the 14th?',
      data: tripData(),
      tools: tools(tripData()),
      events: { onText: (t) => text.push(t), onProgress: (t) => progress.push(t) },
      stream,
    });
    expect(text.join('')).toBe('Bring rain gear.');
    expect(progress.join('')).toBe('Checking the 14th.');
  });

  it('runs a lookup, feeds the result back, and passes thinking blocks back unchanged', async () => {
    const { bodies, stream } = stubTurns(
      fakeMessage(
        [
          { type: 'thinking', thinking: 'Checking the 14th.', signature: 'sig' },
          { type: 'tool_use', id: 'tu_1', name: 'get_day', input: { date: '2027-07-14' } },
        ],
        'tool_use',
      ),
      fakeMessage([{ type: 'text', text: 'Bring rain gear on the 14th.' }], 'end_turn'),
    );
    const start = startConversation(tripData());
    const lookups: string[] = [];
    const after = await runAskAITurn(start, {
      question: 'Anything to know about the 14th?',
      data: tripData(),
      tools: tools(tripData()),
      events: { onLookup: (label) => lookups.push(label) },
      stream,
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
    const { bodies, stream } = stubTurns(
      fakeMessage(
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
      fakeMessage(
        [{ type: 'text', text: 'I proposed moving the kayak tour to 10am.' }],
        'end_turn',
      ),
    );
    const after = await turn(stream, startConversation(tripData()), 'Move the kayak later');

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
    const { stream } = stubTurns(
      fakeMessage(
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
      fakeMessage([{ type: 'text', text: 'Proposed both.' }], 'end_turn'),
    );
    const searched = {
      ...startConversation(tripData()),
      placeSearches: { placeIds: ['p_orso', 'p_crows_nest'], emptyQueries: [] },
    };
    const after = await turn(stream, searched, 'Plan dinner and a grounded day');
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
    const { bodies, stream } = stubTurns(
      fakeMessage([{ type: 'text', text: 'Hello.' }], 'end_turn'),
    );
    const after = await turn(stream, null, 'Hi');
    expect(after.system).toBe(startConversation(tripData()).system);
    const sent = bodies[0].messages as { role: string }[];
    expect(sent.map((m) => m.role)).toEqual(['user']);
  });

  it('returns a malformed tool input to the model as an error it can correct', async () => {
    const { bodies, stream } = stubTurns(
      fakeMessage(
        [{ type: 'tool_use', id: 'tu_1', name: 'get_day', input: { date: 'July 14' } }],
        'tool_use',
      ),
      fakeMessage([{ type: 'text', text: 'Sorry, which day?' }], 'end_turn'),
    );
    await turn(stream, startConversation(tripData()), 'What about that day?');

    const result = (
      bodies[1].messages as { content: { is_error?: boolean; content: string }[] }[]
    )[2].content[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('YYYY-MM-DD');
  });

  it('keeps history append-only and announces trip edits in an appended system message', async () => {
    const { bodies, stream } = stubTurns(
      fakeMessage([{ type: 'text', text: 'First answer.' }], 'end_turn'),
      fakeMessage([{ type: 'text', text: 'Second answer.' }], 'end_turn'),
    );
    const first = await turn(stream, startConversation(tripData()), 'First question');
    const edited = tripData('Glacier kayak tour');
    const second = await turn(stream, first, 'Second question', edited);

    const sent = bodies[1] as { system: { text: string }[]; messages: unknown[] };
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
    const { bodies, stream } = stubTurns(
      fakeMessage([{ type: 'text', text: 'One.' }], 'end_turn'),
      fakeMessage([{ type: 'text', text: 'Two.' }], 'end_turn'),
    );
    const first = await turn(stream, startConversation(tripData()), 'Q1');
    await turn(stream, first, 'Q2');
    const roles = (bodies[1].messages as { role: string }[]).map((m) => m.role);
    expect(roles).not.toContain('system');
  });

  it('tells the model to stop looking things up once the request limit is reached', async () => {
    const lookup = fakeMessage(
      [{ type: 'tool_use', id: 'tu', name: 'get_day', input: { date: '2027-07-14' } }],
      'tool_use',
    );
    const { bodies, stream } = stubTurns(
      ...Array.from({ length: 7 }, () => lookup),
      fakeMessage([{ type: 'text', text: 'Here is what I found.' }], 'end_turn'),
    );
    const after = await turn(stream, startConversation(tripData()), 'Dig deep');
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

  it('checks an arrival taken off the route on each end’s own clock, as every path does', () => {
    const routed = { ...drive, routeId: 'route_a', routeVariant: 'scenic', arrivesAt: null };
    // Reads earlier than the departure on the clock.
    const offRoute = edit({ routeId: '' }, { arrivesAt: `${drive.departsAt.slice(0, 10)}T06:00` });
    const unzoned = resolveProposalDraft(offRoute, { ...data, transits: [routed] });
    expect('error' in unzoned && unzoned.error).toMatch(
      /not after it departs .* give each its placeId from search_places/,
    );
    // From UTC+9 to UTC-8, 06:00 lands well after the departure.
    const zoned = {
      ...routed,
      from: { ...routed.from, timeZone: 'Asia/Tokyo' },
      to: { ...routed.to, timeZone: 'America/Anchorage' },
    };
    expect(resolveProposalDraft(offRoute, { ...data, transits: [zoned] })).toHaveProperty('draft');
  });

  it('checks an off-route arrival against the places the edit leaves, not the ones it replaces', () => {
    const zoned = {
      ...drive,
      routeId: 'route_a',
      routeVariant: 'scenic',
      arrivesAt: null,
      from: { ...drive.from, timeZone: 'Asia/Tokyo' },
      to: { ...drive.to, timeZone: 'America/Anchorage' },
    };
    // The new start has no zone, so 06:00 reads before the 08:00 departure.
    const swapped = edit(
      { routeId: '' },
      {
        arrivesAt: `${drive.departsAt.slice(0, 10)}T06:00`,
        from: { label: 'Somewhere new', notOnGoogle: true },
      },
    );
    const resolved = resolveProposalDraft(swapped, { ...data, transits: [zoned] });
    expect('error' in resolved && resolved.error).toMatch(/not after it departs/);
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

  it('tags a booked entry with its booking status, and an unbooked one with none', () => {
    const booked = { ...drive, bookingId: 'bk_1' };
    const bookings: Booking[] = [
      { _id: 'bk_1', status: 'booked', pricing: null, confirmationNumber: null },
    ];
    expect(buildTripContext({ ...data, transits: [booked], bookings })).toContain(
      'departs 2027-07-14T08:00 [booking booked]',
    );
    expect(buildTripContext(data)).not.toContain('[booking');
  });
});

describe('propose_edit naming travelers', () => {
  const flight: Transit = {
    _id: 'tr_fl',
    legId: 'leg_a',
    journeyId: null,
    travelers: ['t_a', 't_b'],
    scenarioId: null,
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
    const { stream } = stubTurns(
      fakeMessage(
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
      fakeMessage([{ type: 'text', text: 'Proposed.' }], 'end_turn'),
    );
    const after = await turn(stream, earlier, 'Use that café');
    expect(after.messages.at(-1)?.proposals).toHaveLength(1);
  });
});

describe('add_traveler in the chat', () => {
  it('adds someone new and hands a proposal naming them their real id', async () => {
    const { stream } = stubTurns(
      fakeMessage(
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
      fakeMessage([{ type: 'text', text: 'Proposed.' }], 'end_turn'),
    );
    const after = await turn(stream, startConversation(tripData()), 'Pat Guest is coming kayaking');
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
    const { bodies, stream } = stubTurns(
      fakeMessage(
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
      fakeMessage([{ type: 'text', text: 'Let me search.' }], 'end_turn'),
    );
    const after = await turn(stream, startConversation(tripData()), 'Add lunch');
    expect(after.messages.at(-1)?.proposals ?? []).toEqual([]);
    const result = (
      bodies[1].messages as { content: { is_error?: boolean; content: string }[] }[]
    ).at(-1)!.content[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/placeId p_invented/);
  });

  it('turns down a plan that both changes and removes one activity', async () => {
    const { bodies, stream } = stubTurns(
      fakeMessage(
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
      fakeMessage([{ type: 'text', text: 'Fixed.' }], 'end_turn'),
    );
    await turn(stream, startConversation(tripData()), 'Shuffle');
    const result = (
      bodies[1].messages as { content: { is_error?: boolean; content: string }[] }[]
    ).at(-1)!.content[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/act_1 is both changed and removed/);
  });

  it('turns down removing an activity that is on another day', async () => {
    const { bodies, stream } = stubTurns(
      fakeMessage(
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
      fakeMessage([{ type: 'text', text: 'Fixed.' }], 'end_turn'),
    );
    await turn(stream, startConversation(tripData()), 'Clear');
    const result = (
      bodies[1].messages as { content: { is_error?: boolean; content: string }[] }[]
    ).at(-1)!.content[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/act_1 isn't on 2027-07-15/);
  });

  it('turns down changing an activity that is on another day', async () => {
    const { bodies, stream } = stubTurns(
      fakeMessage(
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
      fakeMessage([{ type: 'text', text: 'Fixed.' }], 'end_turn'),
    );
    await turn(stream, startConversation(tripData()), 'Shuffle');
    const result = (
      bodies[1].messages as { content: { is_error?: boolean; content: string }[] }[]
    ).at(-1)!.content[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/act_1 isn't on 2027-07-15/);
  });

  it('turns down an alternative whose ideal entries are on another day', async () => {
    const { bodies, stream } = stubTurns(
      fakeMessage(
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
      fakeMessage([{ type: 'text', text: 'Fixed.' }], 'end_turn'),
    );
    await turn(stream, startConversation(tripData()), 'Rainy day');
    const result = (
      bodies[1].messages as { content: { is_error?: boolean; content: string }[] }[]
    ).at(-1)!.content[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/act_1 isn't an activity or drive on 2027-07-15/);
  });

  it('turns down a new plan entry dated on another day', async () => {
    const { bodies, stream } = stubTurns(
      fakeMessage(
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
      fakeMessage([{ type: 'text', text: 'Fixed.' }], 'end_turn'),
    );
    await turn(stream, startConversation(tripData()), 'Add dinner');
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
    const { bodies, stream } = stubTurns(
      fakeMessage(
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
      fakeMessage([{ type: 'text', text: 'Fixed.' }], 'end_turn'),
    );
    await turn(stream, startConversation(data), 'Clear', data);
    const result = (
      bodies[1].messages as { content: { is_error?: boolean; content: string }[] }[]
    ).at(-1)!.content[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/act_meal is covered by act_1, which is being removed/);
  });

  it('names a new clock in the review line, since it moves the start', () => {
    const plan = (changes: object): ProposedDayPlan => ({
      date: '2027-07-14',
      legId: 'leg_a',
      summary: 'Clock',
      changes: [{ kind: 'activity', entityId: 'act_1', changes, why: 's' }],
      remove: [],
    });
    const line = (changes: object) => describeDayPlan(plan(changes), tripData())[0];
    expect(line({ clockZone: 'America/Phoenix' })).toMatch(/ on America\/Phoenix time$/);
    expect(line({ startAt: '2027-07-14T10:00', clockZone: 'America/Phoenix' })).toMatch(
      /^Move .* 10:00am on America\/Phoenix time$/,
    );
    // Restating no clock on an activity that has none changes nothing.
    expect(line({ startAt: '2027-07-14T10:00', clockZone: null })).not.toMatch(/clock/);
    expect(
      describeDayPlan(
        {
          ...plan({}),
          changes: [
            {
              kind: 'activity',
              legId: 'leg_a',
              date: '2027-07-14',
              changes: { text: 'Tour', startAt: '2027-07-14T10:00', clockZone: 'America/Phoenix' },
              why: 's',
            },
          ],
        },
        tripData(),
      )[0],
    ).toBe('+ Add "Tour" at 10:00am on America/Phoenix time');
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
describe('place id parity', () => {
  const stop = { label: 'Scenic Overlook', placeId: 'ChIJmadeUp' };
  const message = (placeId: string, label: string) =>
    `placeId ${placeId} didn't come from search_places or the trip; search for "${label}"`;
  const route = (overrides: Record<string, unknown> = {}) => ({
    summary: 'Scenic drive',
    from: { label: 'Anchorage', placeId: 'p_anc' },
    to: { label: 'Seward', placeId: 'p_seward' },
    variants: [{ tone: 'scenic', label: 'Coastal', places: [{ kind: 'waypoint', ...stop }] }],
    ...overrides,
  });
  // One turn proposing `uses`, then a closing reply.
  const proposing = (...uses: { name: string; input: unknown }[]) =>
    stubTurns(
      fakeMessage(
        uses.map(({ name, input }, i) => ({ type: 'tool_use', id: `tu_${i}`, name, input })),
        'tool_use',
      ),
      fakeMessage([{ type: 'text', text: 'Done.' }], 'end_turn'),
    );
  const searched = (placeIds: string[], data = tripData()) => ({
    ...startConversation(data),
    placeSearches: { placeIds, emptyQueries: [] },
  });
  const results = (bodies: Record<string, unknown>[]) =>
    (bodies[1].messages as { content: { is_error?: boolean; content: string }[] }[])[2].content;
  const editPlace = {
    name: 'propose_edit',
    input: { kind: 'activity', entityId: 'act_1', changes: { place: stop }, summary: 's' },
  };

  it('turns down an id from no search the same way in an edit and a route', async () => {
    const { bodies, stream } = proposing(editPlace, { name: 'propose_route', input: route() });
    const after = await turn(stream, searched(['p_anc', 'p_seward']), 'Plan a drive');
    expect(after.messages.at(-1)?.proposals ?? []).toEqual([]);
    const refusal = expect.objectContaining({
      is_error: true,
      content: expect.stringContaining(message('ChIJmadeUp', 'Scenic Overlook')),
    });
    expect(results(bodies)).toEqual([refusal, refusal]);
  });

  it('turns down a route whose end has an id from no search', async () => {
    const { bodies, stream } = proposing({
      name: 'propose_route',
      input: route({ from: { label: 'Somewhere', placeId: 'ChIJfakeEnd' } }),
    });
    await turn(stream, searched(['p_seward', 'ChIJmadeUp']), 'Plan a drive');
    expect(results(bodies)[0].content).toContain(message('ChIJfakeEnd', 'Somewhere'));
  });

  it('names an unsearched id once, however many variants stop there', async () => {
    const twice = route({
      variants: ['scenic', 'direct'].map((tone) => ({
        tone,
        label: tone,
        places: [{ kind: 'waypoint', ...stop }],
      })),
    });
    const { bodies, stream } = proposing({ name: 'propose_route', input: twice });
    await turn(stream, searched(['p_anc', 'p_seward']), 'Plan a drive');
    expect(results(bodies)[0].content.split('ChIJmadeUp didn').length - 1).toBe(1);
  });

  it('takes an id that came from a search, in an edit and a route', async () => {
    const { stream } = proposing(editPlace, { name: 'propose_route', input: route() });
    const after = await turn(stream, searched(['p_anc', 'p_seward', 'ChIJmadeUp']), 'Plan a drive');
    expect(after.messages.at(-1)?.proposals).toEqual([
      expect.objectContaining({ type: 'edit' }),
      expect.objectContaining({ type: 'route' }),
    ]);
  });

  it('queues an edit, a day plan and an alternative with the searched zone, never one the AI states', async () => {
    const stated = { ...stop, timeZone: 'Fake/Zone' };
    const { stream } = proposing(
      {
        name: 'propose_edit',
        input: { kind: 'activity', entityId: 'act_1', changes: { place: stated }, summary: 's' },
      },
      {
        name: 'propose_day_plan',
        input: {
          date: '2027-07-14',
          legId: 'leg_a',
          summary: 'Overlook',
          changes: [{ changes: { text: 'Overlook', startAt: '2027-07-14T15:00', place: stated } }],
        },
      },
      {
        name: 'propose_alternative',
        input: {
          date: '2027-07-14',
          legId: 'leg_a',
          summary: 'If it rains',
          label: 'Rain',
          idealLabel: 'Dry',
          idealEntityIds: ['act_1'],
          entries: [{ text: 'Overlook', startAt: '2027-07-14T13:00', place: stated }],
        },
      },
    );
    const conversation = {
      ...startConversation(tripData()),
      placeSearches: {
        placeIds: ['ChIJmadeUp'],
        emptyQueries: [],
        timeZones: [['ChIJmadeUp', 'America/Denver']] as [string, string][],
      },
    };
    const after = await turn(stream, conversation, 'Plan the overlook');
    const queued = after.messages.at(-1)?.proposals ?? [];
    const zones = queued.map((p) =>
      p.type === 'edit'
        ? p.edit.change.changes.place?.timeZone
        : p.type === 'dayPlan'
          ? p.plan.changes[0].changes.place?.timeZone
          : p.type === 'alternative'
            ? p.alternative.entries[0].place?.timeZone
            : undefined,
    );
    expect(zones).toEqual(['America/Denver', 'America/Denver', 'America/Denver']);
  });

  it('takes an id the trip already has, in an edit and a route', async () => {
    const data = tripData();
    (data.activities[0] as { place: unknown }).place = {
      id: 'ChIJmadeUp',
      label: 'Scenic Overlook',
    };
    const { stream } = proposing(editPlace, { name: 'propose_route', input: route() });
    const after = await turn(stream, searched(['p_anc', 'p_seward'], data), 'Plan a drive', data);
    expect(after.messages.at(-1)?.proposals).toEqual([
      expect.objectContaining({ type: 'edit' }),
      expect.objectContaining({ type: 'route' }),
    ]);
  });
});

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

describe('askAIStream', () => {
  const hello = { max_tokens: 100, messages: [{ role: 'user' as const, content: 'hello' }] };

  it('reports a declined question as the chat’s own error', async () => {
    const { options } = fakeAnthropic({ body: streamedBody(fakeMessage([], 'refusal')) });
    const sent = askAIStream(options)(hello, {});
    await expect(sent).rejects.toBeInstanceOf(AskAIError);
    await expect(sent).rejects.toThrow('Claude declined to respond to that.');
  });

  it('asks for a key as the chat’s own error', async () => {
    const { options } = fakeAnthropic({ body: '' }, '');
    await expect(askAIStream(options)(hello, {})).rejects.toBeInstanceOf(AskAIError);
  });
});
