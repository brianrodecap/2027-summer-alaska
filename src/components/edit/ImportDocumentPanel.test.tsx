import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { QueuedImport } from '../../model/documentImport';
import { blankActivity, blankTransit } from '../../model/editForms';
import type { Transit } from '../../model/types';
import { ImportEntryRow } from './ImportDocumentPanel';

afterEach(cleanup);

const placeholder: Transit = {
  ...blankTransit('leg_t', '2027-07-11'),
  _id: 'ph_out',
  mode: 'flight',
  from: { id: 'place_base', label: 'Test Air Base' },
  to: { id: 'place_lodge', label: 'Remote Lodge' },
  departsAt: '2027-07-11T08:30',
};

describe('ImportEntryRow', () => {
  it('shows an update with what moves, its booking and the AI’s reason', () => {
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
    render(<ImportEntryRow draft={draft} before={placeholder} />);
    expect(screen.getByText(/booking T123/)).toBeInTheDocument();
    expect(screen.getByText(/1 note to review/)).toBeInTheDocument();
    expect(screen.getByText(/departs 8:30am → 8:00am/)).toBeInTheDocument();
    expect(screen.getByText('Same operator and morning')).toBeInTheDocument();
  });

  it('shows a new entry, and a booking still awaiting confirmation', () => {
    const draft: QueuedImport = {
      kind: 'activity',
      entity: { ...blankActivity('leg_t', '2026-06-16'), text: 'Alcatraz Night Tour' },
      bookings: [{ _id: 'bk', status: 'requested', pricing: null, confirmationNumber: null }],
      travelers: [],
      notes: [],
      why: 'A new tour',
    };
    render(<ImportEntryRow draft={draft} before={null} />);
    expect(screen.getByText('Adds a new activity')).toBeInTheDocument();
    expect(screen.getByText(/awaiting confirmation/)).toBeInTheDocument();
  });
});
