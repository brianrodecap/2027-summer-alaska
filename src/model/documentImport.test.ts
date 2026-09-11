import { describe, expect, it } from 'vitest';

import {
  draftEntityFromExtraction,
  draftIncludedTransfers,
  type ExtractedFields,
  mergeBooking,
  notesFromExtraction,
} from './documentImport';
import type { Stay } from './types';

// A synthetic stand-in for a Kennicott-Glacier-Lodge-style booking
// confirmation: no direct vehicle access, so the rate bundles a round-trip
// shuttle to a fixed meeting point, plus a nonrefundable-style callout.
function kennicottLikeFields(overrides: Partial<ExtractedFields> = {}): ExtractedFields {
  return {
    kind: 'stay',
    lodgingName: 'Kennicott Glacier Lodge',
    checkInAt: '2027-07-03T14:00',
    checkOutAt: '2027-07-05T11:00',
    bookingStatus: 'booked',
    costAmount: 990,
    includedTransfers: [{ transferPointLabel: 'McCarthy Road footbridge' }],
    includedPerks: ['Round-trip shuttle between the McCarthy Road footbridge and the lodge'],
    noteworthy: [{ kind: 'warning', text: 'Cancellation fees apply within 60 days of arrival.' }],
    ...overrides,
  };
}

describe('draftEntityFromExtraction: included perks/fees', () => {
  it('folds includedPerks into a zero-cost Package on the stay', () => {
    const stay = draftEntityFromExtraction(kennicottLikeFields(), 'leg_test', '2027-07-03') as Stay;
    expect(stay.packages).toHaveLength(1);
    expect(stay.packages?.[0].cost).toBeNull();
    expect(stay.packages?.[0].benefits).toEqual([
      'Round-trip shuttle between the McCarthy Road footbridge and the lodge',
    ]);
  });

  it('keeps extraFees and includedPerks as separate packages when both are present', () => {
    const fields = kennicottLikeFields({
      extraFees: [{ name: 'Pet fee', amount: 25 }],
    });
    const stay = draftEntityFromExtraction(fields, 'leg_test', '2027-07-03') as Stay;
    expect(stay.packages).toHaveLength(2);
    expect(stay.packages?.map((p) => p.name)).toEqual(['Pet fee', 'Included with your stay']);
  });
});

describe('draftIncludedTransfers', () => {
  it('produces an arrival transit anchored at check-in and a departure transit anchored at check-out', () => {
    const fields = kennicottLikeFields();
    const stay = draftEntityFromExtraction(fields, 'leg_test', '2027-07-03') as Stay;
    const transfers = draftIncludedTransfers(fields, stay, 'leg_test');

    expect(transfers).toHaveLength(2);
    const [arrival, departure] = transfers.map((t) => t.transit);

    expect(arrival.mode).toBe('shuttle');
    expect(arrival.departsAt).toBe('2027-07-03T14:00');
    expect(arrival.from.label).toBe('McCarthy Road footbridge');
    expect(arrival.to.label).toBe('Kennicott Glacier Lodge');

    expect(departure.mode).toBe('shuttle');
    expect(departure.departsAt).toBe('2027-07-05T11:00');
    expect(departure.from.label).toBe('Kennicott Glacier Lodge');
    expect(departure.to.label).toBe('McCarthy Road footbridge');
  });

  it('returns nothing for a stay with no included transfers', () => {
    const fields = kennicottLikeFields({ includedTransfers: undefined });
    const stay = draftEntityFromExtraction(fields, 'leg_test', '2027-07-03') as Stay;
    expect(draftIncludedTransfers(fields, stay, 'leg_test')).toEqual([]);
  });
});

describe('draftEntityFromExtraction: contact fallbacks', () => {
  it('sets phone/email/website on the lodging place when no id was resolved', () => {
    const fields = kennicottLikeFields({
      phone: '+1 907 2582350',
      email: 'reservations@kennicottlodge.com',
      website: 'http://www.KennicottLodge.com',
    });
    const stay = draftEntityFromExtraction(fields, 'leg_test', '2027-07-03') as Stay;
    expect(stay.lodging?.place.phone).toBe('+1 907 2582350');
    expect(stay.lodging?.place.email).toBe('reservations@kennicottlodge.com');
    expect(stay.lodging?.place.website).toBe('http://www.KennicottLodge.com');
  });

  // Regression: a resolved Place (id + images returned by the live Text
  // Search / Place Details lookup) has no phone/email/website fields of its
  // own — assigning it wholesale onto stay.lodging.place used to silently
  // drop everything the AI had just extracted, email included, even though
  // email has no live Google equivalent to fall back on afterward.
  it('keeps the extracted email even when the place resolves to a real Google id', () => {
    const fields = kennicottLikeFields({
      phone: '+1 907 2582350',
      email: 'reservations@kennicottlodge.com',
      website: 'http://www.KennicottLodge.com',
    });
    const stay = draftEntityFromExtraction(fields, 'leg_test', '2027-07-03', {
      lodging: { id: 'place_real', label: 'Kennicott Glacier Lodge', images: [] },
    }) as Stay;
    expect(stay.lodging?.place.id).toBe('place_real');
    expect(stay.lodging?.place.email).toBe('reservations@kennicottlodge.com');
  });
});

describe('draftIncludedTransfers: notes', () => {
  it("attaches each transfer note to both of that transfer's own Transit drafts", () => {
    const fields = kennicottLikeFields({
      includedTransfers: [
        {
          transferPointLabel: 'McCarthy Road footbridge',
          notes: [
            {
              kind: 'info',
              text: 'Shuttle runs hourly noon–8pm; confirm which arrival mode applies (car, shuttle van, or plane) since each meets at a different point.',
            },
          ],
        },
      ],
    });
    const stay = draftEntityFromExtraction(fields, 'leg_test', '2027-07-03') as Stay;
    const transfers = draftIncludedTransfers(fields, stay, 'leg_test');

    expect(transfers).toHaveLength(2);
    expect(transfers.every((t) => t.notes.length === 1 && t.notes[0].kind === 'info')).toBe(true);
  });

  it('returns no notes when a transfer has none of its own', () => {
    const fields = kennicottLikeFields();
    const stay = draftEntityFromExtraction(fields, 'leg_test', '2027-07-03') as Stay;
    const transfers = draftIncludedTransfers(fields, stay, 'leg_test');
    expect(transfers.every((t) => t.notes.length === 0)).toBe(true);
  });
});

describe('notesFromExtraction', () => {
  it('turns each noteworthy callout into a draft concerning the given entity id', () => {
    const notes = notesFromExtraction(kennicottLikeFields(), 'stay_123');
    expect(notes).toEqual([
      {
        ref: { entity: 'stay', id: 'stay_123' },
        kind: 'warning',
        text: 'Cancellation fees apply within 60 days of arrival.',
      },
    ]);
  });

  it('returns an empty array when nothing is noteworthy', () => {
    expect(notesFromExtraction(kennicottLikeFields({ noteworthy: undefined }), 'stay_123')).toEqual(
      [],
    );
  });
});

describe('mergeBooking: bookedThrough', () => {
  it('sets bookedThrough on a freshly-merged booking', () => {
    const booking = mergeBooking({ kind: 'stay', bookedThrough: 'Capital One Travel' });
    expect(booking?.bookedThrough).toBe('Capital One Travel');
  });

  it('preserves an existing bookedThrough when the extraction omits it', () => {
    const base = {
      status: 'booked' as const,
      cost: null,
      confirmationNumber: null,
      bookedThrough: 'Expedia',
    };
    const booking = mergeBooking({ kind: 'stay', costAmount: 100 }, base);
    expect(booking?.bookedThrough).toBe('Expedia');
  });
});
