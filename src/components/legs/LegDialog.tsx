import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { type ReactNode, useMemo } from 'react';

import { bookingFares } from '../../model/bookings';
import { firstImage } from '../../model/formatting';
import {
  formatDateRangeLabel,
  formatMoney,
  travelersById,
  tripDayCount,
} from '../../model/tripModel';
import type { Booking, Day, LegSummary } from '../../model/types';
import { useLiveDays } from '../../state/useLiveDays';
import { useTripData } from '../../state/useTripData';
import { BookingChip } from '../shared/BookingChip';
import { EntityHeroImage } from '../shared/EntityHeroImage';
import { NotesCluster } from '../shared/Notes';
import { groupDaysByLocation } from './legDayGroups';

function DayRow({ day, onSelectDay }: { day: Day; onSelectDay: (date: string) => void }) {
  return (
    <ListItemButton onClick={() => onSelectDay(day.date)}>
      <ListItemText primary={day.summary} secondary={day.dateLabel} />
      <ChevronRightIcon color="action" />
    </ListItemButton>
  );
}

function DayGroup({
  group,
  onSelectDay,
}: {
  group: { location: string; days: Day[] };
  onSelectDay: (date: string) => void;
}) {
  const range = `${group.days[0].dateLabel} – ${group.days[group.days.length - 1].dateLabel}`;
  return (
    <Accordion disableGutters elevation={0} sx={{ '&:before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Box>
          <Typography variant="subtitle2">{group.location}</Typography>
          <Typography variant="caption" color="text.secondary">
            {range} · {group.days.length} days
          </Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ p: 0 }}>
        <List disablePadding>
          {group.days.map((d) => (
            <DayRow key={d.date} day={d} onSelectDay={onSelectDay} />
          ))}
        </List>
      </AccordionDetails>
    </Accordion>
  );
}

// Consecutive single-day groups share one plain list; a run of 2+ days at
// the same location becomes its own collapsible accordion.
function LegDayList({ days, onSelectDay }: { days: Day[]; onSelectDay: (date: string) => void }) {
  const groups = useMemo(() => groupDaysByLocation(days), [days]);
  const blocks: ReactNode[] = [];
  let pending: Day[] = [];
  const flushPending = (key: string) => {
    if (pending.length) {
      blocks.push(
        <List key={key} disablePadding>
          {pending.map((d) => (
            <DayRow key={d.date} day={d} onSelectDay={onSelectDay} />
          ))}
        </List>,
      );
    }
    pending = [];
  };
  groups.forEach((group, i) => {
    if (group.days.length === 1) {
      pending.push(group.days[0]);
    } else {
      flushPending(`pending-${i}`);
      blocks.push(<DayGroup key={`group-${i}`} group={group} onSelectDay={onSelectDay} />);
    }
  });
  flushPending('pending-last');
  return <>{blocks}</>;
}

function LegBooking({ booking }: { booking: Booking }) {
  const { data } = useTripData();
  const fares = bookingFares(booking);
  const names = travelersById(data?.trip.travelers ?? []);
  const travelerName = (id: string) => names.get(id) ?? id;
  return (
    <Stack spacing={0.5} sx={{ my: 1, alignItems: 'flex-start' }}>
      <BookingChip booking={booking} />
      {booking.depositPaidAt && (
        <Typography variant="body2">Deposit paid {booking.depositPaidAt}</Typography>
      )}
      {booking.finalPaymentDueAt && (
        <Typography variant="body2">Final payment due {booking.finalPaymentDueAt}</Typography>
      )}
      {fares?.length ? (
        <Box component="ul" sx={{ pl: 2, m: 0 }}>
          {fares.map((f) => (
            <Typography component="li" variant="body2" key={f.travelerId}>
              {travelerName(f.travelerId)}: {formatMoney(f.fare)}
            </Typography>
          ))}
        </Box>
      ) : null}
    </Stack>
  );
}

export function LegDialog({
  summary,
  open,
  onClose,
  onSelectDay,
}: {
  summary: LegSummary | null;
  open: boolean;
  onClose: () => void;
  onSelectDay: (date: string) => void;
}) {
  const live = useLiveDays();
  if (!summary) return null;
  const { leg, dateRange, notes, booking } = summary;
  // Each day as the reader is looking at it — the summary line and location
  // grouping follow the current scenario picks.
  const days = summary.days.flatMap((d) => live.byDate.get(d.date) ?? []);
  const image = firstImage(leg);
  const dayCount = dateRange ? tripDayCount(dateRange) : 0;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {leg.name}
        <IconButton onClick={onClose} aria-label="Close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ maxHeight: '70vh' }}>
        <EntityHeroImage image={image} />
        <Typography variant="body2" color="text.secondary">
          {dateRange ? `${formatDateRangeLabel(dateRange)} · ` : ''}
          {dayCount} days
        </Typography>
        {booking ? (
          <LegBooking booking={booking} />
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ my: 1 }}>
            No single reservation for this leg — booked piece by piece as its
            Stays/Transits/Activities.
          </Typography>
        )}
        <NotesCluster notes={notes} expanded />
        <Divider sx={{ my: 1 }} />
        <LegDayList days={days} onSelectDay={onSelectDay} />
      </DialogContent>
    </Dialog>
  );
}
