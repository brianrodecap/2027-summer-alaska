import Snackbar from '@mui/material/Snackbar';
import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';

import { JumpToDayPicker } from '../components/pickers/JumpToDayPicker';
import { LegChoiceDialog } from '../components/pickers/LegChoiceDialog';
import { ShiftLegsDialog } from '../components/pickers/ShiftLegsDialog';
import {
  applyMoveToDay,
  type LegShift,
  legShiftOffer,
  movedFrom,
  type MoveMembers,
  moveNotes,
  nearestLegId,
  shiftLegs,
  suggestedLegId,
  wholeDays,
} from '../model/moveToDay';
import { MoveToDayContext } from './MoveToDayContextObject';
import { useTripData } from './useTripData';

// The day picker behind every "Move to another day" action (a row's menu, the
// selection bar): rows ask through the context, and the picker, the move and
// any refusal live here once.
export function MoveToDayProvider({ children }: { children: ReactNode }) {
  const { data, view, setData } = useTripData();
  // Kept after the picker closes: it reports its pick once its exit transition
  // has finished (see JumpToDayPicker).
  const [moves, setMoves] = useState<MoveMembers[] | null>(null);
  const [open, setOpen] = useState(false);
  // A picked date that needs a leg named (the trip changes legs that day, or the date
  // is beyond the trip), until the person says which: the legs to choose from and the
  // one to suggest.
  const [choosingLeg, setChoosingLeg] = useState<{
    date: string;
    legIds: string[];
    why: string;
    suggested: string | null;
  } | null>(null);
  // A move that stretches a leg over others, until the person says whether to
  // shift those legs.
  const [shifting, setShifting] = useState<{
    date: string;
    legId: string;
    shifts: LegShift[];
  } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const onMoved = useRef<(() => void) | undefined>(undefined);

  const requestMove = useCallback((next: MoveMembers[], whenMoved?: () => void) => {
    onMoved.current = whenMoved;
    setMoves(next);
    setOpen(true);
  }, []);
  const value = useMemo(() => ({ requestMove }), [requestMove]);

  const notes = useMemo(() => (data && moves ? moveNotes(data, moves) : []), [data, moves]);
  const from = useMemo(() => (data && moves ? movedFrom(data, moves) : null), [data, moves]);

  const moveOnto = (date: string, legId: string, shifts: LegShift[] = []) => {
    if (!data || !moves) return;
    const outcome = applyMoveToDay(data, moves, { date, legId });
    if ('error' in outcome) {
      setProblem(outcome.error);
      return;
    }
    setData(() => (shifts.length ? shiftLegs(outcome.data, shifts, data) : outcome.data));
    onMoved.current?.();
  };

  // Moves, after offering to shift the legs this would run into.
  const moveOrOfferShift = (date: string, legId: string) => {
    const shifts = data && moves ? legShiftOffer(data, moves, { date, legId }) : [];
    if (shifts.length) setShifting({ date, legId, shifts });
    else moveOnto(date, legId);
  };

  const pickDay = (date: string) => {
    if (!view?.dateRange) return;
    const day = view.days.find((d) => d.date === date);
    if (day) {
      if (day.legIds.length > 1) {
        setChoosingLeg({
          date,
          legIds: day.legIds,
          why: 'The trip changes legs that day. Which leg?',
          suggested: suggestedLegId(from, day.legIds),
        });
      } else {
        moveOrOfferShift(day.date, day.leg._id);
      }
      return;
    }
    // No leg claims it (beyond the trip, or between legs): any leg can stretch to reach
    // it, the nearest one by default. A pick that adds many days says so.
    const { startDate, endDate } = view.dateRange;
    const added =
      date < startDate ? wholeDays(date, startDate) : date > endDate ? wholeDays(endDate, date) : 0;
    const where = added
      ? `That day is ${added} days beyond the trip`
      : 'That day falls between legs';
    setChoosingLeg({
      date,
      legIds: view.legSummaries.map((s) => s.leg._id),
      why: `${where}. Which leg stretches to reach it?`,
      suggested: nearestLegId(
        view.legSummaries.map((s) => ({ legId: s.leg._id, range: s.dateRange })),
        date,
      ),
    });
  };

  return (
    <MoveToDayContext.Provider value={value}>
      {children}
      {view?.dateRange && (
        <JumpToDayPicker
          open={open}
          onClose={() => setOpen(false)}
          days={view.days}
          tripStart={view.dateRange.startDate}
          tripEnd={view.dateRange.endDate}
          onSelectDay={pickDay}
          title="Move to another day"
          notes={notes}
          initialDate={from?.date ?? undefined}
          anyDate
        />
      )}
      <LegChoiceDialog
        open={choosingLeg !== null}
        legs={
          view?.legSummaries
            .map((s) => s.leg)
            .filter((leg) => choosingLeg?.legIds.includes(leg._id)) ?? []
        }
        title={choosingLeg?.why ?? ''}
        suggestedLegId={choosingLeg?.suggested ?? null}
        onChoose={(legId) => {
          if (choosingLeg) moveOrOfferShift(choosingLeg.date, legId);
          setChoosingLeg(null);
        }}
        onClose={() => setChoosingLeg(null)}
      />
      <ShiftLegsDialog
        open={shifting !== null}
        legs={(shifting?.shifts ?? []).map((shift) => ({
          id: shift.legId,
          name: data?.legs.find((leg) => leg._id === shift.legId)?.name ?? shift.legId,
          days: shift.days,
        }))}
        onShift={() => {
          if (shifting) moveOnto(shifting.date, shifting.legId, shifting.shifts);
          setShifting(null);
        }}
        onLeave={() => {
          if (shifting) moveOnto(shifting.date, shifting.legId);
          setShifting(null);
        }}
        onCancel={() => setShifting(null)}
      />
      <Snackbar
        open={problem !== null}
        autoHideDuration={4000}
        onClose={() => setProblem(null)}
        message={problem}
      />
    </MoveToDayContext.Provider>
  );
}
