import { afterEach, describe, expect, it, vi } from 'vitest';

import { blankTransit } from './editForms';
import { draftTripData, importByProposals, stagedFromProposals } from './proposalImport';
import { buildTripView } from './tripModel';
import type { Transit, TripData } from './types';

// The API is stubbed: each request gets the next canned reply, and every request
// body is kept for the assertions.
function stubTurns(...replies: unknown[][]): Record<string, unknown>[] {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      const content = replies[Math.min(bodies.length - 1, replies.length - 1)];
      return new Response(
        JSON.stringify({
          id: `msg_${bodies.length}`,
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content,
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }),
  );
  return bodies;
}

afterEach(() => vi.unstubAllGlobals());

const call = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input });
const pdf = () => new File(['%PDF-1.4 synthetic'], 'booking.pdf', { type: 'application/pdf' });

function trip(): TripData {
  const flight: Transit = {
    ...blankTransit('leg_t', '2027-07-11'),
    _id: 'ph_out',
    mode: 'flight',
    from: { id: 'place_a', label: 'Alpha' },
    to: { id: 'place_b', label: 'Bravo' },
    departsAt: '2027-07-11T08:30',
    arrivesAt: '2027-07-11T09:30',
  };
  return {
    ...draftTripData([{ id: 't1', name: 'Alex Tester' }], false),
    legs: [
      { _id: 'leg_t', tripId: 'trip_new', name: 'Leg', skeletonAuthority: 'self', images: [] },
    ],
    transits: [flight],
  };
}

const proposal = {
  entityId: 'ph_out',
  kind: 'transit',
  changes: { departsAt: '2027-07-11T08:00' },
  booking: {
    ref: 'b',
    status: 'booked',
    confirmationNumber: 'C1',
    perTraveler: [{ travelerId: 't1', amount: 100, payable: 'paid' }],
  },
  why: 'Same flight',
};

describe('importByProposals', () => {
  it('offers the lookups and proposal tools, and queues what passes', async () => {
    const bodies = stubTurns([
      call('a', 'propose_change', proposal),
      call('b', 'finish', {
        documentTotal: { amount: 100 },
        refundTerms: { policy: 'nonrefundable', text: 'Nonrefundable' },
      }),
    ]);
    const data = trip();
    const result = await importByProposals(pdf(), 'sk-test', data, buildTripView(data));

    const [body] = bodies;
    expect((body.tools as { name: string }[]).map((t) => t.name)).toEqual([
      'get_entity',
      'search_places',
      'propose_change',
      'add_traveler',
      'add_note',
      'finish',
    ]);
    expect(body.tool_choice).toBeUndefined();
    expect(body.output_config).toEqual({ effort: 'low' });
    expect(result.requests).toBe(1);
    expect(result.queue).toHaveLength(1);
    expect((result.queue[0].entity as Transit).departsAt).toBe('2027-07-11T08:00');
    expect(result.queue[0].notes[0]).toMatchObject({ kind: 'warning', text: 'Nonrefundable' });
  });

  it('checks finish after the turn’s other calls, whatever order they came in', async () => {
    stubTurns([
      call('b', 'finish', { documentTotal: { amount: 100 }, refundTerms: { policy: 'none' } }),
      call('a', 'propose_change', proposal),
    ]);
    const data = trip();
    const result = await importByProposals(pdf(), 'sk-test', data, buildTripView(data));
    expect(result.requests).toBe(1);
    expect(result.queue).toHaveLength(1);
    expect(result.rejected).toEqual([]);
  });

  it('won’t finish in a turn where another call was turned down', async () => {
    stubTurns(
      [
        call('a', 'propose_change', { ...proposal, entityId: 'nope' }),
        call('b', 'finish', { documentTotal: { amount: 100 }, refundTerms: { policy: 'none' } }),
      ],
      [
        call('c', 'propose_change', proposal),
        call('d', 'finish', { documentTotal: { amount: 100 }, refundTerms: { policy: 'none' } }),
      ],
    );
    const data = trip();
    const result = await importByProposals(pdf(), 'sk-test', data, buildTripView(data));
    expect(result.requests).toBe(2);
    expect(result.queue).toHaveLength(1);
    expect(result.rejected.map((r) => r.tool)).toEqual(['propose_change', 'finish']);
  });

  it('sends a failed check back to the AI, and goes on once it’s fixed', async () => {
    const bodies = stubTurns(
      [call('a', 'propose_change', { ...proposal, entityId: 'nope' })],
      [
        call('b', 'propose_change', proposal),
        call('c', 'finish', { documentTotal: { amount: 100 }, refundTerms: { policy: 'none' } }),
      ],
    );
    const data = trip();
    const result = await importByProposals(pdf(), 'sk-test', data, buildTripView(data));

    const turned = (bodies[1].messages as { content: unknown }[]).at(-1)?.content as {
      is_error?: boolean;
      content: string;
    }[];
    expect(turned[0]).toMatchObject({
      is_error: true,
      content: 'No transit nope on the itinerary.',
    });
    expect(result.rejected).toHaveLength(1);
    expect(result.queue).toHaveLength(1);
    expect(result.queue[0].notes).toEqual([]);
  });
});

describe('a new trip from a document', () => {
  it('stages what was proposed on the real leg, with its notes and new travelers', async () => {
    stubTurns(
      [call('a', 'add_traveler', { name: 'Pat Guest' })],
      [
        call('b', 'propose_change', {
          key: 'ferry',
          kind: 'transit',
          legId: 'leg_new_trip',
          date: '2026-06-24',
          changes: { mode: 'ferry', departsAt: '2026-06-24T08:15', arrivesAt: '2026-06-24T09:15' },
          booking: {
            ref: 'f',
            status: 'booked',
            perTraveler: [{ travelerId: 'trav_pat_guest', amount: 44.5, payable: 'paid' }],
          },
          why: 'The ferry booked',
        }),
        call('c', 'finish', {
          documentTotal: { amount: 44.5 },
          refundTerms: { policy: 'full', text: 'Free cancellation until 48 hours before' },
          tripName: 'Catalina',
        }),
      ],
    );
    const draft = draftTripData([], false);
    const result = await importByProposals(pdf(), 'sk-test', draft, buildTripView(draft), {
      newTrip: true,
    });
    expect(result.tripName).toBe('Catalina');
    expect(result.newTravelers).toEqual([{ id: 'trav_pat_guest', name: 'Pat Guest' }]);

    const staged = stagedFromProposals(result, 'leg_real');
    expect(staged.transits.map((t) => t.legId)).toEqual(['leg_real']);
    expect(staged.bookings).toHaveLength(1);
    expect(staged.notes.map((n) => n.text)).toEqual(['Free cancellation until 48 hours before']);
  });
});
