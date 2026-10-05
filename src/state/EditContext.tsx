import { lazy, type ReactNode, Suspense, useCallback, useMemo, useState } from 'react';

import { uniqueBookings } from '../model/bookings';
import type { ChangeSource } from '../model/changeLog';
import {
  commitEntityEdit,
  deleteEntityByKind,
  type EditKind,
  type Entity,
  findByKind,
  NO_BOOKINGS,
  upsertById,
  withTripTravelers,
} from '../model/editForms';
import type { Booking, Traveler, TripData } from '../model/types';
import { type DraftReview, EditContext } from './EditContextObject';
import { useTripData } from './useTripData';

// Lazy: both pull in PlacePickerField's Autocomplete and the date/time
// pickers, which most visits (read-only browsing) never touch. Whichever
// one `state` below calls for is only ever mounted once a pencil/draft tap
// actually happens, so this defers that weight until then.
const EditDialog = lazy(() =>
  import('../components/edit/EditDialog').then((m) => ({ default: m.EditDialog })),
);
const EditEventWizard = lazy(() =>
  import('../components/wizard/EditEventWizard').then((m) => ({ default: m.EditEventWizard })),
);

// `via` (on the 'edit' variant only — 'create' only ever happens via a
// draft, so it's implicitly 'flat') picks which of the two components above
// renders this state: 'wizard' for a plain openEdit (the day-list pencils/
// side-sheet edit button) walks the guided step-by-step EditEventWizard;
// 'flat' for openFromDraft's/openDraftSequence's AI-suggestion/import
// review renders the original one-page EditDialog instead, since a draft
// already has every field filled in for the user to check rather than a
// blank to fill in one step at a time — including its create sub-case (no
// overrideId). `onSaved` (flat only, both its sub-cases) fires once Save
// actually commits, letting a caller chain a follow-up step (see
// EditContextObject.ts's own note on openFromDraft) — undefined for the
// wizard path, which nothing chains off. `queue` (flat only) holds whatever
// drafts still follow this one in the same openDraftSequence call, and
// `pendingBookings` the sequence's not-yet-saved Booking documents — held
// once for the whole sequence, not per draft, so a round trip's two flights
// share one copy and the second opens on whatever the first saved.
// `travelers` (flat only) are this draft's own new travelers — offered in its
// form and added to the trip when it's saved, never before.
type EditState =
  | { mode: 'edit'; kind: EditKind; id: string; seed?: Entity; via: 'wizard' }
  | {
      mode: 'edit';
      kind: EditKind;
      id: string;
      seed?: Entity;
      via: 'flat';
      pendingBookings: Booking[];
      travelers: Traveler[];
      onSaved?: (advance: () => void) => void;
      source?: ChangeSource;
      queue: DraftReview[];
    }
  | {
      mode: 'create';
      kind: EditKind;
      entity: Entity;
      pendingBookings: Booking[];
      travelers: Traveler[];
      onSaved?: (advance: () => void) => void;
      source?: ChangeSource;
      queue: DraftReview[];
    };

function stateFromDraft(
  draft: DraftReview,
  queue: DraftReview[],
  pendingBookings: Booking[],
): EditState {
  const session = {
    kind: draft.kind,
    pendingBookings,
    travelers: draft.travelers ?? [],
    onSaved: draft.onSaved,
    source: draft.source,
    queue,
  };
  return draft.overrideId
    ? {
        ...session,
        mode: 'edit',
        id: draft.overrideId,
        seed: { ...draft.entity, _id: draft.overrideId },
        via: 'flat',
      }
    : { ...session, mode: 'create', entity: draft.entity };
}

// Wraps the trip page in one place both the day-list's edit pencils and the
// activity side sheet's own edit button can reach. There's no backend yet —
// Save mutates a clone of the in-memory entity via
// TripDataContext's setData, which is what triggers useMemo(buildTripView)
// to re-run and saves the edit to the change log (see model/changeLog.ts).
export function EditProvider({ children }: { children: ReactNode }) {
  const { data, setData } = useTripData();
  const [state, setState] = useState<EditState | null>(null);

  const openEdit = useCallback(
    (kind: EditKind, id: string) => setState({ mode: 'edit', kind, id, via: 'wizard' }),
    [],
  );
  const openDraftSequence = useCallback((drafts: DraftReview[]) => {
    if (!drafts.length) return;
    const [first, ...rest] = drafts;
    setState(stateFromDraft(first, rest, uniqueBookings(drafts.flatMap((d) => d.bookings ?? []))));
  }, []);
  const openFromDraft = useCallback(
    (draft: DraftReview) => openDraftSequence([draft]),
    [openDraftSequence],
  );
  // Cancel/Delete always abandons the rest of a draft sequence rather than
  // silently advancing to the next queued item — a viewer who bails on one
  // step of an import (the Stay, say) shouldn't have its sibling Transits
  // saved without ever being shown.
  const closeEdit = useCallback(() => setState(null), []);

  // Moves a draft sequence on to its next queued draft, or closes once none
  // are left.
  const advanceQueue = useCallback(
    (queue: DraftReview[], pendingBookings: Booking[]) => {
      if (!queue.length) {
        closeEdit();
        return;
      }
      const [next, ...rest] = queue;
      setState(stateFromDraft(next, rest, pendingBookings));
    },
    [closeEdit],
  );

  const handleSave = useCallback(
    (updated: Entity, bookings: Booking[]) => {
      if (!state) return;
      const upsert = (prev: TripData) => commitEntityEdit(prev, state.kind, updated, bookings);
      if (state.mode === 'edit' && state.via === 'wizard') {
        setData(upsert);
        closeEdit();
        return;
      }
      setData((prev) => withTripTravelers(upsert(prev), state.travelers), state.source);
      // A booking this step saved is no longer pending — later drafts read
      // it as saved, including any edits made here.
      const saved = new Set(bookings.map((b) => b._id));
      const pending = state.pendingBookings.filter((b) => !saved.has(b._id));
      const { queue } = state;
      const advance = () => advanceQueue(queue, pending);
      if (state.onSaved) {
        state.onSaved(advance);
      } else {
        advance();
      }
    },
    [state, setData, closeEdit, advanceQueue],
  );

  // Offered only while more drafts are queued — declines this one draft.
  const handleSkip =
    state && !(state.mode === 'edit' && state.via === 'wizard') && state.queue.length
      ? () => advanceQueue(state.queue, state.pendingBookings)
      : undefined;

  const handleDelete = useCallback(
    (kind: EditKind, id: string) => {
      setData((prev) => deleteEntityByKind(prev, kind, id));
      closeEdit();
    },
    [setData, closeEdit],
  );

  const entity = state
    ? state.mode === 'create'
      ? state.entity
      : (state.seed ?? (data ? findByKind(state.kind, state.id, data) : undefined))
    : undefined;

  // A sequence's not-yet-saved bookings win over a saved one with the same
  // id (an AI edit to an existing booking).
  const pendingBookings = state && 'pendingBookings' in state ? state.pendingBookings : undefined;
  const draftTravelers = state && 'travelers' in state ? state.travelers : undefined;
  const trip = data?.trip;
  const tripTravelers = useMemo(
    () => (trip ? withTripTravelers({ trip }, draftTravelers ?? []).trip.travelers : []),
    [trip, draftTravelers],
  );
  const bookingSource = useMemo(
    () =>
      data
        ? {
            ...data,
            bookings: pendingBookings?.length
              ? pendingBookings.reduce(upsertById, data.bookings)
              : data.bookings,
          }
        : NO_BOOKINGS,
    [pendingBookings, data],
  );

  const contextValue = useMemo(
    () => ({ openEdit, openFromDraft, openDraftSequence, deleteEntity: handleDelete }),
    [openEdit, openFromDraft, openDraftSequence, handleDelete],
  );

  return (
    <EditContext.Provider value={contextValue}>
      {children}
      {state && data && entity && (
        <Suspense fallback={null}>
          {(() => {
            const sharedProps = {
              kind: state.kind,
              entity,
              stays: data.stays,
              activities: data.activities,
              transits: data.transits,
              tripTravelers,
              routes: data.routes,
              bookingSource,
              onClose: closeEdit,
              onSave: handleSave,
              onDelete: handleDelete,
            };
            return state.mode === 'edit' && state.via === 'wizard' ? (
              <EditEventWizard {...sharedProps} />
            ) : (
              <EditDialog {...sharedProps} isNew={state.mode === 'create'} onSkip={handleSkip} />
            );
          })()}
        </Suspense>
      )}
    </EditContext.Provider>
  );
}
