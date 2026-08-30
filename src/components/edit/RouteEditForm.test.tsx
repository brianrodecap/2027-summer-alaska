import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { Route } from '../../model/types';
import { RouteEditForm } from './RouteEditForm';

// Keeps the test hermetic — real search would debounce into a network call.
vi.mock('./usePlaceSearch', () => ({
  usePlaceSearch: () => ({ options: [], loading: false, error: false }),
}));

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

function Harness({ initial }: { initial: Route }) {
  const [form, setForm] = useState(initial);
  return <RouteEditForm form={form} onChange={setForm} />;
}

describe('RouteEditForm', () => {
  it('removes the clicked place, not a different one, when deleting from the middle', async () => {
    render(<Harness initial={routeWithPlaces(['Alpha', 'Bravo', 'Charlie'])} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove this stage' })[1]);

    await waitFor(() => {
      // The first two "Name" fields are the route's own From/To pickers.
      const names = screen
        .getAllByLabelText('Name')
        .slice(2)
        .map((el) => (el as HTMLInputElement).value);
      expect(names).toEqual(['Alpha', 'Charlie']);
    });
  });
});
