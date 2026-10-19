import { describe, expect, it } from 'vitest';

import type { QueuedImport } from './documentImport';
import { blankActivity, blankTransit } from './editForms';
import { importRowSummary } from './importSummary';
import type { Transit } from './types';

const placeholder: Transit = {
  ...blankTransit('leg_t', '2027-07-11'),
  _id: 'ph_out',
  mode: 'flight',
  from: { id: 'place_base', label: 'Test Air Base' },
  to: { id: 'place_lodge', label: 'Remote Lodge' },
  departsAt: '2027-07-11T08:30',
};

describe('importRowSummary', () => {
  it('describes an update by what moves, its booking and notes', () => {
    const draft: QueuedImport = {
      kind: 'transit',
      entity: { ...placeholder, departsAt: '2027-07-11T08:00' },
      bookings: [{ _id: 'bk', status: 'booked', pricing: null, confirmationNumber: 'T123' }],
      travelers: [],
      overrideId: 'ph_out',
      why: 'Same operator and morning',
      notes: [
        { ref: { entity: 'transit', id: 'ph_out' }, kind: 'info', text: 'Refund until May 1.' },
      ],
    };
    expect(importRowSummary(draft, placeholder)).toEqual({
      title: 'Transit: Test Air Base → Remote Lodge',
      details: 'Sun Jul 11 · booking T123 · 1 note to review',
      effect: {
        kind: 'updates',
        label: 'Test Air Base → Remote Lodge',
        changes: 'departs 8:30am → 8:00am',
      },
    });
  });

  it('names the dates when an update moves to another day', () => {
    const draft: QueuedImport = {
      kind: 'transit',
      entity: { ...placeholder, departsAt: '2027-07-12T08:30' },
      bookings: [],
      travelers: [],
      overrideId: 'ph_out',
      why: '',
      notes: [],
    };
    expect(importRowSummary(draft, placeholder).effect).toMatchObject({
      changes: expect.stringMatching(/^departs .+ 8:30am → .+ 8:30am$/),
    });
  });

  it('names no change when an update keeps its time', () => {
    const draft: QueuedImport = {
      kind: 'transit',
      entity: placeholder,
      bookings: [],
      travelers: [],
      overrideId: 'ph_out',
      why: '',
      notes: [],
    };
    expect(importRowSummary(draft, placeholder).effect).toMatchObject({ changes: null });
  });

  it('describes a new entry, and a booking still awaiting confirmation', () => {
    const draft: QueuedImport = {
      kind: 'activity',
      entity: { ...blankActivity('leg_t', '2026-06-16'), text: 'Alcatraz Night Tour' },
      bookings: [{ _id: 'bk', status: 'requested', pricing: null, confirmationNumber: null }],
      travelers: [],
      notes: [],
      why: 'A new tour',
    };
    const summary = importRowSummary(draft, null);
    expect(summary.effect).toEqual({ kind: 'adds', label: 'Adds a new activity' });
    expect(summary.details).toMatch(/awaiting confirmation$/);
  });
});
