import Box from '@mui/material/Box';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import { DayMapPanel } from '../components/day/DayMapPanel';
import { useActiveDayDate } from '../components/day/useActiveDayDate';
import { AddToDayDialog } from '../components/daysview/AddToDayDialog';
import { DayList } from '../components/daysview/DayList';
import { DaysAppBar } from '../components/daysview/DaysAppBar';
import { DaysDialogs } from '../components/daysview/DaysDialogs';
import { DetailPanels } from '../components/daysview/DetailPanels';
import { MapSidebarSlot } from '../components/daysview/MapSidebarSlot';
import { useDayListNavigation } from '../components/daysview/useDayListNavigation';
import { useDayMapDialog } from '../components/daysview/useDayMapDialog';
import { useDaysDialogs } from '../components/daysview/useDaysDialogs';
import { useDetailPanels } from '../components/daysview/useDetailPanels';
import { dayHasVisibleContent } from '../model/filters';
import { describeScenarioGroupProblems } from '../model/scenarioGroups';
import type { Day } from '../model/types';
import { useLiveDays } from '../state/useLiveDays';
import { useTripData } from '../state/useTripData';
import { useFilterSelection } from '../state/useTripSelections';

// The trip's day list: an app bar, one block per day (with drag-and-drop
// reordering), a persistent map beside it on wide screens, and the sheets and
// dialogs the rows open. Each of those lives in its own component or hook under
// components/daysview; this only wires them to the live days.
export function DaysView() {
  const { view, data } = useTripData();
  const { activeFilterTokens } = useFilterSelection();
  const { slug, date } = useParams();
  const panels = useDetailPanels();
  const dialogs = useDaysDialogs();
  // The days for what the reader has selected right now (scenario picks,
  // route tones, meal choices) — not the statically built view.days.
  const { days: liveDays, byDate: daysByDate } = useLiveDays();
  const mapDialog = useDayMapDialog();
  // The day the "Add to this day" wizard is open for.
  const [addWizardDay, setAddWizardDay] = useState<Day | null>(null);
  // Groups of alternatives without exactly one Ideal — surfaced on the
  // Manage-scenarios button and inside its dialog.
  const groupProblems = useMemo(() => (data ? describeScenarioGroupProblems(data) : []), [data]);
  useDayListNavigation(view, slug, date);

  const visibleDays = useMemo(
    () =>
      view
        ? liveDays.filter((day) =>
            dayHasVisibleContent(day, activeFilterTokens, {
              activities: view.activitiesById,
              transits: view.transitsById,
            }),
          )
        : liveDays,
    [liveDays, activeFilterTokens, view],
  );
  // Drives DayMapSidebar — see that hook's own comment for why this is a
  // single scroll-tracked map rather than one per day. useActiveDayDate keys
  // its own effect on the joined date string, not array identity, so this
  // doesn't need its own memo.
  const activeDate = useActiveDayDate(visibleDays.map((day) => day.date));
  const activeDay = activeDate ? (daysByDate.get(activeDate) ?? null) : null;

  if (!view) return null;

  return (
    <Box>
      <Box sx={{ display: 'flex' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <DaysAppBar
            canJumpToDay={Boolean(view.dateRange)}
            legSummaries={view.legSummaries}
            scenarioProblemCount={groupProblems.length}
            onJumpToDay={() => dialogs.open('datePicker')}
            onManageRoutes={() => dialogs.open('routes')}
            onManageScenarios={() => dialogs.open('scenarios')}
            onAskAI={() => dialogs.open('askAI')}
          />
          <DayList
            days={visibleDays}
            onOpenActivity={panels.handleOpenActivity}
            onOpenStay={panels.stayPanel.onOpen}
            onOpenTransit={panels.transitPanel.onOpen}
            onOpenMap={mapDialog.openMap}
            onAddEvent={setAddWizardDay}
          />
        </Box>
        <MapSidebarSlot
          activeDay={activeDay}
          onOpenActivity={panels.handleOpenActivity}
          onOpenStay={panels.stayPanel.onOpen}
          onOpenTransit={panels.transitPanel.onOpen}
        />
      </Box>
      <DayMapPanel {...mapDialog.panelProps} />
      <DetailPanels panels={panels} />
      <DaysDialogs dialogs={dialogs} groupProblems={groupProblems} />
      <AddToDayDialog day={addWizardDay} onClose={() => setAddWizardDay(null)} />
    </Box>
  );
}
