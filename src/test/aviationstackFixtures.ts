// One /v1/flights entry, as AviationStack sends it: local wall clocks with a
// "+00:00" offset that isn't real.
export function entry(
  flightDate: string,
  departs: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    flight_date: flightDate,
    flight_status: 'scheduled',
    flight: { iata: 'AS273', icao: 'ASA273' },
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

export const DEPARTS_AT = '2027-07-08T08:55';
