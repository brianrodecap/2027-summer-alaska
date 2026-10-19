import { describe, expect, it } from 'vitest';

import { fakeAnthropic, fakeMessage } from '../test/fakeAnthropic';
import type { SendMessage } from './anthropicClient';
import { DocumentImportError } from './documentImport';
import { blankTransit } from './editForms';
import {
  draftTripData,
  importByProposals,
  importRequest,
  stagedFromProposals,
} from './proposalImport';
import { buildTripView } from './tripModel';
import type { Transit, TripData } from './types';

// A client answering each request with the next canned reply (the last one again
// once they run out), and each request as it was sent; nothing reaches the API.
function stubTurns(...replies: unknown[][]) {
  const bodies: Record<string, unknown>[] = [];
  const create: SendMessage = async (request) => {
    bodies.push(structuredClone(request) as Record<string, unknown>);
    const content = replies[Math.min(bodies.length - 1, replies.length - 1)];
    return fakeMessage(content, 'tool_use', {
      id: `msg_${bodies.length}`,
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 },
    });
  };
  return { bodies, create };
}

const call = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input });
const confirmation = () =>
  new File(['Booking confirmation (synthetic)'], 'booking.eml', { type: 'message/rfc822' });

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
    const { bodies, create } = stubTurns([
      call('a', 'propose_change', proposal),
      call('b', 'finish', {
        documentTotal: { amount: 100 },
        refundTerms: { policy: 'nonrefundable', text: 'Nonrefundable' },
      }),
    ]);
    const data = trip();
    const result = await importByProposals(confirmation(), data, buildTripView(data), { create });

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
    const { create } = stubTurns([
      call('b', 'finish', { documentTotal: { amount: 100 }, refundTerms: { policy: 'none' } }),
      call('a', 'propose_change', proposal),
    ]);
    const data = trip();
    const result = await importByProposals(confirmation(), data, buildTripView(data), { create });
    expect(result.requests).toBe(1);
    expect(result.queue).toHaveLength(1);
    expect(result.rejected).toEqual([]);
  });

  it('won’t finish in a turn where another call was turned down', async () => {
    const { create } = stubTurns(
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
    const result = await importByProposals(confirmation(), data, buildTripView(data), { create });
    expect(result.requests).toBe(2);
    expect(result.queue).toHaveLength(1);
    expect(result.rejected.map((r) => r.tool)).toEqual(['propose_change', 'finish']);
  });

  it('sends a failed check back to the AI, and goes on once it’s fixed', async () => {
    const { bodies, create } = stubTurns(
      [call('a', 'propose_change', { ...proposal, entityId: 'nope' })],
      [
        call('b', 'propose_change', proposal),
        call('c', 'finish', { documentTotal: { amount: 100 }, refundTerms: { policy: 'none' } }),
      ],
    );
    const data = trip();
    const result = await importByProposals(confirmation(), data, buildTripView(data), { create });

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
    const { create } = stubTurns(
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
    const result = await importByProposals(confirmation(), draft, buildTripView(draft), {
      newTrip: true,
      create,
    });
    expect(result.tripName).toBe('Catalina');
    expect(result.newTravelers).toEqual([{ id: 'trav_pat_guest', name: 'Pat Guest' }]);

    const staged = stagedFromProposals(result, 'leg_real');
    expect(staged.transits.map((t) => t.legId)).toEqual(['leg_real']);
    expect(staged.bookings).toHaveLength(1);
    expect(staged.notes.map((n) => n.text)).toEqual(['Free cancellation until 48 hours before']);
  });
});

describe('importRequest', () => {
  const hello = { max_tokens: 100, messages: [{ role: 'user' as const, content: 'hello' }] };

  it('reports a declined document as the import’s own error', async () => {
    const { options } = fakeAnthropic({ body: fakeMessage([], 'refusal') });
    const sent = importRequest(options)(hello);
    await expect(sent).rejects.toBeInstanceOf(DocumentImportError);
    await expect(sent).rejects.toThrow('Claude declined to process this document.');
  });

  it('asks for a key as the import’s own error', async () => {
    const { options } = fakeAnthropic({ body: {} }, '');
    await expect(importRequest(options)(hello)).rejects.toBeInstanceOf(DocumentImportError);
  });
});
