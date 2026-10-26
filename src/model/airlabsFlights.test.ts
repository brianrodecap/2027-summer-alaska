import { describe, expect, it } from 'vitest';

import { airlabs, matchFlight } from './airlabsFlights';

const DEPARTS_AT = '2027-07-08T08:55';

// A /flight reply as AirLabs sends it: local wall clocks as 'YYYY-MM-DD HH:MM'.
function reply(overrides: Record<string, unknown> = {}) {
  return {
    response: {
      status: 'en-route',
      flight_icao: 'ASA273',
      dep_iata: 'ANC',
      dep_name: 'Ted Stevens Anchorage International',
      dep_terminal: 'S',
      dep_gate: 'C3',
      dep_time: '2027-07-08 08:55',
      dep_estimated: '2027-07-08 09:10',
      dep_actual: '2027-07-08 09:12',
      dep_delayed: null,
      arr_iata: 'OTZ',
      arr_name: 'Ralph Wien Memorial',
      arr_terminal: null,
      arr_gate: null,
      arr_baggage: '2',
      arr_time: '2027-07-08 10:33',
      arr_estimated: '2027-07-08 10:50',
      arr_actual: null,
      lat: 66.8,
      lng: -162.6,
      alt: 9000,
      updated: 1_800_000_000,
      ...overrides,
    },
  };
}

describe('matchFlight (AirLabs)', () => {
  it('reads the airport’s own clock, gate, baggage claim and position', () => {
    expect(matchFlight(reply(), DEPARTS_AT)).toEqual({
      phase: 'active',
      callsign: 'ASA273',
      departure: {
        airport: 'Ted Stevens Anchorage International',
        iata: 'ANC',
        timeZone: null,
        terminal: 'S',
        gate: 'C3',
        delayMinutes: null,
        scheduled: '2027-07-08T08:55',
        estimated: '2027-07-08T09:10',
        actual: '2027-07-08T09:12',
      },
      arrival: {
        airport: 'Ralph Wien Memorial',
        iata: 'OTZ',
        timeZone: null,
        terminal: null,
        gate: null,
        delayMinutes: null,
        scheduled: '2027-07-08T10:33',
        estimated: '2027-07-08T10:50',
        actual: null,
        baggage: '2',
      },
      live: { lat: 66.8, lng: -162.6, altitudeM: 9000, updatedAt: '2027-01-15T08:00:00.000Z' },
    });
  });

  it('matches nothing when AirLabs has another leg of the code that day', () => {
    expect(matchFlight(reply({ dep_time: '2027-07-08 11:30' }), DEPARTS_AT)).toBeNull();
  });

  it('matches nothing when AirLabs has the code’s flight on another day', () => {
    expect(matchFlight(reply({ dep_time: '2027-07-09 08:55' }), DEPARTS_AT)).toBeNull();
  });

  it('maps its phases, and treats an unknown one as no phase', () => {
    const phaseOf = (status: string) => matchFlight(reply({ status }), DEPARTS_AT)?.phase;
    expect(phaseOf('scheduled')).toBe('scheduled');
    expect(phaseOf('landed')).toBe('landed');
    expect(phaseOf('cancelled')).toBe('cancelled');
    expect(phaseOf('boarding')).toBeNull();
  });

  it('reads a callsign in capitals, with a letter suffix, and none when it has none', () => {
    const callsignOf = (flight_icao: unknown) =>
      matchFlight(reply({ flight_icao }), DEPARTS_AT)?.callsign;
    expect(callsignOf(' dlh7ya ')).toBe('DLH7YA');
    expect(callsignOf(null)).toBeNull();
  });

  it('keeps only a callsign that looks like one', () => {
    expect(matchFlight(reply({ flight_icao: 'not a callsign' }), DEPARTS_AT)?.callsign).toBeNull();
  });

  it('has no position for a flight that isn’t airborne', () => {
    expect(matchFlight(reply({ lat: undefined, lng: undefined }), DEPARTS_AT)?.live).toBeNull();
  });

  it('rejects a reply that has no flight', () => {
    expect(() => matchFlight({ terms: 'x' }, DEPARTS_AT)).toThrow(
      'AirLabs sent a reply this site can’t read.',
    );
  });
});

describe('AirLabs replies', () => {
  const read = (json: unknown, ok = true, status = 200) =>
    airlabs.read({ ok, status, json }, DEPARTS_AT);

  it('says a flight AirLabs doesn’t know is not listed, rather than failing', () => {
    expect(read({ error: { code: 'not_found', message: 'Flight not found' } })).toBeNull();
  });

  it('turns its error codes into what the reader can do', () => {
    expect(() => read({ error: { code: 'unknown_api_key' } })).toThrow(
      'AirLabs didn’t accept the key in Settings.',
    );
    expect(() => read({ error: { code: 'expired_api_key' } })).toThrow(
      'The AirLabs key in Settings has expired.',
    );
    expect(() => read({ error: { code: 'minute_limit_exceeded' } })).toThrow(
      'Too many flight lookups at once; try again in a minute.',
    );
    expect(() => read({ error: { code: 'hour_limit_exceeded' } })).toThrow(
      'AirLabs lookups for this hour are used up; try again later.',
    );
    expect(() => read({ error: { code: 'limit_exceeded' } })).toThrow(
      'This month’s AirLabs lookups are used up.',
    );
    expect(() => read({ error: { code: 'wrong_params', message: 'Bad flight' } })).toThrow(
      'AirLabs: Bad flight',
    );
  });

  it('fails on an HTTP error that carries no AirLabs error', () => {
    expect(() => read(null, false, 502)).toThrow('AirLabs error 502');
  });

  it('puts the key and flight code in the request', () => {
    expect(airlabs.url('k e y', 'AS273')).toBe(
      'https://airlabs.co/api/v9/flight?api_key=k%20e%20y&flight_iata=AS273',
    );
  });
});
