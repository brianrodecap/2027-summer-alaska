import { describe, expect, it } from 'vitest';

import { type DayKind, dayKind } from './dayKind';
import type { PortCall } from './types';

const DATE = '2027-07-10';

const call = (kind: PortCall['kind'], arrivesAt: string, departsAt: string): PortCall => ({
  kind,
  place: { id: `p_${kind}`, label: kind },
  arrivesAt,
  departsAt,
});

// A day made of just the parts the kind reads.
function day(parts: { modes?: string[]; calls?: PortCall[]; plans?: number }) {
  return {
    date: DATE,
    scenarioTracks: Array.from({ length: parts.plans ?? 0 }, () => ({})) as never,
    stays: [{ portCalls: parts.calls ?? null }],
    transits: (parts.modes ?? []).map((mode) => ({ mode })),
  };
}

const kind = (parts: Parameters<typeof day>[0]): DayKind => dayKind(day(parts));

describe('the kind of a day', () => {
  it('is a flight when a flight departs', () => {
    expect(kind({ modes: ['flight'] })).toBe('flight');
  });

  it('is a drive when a drive departs', () => {
    expect(kind({ modes: ['drive'] })).toBe('drive');
  });

  it('is a day with plans when it has weather plans', () => {
    expect(kind({ plans: 2 })).toBe('scenario');
  });

  it('is in port when the ship stops and guests go ashore', () => {
    expect(kind({ calls: [call('port', `${DATE}T08:00`, `${DATE}T17:00`)] })).toBe('port');
  });

  it('is at sea when the ship only cruises past', () => {
    expect(kind({ calls: [call('scenic', `${DATE}T09:00`, `${DATE}T11:00`)] })).toBe('sea');
  });

  it('is a stay put when nothing else happens, and for a ferry', () => {
    expect(kind({})).toBe('stay');
    expect(kind({ modes: ['ferry'] })).toBe('stay');
  });

  it('ignores a port call on another day', () => {
    expect(kind({ calls: [call('port', '2027-07-11T08:00', '2027-07-11T17:00')] })).toBe('stay');
  });
});

describe('which kind wins when several hold', () => {
  const port = call('port', `${DATE}T08:00`, `${DATE}T17:00`);
  const scenic = call('scenic', `${DATE}T05:00`, `${DATE}T07:00`);

  it('plans win over a flight, a drive and a cruise', () => {
    expect(kind({ plans: 1, modes: ['flight', 'drive'], calls: [port] })).toBe('scenario');
  });

  it('a port beats cruising past, in either order of the calls', () => {
    expect(kind({ calls: [scenic, port] })).toBe('port');
    expect(kind({ calls: [port, scenic] })).toBe('port');
  });

  it('a cruise beats a flight and a drive', () => {
    expect(kind({ calls: [scenic], modes: ['flight', 'drive'] })).toBe('sea');
  });

  it('a flight beats a drive, in either order of the transits', () => {
    expect(kind({ modes: ['drive', 'flight'] })).toBe('flight');
    expect(kind({ modes: ['flight', 'drive'] })).toBe('flight');
  });
});
