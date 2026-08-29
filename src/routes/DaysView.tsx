import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import AltRouteIcon from '@mui/icons-material/AltRoute';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import RouteIcon from '@mui/icons-material/Route';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import useScrollTrigger from '@mui/material/useScrollTrigger';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { ActivityDetailPanel } from '../components/activity/ActivityDetailPanel';
import { AskAIDialog } from '../components/day/AskAIDialog';
import { DayBlock } from '../components/day/DayBlock';
import { DayMapPanel } from '../components/day/DayMapPanel';
import { FilterMenu } from '../components/day/FilterMenu';
import { StayDetailPanel } from '../components/day/StayDetailPanel';
import { TransitDetailPanel } from '../components/day/TransitDetailPanel';
import { RoutesDialog } from '../components/edit/RoutesDialog';
import { ScenarioEditDialog } from '../components/edit/ScenarioEditDialog';
import { ScenariosDialog } from '../components/edit/ScenariosDialog';
import { JumpToDayPicker } from '../components/pickers/JumpToDayPicker';
import { applyScenarioDeletion, blankScenario } from '../model/editForms';
import { dayHasVisibleContent } from '../model/filters';
import { applyActivityReorder, type DragMeta } from '../model/reorder';
import { formatTime } from '../model/tripModel';
import type {
  Day,
  EnrichedActivity,
  EnrichedMealOption,
  EnrichedStay,
  EnrichedTransit,
  Route,
  Scenario,
} from '../model/types';
import { useEdit } from '../state/useEdit';
import { useTripData } from '../state/useTripData';
import { useFilterSelection } from '../state/useTripSelections';

// Stay's and Transit's detail panels are both opened/closed/edited the same
// way — a plain "which entity is open" state, with Edit clearing it and
// handing off to EditContext's own dialog. Activity's panel additionally
// carries a selected meal-option candidate, so it keeps its own state below
// rather than being forced into this shape.
function useDetailPanel<T extends { _id: string }>(openEdit: (id: string) => void) {
  const [entity, setEntity] = useState<T | null>(null);
  return {
    entity,
    open: Boolean(entity),
    onOpen: setEntity,
    onClose: () => setEntity(null),
    onEdit: entity
      ? () => {
          const id = entity._id;
          setEntity(null);
          openEdit(id);
        }
      : undefined,
  };
}

export function DaysView() {
  const { view, data, setData } = useTripData();
  const { activeFilterTokens } = useFilterSelection();
  const { openEdit } = useEdit();
  const { slug, date } = useParams();
  const navigate = useNavigate();
  const [mapDay, setMapDay] = useState<Day | null>(null);
  const [openActivity, setOpenActivity] = useState<{
    activity: EnrichedActivity;
    selectedOption?: EnrichedMealOption;
  } | null>(null);
  const stayPanel = useDetailPanel<EnrichedStay>((id) => openEdit('stay', id));
  const transitPanel = useDetailPanel<EnrichedTransit>((id) => openEdit('transit', id));
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [routesOpen, setRoutesOpen] = useState(false);
  const [scenariosOpen, setScenariosOpen] = useState(false);
  // Captured once, at the moment "Add to this day" > Scenario is clicked —
  // not re-derived from `day` on every render, since `view.days` (and so
  // every Day object) is rebuilt fresh on each edit; re-deriving here would
  // hand ScenarioEditDialog a freshly-randomUUID'd draft on every unrelated
  // re-render while it's still open.
  const [newScenarioDraft, setNewScenarioDraft] = useState<Scenario | null>(null);
  // A stable reference (unlike an inline arrow in the day-list map below) so
  // it doesn't defeat DayBlock's own memo on every unrelated DaysView
  // re-render.
  const handleAddScenario = useCallback(
    (day: Day) => setNewScenarioDraft(blankScenario(day.leg._id, day.date)),
    [],
  );
  const [askAIOpen, setAskAIOpen] = useState(false);
  // Flat while it's the page's own leading edge, shadowed only once content
  // has scrolled in underneath it — the M3 app-bar spec's own elevation rule.
  const elevated = useScrollTrigger({ disableHysteresis: true, threshold: 1 });

  const daysByDate = useMemo(() => new Map((view?.days ?? []).map((d) => [d.date, d])), [view]);
  const visibleDays = useMemo(
    () => (view?.days ?? []).filter((day) => dayHasVisibleContent(day, activeFilterTokens)),
    [view, activeFilterTokens],
  );

  // `view` is a fresh object every time data is edited (setData ->
  // buildTripView recompute), so it can't be trusted as a "did the URL's
  // date actually change" signal on its own — that would re-scroll to
  // `date` on every edit, fighting any scrolling the user had done since.
  // This only auto-scrolls once per distinct `date`, retrying only until
  // `view` first becomes available, to cover the case where the day's
  // element doesn't exist in the DOM yet (data still loading on first
  // mount) — depending on `viewLoaded` rather than `view` itself keeps the
  // effect from re-firing on every later edit once that first load has
  // happened.
  const scrolledDateRef = useRef<string | undefined>(undefined);
  const viewLoaded = Boolean(view);
  useEffect(() => {
    if (!date || scrolledDateRef.current === date) return;
    const el = document.getElementById(`day-${date}`);
    if (!el) return;
    el.scrollIntoView({ block: 'start' });
    scrolledDateRef.current = date;
  }, [date, viewLoaded]);

  const handleOpenActivity = useCallback(
    (activity: EnrichedActivity, selectedOption?: EnrichedMealOption) => {
      setOpenActivity({ activity, selectedOption });
    },
    [],
  );

  // Reordering — see src/model/reorder.ts. A distance threshold on the
  // pointer sensor is what lets a plain tap still open a row's detail sheet
  // instead of every click starting a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const draggingActivity = draggingId
    ? (data?.activities.find((a) => a._id === draggingId) ?? null)
    : null;

  const handleDragStart = (event: DragStartEvent) => {
    const meta = event.active.data.current as DragMeta | undefined;
    setDraggingId(meta?.activityId ?? null);
  };

  // Only onDragEnd is handled — see reorder.ts's own note on why this
  // skips live cross-container reflow. Dropping directly onto a row is
  // read as "insert immediately after this row" when the drag moved the
  // Activity later (down past its own start), but dnd-kit's own `over`
  // never distinguishes "onto, meaning before" from "onto, meaning after" —
  // it just names whichever row the pointer is over. Comparing
  // `activeMeta`'s own index (its position before the drag) against
  // `overMeta`'s is what tells the two apart: dragging upward past a row
  // means the intent was to land before it, so the row's own `before`
  // field (reorder.ts's DragMeta) is used instead of its plain fields.
  //
  // That index comparison is only meaningful within one buildDragMeta call,
  // though — each rendered Timeline (the top-level day, and each scenario
  // tab) builds its own DragMeta array with its own 0-based `index`, so
  // comparing indices across two different ones is comparing unrelated
  // numbers. `@dnd-kit/sortable`'s useSortable stamps every row's
  // `data.current` with its own `sortable.containerId` alongside our
  // DragMeta fields (see its SortableData type) — that, not our own
  // `index`, is what actually identifies which rendered Timeline a row
  // belongs to, so it's what detects a drag that crossed from one into
  // another. applyActivityReorder needs to know this: without it, a
  // cross-container drop still resolves to some row's plain DragMeta and
  // forces the dragged Activity onto that row's own instant regardless of
  // duration, which is exactly how dragging an Activity out of a scenario
  // tab used to scramble its displayed time.
  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeMeta = active.data.current as DragMeta | undefined;
    const overMeta = over.data.current as DragMeta | undefined;
    if (!activeMeta?.activityId || !overMeta) return;
    const activityId = activeMeta.activityId;
    const activeContainerId = (active.data.current as { sortable?: { containerId: unknown } })
      ?.sortable?.containerId;
    const overContainerId = (over.data.current as { sortable?: { containerId: unknown } })?.sortable
      ?.containerId;
    const crossContainer = activeContainerId !== overContainerId;
    const movingUp = !crossContainer && activeMeta.index > overMeta.index;
    const dropMeta: DragMeta =
      movingUp && overMeta.before ? { ...overMeta, ...overMeta.before } : overMeta;
    const dayStart = dropMeta.containerDayStart;
    setData(
      (prev) => applyActivityReorder(prev, dropMeta, activityId, dayStart, crossContainer),
      ['activities'],
    );
  };

  if (!view) return null;

  return (
    <Box>
      <Box
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 3,
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          minHeight: '4rem',
          px: 2,
          bgcolor: 'background.default',
          boxShadow: elevated ? 2 : 0,
          transition: 'box-shadow 150ms',
        }}
      >
        {view.dateRange && (
          <IconButton aria-label="Jump to a day" onClick={() => setDatePickerOpen(true)}>
            <CalendarMonthIcon />
          </IconButton>
        )}
        <FilterMenu legSummaries={view.legSummaries} />
        <IconButton aria-label="Manage routes" onClick={() => setRoutesOpen(true)}>
          <RouteIcon />
        </IconButton>
        <IconButton aria-label="Manage scenarios" onClick={() => setScenariosOpen(true)}>
          <AltRouteIcon />
        </IconButton>
        <IconButton aria-label="Ask AI" onClick={() => setAskAIOpen(true)}>
          <AutoAwesomeIcon />
        </IconButton>
      </Box>
      {visibleDays.length === 0 ? (
        <Typography
          variant="body1"
          color="text.secondary"
          sx={{ px: 3, py: 4, textAlign: 'center' }}
        >
          No days match the selected filters.
        </Typography>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <Stack divider={<Box sx={{ borderBottom: 1, borderColor: 'divider' }} />}>
            {visibleDays.map((day) => (
              <DayBlock
                key={day.date}
                day={day}
                daysByDate={daysByDate}
                onOpenActivity={handleOpenActivity}
                onOpenStay={stayPanel.onOpen}
                onOpenTransit={transitPanel.onOpen}
                onOpenMap={setMapDay}
                onAddScenario={handleAddScenario}
              />
            ))}
          </Stack>
          <DragOverlay>
            {draggingActivity && (
              <Paper
                elevation={3}
                sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1 }}
              >
                <DragIndicatorIcon fontSize="small" color="action" />
                <Box>
                  <Typography variant="subtitle2">{draggingActivity.text}</Typography>
                  {draggingActivity.startAt && (
                    <Typography variant="caption" color="text.secondary">
                      {formatTime(draggingActivity.startAt)}
                    </Typography>
                  )}
                </Box>
              </Paper>
            )}
          </DragOverlay>
        </DndContext>
      )}
      <DayMapPanel day={mapDay} open={Boolean(mapDay)} onClose={() => setMapDay(null)} />
      <ActivityDetailPanel
        activity={openActivity?.activity ?? null}
        selectedOption={openActivity?.selectedOption}
        open={Boolean(openActivity)}
        onClose={() => setOpenActivity(null)}
        onEdit={
          openActivity
            ? () => {
                const id = openActivity.activity._id;
                setOpenActivity(null);
                openEdit('activity', id);
              }
            : undefined
        }
      />
      <StayDetailPanel
        stay={stayPanel.entity}
        open={stayPanel.open}
        onClose={stayPanel.onClose}
        onEdit={stayPanel.onEdit}
      />
      <TransitDetailPanel
        transit={transitPanel.entity}
        open={transitPanel.open}
        onClose={transitPanel.onClose}
        onEdit={transitPanel.onEdit}
      />
      {view.dateRange && (
        <JumpToDayPicker
          open={datePickerOpen}
          onClose={() => setDatePickerOpen(false)}
          days={view.days}
          tripStart={view.dateRange.startDate}
          tripEnd={view.dateRange.endDate}
          onSelectDay={(selectedDate) => navigate(`/${slug}/days/${selectedDate}`)}
        />
      )}
      {data && <AskAIDialog open={askAIOpen} onClose={() => setAskAIOpen(false)} data={data} />}
      {data && (
        <RoutesDialog
          routes={data.routes}
          open={routesOpen}
          onClose={() => setRoutesOpen(false)}
          onSave={(route: Route) =>
            setData(
              (prev) => ({
                ...prev,
                routes: prev.routes.some((r) => r._id === route._id)
                  ? prev.routes.map((r) => (r._id === route._id ? route : r))
                  : [...prev.routes, route],
              }),
              ['routes'],
            )
          }
          onDelete={(id: string) =>
            setData(
              (prev) => ({ ...prev, routes: prev.routes.filter((r) => r._id !== id) }),
              ['routes'],
            )
          }
        />
      )}
      {data && (
        <ScenariosDialog
          scenarios={data.scenarios}
          legs={data.legs}
          activities={data.activities}
          transits={data.transits}
          open={scenariosOpen}
          onClose={() => setScenariosOpen(false)}
          onSave={(scenario: Scenario) =>
            setData(
              (prev) => ({
                ...prev,
                scenarios: prev.scenarios.some((s) => s._id === scenario._id)
                  ? prev.scenarios.map((s) => (s._id === scenario._id ? scenario : s))
                  : [...prev.scenarios, scenario],
              }),
              ['scenarios'],
            )
          }
          onDelete={(id: string) =>
            setData(
              (prev) => applyScenarioDeletion(prev, id),
              ['scenarios', 'activities', 'transits'],
            )
          }
        />
      )}
      {data && newScenarioDraft && (
        <ScenarioEditDialog
          scenario={newScenarioDraft}
          isNew
          legs={data.legs}
          allScenarios={data.scenarios}
          onClose={() => setNewScenarioDraft(null)}
          onSave={(scenario: Scenario) => {
            setData(
              (prev) => ({ ...prev, scenarios: [...prev.scenarios, scenario] }),
              ['scenarios'],
            );
            setNewScenarioDraft(null);
          }}
          onDelete={() => setNewScenarioDraft(null)}
        />
      )}
    </Box>
  );
}
