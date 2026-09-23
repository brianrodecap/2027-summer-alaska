import { useCallback, useState } from 'react';

import type {
  EnrichedActivity,
  EnrichedMealOption,
  EnrichedStay,
  EnrichedTransit,
} from '../../model/types';
import { useEdit } from '../../state/useEdit';
import { useLiveDays } from '../../state/useLiveDays';
import { useTripData } from '../../state/useTripData';

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
  byId: ReadonlyMap<string, T> | undefined,
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
  // memoized DayAccordion (onOpenStay/onOpenTransit, and onOpenActivity via
  // useDetailPanels' adapter). A fresh closure here would defeat that memo for
  // all ~28 unvirtualized day blocks on every unrelated DaysView state change —
  // see DayAccordion's own note on why it's memoized. setIds is stable, so these
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

// The three detail sheets' state, plus the adapter the day list hands its rows
// (an Activity opens with an optional selected meal candidate).
export function useDetailPanels() {
  const { view } = useTripData();
  const { openEdit } = useEdit();
  const liveDays = useLiveDays();
  const activityPanel = useDetailPanel<EnrichedActivity, EnrichedMealOption>(
    view?.activitiesById,
    (id) => openEdit('activity', id),
    (activity, optionId) => activity.options?.find((o) => o._id === optionId),
  );
  const stayPanel = useDetailPanel<EnrichedStay>(view?.staysById, (id) => openEdit('stay', id));
  // The live Transits (selected route tab, meals picked along the drive), so
  // the sheet shows the same arrival as the Transit's own rows. DaysView
  // builds the live days anyway, so reading them here costs nothing extra.
  const transitPanel = useDetailPanel<EnrichedTransit>(liveDays.transitsById, (id) =>
    openEdit('transit', id),
  );
  // Memoized (unlike an inline arrow in the day-list map) so it doesn't defeat
  // the memoized DayAccordion it's passed straight to, and activityPanel.onOpen
  // is itself stable (see useDetailPanel), so this adapter stays stable too — the
  // lint rule can't see that stability through the member access, so
  // depending on the whole activityPanel object (a fresh one every render)
  // would defeat the memoization this exists for.
  const handleOpenActivity = useCallback(
    (activity: EnrichedActivity, selectedOption?: EnrichedMealOption) =>
      activityPanel.onOpen(activity, selectedOption?._id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activityPanel.onOpen],
  );
  return { activityPanel, stayPanel, transitPanel, handleOpenActivity };
}

export type DetailPanelsState = ReturnType<typeof useDetailPanels>;
