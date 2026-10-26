import { describe, expect, it } from 'vitest';

import { DEPARTS_AT, entry } from '../test/aviationstackFixtures';
import { matchFlight } from './aviationstackFlights';

describe('matchFlight', () => {
  it('reads the airport’s own clock, not the offset AviationStack labels it with', () => {
    const status = matchFlight({ data: [entry('2027-07-08', '08:55')] }, DEPARTS_AT);
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
      DEPARTS_AT,
    );
    expect(status?.phase).toBe('landed');
  });

  it('falls back to the only flight on the date when the time has moved', () => {
    const status = matchFlight(
      { data: [entry('2027-07-07', '08:55'), entry('2027-07-08', '09:20')] },
      DEPARTS_AT,
    );
    expect(status?.departure.scheduled).toBe('2027-07-08T09:20');
  });

  it('matches nothing when two flights that day could be it', () => {
    expect(
      matchFlight(
        { data: [entry('2027-07-08', '07:00'), entry('2027-07-08', '19:00')] },
        DEPARTS_AT,
      ),
    ).toBeNull();
  });

  it('keeps the plane’s position only when it has one', () => {
    const live = { latitude: 61.2, longitude: -149.9, altitude: 9000, updated: '2027-07-08T17:20' };
    expect(
      matchFlight({ data: [entry('2027-07-08', '08:55', { live })] }, DEPARTS_AT)?.live,
    ).toEqual({
      lat: 61.2,
      lng: -149.9,
      altitudeM: 9000,
      updatedAt: '2027-07-08T17:20',
    });
  });

  it('reads the flight’s ICAO callsign, and none that isn’t one', () => {
    const callsignOf = (flight: unknown) =>
      matchFlight({ data: [entry('2027-07-08', '08:55', { flight })] }, DEPARTS_AT)?.callsign;
    expect(callsignOf({ icao: 'asa273' })).toBe('ASA273');
    expect(callsignOf({ icao: 'AS 273' })).toBeNull();
    expect(callsignOf(null)).toBeNull();
  });

  it('treats an unknown status as no status, not a reason to drop the flight', () => {
    const status = matchFlight(
      { data: [entry('2027-07-08', '08:55', { flight_status: 'boarding' })] },
      DEPARTS_AT,
    );
    expect(status).not.toBeNull();
    expect(status?.phase).toBeNull();
  });

  it('rejects a reply that has no flight list', () => {
    expect(() => matchFlight({ pagination: {} }, DEPARTS_AT)).toThrow(
      'AviationStack sent a reply this site can’t read.',
    );
  });
});
