// Live status for a flight Transit (status, gates, delays, baggage, position) from
// AviationStack's /v1/flights, looked up only around the day it flies: the free
// plan answers for flights near today and allows 100 requests a month. Never
// written back into the trip's JSON; it's only as of when the page asked.
import { getAviationstackApiKey } from '../config/apiKeys';
import type { ClientOptions } from './clientOptions';
import { persisted } from './idbCache';
import {
  addMinutesIso,
  dateOnly,
  diffMinutesIso,
  type EndpointZones,
  endpointZonesOf,
  formatTime,
  zonedInstant,
} from './tripModel';
import type { Transit } from './types';

const PHASES = ['scheduled', 'active', 'landed', 'cancelled', 'incident', 'diverted'] as const;
export type FlightPhase = (typeof PHASES)[number];

// One end of the flight. Times are the airport's local wall clock,
// 'YYYY-MM-DDTHH:MM', like Transit.departsAt.
export interface FlightEnd {
  airport: string | null;
  iata: string | null;
  timeZone: string | null;
  terminal: string | null;
  gate: string | null;
  delayMinutes: number | null;
  scheduled: string | null;
  estimated: string | null;
  actual: string | null;
}

export interface FlightStatus {
  phase: FlightPhase | null;
  departure: FlightEnd;
  arrival: FlightEnd & { baggage: string | null };
  // Where the plane is, while AviationStack is tracking it.
  live: { lat: number; lng: number; altitudeM: number | null; updatedAt: string | null } | null;
}

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

// The latest arrival AviationStack has reported, when it's later than planned: its
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

// AviationStack writes each airport's local time with a "+00:00" offset that isn't
// real (an 08:55 departure from Tokyo reads "08:55:00+00:00"), so only the wall
// clock part is kept.
function wallClock(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(value)
    ? value.slice(0, 16)
    : null;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;
const number = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function flightEnd(raw: Record<string, unknown>): FlightEnd {
  return {
    airport: text(raw.airport),
    iata: text(raw.iata),
    timeZone: text(raw.timezone),
    terminal: text(raw.terminal),
    gate: text(raw.gate),
    delayMinutes: number(raw.delay),
    scheduled: wallClock(raw.scheduled),
    estimated: wallClock(raw.estimated),
    actual: wallClock(raw.actual),
  };
}

// One entry of the response's `data`, or null when it lacks the fields a match
// needs. Every other field is optional: AviationStack leaves many of them null.
function parseFlight(value: unknown): { flightDate: string; status: FlightStatus } | null {
  const raw = record(value);
  const departure = record(raw?.departure);
  const arrival = record(raw?.arrival);
  const flightDate = text(raw?.flight_date);
  if (!raw || !departure || !arrival || !flightDate) return null;
  const live = record(raw.live);
  const lat = number(live?.latitude);
  const lng = number(live?.longitude);
  const phase = text(raw.flight_status);
  return {
    flightDate,
    status: {
      phase: (PHASES as readonly string[]).includes(phase ?? '') ? (phase as FlightPhase) : null,
      departure: flightEnd(departure),
      arrival: { ...flightEnd(arrival), baggage: text(arrival.baggage) },
      live:
        live && lat !== null && lng !== null
          ? { lat, lng, altitudeM: number(live.altitude), updatedAt: text(live.updated) }
          : null,
    },
  };
}

// The response's entry for this Transit: the one scheduled to leave at its
// departsAt, or the only one on its date. A code can return several days' flights,
// and an airline code can be shared ("AS" is also another carrier), so an entry is
// never picked by its place in the list.
export function matchFlight(
  json: unknown,
  transit: Pick<Transit, 'departsAt'>,
): FlightStatus | null {
  const data = record(json)?.data;
  if (!Array.isArray(data)) throw new Error('AviationStack sent a reply this site can’t read.');
  const flights = data.map(parseFlight).filter((f) => f !== null);
  const onTime = flights.filter((f) => f.status.departure.scheduled === transit.departsAt);
  if (onTime.length === 1) return onTime[0].status;
  const onDate = flights.filter((f) => f.flightDate === dateOnly(transit.departsAt));
  return onDate.length === 1 ? onDate[0].status : null;
}

// What the detail sheet says about a flight's status: a headline, its tone, and a
// line per end with whatever AviationStack has posted.
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
// its ICAO callsign ("ASA273", not "AS273"). The trips' carriers, plus the usual
// North American ones.
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
// FlightAware is left out for an airline whose ICAO code isn't known.
export function flightTrackerLinks(code: string): { label: string; url: string }[] {
  const icao = AIRLINE_ICAO[code.slice(0, 2)];
  return [
    ...(icao
      ? [
          {
            label: 'FlightAware',
            url: `https://www.flightaware.com/live/flight/${icao}${code.slice(2)}`,
          },
        ]
      : []),
    {
      label: 'Flightradar24',
      url: `https://www.flightradar24.com/data/flights/${code.toLowerCase()}`,
    },
  ];
}

// What a lookup found: the flight's status (final once it can't change), or why
// there is none.
export type FlightLookup =
  | { kind: 'status'; status: FlightStatus; final: boolean }
  | { kind: 'notListed' }
  | { kind: 'notYet' }
  | { kind: 'over' }
  | { kind: 'noFlightNumber' };

// What the sheet says when there's no status to show.
export function flightLookupNote(lookup: FlightLookup): string | null {
  switch (lookup.kind) {
    case 'notYet':
      return `Gate, delay and baggage news shows here from ${OPENS_BEFORE_DEPARTURE_MS / HOUR_MS} hours before departure.`;
    case 'notListed':
      return 'AviationStack doesn’t list this flight right now.';
    default:
      return null;
  }
}

// Whether asking again could give a different answer.
export const canChange = (lookup: FlightLookup): boolean =>
  (lookup.kind === 'status' && !lookup.final) || lookup.kind === 'notListed';

// AviationStack's error codes, as what the reader can do about them.
function errorMessage(error: Record<string, unknown>): string {
  switch (error.code) {
    case 'invalid_access_key':
    case 'missing_access_key':
      return 'AviationStack didn’t accept the key in Settings.';
    case 'usage_limit_reached':
      return 'This month’s AviationStack lookups are used up.';
    case 'rate_limit_reached':
      return 'Too many flight lookups at once; try again in a minute.';
    default:
      return `AviationStack: ${text(error.message) ?? 'the lookup failed.'}`;
  }
}

// How long one answer stands. Each lookup spends a request from the month's 100.
const STATUS_TTL_MS = 15 * 60 * 1000;
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
  key: () => string;
  now: () => number;
  // Keeps an answer for ttlMs across page loads (idbCache's `persisted`).
  cached: <T>(key: string, ttlMs: number, compute: () => Promise<T>) => Promise<T>;
}

export function createFlightStatusClient(env: FlightStatusEnv) {
  // The latest answer per flight, shared by every row and sheet showing it: reused
  // for STATUS_TTL_MS after it was asked, for the rest of the visit once final, and
  // after the window closes. A failed lookup isn't kept, so it's asked again.
  interface Lookup {
    startedAt: number;
    status: Promise<FlightStatus | null>;
    answer: FlightStatus | null;
  }
  const lookups = new Map<string, Lookup>();

  async function fetchStatus(code: string, transit: Transit): Promise<FlightStatus | null> {
    const key = env.key();
    if (!key) throw new Error('Add your AviationStack API key in Settings.');
    const url =
      `https://api.aviationstack.com/v1/flights?access_key=${encodeURIComponent(key)}` +
      `&flight_iata=${code}`;
    const res = await env.fetch(url);
    const json: unknown = await res.json().catch(() => null);
    const error = record(record(json)?.error);
    if (error) throw new Error(errorMessage(error));
    if (!res.ok) throw new Error(`AviationStack error ${res.status}`);
    return matchFlight(json, transit);
  }

  const toLookup = (answer: FlightStatus | null): FlightLookup =>
    answer ? { kind: 'status', status: answer, final: isFinal(answer) } : { kind: 'notListed' };

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
      status: env.cached(`flight-status:v1:${flight}`, STATUS_TTL_MS, () =>
        fetchStatus(code, transit),
      ),
    };
    lookup.status.then(
      (answer) => (lookup.answer = answer),
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
  key: getAviationstackApiKey,
  now: () => Date.now(),
  cached: persisted,
});

// What a watched flight shows: the latest lookup, and the last failure's message
// (the last good lookup stays while a refresh fails).
export interface FlightWatchState {
  lookup: FlightLookup | null;
  error: string | null;
}

export interface FlightWatchEnv {
  getFlightStatus: (transit: Transit) => Promise<FlightLookup>;
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
    timer = env.setTimeout(whenVisible, FLIGHT_STATUS_REFRESH_MS);
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
