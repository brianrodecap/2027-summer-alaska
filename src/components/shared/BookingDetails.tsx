import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMemo } from 'react';

import { bookedThroughLabel, paymentSummaryLine, priceLineLabel } from '../../model/bookingDetails';
import { bookingCost, bookingFixedCharges, travelerPrices } from '../../model/bookings';
import { bookingCoverageLabels } from '../../model/editForms';
import { bookingPaymentSummary, formatMoney, todayDateStr } from '../../model/tripModel';
import type { Booking, Money, Payable } from '../../model/types';
import { useTravelerNames } from '../../state/useTravelerNames';
import { useTripData } from '../../state/useTripData';
import { renderMaterialIcon } from './materialIcon';

function PriceRow({
  label,
  detail,
  amount,
  state,
  bold,
}: {
  label: string;
  detail?: string;
  amount: Money | null;
  state?: string | null;
  bold?: boolean;
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        columnGap: 1.5,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <Typography variant="body2" sx={{ fontWeight: bold ? 700 : undefined }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ textAlign: 'right', fontWeight: bold ? 700 : undefined }}>
        {formatMoney(amount)}
      </Typography>
      {(detail || state) && (
        <Typography variant="caption" color="text.secondary" sx={{ gridColumn: '1 / -1' }}>
          {[detail, state].filter(Boolean).join(' · ')}
        </Typography>
      )}
    </Box>
  );
}

// Everything a booking records past its chip: the paid/due summary, the
// seller, each traveler's fare lines (with ticket numbers) and each fixed
// charge, in a panel that opens on its own while money is still due; then,
// always in view, what else the same booking pays for. `date` is the day the
// booked entity starts; `entityId` is the entity that owns the booking on
// this view, left out of "also covers".
export function BookingDetails({
  booking,
  date,
  entityId,
}: {
  booking: Booking;
  date: string | null;
  entityId: string;
}) {
  const { data } = useTripData();
  const today = todayDateStr();
  const alsoCovers = useMemo(
    () => (data ? bookingCoverageLabels(data, booking._id, entityId) : []),
    [data, booking._id, entityId],
  );
  const names = useTravelerNames();

  const payments = bookingPaymentSummary(booking, date, today);
  const summary = paymentSummaryLine(booking, payments);
  const seller = bookedThroughLabel(booking.bookedThrough);
  const travelers = travelerPrices(booking);
  const fixed = bookingFixedCharges(booking) ?? [];
  const lineCount = travelers.reduce((n, t) => n + t.lines.length, 0) + fixed.length;
  const state = (payable: Payable | undefined) => priceLineLabel(payable, booking, date, today);

  return (
    <>
      {(summary || seller || lineCount > 0) && (
        <Accordion
          defaultExpanded={payments.due.length > 0}
          disableGutters
          elevation={0}
          sx={{
            mt: 1,
            bgcolor: 'surfaceContainer.high',
            borderRadius: 2,
            '&::before': { display: 'none' },
          }}
        >
          <AccordionSummary expandIcon={renderMaterialIcon('expand_more')}>
            <Typography variant="subtitle2">Booking details</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={1.25}>
              {summary && <Typography variant="body2">{summary}</Typography>}
              {seller && (
                <Typography variant="body2" color="text.secondary">
                  Booked through {seller}
                </Typography>
              )}
              {travelers.map((t) => {
                const name = names.get(t.travelerId) ?? t.travelerId;
                const ticket = t.ticketNumber ? `Ticket ${t.ticketNumber}` : undefined;
                if (t.lines.length === 1) {
                  const [line] = t.lines;
                  return (
                    <PriceRow
                      key={t.travelerId}
                      label={name}
                      detail={ticket}
                      amount={line.amount}
                      state={state(line.payable)}
                    />
                  );
                }
                return (
                  <Stack key={t.travelerId} spacing={0.5}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {name}
                      {ticket && (
                        <Typography component="span" variant="caption" color="text.secondary">
                          {` · ${ticket}`}
                        </Typography>
                      )}
                    </Typography>
                    {t.lines.map((line, i) => (
                      <PriceRow
                        key={i}
                        label="Fare"
                        amount={line.amount}
                        state={state(line.payable)}
                      />
                    ))}
                  </Stack>
                );
              })}
              {fixed.map((c, i) => (
                <PriceRow
                  key={`${c.label}-${i}`}
                  label={c.label}
                  amount={c.amount}
                  state={state(c.payable)}
                />
              ))}
              {lineCount > 1 && <PriceRow label="Total" amount={bookingCost(booking)} bold />}
            </Stack>
          </AccordionDetails>
        </Accordion>
      )}
      {alsoCovers.length > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Same booking also covers {alsoCovers.join(', ')}.
        </Typography>
      )}
    </>
  );
}
