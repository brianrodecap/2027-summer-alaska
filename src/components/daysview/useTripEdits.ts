import { useMemo } from 'react';

import type { ChangeSource } from '../../model/changeLog';
import {
  applyScenarioDeletion,
  applyScenarioSave,
  commitEntityEdit,
  type EditKind,
  upsertById,
} from '../../model/editForms';
import type { Activity, Booking, Route, Scenario, Stay, Transit } from '../../model/types';
import { useTripData } from '../../state/useTripData';

// The trip edits the day list's dialogs make, as named actions over
// TripDataContext's setData, which commits and persists the change.
export function useTripEdits() {
  const { data, setData } = useTripData();
  return useMemo(
    () => ({
      saveRoute: (route: Route, source?: ChangeSource) =>
        setData((prev) => ({ ...prev, routes: upsertById(prev.routes, route) }), source),
      deleteRoute: (id: string, source?: ChangeSource) =>
        setData((prev) => ({ ...prev, routes: prev.routes.filter((r) => r._id !== id) }), source),
      // Returns a message when the scenario-tone invariant (see
      // applyScenarioSave) refuses the edit, null once it's committed.
      saveScenario: (scenario: Scenario, isNew: boolean): string | null => {
        if (!data) return null;
        const outcome = applyScenarioSave(data, scenario, isNew);
        if ('error' in outcome) return outcome.error;
        setData((prev) => {
          const next = applyScenarioSave(prev, scenario, isNew);
          return 'data' in next ? next.data : prev;
        });
        return null;
      },
      deleteScenario: (id: string) => setData((prev) => applyScenarioDeletion(prev, id)),
      addEntity: (kind: EditKind, entity: Activity | Stay | Transit, bookings: Booking[]) =>
        setData((prev) => commitEntityEdit(prev, kind, entity, bookings)),
    }),
    [data, setData],
  );
}
