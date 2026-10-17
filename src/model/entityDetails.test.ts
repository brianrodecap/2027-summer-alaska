import { describe, expect, it } from 'vitest';

import {
  includedInLabel,
  packageCostLabel,
  portCallsInOrder,
  portCallWhenLabel,
  stayWhenLabel,
  transitWhenLabel,
} from './entityDetails';
import { lodgingExtraBits } from './formatting';
import type { Activity, Package, PortCall, Stay, Transit, TripData } from './types';

const usd = (amount: number) => ({ amount, currency: 'USD' });

describe('stayWhenLabel', () => {
  it('dates both ends and counts the nights once a stay spans days', () => {
    expect(stayWhenLabel({ checkInAt: '2027-07-17T15:00', checkOutAt: '2027-07-24T07:30' })).toBe(
      'Sat Jul 17, 3:00pm in → Sat Jul 24, 7:30am out · 7 nights',
    );
    expect(stayWhenLabel({ checkInAt: '2027-07-17T15:00', checkOutAt: '2027-07-18T11:00' })).toBe(
      'Sat Jul 17, 3:00pm in → Sun Jul 18, 11:00am out · 1 night',
    );
  });

  it('keeps a same-day stay to its times', () => {
    expect(stayWhenLabel({ checkInAt: '2027-07-17T09:00', checkOutAt: '2027-07-17T17:00' })).toBe(
      '9:00am in · 5:00pm out',
    );
  });
});

describe('transitWhenLabel', () => {
  it('keeps a same-day trip to its times', () => {
    expect(transitWhenLabel({ departsAt: '2027-07-08T08:55', arrivesAt: '2027-07-08T10:33' })).toBe(
      '8:55am depart · 10:33am arrive',
    );
  });

  it('dates both ends of an overnight trip', () => {
    expect(transitWhenLabel({ departsAt: '2027-07-09T22:00', arrivesAt: '2027-07-10T06:00' })).toBe(
      'Fri Jul 9, 10:00pm depart → Sat Jul 10, 6:00am arrive',
    );
  });

  it('says when the arrival is not known yet', () => {
    expect(transitWhenLabel({ departsAt: '2027-07-08T08:55', arrivesAt: null })).toBe(
      '8:55am depart · arrival time TBD',
    );
  });
});

describe('lodgingExtraBits', () => {
  it('lists the lodging fields the day row leaves out', () => {
    expect(
      lodgingExtraBits({
        place: { id: null, label: 'Ship' },
        deckGroup: 'Upper',
        shipZone: 'Mid-Forward',
        partySize: 4,
        equipment: 'Tent',
        vehicleCount: 1,
      }),
    ).toEqual(['Upper deck', 'Mid-Forward', 'Party of 4', 'Tent', '1 vehicle']);
    expect(lodgingExtraBits(null)).toEqual([]);
  });
});

describe('packageCostLabel', () => {
  const pkg: Package = {
    _id: 'p1',
    name: 'Parking',
    status: 'booked',
    cost: usd(25),
    confirmationNumber: null,
    benefits: null,
    travelers: null,
  };

  it('shows a one-time cost as is', () => {
    expect(packageCostLabel(pkg, 6)).toBe('$25.00');
  });

  it("totals a nightly rate over the holder's nights, as the budget does", () => {
    expect(packageCostLabel({ ...pkg, per: 'night' }, 6)).toBe(
      '$25.00 / night · $150.00 for 6 nights',
    );
  });

  it('charges a nightly rate once off a Stay, as the budget does', () => {
    expect(packageCostLabel({ ...pkg, per: 'night' }, null)).toBe('$25.00');
  });

  it('is null when unpriced', () => {
    expect(packageCostLabel({ ...pkg, cost: null }, 6)).toBeNull();
  });
});

describe('port calls', () => {
  const call = (label: string, arrivesAt: string | null, departsAt: string | null): PortCall => ({
    kind: 'port',
    place: { id: null, label },
    arrivesAt,
    departsAt,
  });

  it('labels a call by its day and hours, dating an overnight one at both ends', () => {
    expect(portCallWhenLabel(call('A', '2027-07-21T06:30', '2027-07-21T16:15'))).toBe(
      'Wed Jul 21 · 6:30am–4:15pm',
    );
    expect(portCallWhenLabel(call('B', '2027-07-21T20:00', '2027-07-22T06:00'))).toBe(
      'Wed Jul 21, 8:00pm → Thu Jul 22, 6:00am',
    );
    expect(portCallWhenLabel(call('C', null, null))).toBe('Times not printed');
  });

  it('orders calls by when the ship gets there, not by how they are listed', () => {
    const later = call('Later', '2027-07-22T10:00', null);
    const earlier = call('Earlier', null, '2027-07-20T19:00');
    const unknown = call('Unknown', null, null);
    expect(portCallsInOrder([unknown, later, earlier]).map((c) => c.place.label)).toEqual([
      'Earlier',
      'Later',
      'Unknown',
    ]);
  });
});

describe('includedInLabel', () => {
  const data = {
    stays: [
      {
        _id: 's1',
        lodging: { place: { id: null, label: 'Test Lodge' } },
        packages: [{ _id: 'pkg1', name: 'Meal plan' }],
      } as unknown as Stay,
    ],
    transits: [{ _id: 't1', from: { label: 'A' }, to: { label: 'B' } } as unknown as Transit],
    activities: [{ _id: 'a1', text: 'Glacier tour', place: null } as unknown as Activity],
  } as Pick<TripData, 'stays' | 'transits' | 'activities'>;

  it('names a package, or the entity a meal comes with', () => {
    expect(includedInLabel(data, { entity: 'package', id: 'pkg1' })).toBe('Included in Meal plan');
    expect(includedInLabel(data, { entity: 'stay', id: 's1' })).toBe('Included with Test Lodge');
    expect(includedInLabel(data, { entity: 'activity', id: 'a1' })).toBe(
      'Included with Glacier tour',
    );
    expect(includedInLabel(data, { entity: 'transit', id: 't1' })).toBe('Included with A → B');
  });

  it('is null when not included, or the target is gone', () => {
    expect(includedInLabel(data, null)).toBeNull();
    expect(includedInLabel(data, { entity: 'package', id: 'missing' })).toBeNull();
  });
});
