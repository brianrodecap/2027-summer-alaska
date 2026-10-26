// AviationStack's /v1/flights as a flight-status source. The free plan answers for
// flights near today and allows 100 requests a month.
import { getAviationstackApiKey } from '../config/apiKeys';
import {
  callsign,
  type FlightEnd,
  type FlightPhase,
  type FlightProvider,
  type FlightStatus,
  number,
  PHASES,
  RATE_LIMITED,
  record,
  text,
} from './flightStatusTypes';
import { dateOnly } from './tripModel';

// AviationStack writes each airport's local time with a "+00:00" offset that isn't
// real (an 08:55 departure from Tokyo reads "08:55:00+00:00"), so only the wall
// clock part is kept.
function wallClock(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(value)
    ? value.slice(0, 16)
    : null;
}

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
  const flight = record(raw.flight);
  return {
    flightDate,
    status: {
      phase: (PHASES as readonly string[]).includes(phase ?? '') ? (phase as FlightPhase) : null,
      callsign: callsign(flight?.icao),
      departure: flightEnd(departure),
      arrival: { ...flightEnd(arrival), baggage: text(arrival.baggage) },
      live:
        live && lat !== null && lng !== null
          ? { lat, lng, altitudeM: number(live.altitude), updatedAt: text(live.updated) }
          : null,
    },
  };
}

// The response's entry for the flight leaving at `departsAt`: the one scheduled
// then, or the only one on its date. A code can return several days' flights, and
// an airline code can be shared ("AS" is also another carrier), so an entry is
// never picked by its place in the list.
export function matchFlight(json: unknown, departsAt: string): FlightStatus | null {
  const data = record(json)?.data;
  if (!Array.isArray(data)) throw new Error('AviationStack sent a reply this site can’t read.');
  const flights = data.map(parseFlight).filter((f) => f !== null);
  const onTime = flights.filter((f) => f.status.departure.scheduled === departsAt);
  if (onTime.length === 1) return onTime[0].status;
  const onDate = flights.filter((f) => f.flightDate === dateOnly(departsAt));
  return onDate.length === 1 ? onDate[0].status : null;
}

// AviationStack's error codes, as what the reader can do about them.
function errorMessage(error: Record<string, unknown>): string {
  switch (error.code) {
    case 'invalid_access_key':
    case 'missing_access_key':
      return 'AviationStack didn’t accept the key in Settings.';
    case 'usage_limit_reached':
      return 'This month’s AviationStack lookups are used up.';
    case 'rate_limit_reached':
      return RATE_LIMITED;
    default:
      return `AviationStack: ${text(error.message) ?? 'the lookup failed.'}`;
  }
}

export const aviationstack: FlightProvider = {
  name: 'AviationStack',
  key: getAviationstackApiKey,
  url: (key, code) =>
    `https://api.aviationstack.com/v1/flights?access_key=${encodeURIComponent(key)}` +
    `&flight_iata=${code}`,
  read: ({ ok, status, json }, departsAt) => {
    const error = record(record(json)?.error);
    if (error) throw new Error(errorMessage(error));
    if (!ok) throw new Error(`AviationStack error ${status}`);
    return matchFlight(json, departsAt);
  },
};
