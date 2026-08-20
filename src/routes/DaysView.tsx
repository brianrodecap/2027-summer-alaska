import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import useScrollTrigger from '@mui/material/useScrollTrigger';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import RouteIcon from '@mui/icons-material/Route';

import { useTripData } from '../state/TripDataContext';
import { useTripSelections } from '../state/TripSelectionsContext';
import { useEdit } from '../state/EditContext';
import { DayBlock } from '../components/day/DayBlock';
import { DayMapPanel } from '../components/day/DayMapPanel';
import { FilterMenu } from '../components/day/FilterMenu';
import { ActivityDetailPanel } from '../components/activity/ActivityDetailPanel';
import { JumpToDayPicker } from '../components/pickers/JumpToDayPicker';
import { RoutesDialog } from '../components/edit/RoutesDialog';
import { dayHasVisibleContent } from '../model/filters';
import type { Day, EnrichedActivity, EnrichedMealOption, Route } from '../model/types';

export function DaysView() {
  const { view, data, setData } = useTripData();
  const { activeFilterTokens } = useTripSelections();
  const { openEdit } = useEdit();
  const { slug, date } = useParams();
  const navigate = useNavigate();
  const [mapDay, setMapDay] = useState<Day | null>(null);
  const [openActivity, setOpenActivity] = useState<{ activity: EnrichedActivity; selectedOption?: EnrichedMealOption } | null>(null);
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

  if (!view) return null;

  const handleOpenActivity = (activity: EnrichedActivity, selectedOption?: EnrichedMealOption) => {
    setOpenActivity({ activity, selectedOption });
  };

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
        <IconButton aria-label="Jump to a day" onClick={() => setDatePickerOpen(true)}>
          <CalendarMonthIcon />
        </IconButton>
        <FilterMenu legSummaries={view.legSummaries} />
        <IconButton aria-label="Manage routes" onClick={() => setRoutesOpen(true)}>
          <RouteIcon />
        </IconButton>
      </Box>
      {visibleDays.length === 0 ? (
        <Typography variant="body1" color="text.secondary" sx={{ px: 3, py: 4, textAlign: 'center' }}>
          No days match the selected filters.
        </Typography>
      ) : (
        <Stack divider={<Box sx={{ borderBottom: 1, borderColor: 'divider' }} />}>
          {visibleDays.map((day) => (
            <DayBlock key={day.date} day={day} daysByDate={daysByDate} onOpenActivity={handleOpenActivity} onOpenMap={setMapDay} />
          ))}
        </Stack>
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
      <JumpToDayPicker
        open={datePickerOpen}
        onClose={() => setDatePickerOpen(false)}
        days={view.days}
        tripStart={view.trip.startDate}
        tripEnd={view.trip.endDate}
        onSelectDay={(selectedDate) => navigate(`/${slug}/days/${selectedDate}`)}
      />
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
            setData((prev) => ({ ...prev, routes: prev.routes.filter((r) => r._id !== id) }), ['routes'])
          }
        />
      )}
    </Box>
  );
}
