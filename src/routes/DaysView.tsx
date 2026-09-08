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
import { applyGroupDragEnd, applySingleRowDragEnd, type DragMeta } from '../model/reorder';
import { activityHeadline, formatTime, todayDateStr, transitRouteLabel } from '../model/tripModel';
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
import type { CollectionName } from '../state/TripDataContextObject';
import { useEdit } from '../state/useEdit';
import { useTripData } from '../state/useTripData';
import { useFilterSelection, useRowSelection } from '../state/useTripSelections';

// Stay's, Transit's and Activity's detail panels are all opened/closed/edited
// the same way — a plain "which entity is open" state, with Edit clearing it
// and handing off to EditContext's own dialog. Activity's panel additionally
// carries a selected meal-option candidate, resolved via `resolveSecondary`.
//
// Stores only the id(s), not the entity itself — a live edit (an in-place
// photo pick, say — see PlacePanel's onSelectImage) rebuilds `view` with a
// fresh object for every entity, and a panel that had captured the *old* one
// at open time would keep showing stale data until closed and reopened.
// Looking it up by id from `byId` every render instead means the open sheet
// always reflects whatever `view` currently holds.
function useDetailPanel<T extends { _id: string }, S = never>(
  byId: Map<string, T> | undefined,
  openEdit: (id: string) => void,
  resolveSecondary?: (entity: T, secondaryId: string) => S | undefined,
) {
  const [ids, setIds] = useState<{ id: string; secondaryId?: string } | null>(null);
  const entity = ids ? (byId?.get(ids.id) ?? null) : null;
  const secondary =
    entity && ids?.secondaryId && resolveSecondary
      ? resolveSecondary(entity, ids.secondaryId)
      : undefined;
  // onOpen/onClose are memoized because they're handed straight to the
  // memoized DayBlock (onOpenStay/onOpenTransit, and onOpenActivity via
  // DaysView's adapter). A fresh closure here would defeat that memo for all
  // ~28 unvirtualized day blocks on every unrelated DaysView state change —
  // see DayBlock's own note on why it's memoized. setIds is stable, so these
  // need no dependencies.
  const onOpen = useCallback(
    (e: T, secondaryId?: string) => setIds({ id: e._id, secondaryId }),
    [],
  );
  const onClose = useCallback(() => setIds(null), []);
  return {
    entity,
    secondary,
    open: Boolean(ids),
    onOpen,
    onClose,
    onEdit: entity
      ? () => {
          setIds(null);
          openEdit(entity._id);
        }
      : undefined,
  };
}

// dnd-kit's own `data.current` is typed `unknown` — this just unwraps the
// `sortable.containerId` it stamps on every row alongside our own DragMeta
// fields (see SortableData); call sites normalize the result to
// `string | null` before handing it to reorder.ts. The same-day-vs-cross-day
// resolution that used to live here (dayOfContainer/preserveOwnTiming) has
// moved into reorder.ts's own resolveDragEndPlacement, since it's business
// logic, not dnd-kit wiring — see that function's own comment for the
// reasoning.
function containerIdOf(dndData: unknown): unknown {
  return (dndData as { sortable?: { containerId: unknown } } | undefined)?.sortable?.containerId;
}

function normalizeContainerId(containerId: unknown): string | null {
  return typeof containerId === 'string' ? containerId : null;
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
  const activityPanel = useDetailPanel<EnrichedActivity, EnrichedMealOption>(
    view?.activitiesById,
    (id) => openEdit('activity', id),
    (activity, optionId) => activity.options?.find((o) => o._id === optionId),
  );
  const stayPanel = useDetailPanel<EnrichedStay>(view?.staysById, (id) => openEdit('stay', id));
  const transitPanel = useDetailPanel<EnrichedTransit>(view?.transitsById, (id) =>
    openEdit('transit', id),
  );
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

  // Memoized for the same reason as handleAddEvent below: this is passed
  // straight to the memoized DayBlock, and activityPanel.onOpen is itself
  // stable (see useDetailPanel), so this adapter stays stable too.
  const handleOpenActivity = useCallback(
    (activity: EnrichedActivity, selectedOption?: EnrichedMealOption) =>
      activityPanel.onOpen(activity, selectedOption?._id),
    [activityPanel.onOpen],
  );

  // Reordering — see src/model/reorder.ts. A distance threshold on the
  // pointer sensor is what lets a plain tap still open a row's detail sheet
  // instead of every click starting a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [draggingMeta, setDraggingMeta] = useState<DragMeta | null>(null);
  const draggingSource = draggingMeta?.source ?? null;
  const draggingActivity =
    draggingSource?.kind === 'activity'
      ? (data?.activities.find((a) => a._id === draggingSource.id) ?? null)
      : null;
  const draggingTransit =
    draggingSource?.kind === 'transit'
      ? (data?.transits.find((t) => t._id === draggingSource.id) ?? null)
      : null;
  // The DragOverlay's own "N items" chip count — a multi-select of more
  // than one row (of any kind: a plain Activity, a Transit's Depart row, or
  // a whole scenario-tabs bundle; see RowSelectionValue) takes priority
  // when active (selection is untouched for the whole drag, only cleared
  // once handleDragEnd's group branch commits, so this can be derived
  // straight from current state rather than snapshotted at drag-start);
  // otherwise a lone scenario-tabs drag shows its own bundle size.
  // draggingMeta.source is a tagged union naming exactly one kind, so
  // falling back to its 'scenario-group' case here never masks a single
  // Activity/Transit drag.
  const draggingItemCount =
    draggingMeta?.id && selection && selection.rows.has(draggingMeta.id) && selection.rows.size > 1
      ? selection.rows.size
      : draggingMeta?.source?.kind === 'scenario-group'
        ? draggingMeta.source.members.activityIds.length +
          draggingMeta.source.members.transitIds.length
        : null;

  const handleDragStart = (event: DragStartEvent) => {
    setDraggingMeta((event.active.data.current as DragMeta | undefined) ?? null);
  };

  // A thin dispatcher — the actual drag/direction/timing resolution
  // (movingUp, preserveOwnTiming, dropMeta) and the dispatch onto the right
  // applyXReorder now live in reorder.ts's own applySingleRowDragEnd/
  // applyGroupDragEnd (see their own comments for the Homer-Spit/same-day-
  // vs-cross-day reasoning); this just unwraps dnd-kit's event, decides
  // single-row vs. multi-select, and commits the result via setData.
  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingMeta(null);
    const { active, over } = event;
    if (!over || active.id === over.id || !data) return;
    const activeMeta = active.data.current as DragMeta | undefined;
    const overMeta = over.data.current as DragMeta | undefined;
    if (!activeMeta || !overMeta) return;
    const activeContainerId = normalizeContainerId(containerIdOf(active.data.current));
    const overContainerId = normalizeContainerId(containerIdOf(over.data.current));

    // A drag of a row that's itself part of a real (>1) multi-select moves
    // every selected row together, regardless of container or day — takes
    // priority over the single-row case below. Dragging some other,
    // unselected row while a selection exists elsewhere still falls through
    // to that (a normal single-row drag; the selection is left untouched).
    if (selection && selection.rows.has(activeMeta.id) && selection.rows.size > 1) {
      const rows = [...selection.rows.values()];
      const result = applyGroupDragEnd(
        data,
        activeMeta,
        overMeta,
        activeContainerId,
        overContainerId,
        rows,
      );
      setData(() => result.data, result.collections as CollectionName[]);
      clearRowSelection();
      return;
    }

    const result = applySingleRowDragEnd(
      data,
      activeMeta,
      overMeta,
      activeContainerId,
      overContainerId,
    );
    if (!result) return;
    setData(() => result.data, result.collections as CollectionName[]);
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
                  <Typography variant="subtitle2">{activityHeadline(draggingActivity)}</Typography>
                  {draggingActivity.startAt && (
                    <Typography variant="caption" color="text.secondary">
                      {formatTime(draggingActivity.startAt)}
                    </Typography>
                  )}
                </Box>
              </DragOverlayChip>
            ) : draggingTransit ? (
              <DragOverlayChip>
                <Typography variant="subtitle2">{transitRouteLabel(draggingTransit)}</Typography>
              </DragOverlayChip>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
      <DayMapPanel day={mapDay} open={Boolean(mapDay)} onClose={() => setMapDay(null)} />
      <ActivityDetailPanel
        activity={activityPanel.entity}
        selectedOption={activityPanel.secondary}
        open={activityPanel.open}
        onClose={activityPanel.onClose}
        onEdit={activityPanel.onEdit}
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
                // Upsert rather than a plain append — a brand-new entity's id
                // is never already present, but merging a duplicate meal into
                // an existing Activity (see AddEventWizard's meal-duplicate
                // step) reuses that Activity's own id and needs to replace it
                // in place instead of adding a second copy.
                [collection]: upsertById(prev[collection] as (Activity | Stay | Transit)[], entity),
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
