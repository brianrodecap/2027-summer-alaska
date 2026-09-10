import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Route } from '../../model/types';
import { RouteEditForm } from './RouteEditForm';

// This file has no global RTL auto-cleanup wired up (src/test/setup.ts only
// registers jest-dom's matchers) — with more than one test in a file, a
// prior test's tree stays mounted, so a getAllByLabelText/getByRole query in
// a later test can silently match the wrong render entirely.
afterEach(cleanup);

// Keeps the test hermetic — real search would debounce into a network call.
vi.mock('./usePlaceSearch', () => ({
  usePlaceSearch: () => ({
    options: [{ id: 'place_diner', label: 'Alpha Diner', address: '123 Main St' }],
    loading: false,
    error: false,
  }),
}));

// Only the live Place Details fetch needs stubbing — everything else
// (photoMediaUrl/placeImageFromPhoto's own URL building, invoked here via the
// real placeImageFromPhoto) stays real so the assertion below exercises the
// same code a real pick would run.
vi.mock('../../model/places', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../model/places')>();
  return {
    ...actual,
    fetchFirstPlaceImage: vi
      .fn()
      .mockResolvedValue(actual.placeImageFromPhoto({ name: 'places/place_diner/photos/photo_1' })),
  };
});

function routeWithPlaces(labels: string[]): Route {
  return {
    _id: 'route_test',
    from: { id: null, label: 'Start' },
    to: { id: null, label: 'End' },
    variants: [
      {
        tone: 'direct',
        label: 'Test variant',
        places: labels.map((label) => ({
          kind: 'waypoint' as const,
          place: { id: null, label },
          durationMinutes: 0,
        })),
        finalLegMinutes: 0,
      },
    ],
    images: [],
  };
}

function Harness({
  initial,
  onFormChange,
}: {
  initial: Route;
  onFormChange?: (route: Route) => void;
}) {
  const [form, setForm] = useState(initial);
  return (
    <RouteEditForm
      form={form}
      onChange={(next) => {
        setForm(next);
        onFormChange?.(next);
      }}
    />
  );
}

describe('RouteEditForm', () => {
  // Rendering/re-rendering three MUI Autocomplete-based PlacePickerFields
  // (each mounting its own Popper) in jsdom measures at ~1.5-1.7s per pass on
  // this machine — not a hang, just consistently slow — which left this test
  // right at the edge of Vitest's default 5000ms per-test timeout and made
  // it fail intermittently under load. A generous explicit timeout here
  // keeps it from flaking without masking an actual regression (a genuine
  // hang, e.g. a missed await, would still fail well before 15s).
  it('removes the clicked place, not a different one, when deleting from the middle', async () => {
    render(<Harness initial={routeWithPlaces(['Alpha', 'Bravo', 'Charlie'])} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove this stage' })[1]);

    await waitFor(
      () => {
        // The first two "Name" fields are the route's own From/To pickers.
        const names = screen
          .getAllByLabelText('Name')
          .slice(2)
          .map((el) => (el as HTMLInputElement).value);
        expect(names).toEqual(['Alpha', 'Charlie']);
      },
      { timeout: 10_000 },
    );
  }, 15_000);

  it('backfills the first Google photo onto a freshly picked waypoint place', async () => {
    let latestForm: Route | undefined;
    render(
      <Harness
        initial={routeWithPlaces(['Alpha'])}
        onFormChange={(form) => {
          latestForm = form;
        }}
      />,
    );

    // The first two "Name" fields are the route's own From/To pickers — the
    // third is this variant's one waypoint.
    fireEvent.mouseDown(screen.getAllByLabelText('Name')[2]);
    fireEvent.click(await screen.findByRole('option', { name: /Alpha Diner/ }));

    await waitFor(
      () => {
        expect(latestForm?.variants[0].places[0].place?.images).toEqual([
          {
            uri: expect.stringContaining('places/place_diner/photos/photo_1/media'),
            credit: null,
            caption: null,
          },
        ]);
      },
      { timeout: 10_000 },
    );
  }, 15_000);
});
