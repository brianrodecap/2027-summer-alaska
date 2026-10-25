import { describe, expect, it } from 'vitest';

import {
  canChange,
  createFlightStatusClient,
  FLIGHT_STATUS_REFRESH_MS,
  flightCode,
  type FlightLookup,
  flightLookupNote,
  flightTrackerLinks,
  isWorthLookingUp,
  matchFlight,
  summarizeFlightStatus,
  watchFlightStatus,
} from './flightStatus';
import type { Transit } from './types';

// One /v1/flights entry, as AviationStack sends it: local wall clocks with a
// "+00:00" offset that isn't real.
function entry(flightDate: string, departs: string, overrides: Record<string, unknown> = {}) {
  return {
    flight_date: flightDate,
    flight_status: 'scheduled',
    departure: {
      airport: 'Anchorage',
      timezone: 'America/Anchorage',
      iata: 'ANC',
      terminal: 'S',
      gate: 'C3',
      delay: 12,
      scheduled: `${flightDate}T${departs}:00+00:00`,
      estimated: `${flightDate}T${departs}:00+00:00`,
      actual: null,
    },
    arrival: {
      airport: 'Kotzebue',
      timezone: 'America/Anchorage',
      iata: 'OTZ',
      terminal: null,
      gate: null,
      baggage: '2',
      scheduled: `${flightDate}T10:33:00+00:00`,
      delay: null,
      estimated: null,
      actual: null,
    },
    live: null,
    ...overrides,
  };
}

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

describe('matchFlight', () => {
  it('reads the airport’s own clock, not the offset AviationStack labels it with', () => {
    const status = matchFlight({ data: [entry('2027-07-08', '08:55')] }, transit);
    expect(status?.departure).toMatchObject({
      scheduled: '2027-07-08T08:55',
      gate: 'C3',
      delayMinutes: 12,
      timeZone: 'America/Anchorage',
    });
    expect(status?.arrival.baggage).toBe('2');
  });

  it('picks the flight scheduled at the transit’s departure, wherever it is listed', () => {
    const status = matchFlight(
      {
        data: [
          entry('2027-07-08', '16:10', { flight_status: 'active' }),
          entry('2027-07-08', '08:55', { flight_status: 'landed' }),
        ],
      },
      transit,
    );
    expect(status?.phase).toBe('landed');
  });

  it('falls back to the only flight on the date when the time has moved', () => {
    const status = matchFlight(
      { data: [entry('2027-07-07', '08:55'), entry('2027-07-08', '09:20')] },
      transit,
    );
    expect(status?.departure.scheduled).toBe('2027-07-08T09:20');
  });

  it('matches nothing when two flights that day could be it', () => {
    expect(
      matchFlight({ data: [entry('2027-07-08', '07:00'), entry('2027-07-08', '19:00')] }, transit),
    ).toBeNull();
  });

  it('keeps the plane’s position only when it has one', () => {
    const live = { latitude: 61.2, longitude: -149.9, altitude: 9000, updated: '2027-07-08T17:20' };
    expect(matchFlight({ data: [entry('2027-07-08', '08:55', { live })] }, transit)?.live).toEqual({
      lat: 61.2,
      lng: -149.9,
      altitudeM: 9000,
      updatedAt: '2027-07-08T17:20',
    });
  });

  it('treats an unknown status as no status, not a reason to drop the flight', () => {
    const status = matchFlight(
      { data: [entry('2027-07-08', '08:55', { flight_status: 'boarding' })] },
      transit,
    );
    expect(status).not.toBeNull();
    expect(status?.phase).toBeNull();
  });

  it('rejects a reply that has no flight list', () => {
    expect(() => matchFlight({ pagination: {} }, transit)).toThrow(
      'AviationStack sent a reply this site can’t read.',
    );
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
    const urls: string[] = [];
    const { getFlightStatus } = createFlightStatusClient({
      fetch: async (url) => {
        urls.push(String(url));
        return new Response(JSON.stringify(reply), { status: 200 });
      },
      key: () => currentKey,
      now: () => clock,
      cached: (_key, _ttl, compute) => compute(),
    });
    return {
      getFlightStatus,
      urls,
      advance: (ms: number) => (clock += ms),
      setKey: (next: string) => (currentKey = next),
      setReply: (next: unknown) => (reply = next),
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

  it('says AviationStack doesn’t list the flight, and that asking again may change that', async () => {
    const c = client('2027-07-08T16:00Z', { data: [] });
    const lookup = await c.getFlightStatus(asFlight);
    expect(lookup).toEqual({ kind: 'notListed' });
    expect(canChange(lookup)).toBe(true);
    expect(flightLookupNote(lookup)).toBe('AviationStack doesn’t list this flight right now.');
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
    matchFlight({ data: [entry('2027-07-08', '08:55', overrides)] }, transit) as NonNullable<
      ReturnType<typeof matchFlight>
    >;

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

  it('leaves FlightAware out for an airline whose ICAO code isn’t known', () => {
    expect(flightTrackerLinks('ZZ12').map((l) => l.label)).toEqual(['Flightradar24']);
  });
});

describe('watchFlightStatus', () => {
  const flight = { _id: 'transit_test', flightNumber: 'AS 273' } as Transit;
  const live: FlightLookup = {
    kind: 'status',
    status: matchFlight({ data: [entry('2027-07-08', '08:55')] }, transit) as NonNullable<
      ReturnType<typeof matchFlight>
    >,
    final: false,
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
    const stop = watchFlightStatus(flight, (state) => shown.push(state), {
      getFlightStatus: async () => {
        const answer = answers[Math.min(asked++, answers.length - 1)];
        if (answer instanceof Error) throw answer;
        return answer;
      },
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
