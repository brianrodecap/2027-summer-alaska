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
import type { ReactNode } from 'react';

import { firstImage } from '../../model/formatting';
import { formatDateLabel, formatMoney, tripDayCount } from '../../model/tripModel';
import type { Booking, Day, LegSummary } from '../../model/types';
import { BookingChip } from '../shared/BookingChip';
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
  const groups = groupDaysByLocation(days);
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
  return (
    <Stack spacing={0.5} sx={{ my: 1, alignItems: 'flex-start' }}>
      <BookingChip booking={booking} />
      {booking.depositPaidAt && (
        <Typography variant="body2">Deposit paid {booking.depositPaidAt}</Typography>
      )}
      {booking.finalPaymentDueAt && (
        <Typography variant="body2">Final payment due {booking.finalPaymentDueAt}</Typography>
      )}
      {booking.passengers?.length ? (
        <Box component="ul" sx={{ pl: 2, m: 0 }}>
          {booking.passengers.map((p) => (
            <Typography component="li" variant="body2" key={p.name}>
              {p.name}: {formatMoney(p.fare)}
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
  if (!summary) return null;
  const { leg, dateRange, days, notes } = summary;
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
        {image && (
          <Box
            component="img"
            src={image.uri}
            alt={image.caption ?? ''}
            title={image.credit ?? ''}
            sx={{ width: '100%', borderRadius: 2, mb: 2 }}
          />
        )}
        <Typography variant="body2" color="text.secondary">
          {dateRange
            ? `${formatDateLabel(dateRange.startDate)} – ${formatDateLabel(dateRange.endDate)} · `
            : ''}
          {dayCount} days
        </Typography>
        {leg.booking ? (
          <LegBooking booking={leg.booking} />
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
