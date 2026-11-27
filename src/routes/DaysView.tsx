import Box from '@mui/material/Box';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import { AssistantChatProvider } from '../components/assistant/AssistantChatProvider';
import { AssistantSheet } from '../components/assistant/AssistantSheet';
import { useAssistant } from '../components/assistant/useAssistant';
import { DAY_LIST_WIDTH } from '../components/day/dayLayout';
import { DayMapPanel } from '../components/day/DayMapPanel';
import { useActiveDayDate } from '../components/day/useActiveDayDate';
import { AddToDayDialog } from '../components/daysview/AddToDayDialog';
import { DayList } from '../components/daysview/DayList';
import { DayNavigator } from '../components/daysview/DayNavigator';
import { DaysAppBar } from '../components/daysview/DaysAppBar';
import { DaysDialogs } from '../components/daysview/DaysDialogs';
import { selectedDayDate } from '../components/daysview/selectedDay';
import { SelectionBar } from '../components/daysview/SelectionBar';
import { SidebarSlot } from '../components/daysview/SidebarSlot';
import { useDayListNavigation } from '../components/daysview/useDayListNavigation';
import { useDayMapDialog } from '../components/daysview/useDayMapDialog';
import { useDaysDialogs } from '../components/daysview/useDaysDialogs';
import { dayHasVisibleContent } from '../model/filters';
import { describeScenarioGroupProblems } from '../model/scenarioGroups';
import type { Day } from '../model/types';
import { createExpandedRows } from '../state/expandedRows';
import { MoveToDayProvider } from '../state/MoveToDayContext';
import { ExpandedRowsContext } from '../state/useExpandedRow';
import { useLiveDays } from '../state/useLiveDays';
import { useTripData } from '../state/useTripData';
import { useFilterSelection } from '../state/useTripSelections';

// The trip's day list: an app bar, one block per day (with drag-and-drop
// reordering), and on wide screens a day navigator and a map-or-assistant pane
// beside it, plus the dialogs the rows open. Each of those lives in
// its own component or hook under components/daysview; this only wires them to
// the live days.
export function DaysView() {
  const { view, data } = useTripData();
  const { activeFilterTokens } = useFilterSelection();
  const { slug, date } = useParams();
  const dialogs = useDaysDialogs();
  // Which cards are open, shared by the day list and the map's pins.
  const [expandedRows] = useState(createExpandedRows);
  // The days for what the reader has selected right now (scenario picks,
  // route tones, meal choices) — not the statically built view.days.
  const { days: liveDays, byDate: daysByDate } = useLiveDays();
  const mapDialog = useDayMapDialog();
  const assistant = useAssistant();
  // The day the "Add to this day" wizard is open for.
  const [addWizardDay, setAddWizardDay] = useState<Day | null>(null);
  // Groups of alternatives without exactly one Ideal — surfaced on the
  // Manage-scenarios button and inside its dialog.
  const groupProblems = useMemo(() => (data ? describeScenarioGroupProblems(data) : []), [data]);
  const jumpToDay = useDayListNavigation(view, slug, date);

  const visibleDays = useMemo(
    () =>
      view
        ? liveDays.filter((day) =>
            // The view's own maps, not the live ones: a scenario tab the reader is not on
            // is judged by the verdict built against its own branch (see filters.ts).
            dayHasVisibleContent(day, activeFilterTokens, {
              activities: view.activitiesById,
              transits: view.transitsById,
            }),
          )
        : liveDays,
    [liveDays, activeFilterTokens, view],
  );
  // On wide screens the list shows one day: the URL's, or the first the filters
  // leave. Narrower screens keep the scrolling list of every day.
  const wide = useMediaQuery((theme) => theme.breakpoints.up('lg'));
  const selectedDate = selectedDayDate(
    visibleDays.map((day) => day.date),
    date,
  );
  const listedDays = useMemo(
    () => (wide ? visibleDays.filter((day) => day.date === selectedDate) : visibleDays),
    [wide, visibleDays, selectedDate],
  );
  // The single-day panel opens with the day's poster.
  const tripStart = view?.dateRange?.startDate ?? null;
  const poster = useMemo(() => (wide ? { tripStart } : undefined), [wide, tripStart]);
  // Drives DayMapSidebar — see that hook's own comment for why this is a
  // single scroll-tracked map rather than one per day. useActiveDayDate keys
  // its own effect on the joined date string, not array identity, so this
  // doesn't need its own memo.
  const scrolledDate = useActiveDayDate(listedDays.map((day) => day.date));
  const activeDate = wide ? selectedDate : scrolledDate;
  const activeDay = activeDate ? (daysByDate.get(activeDate) ?? null) : null;

  if (!view) return null;

  // The chat lives in a provider so a streaming reply re-renders only the assistant
  // panel, not this whole view.
  return (
    <AssistantChatProvider>
      <ExpandedRowsContext.Provider value={expandedRows}>
        <MoveToDayProvider>
          <Box>
            <Box sx={{ display: 'flex' }}>
              <DayNavigator
                days={visibleDays}
                activeDate={activeDate}
                bookings={data?.bookings ?? []}
                tripStart={tripStart}
                onSelectDay={jumpToDay}
              />
              <SidebarSlot
                activeDay={activeDay}
                view={assistant.sidebarView}
                onViewChange={assistant.setSidebarView}
              />
              {/* On wide screens the cards are compact, so the list keeps a set width
                and the map takes the rest. */}
              <Box
                sx={{
                  flex: {
                    xs: 1,
                    lg: `0 0 ${DAY_LIST_WIDTH.lg}px`,
                    xl: `0 0 ${DAY_LIST_WIDTH.xl}px`,
                  },
                  minWidth: 0,
                }}
              >
                <DaysAppBar
                  canJumpToDay={Boolean(view.dateRange)}
                  legSummaries={view.legSummaries}
                  scenarioProblemCount={groupProblems.length}
                  onJumpToDay={() => dialogs.open('datePicker')}
                  onManageRoutes={() => dialogs.open('routes')}
                  onManageScenarios={() => dialogs.open('scenarios')}
                  onAskAI={assistant.open}
                />
                <DayList
                  days={listedDays}
                  onOpenMap={mapDialog.openMap}
                  onAddEvent={setAddWizardDay}
                  poster={poster}
                />
              </Box>
            </Box>
            <DayMapPanel {...mapDialog.panelProps} />
            <DaysDialogs dialogs={dialogs} groupProblems={groupProblems} />
            <AddToDayDialog day={addWizardDay} onClose={() => setAddWizardDay(null)} />
            <SelectionBar />
            <AssistantSheet
              open={assistant.sheetOpen}
              onClose={assistant.closeSheet}
              focusDay={activeDay}
            />
          </Box>
        </MoveToDayProvider>
      </ExpandedRowsContext.Provider>
    </AssistantChatProvider>
  );
}
