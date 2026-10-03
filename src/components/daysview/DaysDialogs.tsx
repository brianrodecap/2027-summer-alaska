import { useNavigate, useParams } from 'react-router-dom';

import type { ScenarioGroupProblemView } from '../../model/scenarioGroups';
import { useTripData } from '../../state/useTripData';
import { RoutesDialog } from '../edit/RoutesDialog';
import { ScenariosDialog } from '../edit/ScenariosDialog';
import { JumpToDayPicker } from '../pickers/JumpToDayPicker';
import type { DaysDialogsState } from './useDaysDialogs';
import { useTripEdits } from './useTripEdits';

// The day list's three dialogs — jump to a day, manage routes, manage scenarios —
// each rendered only once the data it needs is there. (Ask AI is a panel, not a
// dialog: see components/assistant.)
export function DaysDialogs({
  dialogs,
  groupProblems,
}: {
  dialogs: DaysDialogsState;
  groupProblems: ScenarioGroupProblemView[];
}) {
  const { view, data } = useTripData();
  const edits = useTripEdits();
  const { slug } = useParams();
  const navigate = useNavigate();
  return (
    <>
      {view?.dateRange && (
        <JumpToDayPicker
          open={dialogs.isOpen('datePicker')}
          onClose={dialogs.close}
          days={view.days}
          tripStart={view.dateRange.startDate}
          tripEnd={view.dateRange.endDate}
          onSelectDay={(selectedDate) => navigate(`/${slug}/days/${selectedDate}`)}
        />
      )}
      {data && (
        <RoutesDialog
          routes={data.routes}
          open={dialogs.isOpen('routes')}
          onClose={dialogs.close}
          onSave={edits.saveRoute}
          onDelete={edits.deleteRoute}
        />
      )}
      {data && (
        <ScenariosDialog
          scenarios={data.scenarios}
          legs={data.legs}
          activities={data.activities}
          transits={data.transits}
          open={dialogs.isOpen('scenarios')}
          groupProblems={groupProblems}
          onClose={dialogs.close}
          onSave={edits.saveScenario}
          onDelete={edits.deleteScenario}
        />
      )}
    </>
  );
}
