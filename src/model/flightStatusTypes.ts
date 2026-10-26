// What a flight-status lookup returns, whichever source answered, and the readers
// the sources share for picking fields out of a reply they can't trust.

export const PHASES = [
  'scheduled',
  'active',
  'landed',
  'cancelled',
  'incident',
  'diverted',
] as const;
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
  // The flight's ICAO callsign ("ASA273" for AS273), which FlightAware needs.
  callsign: string | null;
  // Where the plane is, while the source is tracking it.
  live: { lat: number; lng: number; altitudeM: number | null; updatedAt: string | null } | null;
}

// What a source needs to look a flight up and read its answer.
export interface FlightProvider {
  name: string;
  // '' when Settings has no key for it.
  key: () => string;
  url: (key: string, flightCode: string) => string;
  // The reply's status for the flight leaving at `departsAt`; null when it lists no
  // such flight. Throws a message the reader can act on when the reply is an error.
  read: (
    reply: { ok: boolean; status: number; json: unknown },
    departsAt: string,
  ) => FlightStatus | null;
}

// What a provider's per-minute or per-hour limit tells the reader.
export const RATE_LIMITED = 'Too many flight lookups at once; try again in a minute.';

export const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;
export const number = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
export const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

// An ICAO callsign: the airline's three letters, then digits and up to two letters.
export const callsign = (value: unknown): string | null => {
  const code = text(value)?.toUpperCase() ?? '';
  return /^[A-Z]{3}\d{1,4}[A-Z]{0,2}$/.test(code) ? code : null;
};
