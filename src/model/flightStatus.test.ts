import { describe, expect, it } from 'vitest';

import { entry } from '../test/aviationstackFixtures';
import { airlabs } from './airlabsFlights';
import { aviationstack, matchFlight } from './aviationstackFlights';
import {
  canChange,
  createFlightStatusClient,
  FLIGHT_STATUS_REFRESH_MS,
  flightCode,
  type FlightLookup,
  flightLookupNote,
  flightTrackerLinks,
  isWorthLookingUp,
  summarizeFlightStatus,
  watchFlightStatus,
} from './flightStatus';
import type { Transit } from './types';

// The part of an AirLabs /flight reply the lookups read.
const airlabsReply = {
  dep_time: '2027-07-08 08:55',
  arr_time: '2027-07-08 10:33',
};

const transit = { departsAt: '2027-07-08T08:55' };

describe('flightCode', () => {
  it('reads a flight number the way it was booked', () => {
    expect(flightCode({ flightNumber: 'AS 273' })).toBe('AS273');
    expect(flightCode({ flightNumber: ' as273 ' })).toBe('AS273');
  });

  it('has no code for a missing or unreadable flight number', () => {
    expect(flightCode({})).toBeNull();
    expect(flightCode({ flightNumber: 'Floatplane' })).toBeNull();
  });
});

const at = (iso: string) => Date.parse(iso);
const ANCHORAGE = 'America/Anchorage';
const SEATTLE = 'America/Los_Angeles';

describe('the lookup window', () => {
  // A flight between places keeping their clocks in `from` and `to`.
  const zoned = (
    times: { departsAt: string; arrivesAt: string | null },
    from = ANCHORAGE,
    to = ANCHORAGE,
  ) => ({
    ...times,
    from: { id: null, label: 'From', timeZone: from },
    to: { id: null, label: 'To', timeZone: to },
  });
  const flight = zoned({ departsAt: '2027-07-08T08:55', arrivesAt: '2027-07-08T10:33' });

  it('opens two hours before departure, on the departure airport’s clock', () => {
    // 06:55 AKDT is 14:55 UTC.
    expect(isWorthLookingUp(flight, at('2027-07-08T14:54Z'))).toBe(false);
    expect(isWorthLookingUp(flight, at('2027-07-08T14:55Z'))).toBe(true);
  });

  it('closes an hour after arrival, on the arrival airport’s clock', () => {
    // 11:33 AKDT is 19:33 UTC.
    expect(isWorthLookingUp(flight, at('2027-07-08T19:33Z'))).toBe(true);
    expect(isWorthLookingUp(flight, at('2027-07-08T19:34Z'))).toBe(false);
  });

  it('reads each end in its own airport’s zone', () => {
    const seattleToAnchorage = zoned(
      { departsAt: '2027-07-08T08:55', arrivesAt: '2027-07-08T10:33' },
      SEATTLE,
      ANCHORAGE,
    );
    // Opens 06:55 PDT (13:55 UTC), an hour before 06:55 in Anchorage would.
    expect(isWorthLookingUp(seattleToAnchorage, at('2027-07-08T13:55Z'))).toBe(true);
    expect(isWorthLookingUp(seattleToAnchorage, at('2027-07-08T13:54Z'))).toBe(false);
    // Closes 11:33 AKDT (19:33 UTC), not 11:33 PDT.
    expect(isWorthLookingUp(seattleToAnchorage, at('2027-07-08T19:33Z'))).toBe(true);
  });

  it('stays open 12 hours after departure when no arrival time is recorded', () => {
    const noArrival = zoned({ departsAt: '2027-07-08T08:55', arrivesAt: null });
    // 20:55 AKDT is 04:55 UTC the next day.
    expect(isWorthLookingUp(noArrival, at('2027-07-09T04:55Z'))).toBe(true);
    expect(isWorthLookingUp(noArrival, at('2027-07-09T04:56Z'))).toBe(false);
  });

  it('reads a winter flight on winter time', () => {
    const january = zoned({ departsAt: '2027-01-08T08:55', arrivesAt: '2027-01-08T10:33' });
    // 06:55 AKST is 15:55 UTC, an hour later than in July.
    expect(isWorthLookingUp(january, at('2027-01-08T15:54Z'))).toBe(false);
    expect(isWorthLookingUp(january, at('2027-01-08T15:55Z'))).toBe(true);
  });
});

describe('getFlightStatus', () => {
  const asFlight = {
    _id: 'transit_test',
    legId: 'leg_test',
    journeyId: null,
    scenarioId: null,
    mode: 'flight',
    travelers: null,
    from: { id: 'place_anc', label: 'Anchorage', timeZone: ANCHORAGE },
    to: { id: 'place_otz', label: 'Kotzebue', timeZone: ANCHORAGE },
    departsAt: '2027-07-08T08:55',
    arrivesAt: '2027-07-08T10:33',
    routeId: null,
    routeVariant: null,
    bookingId: null,
    images: [],
    flightNumber: 'AS 273',
  } as Transit;

  // A client on a fixed clock whose AviationStack answers `body`; every request
  // is recorded.
  function client(nowIso: string, body: unknown, key = 'as-key') {
    let clock = at(nowIso);
    let currentKey = key;
    let reply = body;
    // An answer an earlier visit kept, which the cache hands back instead of asking.
    let kept: { value: unknown; savedAt: number } | null = null;
    const ttls: ((value: unknown) => number)[] = [];
    const urls: string[] = [];
    const { getFlightStatus } = createFlightStatusClient({
      fetch: async (url) => {
        urls.push(String(url));
        return new Response(JSON.stringify(reply), { status: 200 });
      },
      providers: [{ ...aviationstack, key: () => currentKey }],
      now: () => clock,
      cached: async (_key, ttl, compute) => {
        ttls.push(ttl as (value: unknown) => number);
        return (
          (kept as { value: Awaited<ReturnType<typeof compute>>; savedAt: number } | null) ?? {
            value: await compute(),
            savedAt: clock,
          }
        );
      },
    });
    return {
      getFlightStatus,
      urls,
      advance: (ms: number) => (clock += ms),
      setKey: (next: string) => (currentKey = next),
      setReply: (next: unknown) => (reply = next),
      ttls,
      keep: (value: unknown, savedAt: number) => (kept = { value, savedAt }),
      forget: () => (kept = null),
    };
  }
  const listed = { data: [entry('2027-07-08', '08:55', { flight_status: 'active' })] };

  it('looks the flight up by its code inside the window', async () => {
    const c = client('2027-07-08T16:00Z', listed);
    await expect(c.getFlightStatus(asFlight)).resolves.toMatchObject({
      status: { phase: 'active' },
    });
    expect(c.urls).toHaveLength(1);
    expect(c.urls[0]).toContain('flight_iata=AS273');
  });

  it('opens the window on the departure airport’s stored zone', async () => {
    // 08:55 at UTC+14 is 18:55 UTC the day before, so the window opens at 16:55
    // UTC on Jul 7: earlier than it would on any reader's own clock.
    const fromKiritimati = {
      ...asFlight,
      from: { ...asFlight.from, timeZone: 'Pacific/Kiritimati' },
    } as Transit;
    const c = client('2027-07-07T17:00Z', listed);
    await c.getFlightStatus(fromKiritimati);
    expect(c.urls).toHaveLength(1);
  });

  it('spends nothing far from the flight', async () => {
    const c = client('2027-06-01T16:00Z', listed);
    await expect(c.getFlightStatus(asFlight)).resolves.toEqual({ kind: 'notYet' });
    expect(c.urls).toEqual([]);
  });

  it('spends one request on every row and sheet showing the flight in one window', async () => {
    const c = client('2027-07-08T16:00Z', listed);
    await Promise.all([c.getFlightStatus(asFlight), c.getFlightStatus(asFlight)]);
    expect(c.urls).toHaveLength(1);
  });

  it('reuses an answer for 15 minutes after it was asked, across the quarter hour', async () => {
    const c = client('2027-07-08T16:14Z', listed);
    await c.getFlightStatus(asFlight);
    c.advance(2 * 60 * 1000);
    await c.getFlightStatus(asFlight);
    expect(c.urls).toHaveLength(1);
    c.advance(13 * 60 * 1000);
    await c.getFlightStatus(asFlight);
    expect(c.urls).toHaveLength(2);
  });

  it('stops asking once the flight has landed and its baggage claim is posted', async () => {
    const landed = { data: [entry('2027-07-08', '08:55', { flight_status: 'landed' })] };
    const c = client('2027-07-08T18:40Z', landed);
    await c.getFlightStatus(asFlight);
    c.advance(30 * 60 * 1000);
    await expect(c.getFlightStatus(asFlight)).resolves.toMatchObject({
      status: { phase: 'landed' },
    });
    expect(c.urls).toHaveLength(1);
  });

  it('keeps asking after landing until the baggage claim is posted', async () => {
    const landed = {
      data: [
        entry('2027-07-08', '08:55', {
          flight_status: 'landed',
          arrival: { ...entry('2027-07-08', '08:55').arrival, baggage: null },
        }),
      ],
    };
    const c = client('2027-07-08T18:40Z', landed);
    await c.getFlightStatus(asFlight);
    c.advance(30 * 60 * 1000);
    await c.getFlightStatus(asFlight);
    expect(c.urls).toHaveLength(2);
  });

  it('asks for a key, without calling AviationStack, when none is set', async () => {
    const c = client('2027-07-08T16:00Z', listed, '');
    await expect(c.getFlightStatus(asFlight)).rejects.toThrow(
      'Add your AviationStack API key in Settings.',
    );
    expect(c.urls).toEqual([]);
  });

  it('asks again right away once a key is added, rather than keeping the failure', async () => {
    const c = client('2027-07-08T16:00Z', listed, '');
    await expect(c.getFlightStatus(asFlight)).rejects.toThrow('Add your AviationStack API key');
    c.setKey('as-key');
    await expect(c.getFlightStatus(asFlight)).resolves.toMatchObject({
      status: { phase: 'active' },
    });
  });

  it('keeps looking while a delay holds the flight past its planned arrival', async () => {
    // Planned to land 10:33 AKDT, so the window would close at 19:33 UTC; it's
    // reported landing at 13:33 instead.
    const late = entry('2027-07-08', '08:55', {
      flight_status: 'active',
      arrival: { ...entry('2027-07-08', '08:55').arrival, estimated: '2027-07-08T13:33:00+00:00' },
    });
    const c = client('2027-07-08T19:20Z', { data: [late] });
    await c.getFlightStatus(asFlight);
    c.advance(20 * 60 * 1000);
    await c.getFlightStatus(asFlight);
    expect(c.urls).toHaveLength(2);
  });

  it('still shows the last answer after the window closes, without asking again', async () => {
    const c = client('2027-07-08T19:20Z', listed);
    await c.getFlightStatus(asFlight);
    c.advance(60 * 60 * 1000);
    await expect(c.getFlightStatus(asFlight)).resolves.toMatchObject({
      status: { phase: 'active' },
    });
    expect(c.urls).toHaveLength(1);
  });

  it('says the window has closed when it holds nothing for the flight', async () => {
    const c = client('2027-07-08T20:00Z', listed);
    await expect(c.getFlightStatus(asFlight)).resolves.toEqual({ kind: 'over' });
    expect(c.urls).toEqual([]);
  });

  it('says the flight isn’t listed, and that asking again may change that', async () => {
    const c = client('2027-07-08T16:00Z', { data: [] });
    const lookup = await c.getFlightStatus(asFlight);
    expect(lookup).toEqual({ kind: 'notListed', asOf: at('2027-07-08T16:00Z') });
    expect(canChange(lookup)).toBe(true);
    expect(flightLookupNote(lookup)).toBe('This flight isn’t listed right now.');
  });

  it('marks a landed flight with its baggage claim as final, so it isn’t asked again', async () => {
    const landed = { data: [entry('2027-07-08', '08:55', { flight_status: 'landed' })] };
    const lookup = await client('2027-07-08T18:40Z', landed).getFlightStatus(asFlight);
    expect(lookup).toMatchObject({ kind: 'status', final: true });
    expect(canChange(lookup)).toBe(false);
  });

  it('has nothing to look up without a flight number', async () => {
    const c = client('2027-07-08T16:00Z', listed);
    await expect(c.getFlightStatus({ ...asFlight, flightNumber: undefined })).resolves.toEqual({
      kind: 'noFlightNumber',
    });
  });

  it('says when live news starts, from the window’s own opening', () => {
    expect(flightLookupNote({ kind: 'notYet' })).toBe(
      'Gate, delay and baggage news shows here from 2 hours before departure.',
    );
  });

  it('treats a held answer as final once the window has closed', async () => {
    const landedNoBags = {
      data: [
        entry('2027-07-08', '08:55', {
          flight_status: 'landed',
          arrival: { ...entry('2027-07-08', '08:55').arrival, baggage: null },
        }),
      ],
    };
    const c = client('2027-07-08T19:20Z', landedNoBags);
    await expect(c.getFlightStatus(asFlight)).resolves.toMatchObject({ final: false });
    c.advance(60 * 60 * 1000);
    await expect(c.getFlightStatus(asFlight)).resolves.toMatchObject({ final: true });
  });

  describe('answers kept across reloads', () => {
    const landedWithBags = entry('2027-07-08', '08:55', { flight_status: 'landed' });
    const landedNoBags = entry('2027-07-08', '08:55', {
      flight_status: 'landed',
      arrival: { ...landedWithBags.arrival, baggage: null },
    });

    it('keeps a final answer for a day, and any other for 15 minutes', async () => {
      const c = client('2027-07-08T18:40Z', { data: [landedWithBags] });
      await c.getFlightStatus(asFlight);
      const finalAnswer = matchFlight({ data: [landedWithBags] }, asFlight.departsAt);
      const openAnswer = matchFlight({ data: [landedNoBags] }, asFlight.departsAt);
      expect(c.ttls[0](finalAnswer)).toBe(24 * 60 * 60 * 1000);
      expect(c.ttls[0](openAnswer)).toBe(15 * 60 * 1000);
      expect(c.ttls[0](null)).toBe(15 * 60 * 1000);
    });

    it('counts an answer’s age from when it was asked, not from the reload', async () => {
      const c = client('2027-07-08T16:14Z', listed);
      const kept = matchFlight(listed, asFlight.departsAt);
      // Asked 14 minutes ago in an earlier visit.
      c.keep(kept, at('2027-07-08T16:00Z'));
      await expect(c.getFlightStatus(asFlight)).resolves.toMatchObject({
        status: { phase: 'active' },
        asOf: at('2027-07-08T16:00Z'),
      });
      c.advance(2 * 60 * 1000);
      c.forget();
      await c.getFlightStatus(asFlight);
      expect(c.urls).toHaveLength(1);
    });
  });

  describe('with AirLabs asked first and AviationStack behind it', () => {
    const airlabsKey = (key: string) => ({ ...airlabs, key: () => key });
    const found = { response: { ...airlabsReply, status: 'en-route' } };
    const notFound = { error: { code: 'not_found' } };
    const quota = { error: { code: 'limit_exceeded' } };

    // Both providers over a fetch that answers each from its own reply.
    function both(
      replies: { airlabs: unknown; aviationstack: unknown },
      keys = { airlabs: 'al-key', aviationstack: 'as-key' },
    ) {
      const urls: string[] = [];
      const { getFlightStatus } = createFlightStatusClient({
        fetch: async (url) => {
          urls.push(String(url));
          const reply = String(url).includes('airlabs.co')
            ? replies.airlabs
            : replies.aviationstack;
          return new Response(JSON.stringify(reply), { status: 200 });
        },
        providers: [airlabsKey(keys.airlabs), { ...aviationstack, key: () => keys.aviationstack }],
        now: () => at('2027-07-08T16:00Z'),
        cached: async (_key, _ttl, compute) => ({
          value: await compute(),
          savedAt: at('2027-07-08T16:00Z'),
        }),
      });
      return { getFlightStatus: () => getFlightStatus(asFlight), urls };
    }

    it('answers from AirLabs without spending an AviationStack request', async () => {
      const c = both({ airlabs: found, aviationstack: listed });
      await expect(c.getFlightStatus()).resolves.toMatchObject({ status: { phase: 'active' } });
      expect(c.urls).toHaveLength(1);
      expect(c.urls[0]).toContain('airlabs.co');
    });

    it('asks AviationStack when AirLabs doesn’t know the flight', async () => {
      const c = both({
        airlabs: notFound,
        aviationstack: { data: [entry('2027-07-08', '08:55', { flight_status: 'landed' })] },
      });
      await expect(c.getFlightStatus()).resolves.toMatchObject({ status: { phase: 'landed' } });
      expect(c.urls).toHaveLength(2);
    });

    it('asks AviationStack when AirLabs fails', async () => {
      const c = both({ airlabs: quota, aviationstack: listed });
      await expect(c.getFlightStatus()).resolves.toMatchObject({ status: { phase: 'active' } });
    });

    it('shows a failure, and keeps no answer, when the other source says it isn’t listed', async () => {
      const c = both({
        airlabs: { error: { code: 'unknown_api_key' } },
        aviationstack: { data: [] },
      });
      await expect(c.getFlightStatus()).rejects.toThrow(
        'AirLabs didn’t accept the key in Settings.',
      );
    });

    it('says the flight isn’t listed when every source answers that it is not', async () => {
      const c = both({ airlabs: notFound, aviationstack: { data: [] } });
      await expect(c.getFlightStatus()).resolves.toMatchObject({ kind: 'notListed' });
    });

    it('reports the first failure when neither source can answer', async () => {
      const c = both({ airlabs: quota, aviationstack: { error: { code: 'usage_limit_reached' } } });
      await expect(c.getFlightStatus()).rejects.toThrow(
        'This month’s AirLabs lookups are used up.',
      );
    });

    it('skips a source with no key, without calling it', async () => {
      const c = both(
        { airlabs: found, aviationstack: listed },
        { airlabs: '', aviationstack: 'as-key' },
      );
      await c.getFlightStatus();
      expect(c.urls).toHaveLength(1);
      expect(c.urls[0]).toContain('aviationstack.com');
    });

    it('asks for a key to either source when neither has one', async () => {
      const c = both({ airlabs: found, aviationstack: listed }, { airlabs: '', aviationstack: '' });
      await expect(c.getFlightStatus()).rejects.toThrow(
        'Add your AirLabs or AviationStack API key in Settings.',
      );
      expect(c.urls).toEqual([]);
    });
  });

  it('says when the month’s lookups are used up', async () => {
    const c = client('2027-07-08T16:00Z', { error: { code: 'usage_limit_reached' } });
    await expect(c.getFlightStatus(asFlight)).rejects.toThrow(
      'This month’s AviationStack lookups are used up.',
    );
  });
});

describe('summarizeFlightStatus', () => {
  const base = entry('2027-07-08', '08:55');
  const statusOf = (overrides: Record<string, unknown>) =>
    matchFlight(
      { data: [entry('2027-07-08', '08:55', overrides)] },
      transit.departsAt,
    ) as NonNullable<ReturnType<typeof matchFlight>>;

  it('calls a flight on time until its delay is worth mentioning', () => {
    const { departure } = base;
    expect(
      summarizeFlightStatus(statusOf({ departure: { ...departure, delay: 14 } })),
    ).toMatchObject({ headline: 'On time', tone: 'ok' });
    expect(
      summarizeFlightStatus(statusOf({ departure: { ...departure, delay: 15 } })),
    ).toMatchObject({ headline: 'Delayed 15 min', tone: 'warning' });
  });

  it('calls a flight delayed when its new departure time slips, whatever the delay field says', () => {
    const departure = { ...base.departure, delay: null, estimated: '2027-07-08T09:20:00+00:00' };
    expect(summarizeFlightStatus(statusOf({ departure })).headline).toBe('Delayed 25 min');
  });

  it('flags a cancelled flight as a problem', () => {
    expect(summarizeFlightStatus(statusOf({ flight_status: 'cancelled' }))).toMatchObject({
      headline: 'Cancelled',
      tone: 'problem',
    });
  });

  it('lists the gate, the new departure time and the baggage claim', () => {
    const departure = {
      ...base.departure,
      estimated: '2027-07-08T09:20:00+00:00',
    };
    const summary = summarizeFlightStatus(statusOf({ departure }));
    expect(summary.departure).toBe('Terminal S · Gate C3 · leaves 9:20am');
    expect(summary.arrival).toBe('Baggage claim 2');
  });

  it('says when an airborne flight lands', () => {
    const arrival = {
      ...base.arrival,
      estimated: '2027-07-08T10:41:00+00:00',
    };
    expect(summarizeFlightStatus(statusOf({ flight_status: 'active', arrival })).headline).toBe(
      'In the air · lands 10:41am',
    );
  });
});

describe('flightTrackerLinks', () => {
  it('links FlightAware by the airline’s ICAO callsign and Flightradar24 by the flight code', () => {
    expect(flightTrackerLinks('AS273').map((l) => l.url)).toEqual([
      'https://www.flightaware.com/live/flight/ASA273',
      'https://www.flightradar24.com/data/flights/as273',
    ]);
  });

  it('links FlightAware by the callsign a source reported, over the airline table', () => {
    expect(flightTrackerLinks('AS273', 'ASA2731').map((l) => l.url)[0]).toBe(
      'https://www.flightaware.com/live/flight/ASA2731',
    );
    expect(flightTrackerLinks('ZZ12', 'ZZZ12').map((l) => l.label)).toEqual([
      'FlightAware',
      'Flightradar24',
    ]);
  });

  it('leaves FlightAware out for an airline whose ICAO code isn’t known', () => {
    expect(flightTrackerLinks('ZZ12').map((l) => l.label)).toEqual(['Flightradar24']);
  });
});

describe('watchFlightStatus', () => {
  const NOW = at('2027-07-08T16:00Z');
  const flight = { _id: 'transit_test', flightNumber: 'AS 273' } as Transit;
  const live: FlightLookup = {
    kind: 'status',
    status: matchFlight({ data: [entry('2027-07-08', '08:55')] }, transit.departsAt) as NonNullable<
      ReturnType<typeof matchFlight>
    >,
    final: false,
    asOf: NOW,
  };
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  // A watcher whose lookups answer from `answers` in turn (an Error rejects), on
  // fake timers and a page that's on screen unless `hide` says otherwise.
  function watch(answers: (FlightLookup | Error)[]) {
    const shown: { lookup: FlightLookup | null; error: string | null }[] = [];
    const timers: { run: () => void; ms: number }[] = [];
    let visible = true;
    const onVisible: (() => void)[] = [];
    let asked = 0;
    let elapsed = 0;
    const stop = watchFlightStatus(flight, (state) => shown.push(state), {
      getFlightStatus: async () => {
        const answer = answers[Math.min(asked++, answers.length - 1)];
        if (answer instanceof Error) throw answer;
        return answer;
      },
      now: () => NOW + elapsed,
      setTimeout: (run, ms) => timers.push({ run, ms }),
      clearTimeout: () => timers.splice(0),
      visible: () => visible,
      onVisible: (run) => {
        onVisible.push(run);
        return () => onVisible.splice(onVisible.indexOf(run), 1);
      },
    });
    return {
      shown,
      timers,
      stop,
      asked: () => asked,
      tick: async () => {
        timers.shift()?.run();
        await flush();
      },
      advance: (ms: number) => (elapsed += ms),
      hide: () => (visible = false),
      show: async () => {
        visible = true;
        onVisible.splice(0).forEach((run) => run());
        await flush();
      },
    };
  }

  it('asks again on the refresh interval while the answer can change', async () => {
    const w = watch([live]);
    await flush();
    expect(w.timers.map((t) => t.ms)).toEqual([FLIGHT_STATUS_REFRESH_MS]);
    await w.tick();
    expect(w.asked()).toBe(2);
  });

  it('asks again an interval after the answer was asked, not after it was shown', async () => {
    const fourteenMinutes = 14 * 60 * 1000;
    const w = watch([{ ...live, asOf: NOW - fourteenMinutes }]);
    await flush();
    expect(w.timers.map((t) => t.ms)).toEqual([FLIGHT_STATUS_REFRESH_MS - fourteenMinutes]);
  });

  it('waits a whole interval, not zero, on an answer already older than the interval', async () => {
    const w = watch([{ ...live, asOf: NOW - 2 * FLIGHT_STATUS_REFRESH_MS }]);
    await flush();
    expect(w.timers.map((t) => t.ms)).toEqual([FLIGHT_STATUS_REFRESH_MS]);
  });

  it('keeps to the interval when a refresh fails and the last answer has aged', async () => {
    const w = watch([{ ...live, asOf: NOW - 14 * 60 * 1000 }, new Error('offline')]);
    await flush();
    // The refresh comes due 2 minutes on, and fails.
    w.advance(2 * 60 * 1000);
    await w.tick();
    expect(w.shown.at(-1)?.error).toBe('offline');
    expect(w.timers.map((t) => t.ms)).toEqual([FLIGHT_STATUS_REFRESH_MS]);
  });

  it('stops asking once the answer is final, or there is nothing to watch for', async () => {
    const final = watch([{ ...live, final: true } as FlightLookup]);
    const notYet = watch([{ kind: 'notYet' }]);
    await flush();
    expect(final.timers).toEqual([]);
    expect(notYet.timers).toEqual([]);
  });

  it('keeps the last answer through a failed refresh, and tries again on the interval', async () => {
    const w = watch([
      live,
      new Error('Too many flight lookups at once; try again in a minute.'),
      live,
    ]);
    await flush();
    await w.tick();
    expect(w.shown.at(-1)).toEqual({
      lookup: live,
      error: 'Too many flight lookups at once; try again in a minute.',
    });
    expect(w.asked()).toBe(2);
    expect(w.timers.map((t) => t.ms)).toEqual([FLIGHT_STATUS_REFRESH_MS]);
    await w.tick();
    expect(w.shown.at(-1)).toEqual({ lookup: live, error: null });
  });

  it('spends nothing while the page is hidden, and asks when it comes back', async () => {
    const w = watch([live]);
    await flush();
    w.hide();
    await w.tick();
    expect(w.asked()).toBe(1);
    await w.show();
    expect(w.asked()).toBe(2);
  });

  it('says what failed when the first lookup fails, and doesn’t retry it on a timer', async () => {
    const w = watch([new Error('Add your AviationStack API key in Settings.')]);
    await flush();
    expect(w.shown).toEqual([
      { lookup: null, error: 'Add your AviationStack API key in Settings.' },
    ]);
    expect(w.timers).toEqual([]);
  });

  it('stops when the sheet closes', async () => {
    const w = watch([live]);
    await flush();
    w.stop();
    expect(w.timers).toEqual([]);
  });
});
