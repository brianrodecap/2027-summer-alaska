import { useMemo } from 'react';

import {
  applyScenarioDeletion,
  applyScenarioSave,
  COLLECTION_FOR_KIND,
  type EditKind,
  upsertById,
  upsertByKind,
} from '../../model/editForms';
import type { Activity, Route, Scenario, Stay, Transit } from '../../model/types';
import { useTripData } from '../../state/useTripData';

// The trip edits the day list's dialogs make, as named actions over
// TripDataContext's setData — each commits the change and marks the touched
// collection(s) dirty.
export function useTripEdits() {
  const { data, setData } = useTripData();
  return useMemo(
    () => ({
      saveRoute: (route: Route) =>
        setData((prev) => ({ ...prev, routes: upsertById(prev.routes, route) }), ['routes']),
      deleteRoute: (id: string) =>
        setData(
          (prev) => ({ ...prev, routes: prev.routes.filter((r) => r._id !== id) }),
          ['routes'],
        ),
      // Returns a message when the scenario-tone invariant (see
      // applyScenarioSave) refuses the edit, null once it's committed.
      saveScenario: (scenario: Scenario, isNew: boolean): string | null => {
        if (!data) return null;
        const outcome = applyScenarioSave(data, scenario, isNew);
        if ('error' in outcome) return outcome.error;
        setData(
          (prev) => {
            const next = applyScenarioSave(prev, scenario, isNew);
            return 'data' in next ? next.data : prev;
          },
          ['scenarios'],
        );
        return null;
      },
      deleteScenario: (id: string) =>
        setData(
          (prev) => applyScenarioDeletion(prev, id),
          ['scenarios', 'stays', 'activities', 'transits'],
        ),
      addEntity: (kind: EditKind, entity: Activity | Stay | Transit) =>
        setData((prev) => upsertByKind(prev, kind, entity), [COLLECTION_FOR_KIND[kind]]),
    }),
    [data, setData],
  );
}
