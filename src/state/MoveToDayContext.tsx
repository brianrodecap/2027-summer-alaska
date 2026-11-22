import Snackbar from '@mui/material/Snackbar';
import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';

import { JumpToDayPicker } from '../components/pickers/JumpToDayPicker';
import { LegChoiceDialog } from '../components/pickers/LegChoiceDialog';
import {
  applyMoveToDay,
  movedFrom,
  type MoveMembers,
  moveNotes,
  suggestedLegId,
} from '../model/moveToDay';
import type { DayFrame } from '../model/types';
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
  // A picked day where the trip changes legs, until the person says which leg.
  const [choosingLeg, setChoosingLeg] = useState<DayFrame | null>(null);
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

  const moveOnto = (date: string, legId: string) => {
    if (!data || !moves) return;
    const outcome = applyMoveToDay(data, moves, { date, legId });
    if ('error' in outcome) {
      setProblem(outcome.error);
      return;
    }
    setData(() => outcome.data);
    onMoved.current?.();
  };

  const pickDay = (date: string) => {
    const day = view?.days.find((d) => d.date === date);
    if (!day) return;
    if (day.legIds.length > 1) setChoosingLeg(day);
    else moveOnto(day.date, day.leg._id);
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
        />
      )}
      <LegChoiceDialog
        open={choosingLeg !== null}
        legs={
          view?.legSummaries
            .map((s) => s.leg)
            .filter((leg) => choosingLeg?.legIds.includes(leg._id)) ?? []
        }
        suggestedLegId={choosingLeg ? suggestedLegId(from, choosingLeg.legIds) : null}
        onChoose={(legId) => {
          if (choosingLeg) moveOnto(choosingLeg.date, legId);
          setChoosingLeg(null);
        }}
        onClose={() => setChoosingLeg(null)}
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
