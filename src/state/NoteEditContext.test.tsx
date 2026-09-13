import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode, useContext, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TripData } from '../model/types';
import { NoteEditProvider } from './NoteEditContext';
import { TripDataContext } from './TripDataContextObject';
import { useNoteEdit } from './useNoteEdit';

afterEach(cleanup);

function minimalTripData(): TripData {
  return {
    trip: { _id: 'trip_test', name: 'Test Trip', travelers: [], images: [] },
    legs: [],
    stays: [],
    transits: [],
    activities: [],
    scenarios: [],
    notes: [],
    travelModeOverrides: [],
    routes: [],
  };
}

// A minimal stand-in for TripDataProvider (which does a real network fetch)
// — just enough state + setData for NoteEditContext to read/write notes.
function TestHarness({ children }: { children: ReactNode }) {
  const [data, setDataState] = useState<TripData>(minimalTripData());
  return (
    <TripDataContext.Provider
      value={{
        slug: 'test',
        data,
        view: null,
        loading: false,
        error: null,
        dirtyCollections: new Set(),
        setData: (updater) => setDataState((prev) => updater(prev)),
      }}
    >
      <NoteEditProvider>{children}</NoteEditProvider>
    </TripDataContext.Provider>
  );
}

// A tiny escape hatch so a harness component can read the same TripData the
// provider above it supplies, without re-plumbing props.
function useTripDataForTest(): TripData {
  const value = useContext(TripDataContext);
  if (!value) throw new Error('missing TripDataContext');
  return value.data as TripData;
}

// Exposes the notes currently in TripData (for assertions) and a button to
// kick off a two-note draft sequence, via the same context real callers use.
function SequenceHarness({ onComplete }: { onComplete: () => void }) {
  const { openNoteDraftSequence } = useNoteEdit();
  const data = useTripDataForTest();
  return (
    <div>
      <button
        onClick={() =>
          openNoteDraftSequence(
            [
              { ref: { entity: 'stay', id: 's1' }, kind: 'warning', text: 'First note' },
              { ref: { entity: 'stay', id: 's1' }, kind: 'info', text: 'Second note' },
            ],
            onComplete,
          )
        }
      >
        Start sequence
      </button>
      <div data-testid="notes-count">{data.notes.length}</div>
      <div data-testid="notes-text">{data.notes.map((n) => n.text).join(' | ')}</div>
    </div>
  );
}

function ManualCreateHarness() {
  const { openNoteCreate } = useNoteEdit();
  return (
    <button onClick={() => openNoteCreate({ entity: 'stay', id: 's1' }, 'info')}>
      Add manually
    </button>
  );
}

describe('NoteEditContext: draft sequence Next/Back', () => {
  // A longer timeout than the default 5000ms: this test drives several
  // renders/interactions in sequence, which the default budget can miss
  // under the parallel load of the full suite even though the test itself
  // runs in well under a second in isolation.
  it('labels Save as "Next" until the last item, and Back returns to and updates an earlier saved note', () => {
    const onComplete = vi.fn();
    render(
      <TestHarness>
        <SequenceHarness onComplete={onComplete} />
      </TestHarness>,
    );

    fireEvent.click(screen.getByText('Start sequence'));

    // First note: Save reads "Next" since a second one is still queued.
    expect(screen.getByDisplayValue('First note')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByTestId('notes-count').textContent).toBe('1');
    expect(screen.getByTestId('notes-text').textContent).toBe('First note');

    // Second (last) note: Save reads "Save", and Back is now available.
    expect(screen.getByDisplayValue('Second note')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    const backButton = screen.getByRole('button', { name: 'Back' });

    fireEvent.click(backButton);

    // Back returns to the first note (already saved) — editing and
    // re-saving it must update that same note, not append a duplicate.
    expect(screen.getByDisplayValue('First note')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy();

    const textbox = screen.getByLabelText('Note text');
    fireEvent.change(textbox, { target: { value: 'First note, edited' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByTestId('notes-count').textContent).toBe('1');
    expect(screen.getByTestId('notes-text').textContent).toBe('First note, edited');

    // Back on the re-queued second note.
    expect(screen.getByDisplayValue('Second note')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByTestId('notes-count').textContent).toBe('2');
    expect(onComplete).toHaveBeenCalledTimes(1);
  }, 15000);

  it('does not offer Skip/Back for a plain manual note create', () => {
    render(
      <TestHarness>
        <ManualCreateHarness />
      </TestHarness>,
    );
    fireEvent.click(screen.getByText('Add manually'));
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });
});
