// Live status for a flight Transit (status, gates, delays, baggage, position) from
// the flight-status sources in `providers`, looked up only around the day it flies:
// the free plans answer for flights near today and allow few requests a month.
// Never written back into the trip's JSON; it's only as of when the page asked.
import { airlabs } from './airlabsFlights';
import { aviationstack } from './aviationstackFlights';
import type { ClientOptions } from './clientOptions';
import { type FlightEnd, type FlightProvider, type FlightStatus } from './flightStatusTypes';
import { type CacheEntry, persistedEntry } from './idbCache';
import {
  addMinutesIso,
  diffMinutesIso,
  type EndpointZones,
  endpointZonesOf,
  formatTime,
  zonedInstant,
} from './tripModel';
import type { Transit } from './types';

// "AS 273" / "as273" → "AS273"; null when the Transit has no usable flight number.
export function flightCode(transit: Pick<Transit, 'flightNumber'>): string | null {
  const code = transit.flightNumber?.replace(/\s+/g, '').toUpperCase() ?? '';
  return /^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(code) ? code : null;
}

const HOUR_MS = 60 * 60 * 1000;
// The lookup window: from 2 hours before departure (gate and delay news) to 1 hour
// after arrival (baggage claim), each on its own airport's clock.
const OPENS_BEFORE_DEPARTURE_MS = 2 * HOUR_MS;
const CLOSES_AFTER_ARRIVAL_MS = 1 * HOUR_MS;
// Without a recorded arrival, how long after departure the window stays open.
const NO_ARRIVAL_CLOSES_AFTER_DEPARTURE_MS = 12 * HOUR_MS;

type FlightTimes = Pick<Transit, 'departsAt' | 'arrivesAt' | 'from' | 'to'>;
// The instant a wall clock at one end of the flight shows.
type ReadClock = (wall: string, end: keyof EndpointZones) => number;

function lookupWindow({ departsAt, arrivesAt }: FlightTimes, read: ReadClock): [number, number] {
  const departs = read(departsAt, 'from');
  return [
    departs - OPENS_BEFORE_DEPARTURE_MS,
    arrivesAt
      ? read(arrivesAt, 'to') + CLOSES_AFTER_ARRIVAL_MS
      : departs + NO_ARRIVAL_CLOSES_AFTER_DEPARTURE_MS,
  ];
}

type WindowSide = 'before' | 'within' | 'after';
const sideOf = ([opens, closes]: [number, number], now: number): WindowSide =>
  now < opens ? 'before' : now > closes ? 'after' : 'within';

// The latest arrival the source has reported, when it's later than planned: its
// actual or estimated arrival, or the planned one pushed back by the departure
// delay. The window stays open an hour past it, so a delay doesn't close it early.
export function withReportedArrival(
  times: FlightTimes,
  reported: FlightStatus | null,
): FlightTimes {
  const delay = reported?.departure.delayMinutes;
  const arrival =
    reported?.arrival.actual ??
    reported?.arrival.estimated ??
    (times.arrivesAt && delay ? addMinutesIso(times.arrivesAt, delay) : null);
  return arrival && (!times.arrivesAt || arrival > times.arrivesAt)
    ? { ...times, arrivesAt: arrival }
    : times;
}

// Where a lookup at `now` (epoch ms) falls against the window. An airport with no
// stored zone is read on the reader's own clock, which on the day is usually the
// one they're flying from, but before the trip can be hours off.
function zonedSide(times: FlightTimes, now: number): WindowSide {
  const zones = endpointZonesOf(times);
  return sideOf(
    lookupWindow(times, (wall, end) => zonedInstant(wall, zones[end])),
    now,
  );
}

export function isWorthLookingUp(times: FlightTimes, now: number): boolean {
  return zonedSide(times, now) === 'within';
}

// What the detail sheet says about a flight's status: a headline, its tone, and a
// line per end with whatever the source has posted.
export interface FlightStatusSummary {
  headline: string;
  tone: 'ok' | 'warning' | 'problem';
  departure: string | null;
  arrival: string | null;
}

// Late enough to call out; shorter delays read as on time.
const NOTABLE_DELAY_MINUTES = 15;

const joined = (parts: (string | false | null)[]) => parts.filter(Boolean).join(' · ') || null;
const movedTime = (end: FlightEnd, verb: string) => {
  const time = end.actual ?? end.estimated;
  return time && time !== end.scheduled && `${verb} ${formatTime(time)}`;
};

function headlineOf({
  phase,
  departure,
  arrival,
}: FlightStatus): [string, FlightStatusSummary['tone']] {
  switch (phase) {
    case 'cancelled':
      return ['Cancelled', 'problem'];
    case 'diverted':
      return ['Diverted', 'problem'];
    case 'incident':
      return ['Incident reported', 'problem'];
    case 'landed':
      return [arrival.actual ? `Landed ${formatTime(arrival.actual)}` : 'Landed', 'ok'];
    case 'active': {
      const landsAt = arrival.actual ?? arrival.estimated;
      return [landsAt ? `In the air · lands ${formatTime(landsAt)}` : 'In the air', 'ok'];
    }
    default: {
      const leaves = departure.estimated ?? departure.actual;
      const slip = leaves && departure.scheduled ? diffMinutesIso(departure.scheduled, leaves) : 0;
      const delay = Math.max(departure.delayMinutes ?? 0, slip);
      return delay >= NOTABLE_DELAY_MINUTES
        ? [`Delayed ${delay} min`, 'warning']
        : ['On time', 'ok'];
    }
  }
}

export function summarizeFlightStatus(status: FlightStatus): FlightStatusSummary {
  const { phase, departure, arrival } = status;
  const [headline, tone] = headlineOf(status);
  const departed = phase === 'active' || phase === 'landed';
  return {
    headline,
    tone,
    departure: joined([
      departure.terminal && `Terminal ${departure.terminal}`,
      departure.gate && `Gate ${departure.gate}`,
      !departed && movedTime(departure, 'leaves'),
    ]),
    arrival: joined([
      arrival.terminal && `Terminal ${arrival.terminal}`,
      arrival.gate && `Gate ${arrival.gate}`,
      arrival.baggage && `Baggage claim ${arrival.baggage}`,
    ]),
  };
}

// Airlines' ICAO codes by IATA code, for FlightAware, which only finds a flight by
// its ICAO callsign ("ASA273", not "AS273"). Used whenever no source has reported
// the flight's own callsign: before the day it flies, or when none lists it. The
// trips' carriers, plus the usual North American ones.
const AIRLINE_ICAO: Record<string, string> = {
  AA: 'AAL',
  AC: 'ACA',
  AS: 'ASA',
  B6: 'JBU',
  DL: 'DAL',
  F9: 'FFT',
  G4: 'AAY',
  HA: 'HAL',
  MX: 'MXY',
  NK: 'NKS',
  OO: 'SKW',
  QX: 'QXE',
  SY: 'SCX',
  UA: 'UAL',
  WN: 'SWA',
  WS: 'WJA',
};

// Public trackers for a flight code, which need no key and work any day.
// FlightAware uses the callsign a source reported, else the airline's ICAO code
// from the table, and is left out when neither is known.
export function flightTrackerLinks(
  code: string,
  reportedCallsign: string | null = null,
): { label: string; url: string }[] {
  const icao = AIRLINE_ICAO[code.slice(0, 2)];
  const callsign = reportedCallsign ?? (icao ? `${icao}${code.slice(2)}` : null);
  return [
    ...(callsign
      ? [{ label: 'FlightAware', url: `https://www.flightaware.com/live/flight/${callsign}` }]
      : []),
    {
      label: 'Flightradar24',
      url: `https://www.flightradar24.com/data/flights/${code.toLowerCase()}`,
    },
  ];
}

// What a lookup found: the flight's status (final once it can't change), or why
// there is none. `asOf` is when the source was asked (epoch ms), which on a reload
// is when an earlier visit did.
export type FlightLookup =
  | { kind: 'status'; status: FlightStatus; final: boolean; asOf: number }
  | { kind: 'notListed'; asOf: number }
  | { kind: 'notYet' }
  | { kind: 'over' }
  | { kind: 'noFlightNumber' };

// What the sheet says when there's no status to show.
export function flightLookupNote(lookup: FlightLookup): string | null {
  switch (lookup.kind) {
    case 'notYet':
      return `Gate, delay and baggage news shows here from ${OPENS_BEFORE_DEPARTURE_MS / HOUR_MS} hours before departure.`;
    case 'notListed':
      return 'This flight isn’t listed right now.';
    default:
      return null;
  }
}

// Whether asking again could give a different answer.
export const canChange = (lookup: FlightLookup): boolean =>
  (lookup.kind === 'status' && !lookup.final) || lookup.kind === 'notListed';

// How long one answer stands. Each lookup spends a request from a source's free
// plan; AviationStack's is 100 a month, so it is asked only when AirLabs has none.
const STATUS_TTL_MS = 15 * 60 * 1000;
// How long an answer that can't change is kept across visits: past the day it flies.
const FINAL_TTL_MS = 24 * 60 * 60 * 1000;
// How often an open sheet asks again: just past STATUS_TTL_MS, so each ask gets a
// fresh answer rather than the one it already has.
export const FLIGHT_STATUS_REFRESH_MS = STATUS_TTL_MS + 60 * 1000;

// An answer that won't change again: the flight is cancelled or diverted, or has
// landed with its baggage claim posted.
function isFinal(status: FlightStatus | null): boolean {
  return (
    status?.phase === 'cancelled' ||
    status?.phase === 'diverted' ||
    (status?.phase === 'landed' && status.arrival.baggage !== null)
  );
}

export interface FlightStatusEnv extends Required<Pick<ClientOptions, 'fetch'>> {
  // In the order they are asked: the first to know the flight answers.
  providers: FlightProvider[];
  now: () => number;
  // Keeps an answer across page loads for the ttl its value gives, and says when it
  // was computed (idbCache's `persistedEntry`).
  cached: <T>(
    key: string,
    ttlMs: (value: T) => number,
    compute: () => Promise<T>,
  ) => Promise<CacheEntry<T>>;
}

export function createFlightStatusClient(env: FlightStatusEnv) {
  // The latest answer per flight, shared by every row and sheet showing it: reused
  // for STATUS_TTL_MS after it was asked, for the rest of the visit once final, and
  // after the window closes. A failed lookup isn't kept, so it's asked again.
  type Answer = CacheEntry<FlightStatus | null>;
  interface Lookup {
    startedAt: number;
    status: Promise<Answer>;
    answer: FlightStatus | null;
  }
  const lookups = new Map<string, Lookup>();

  async function ask(provider: FlightProvider, key: string, code: string, departsAt: string) {
    const res = await env.fetch(provider.url(key, code));
    const json: unknown = await res.json().catch(() => null);
    return provider.read({ ok: res.ok, status: res.status, json }, departsAt);
  }

  // The first status a provider with a key finds. A provider that fails is skipped
  // for the next. If none finds the flight, a failure is thrown (so a bad key or a
  // dropped request is shown and the miss isn't kept); otherwise it isn't listed.
  async function fetchStatus(code: string, transit: Transit): Promise<FlightStatus | null> {
    const keyed = env.providers
      .map((provider) => ({ provider, key: provider.key() }))
      .filter(({ key }) => key);
    if (!keyed.length) {
      const names = new Intl.ListFormat('en', { type: 'disjunction' }).format(
        env.providers.map((provider) => provider.name),
      );
      throw new Error(`Add your ${names} API key in Settings.`);
    }
    let failure: unknown = null;
    for (const { provider, key } of keyed) {
      try {
        const status = await ask(provider, key, code, transit.departsAt);
        if (status) return status;
      } catch (err) {
        failure ??= err;
      }
    }
    if (failure) throw failure;
    return null;
  }

  const toLookup = ({ value, savedAt }: Answer): FlightLookup =>
    value
      ? { kind: 'status', status: value, final: isFinal(value), asOf: savedAt }
      : { kind: 'notListed', asOf: savedAt };

  // The flight's status, or why there is none. Only a lookup inside the window
  // spends a request; an answer already held is kept after the window closes.
  // Throws a message the reader can act on when the lookup itself fails.
  async function getFlightStatus(transit: Transit): Promise<FlightLookup> {
    const code = flightCode(transit);
    if (!code) return { kind: 'noFlightNumber' };
    const flight = `${code}|${transit.departsAt}`;
    const held = lookups.get(flight);
    const now = env.now();
    if (held && (isFinal(held.answer) || now - held.startedAt < STATUS_TTL_MS)) {
      return held.status.then(toLookup);
    }
    const times = withReportedArrival(transit, held?.answer ?? null);
    const side = zonedSide(times, now);
    if (side !== 'within') {
      if (!held) return { kind: side === 'before' ? 'notYet' : 'over' };
      // Once the window has closed no lookup follows, so a held answer is final.
      const lookup = toLookup(await held.status);
      return lookup.kind === 'status' && side === 'after' ? { ...lookup, final: true } : lookup;
    }
    const lookup: Lookup = {
      startedAt: now,
      answer: null,
      status: env.cached(
        `flight-status:v2:${flight}`,
        (answer: FlightStatus | null) => (isFinal(answer) ? FINAL_TTL_MS : STATUS_TTL_MS),
        () => fetchStatus(code, transit),
      ),
    };
    lookup.status.then(
      ({ value, savedAt }) => {
        lookup.answer = value;
        // An answer kept from an earlier visit is as old as it was then.
        lookup.startedAt = savedAt;
      },
      () => {
        if (lookups.get(flight) !== lookup) return;
        if (held) lookups.set(flight, held);
        else lookups.delete(flight);
      },
    );
    lookups.set(flight, lookup);
    return lookup.status.then(toLookup);
  }

  return { getFlightStatus };
}

export const { getFlightStatus } = createFlightStatusClient({
  fetch: (...args) => globalThis.fetch(...args),
  providers: [airlabs, aviationstack],
  now: () => Date.now(),
  cached: persistedEntry,
});

// What a watched flight shows: the latest lookup, and the last failure's message
// (the last good lookup stays while a refresh fails).
export interface FlightWatchState {
  lookup: FlightLookup | null;
  error: string | null;
}

export interface FlightWatchEnv {
  getFlightStatus: (transit: Transit) => Promise<FlightLookup>;
  now: () => number;
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (timer: unknown) => void;
  // Whether the page is on screen, and a way to hear when it comes back.
  visible: () => boolean;
  onVisible: (run: () => void) => () => void;
}

// Looks the flight up now, then again every FLIGHT_STATUS_REFRESH_MS while the
// answer could still change, waiting while the page is hidden so a background tab
// spends nothing. A failed refresh keeps the last lookup and tries again on the
// same interval. Returns a stop function.
export function watchFlightStatus(
  transit: Transit,
  onChange: (state: FlightWatchState) => void,
  env: FlightWatchEnv,
): () => void {
  let stopped = false;
  let timer: unknown = null;
  let unlisten: (() => void) | null = null;
  let state: FlightWatchState = { lookup: null, error: null };

  const show = (next: FlightWatchState) => {
    state = next;
    if (!stopped) onChange(next);
  };
  const scheduleNext = () => {
    if (stopped || !state.lookup || !canChange(state.lookup)) return;
    // Counted from when the answer was asked, so one kept from an earlier visit is
    // refreshed on time. An answer already older than that (a failed refresh left
    // the last one showing) waits a whole interval rather than asking in a loop.
    const age = 'asOf' in state.lookup ? Math.max(0, env.now() - state.lookup.asOf) : 0;
    const wait = FLIGHT_STATUS_REFRESH_MS - age;
    timer = env.setTimeout(whenVisible, wait > 0 ? wait : FLIGHT_STATUS_REFRESH_MS);
  };
  function whenVisible() {
    if (env.visible()) return void run();
    unlisten = env.onVisible(() => {
      unlisten?.();
      unlisten = null;
      run();
    });
  }
  function run() {
    env
      .getFlightStatus(transit)
      .then(
        (lookup) => show({ lookup, error: null }),
        (err: unknown) =>
          show({
            lookup: state.lookup,
            error: err instanceof Error ? err.message : 'The flight status lookup failed.',
          }),
      )
      .finally(scheduleNext);
  }

  run();
  return () => {
    stopped = true;
    if (timer !== null) env.clearTimeout(timer);
    unlisten?.();
  };
}
