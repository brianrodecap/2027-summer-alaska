// AirLabs' /flight as a flight-status source. It answers with the one instance of a
// flight code nearest today. The free plan
// allows 1,000 requests, with gates, terminals, baggage claim and position included.
import { getAirlabsApiKey } from '../config/apiKeys';
import {
  callsign,
  type FlightEnd,
  type FlightPhase,
  type FlightProvider,
  type FlightStatus,
  number,
  RATE_LIMITED,
  record,
  text,
} from './flightStatusTypes';

// AirLabs' own words for a flight's phase.
const PHASE: Record<string, FlightPhase> = {
  scheduled: 'scheduled',
  'en-route': 'active',
  landed: 'landed',
  cancelled: 'cancelled',
  diverted: 'diverted',
  incident: 'incident',
};

// 'YYYY-MM-DD HH:MM' at the airport → 'YYYY-MM-DDTHH:MM'.
function wallClock(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\d \d\d:\d\d/.test(value)
    ? value.slice(0, 16).replace(' ', 'T')
    : null;
}

// One end of the flight from `dep_` or `arr_` fields. AirLabs sends no time zone
// name, so the airport's stored zone is the only one the site has.
function flightEnd(raw: Record<string, unknown>, end: 'dep' | 'arr'): FlightEnd {
  return {
    airport: text(raw[`${end}_name`]),
    iata: text(raw[`${end}_iata`]),
    timeZone: null,
    terminal: text(raw[`${end}_terminal`]),
    gate: text(raw[`${end}_gate`]),
    delayMinutes: number(raw[`${end}_delayed`]),
    scheduled: wallClock(raw[`${end}_time`]),
    estimated: wallClock(raw[`${end}_estimated`]),
    actual: wallClock(raw[`${end}_actual`]),
  };
}

function parseFlight(raw: Record<string, unknown>): FlightStatus {
  const lat = number(raw.lat);
  const lng = number(raw.lng);
  const updated = number(raw.updated);
  return {
    phase: PHASE[text(raw.status) ?? ''] ?? null,
    callsign: callsign(raw.flight_icao),
    departure: flightEnd(raw, 'dep'),
    arrival: { ...flightEnd(raw, 'arr'), baggage: text(raw.arr_baggage) },
    live:
      lat !== null && lng !== null
        ? {
            lat,
            lng,
            altitudeM: number(raw.alt),
            updatedAt: updated === null ? null : new Date(updated * 1000).toISOString(),
          }
        : null,
  };
}

// The reply's flight when it is scheduled to leave at `departsAt`. AirLabs sends
// one flight per code, and a code can fly several legs a day, so a flight at another
// time is no match; the next source is asked instead.
export function matchFlight(json: unknown, departsAt: string): FlightStatus | null {
  const raw = record(record(json)?.response);
  if (!raw) throw new Error('AirLabs sent a reply this site can’t read.');
  const status = parseFlight(raw);
  return status.departure.scheduled === departsAt ? status : null;
}

// AirLabs' error codes, as what the reader can do about them.
function errorMessage(error: Record<string, unknown>): string {
  const code = text(error.code) ?? '';
  if (code === 'unknown_api_key') return 'AirLabs didn’t accept the key in Settings.';
  if (code === 'expired_api_key') return 'The AirLabs key in Settings has expired.';
  if (code.startsWith('minute_limit')) return RATE_LIMITED;
  if (code.startsWith('hour_limit'))
    return 'AirLabs lookups for this hour are used up; try again later.';
  if (code.includes('limit')) return 'This month’s AirLabs lookups are used up.';
  return `AirLabs: ${text(error.message) ?? 'the lookup failed.'}`;
}

export const airlabs: FlightProvider = {
  name: 'AirLabs',
  key: getAirlabsApiKey,
  url: (key, code) =>
    `https://airlabs.co/api/v9/flight?api_key=${encodeURIComponent(key)}&flight_iata=${code}`,
  read: ({ ok, status, json }, departsAt) => {
    const error = record(record(json)?.error);
    if (error?.code === 'not_found') return null;
    if (error) throw new Error(errorMessage(error));
    if (!ok) throw new Error(`AirLabs error ${status}`);
    return matchFlight(json, departsAt);
  },
};
