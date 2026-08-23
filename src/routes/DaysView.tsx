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
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import RouteIcon from '@mui/icons-material/Route';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import useScrollTrigger from '@mui/material/useScrollTrigger';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { ActivityDetailPanel } from '../components/activity/ActivityDetailPanel';
import { DayBlock } from '../components/day/DayBlock';
import { DayMapPanel } from '../components/day/DayMapPanel';
import { FilterMenu } from '../components/day/FilterMenu';
import { StayDetailPanel } from '../components/day/StayDetailPanel';
import { TransitDetailPanel } from '../components/day/TransitDetailPanel';
import { RoutesDialog } from '../components/edit/RoutesDialog';
import { JumpToDayPicker } from '../components/pickers/JumpToDayPicker';
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
} from '../model/types';
import { useEdit } from '../state/EditContext';
import { useTripData } from '../state/TripDataContext';
import { useFilterSelection } from '../state/TripSelectionsContext';

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
  // Flat while it's the page's own leading edge, shadowed only once content
  // has scrolled in underneath it — the M3 app-bar spec's own elevation rule.
  const elevated = useScrollTrigger({ disableHysteresis: true, threshold: 1 });

  const daysByDate = useMemo(() => new Map((view?.days ?? []).map((d) => [d.date, d])), [view]);
  const visibleDays = useMemo(
    () => (view?.days ?? []).filter((day) => dayHasVisibleContent(day, activeFilterTokens)),
    [view, activeFilterTokens],
  );

  useEffect(() => {
    if (!date) return;
    const el = document.getElementById(`day-${date}`);
    el?.scrollIntoView({ block: 'start' });
  }, [date, view]);

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
  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeMeta = active.data.current as DragMeta | undefined;
    const overMeta = over.data.current as DragMeta | undefined;
    if (!activeMeta?.activityId || !overMeta) return;
    const activityId = activeMeta.activityId;
    const movingUp = activeMeta.index > overMeta.index;
    const dropMeta: DragMeta =
      movingUp && overMeta.before ? { ...overMeta, ...overMeta.before } : overMeta;
    const dayStart = dropMeta.containerDayStart;
    setData((prev) => applyActivityReorder(prev, dropMeta, activityId, dayStart), ['activities']);
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
    </Box>
  );
}
