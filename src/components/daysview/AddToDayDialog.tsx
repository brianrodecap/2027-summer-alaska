import { resolveActiveScenarioId } from '../../model/dayHeader';
import type { Day } from '../../model/types';
import { useLiveDays } from '../../state/useLiveDays';
import { useTripData } from '../../state/useTripData';
import { AddEventWizard } from '../wizard/AddEventWizard';
import { useTripEdits } from './useTripEdits';

// The "Add to this day" wizard for `day`. The day is captured once, at the
// moment the button is clicked, not re-derived on every render, since
// `view.days` (and so every Day object) is rebuilt fresh on each edit;
// re-deriving here would reset the wizard's own in-progress state on every
// unrelated re-render while it's still open.
export function AddToDayDialog({ day, onClose }: { day: Day | null; onClose: () => void }) {
  const { data } = useTripData();
  const live = useLiveDays();
  const edits = useTripEdits();
  if (!data || !day) return null;
  // `day` was captured when the wizard opened; the live one is what carries
  // the reader's current scenario picks.
  const activeScenarioId = resolveActiveScenarioId(live.byDate.get(day.date) ?? day);
  return (
    <AddEventWizard
      activeScenarioId={activeScenarioId}
      legId={day.leg._id}
      date={day.date}
      stays={data.stays}
      activities={data.activities}
      transits={data.transits}
      scenarios={data.scenarios}
      legs={data.legs}
      tripTravelers={data.trip.travelers}
      routes={data.routes}
      onClose={onClose}
      onSaveEntity={(kind, entity) => {
        edits.addEntity(kind, entity);
        onClose();
      }}
      onSaveScenario={(scenario) => {
        const error = edits.saveScenario(scenario, true);
        if (!error) onClose();
        return error;
      }}
    />
  );
}
