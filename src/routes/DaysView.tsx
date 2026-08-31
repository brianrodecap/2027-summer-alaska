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
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { ActivityDetailPanel } from '../components/activity/ActivityDetailPanel';
import { AskAIDialog } from '../components/day/AskAIDialog';
import { DayBlock } from '../components/day/DayBlock';
import { DayMapPanel } from '../components/day/DayMapPanel';
import { FilterMenu } from '../components/day/FilterMenu';
import { StayDetailPanel } from '../components/day/StayDetailPanel';
import { TransitDetailPanel } from '../components/day/TransitDetailPanel';
import { RoutesDialog } from '../components/edit/RoutesDialog';
import { ScenariosDialog } from '../components/edit/ScenariosDialog';
import { JumpToDayPicker } from '../components/pickers/JumpToDayPicker';
import { AddEventWizard } from '../components/wizard/AddEventWizard';
import {
  applyScenarioDeletion,
  COLLECTION_FOR_KIND,
  type EditKind,
  upsertById,
} from '../model/editForms';
import { dayHasVisibleContent } from '../model/filters';
import {
  applyActivityReorder,
  applyBlockReorder,
  applyGroupActivityReorder,
  applyTransitReorder,
  type DragMeta,
} from '../model/reorder';
import { activitySortKey, formatTime, todayDateStr } from '../model/tripModel';
import type {
  Activity,
  Day,
  EnrichedActivity,
  EnrichedMealOption,
  EnrichedStay,
  EnrichedTransit,
  Route,
  Scenario,
  Stay,
  Transit,
} from '../model/types';
import { useEdit } from '../state/useEdit';
import { useTripData } from '../state/useTripData';
import { useFilterSelection, useRowSelection } from '../state/useTripSelections';

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

function containerIdOf(dndData: unknown): unknown {
  return (dndData as { sortable?: { containerId: unknown } } | undefined)?.sortable?.containerId;
}

// A container's own leading date — DayTimeline.tsx builds a top-level
// day's containerId as exactly its date ("2027-06-26") and a scenario
// tab's as `${date}::${scenarioId}`, so splitting on '::' recovers the
// calendar date either way. Comparing dates (not raw containerId) is what
// tells a same-day scenario-boundary crossing (reorder.ts's
// `preserveOwnTiming` — the dragged Activity's own time should carry over
// untouched) apart from a genuine cross-day move (where landing on the new
// day's own anchor position, date included, is the entire point of the
// drag).
function dayOfContainer(containerId: unknown): string | null {
  return typeof containerId === 'string' ? containerId.split('::')[0] : null;
}

// The shared chrome every DragOverlay body below renders — only the
// content (a plain label, or an Activity's text + time) actually varies
// per drag kind.
function DragOverlayChip({ children }: { children: ReactNode }) {
  return (
    <Paper elevation={3} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1 }}>
      <DragIndicatorIcon fontSize="small" color="action" />
      {children}
    </Paper>
  );
}

export function DaysView() {
  const { view, data, setData } = useTripData();
  const { activeFilterTokens } = useFilterSelection();
  const { selection, clearRowSelection } = useRowSelection();
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
  // The day the "Add to this day" wizard is open for — captured once, at
  // the moment the button is clicked, not re-derived from `day` on every
  // render, since `view.days` (and so every Day object) is rebuilt fresh on
  // each edit; re-deriving here would reset the wizard's own in-progress
  // state on every unrelated re-render while it's still open.
  const [addWizardDay, setAddWizardDay] = useState<Day | null>(null);
  // A stable reference (unlike an inline arrow in the day-list map below) so
  // it doesn't defeat DayBlock's own memo on every unrelated DaysView
  // re-render.
  const handleAddEvent = useCallback((day: Day) => setAddWizardDay(day), []);
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

  // Landing on the bare /days route (no date in the URL) — as opposed to a
  // direct link to a specific day — defaults to today's date when today
  // falls within the trip, so opening the day list mid-trip doesn't strand
  // the traveler back at day one. Redirecting (rather than just scrolling)
  // reuses the scroll effect above and leaves the URL correctly reflecting
  // what's on screen, same as picking today from "Jump to a day" would.
  useEffect(() => {
    if (date || !view?.dateRange) return;
    const today = todayDateStr();
    if (today >= view.dateRange.startDate && today <= view.dateRange.endDate) {
      navigate(`/${slug}/days/${today}`, { replace: true });
    }
  }, [date, view?.dateRange, slug, navigate]);

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
  const [draggingMeta, setDraggingMeta] = useState<DragMeta | null>(null);
  const draggingActivity = draggingMeta?.activityId
    ? (data?.activities.find((a) => a._id === draggingMeta.activityId) ?? null)
    : null;
  const draggingTransit = draggingMeta?.transitId
    ? (data?.transits.find((t) => t._id === draggingMeta.transitId) ?? null)
    : null;
  // The DragOverlay's own "N items" chip count — a multi-select of more
  // than one row (of any kind: a plain Activity, a Transit's Depart row, or
  // a whole scenario-tabs bundle; see RowSelectionValue) takes priority
  // when active (selection is untouched for the whole drag, only cleared
  // once handleDragEnd's group branch commits, so this can be derived
  // straight from current state rather than snapshotted at drag-start);
  // otherwise a lone scenario-tabs drag shows its own bundle size.
  // draggingMeta's activityId/transitId/scenarioGroup are mutually
  // exclusive per row, so falling back to scenarioGroup here never masks a
  // single Activity/Transit drag.
  const draggingItemCount =
    draggingMeta?.id && selection && selection.rows.has(draggingMeta.id) && selection.rows.size > 1
      ? selection.rows.size
      : draggingMeta?.scenarioGroup
        ? draggingMeta.scenarioGroup.activityIds.length +
          draggingMeta.scenarioGroup.transitIds.length
        : null;

  const handleDragStart = (event: DragStartEvent) => {
    setDraggingMeta((event.active.data.current as DragMeta | undefined) ?? null);
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
  // same-day cross-container drop still resolves to some row's plain
  // DragMeta and forces the dragged Activity onto that row's own instant
  // regardless of duration, which is exactly how dragging an Activity out
  // of a scenario tab used to scramble its displayed time. A drop that
  // crosses onto a *different calendar day* is deliberately NOT treated
  // this way — see `dayOfContainer`/`preserveOwnTiming` below — since
  // relocating onto the new day's own real anchor timestamp (date
  // included) is the entire point of that drag, not something to guard
  // against the way an ambiguous same-day "before vs. after" is.
  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingMeta(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeMeta = active.data.current as DragMeta | undefined;
    const overMeta = over.data.current as DragMeta | undefined;
    if (!activeMeta || !overMeta) return;
    const activeContainerId = containerIdOf(active.data.current);
    const overContainerId = containerIdOf(over.data.current);
    const containerChanged = activeContainerId !== overContainerId;
    // Only a same-day container crossing should leave the dragged
    // Activity's own time untouched (reorder.ts's `preserveOwnTiming`) — a
    // containerChanged drop that also lands on a different calendar day
    // needs the normal takeover so the destination day's own anchor
    // timestamp (and therefore the new date) actually applies.
    const preserveOwnTiming =
      containerChanged && dayOfContainer(activeContainerId) === dayOfContainer(overContainerId);
    const movingUp = !containerChanged && activeMeta.index > overMeta.index;
    const dropMeta: DragMeta =
      movingUp && overMeta.before ? { ...overMeta, ...overMeta.before } : overMeta;
    const dayStart = dropMeta.containerDayStart;

    // A drag of a row that's itself part of a real (>1) multi-select moves
    // every selected row together, regardless of container or day — takes
    // priority over the single-row branches below. Dragging some other,
    // unselected row while a selection exists elsewhere still falls through
    // to those (a normal single-row drag; the selection is left untouched).
    if (selection && selection.rows.has(activeMeta.id) && selection.rows.size > 1 && data) {
      const rows = [...selection.rows.values()];
      // A selection made up entirely of plain Activity rows keeps the
      // original insertion-chaining behavior (applyGroupActivityReorder,
      // each member anchored right after the previous one) — this is
      // established, tested behavior, unchanged from before mixed
      // selections existed. A selection that includes a Transit row and/or
      // a scenario-group bundle instead moves as one rigid formation
      // (applyBlockReorder — every member shifted by the same delta,
      // preserving each member's own offset from the rest of the group),
      // since that's the only sensible way to keep e.g. a scenario's own
      // Depart/Arrive/Activities and a plain Activity selected alongside it
      // (a dinner right after) in the same relative arrangement on drop.
      const isPureActivitySelection = rows.every(
        (row) => row.members.transitIds.length === 0 && row.members.activityIds.length === 1,
      );
      if (isPureActivitySelection) {
        const originContainerByActivityId = new Map(
          rows.map((row) => [row.members.activityIds[0], row.containerId]),
        );
        const groupIds = data.activities
          .filter((a) => originContainerByActivityId.has(a._id))
          .sort((a, b) => activitySortKey(a, dayStart).localeCompare(activitySortKey(b, dayStart)))
          .map((a) => a._id);
        // Each group member's own origin container may differ from the row
        // that was actually dragged (a multi-day selection) — so whether a
        // given member's own drop should preserve its own timing has to be
        // asked per Activity, against that Activity's own recorded origin
        // day, rather than reusing the single `preserveOwnTiming` flag
        // derived from just the dragged row above.
        setData(
          (prev) =>
            applyGroupActivityReorder(prev, dropMeta, groupIds, dayStart, (id) => {
              const originContainerId = originContainerByActivityId.get(id);
              return (
                originContainerId !== overContainerId &&
                dayOfContainer(originContainerId) === dayOfContainer(overContainerId)
              );
            }),
          ['activities'],
        );
      } else {
        const activityIds = new Set<string>();
        const transitIds = new Set<string>();
        for (const row of rows) {
          row.members.activityIds.forEach((id) => activityIds.add(id));
          row.members.transitIds.forEach((id) => transitIds.add(id));
        }
        setData(
          (prev) =>
            applyBlockReorder(
              prev,
              dropMeta,
              { activityIds: [...activityIds], transitIds: [...transitIds] },
              dayStart,
            ),
          ['activities', 'transits'],
        );
      }
      clearRowSelection();
      return;
    }

    if (activeMeta.scenarioGroup) {
      const members = activeMeta.scenarioGroup;
      setData(
        (prev) => applyBlockReorder(prev, dropMeta, members, dayStart),
        ['activities', 'transits'],
      );
      return;
    }

    if (activeMeta.transitId) {
      const transitId = activeMeta.transitId;
      setData(
        (prev) => applyTransitReorder(prev, dropMeta, transitId, dayStart, preserveOwnTiming),
        ['transits'],
      );
      return;
    }

    if (!activeMeta.activityId) return;
    const activityId = activeMeta.activityId;
    setData(
      (prev) => applyActivityReorder(prev, dropMeta, activityId, dayStart, preserveOwnTiming),
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
        <IconButton edge="end" aria-label="Ask AI" onClick={() => setAskAIOpen(true)}>
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
                onAddEvent={handleAddEvent}
              />
            ))}
          </Stack>
          <DragOverlay>
            {draggingItemCount !== null ? (
              <DragOverlayChip>
                <Typography variant="subtitle2">{draggingItemCount} items</Typography>
              </DragOverlayChip>
            ) : draggingActivity ? (
              <DragOverlayChip>
                <Box>
                  <Typography variant="subtitle2">{draggingActivity.text}</Typography>
                  {draggingActivity.startAt && (
                    <Typography variant="caption" color="text.secondary">
                      {formatTime(draggingActivity.startAt)}
                    </Typography>
                  )}
                </Box>
              </DragOverlayChip>
            ) : draggingTransit ? (
              <DragOverlayChip>
                <Typography variant="subtitle2">
                  {draggingTransit.from.label} → {draggingTransit.to.label}
                </Typography>
              </DragOverlayChip>
            ) : null}
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
            setData((prev) => ({ ...prev, routes: upsertById(prev.routes, route) }), ['routes'])
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
              (prev) => ({ ...prev, scenarios: upsertById(prev.scenarios, scenario) }),
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
      {data && addWizardDay && (
        <AddEventWizard
          legId={addWizardDay.leg._id}
          date={addWizardDay.date}
          stays={data.stays}
          activities={data.activities}
          transits={data.transits}
          scenarios={data.scenarios}
          legs={data.legs}
          tripTravelers={data.trip.travelers}
          routes={data.routes}
          onClose={() => setAddWizardDay(null)}
          onSaveEntity={(kind: EditKind, entity: Activity | Stay | Transit) => {
            const collection = COLLECTION_FOR_KIND[kind];
            setData(
              (prev) => ({
                ...prev,
                [collection]: [...(prev[collection] as (Activity | Stay | Transit)[]), entity],
              }),
              [collection],
            );
            setAddWizardDay(null);
          }}
          onSaveScenario={(scenario: Scenario) => {
            setData(
              (prev) => ({ ...prev, scenarios: [...prev.scenarios, scenario] }),
              ['scenarios'],
            );
            setAddWizardDay(null);
          }}
        />
      )}
    </Box>
  );
}
