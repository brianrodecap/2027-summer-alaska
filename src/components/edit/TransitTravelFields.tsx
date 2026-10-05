import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { isOnBoard, type TransitFormState } from '../../model/editForms';
import type { SeatAssignment, Traveler } from '../../model/types';
import { TravelerCheckboxList } from './TravelerCheckboxList';

// Carrier/flight details plus who's traveling and where each of them sits —
// shared by the flat TransitEditForm and the wizard's transit booking step.
// Seats are per traveler on this one Transit (a round trip's return flight
// has its own), so there's one row per traveler on board: everyone when no
// travelers are picked, otherwise just those picked. A row with no seat
// typed, or for a traveler no longer picked, is dropped on Save (see
// applyTransitForm).
export function TransitTravelFields({
  form,
  onChange,
  tripTravelers,
}: {
  form: TransitFormState;
  onChange: (form: TransitFormState) => void;
  tripTravelers: Traveler[];
}) {
  const onBoard = tripTravelers.filter((t) => isOnBoard(form.travelerIds, t.id));
  const seatFor = (travelerId: string): SeatAssignment =>
    form.seats.find((s) => s.travelerId === travelerId) ?? { travelerId, seat: '' };
  const setSeat = (travelerId: string, patch: Partial<SeatAssignment>) => {
    const next = { ...seatFor(travelerId), ...patch };
    for (const key of ['cabin', 'fareClass'] as const) if (!next[key]) delete next[key];
    onChange({
      ...form,
      seats: [...form.seats.filter((s) => s.travelerId !== travelerId), next],
    });
  };

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={2}>
        <TextField
          label="Carrier"
          value={form.carrier}
          onChange={(e) => onChange({ ...form, carrier: e.target.value })}
          fullWidth
        />
        <TextField
          label="Flight / trip #"
          value={form.flightNumber}
          onChange={(e) => onChange({ ...form, flightNumber: e.target.value })}
          fullWidth
        />
      </Stack>
      <Stack direction="row" spacing={2}>
        <TextField
          label="Operated by"
          placeholder="If another carrier flies it"
          value={form.operatedBy}
          onChange={(e) => onChange({ ...form, operatedBy: e.target.value })}
          fullWidth
        />
        <TextField
          label="Aircraft / vessel"
          value={form.aircraft}
          onChange={(e) => onChange({ ...form, aircraft: e.target.value })}
          fullWidth
        />
      </Stack>
      {tripTravelers.length > 0 && (
        <>
          <TravelerCheckboxList
            caption="Travelers (leave all unchecked for everyone)"
            travelers={tripTravelers}
            selectedIds={form.travelerIds}
            onChange={(travelerIds) => onChange({ ...form, travelerIds })}
          />
          <Typography variant="overline" color="text.secondary">
            Seats on this {form.flightNumber ? 'flight' : 'trip'}
          </Typography>
          {onBoard.map((t) => {
            const seat = seatFor(t.id);
            return (
              <Stack key={t.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="body2" sx={{ minWidth: 0, flex: '1 1 30%' }} noWrap>
                  {t.name}
                </Typography>
                <TextField
                  size="small"
                  label="Seat"
                  value={seat.seat}
                  onChange={(e) => setSeat(t.id, { seat: e.target.value })}
                  sx={{ flex: '1 1 20%' }}
                />
                <TextField
                  size="small"
                  label="Cabin"
                  value={seat.cabin ?? ''}
                  onChange={(e) => setSeat(t.id, { cabin: e.target.value })}
                  sx={{ flex: '1 1 30%' }}
                />
                <TextField
                  size="small"
                  label="Class"
                  value={seat.fareClass ?? ''}
                  onChange={(e) => setSeat(t.id, { fareClass: e.target.value })}
                  sx={{ flex: '1 1 20%' }}
                />
              </Stack>
            );
          })}
        </>
      )}
    </Stack>
  );
}
