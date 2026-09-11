import { lazy, type ReactNode, Suspense, useCallback, useMemo, useState } from 'react';

import {
  COLLECTION_FOR_KIND,
  type EditKind,
  type Entity,
  findByKind,
  upsertById,
} from '../model/editForms';
import { EditContext } from './EditContextObject';
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

export type { EditKind };

// One draft still waiting in openDraftSequence's own queue — same shape
// openFromDraft takes a single one of, but plural, so a document import
// that produces several entities (a Stay plus the two Transits its own
// bundled shuttle implies, say — see documentImport.ts's
// draftIncludedTransfers) can walk a human through each one's own review in
// turn rather than requiring one dialog to show them all at once. `onSaved`
// takes the `advance` callback rather than being called with no arguments:
// a caller that needs to run its own async follow-up first (opening a
// NoteEditContext draft sequence for this same entity's own noteworthy
// callouts, say) must call `advance` itself once that follow-up is fully
// resolved, rather than this queue moving on right away — two independent
// dialogs (this one's next entity, and NoteEditDialog) must never be open
// at once, since neither would visibly win against the other's own focus
// trap. A caller with nothing to wait for just calls `advance` immediately.
interface QueuedDraft {
  kind: EditKind;
  entity: Entity;
  overrideId?: string;
  onSaved?: (advance: () => void) => void;
}

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
// drafts still follow this one in the same openDraftSequence call.
type EditState =
  | { mode: 'edit'; kind: EditKind; id: string; seed?: Entity; via: 'wizard' }
  | {
      mode: 'edit';
      kind: EditKind;
      id: string;
      seed?: Entity;
      via: 'flat';
      onSaved?: (advance: () => void) => void;
      queue: QueuedDraft[];
    }
  | {
      mode: 'create';
      kind: EditKind;
      entity: Entity;
      onSaved?: (advance: () => void) => void;
      queue: QueuedDraft[];
    };

function stateFromDraft(draft: QueuedDraft, queue: QueuedDraft[]): EditState {
  return draft.overrideId
    ? {
        mode: 'edit',
        kind: draft.kind,
        id: draft.overrideId,
        seed: { ...draft.entity, _id: draft.overrideId },
        via: 'flat',
        onSaved: draft.onSaved,
        queue,
      }
    : { mode: 'create', kind: draft.kind, entity: draft.entity, onSaved: draft.onSaved, queue };
}

// Wraps the trip page in one place both the day-list's edit pencils and the
// activity side sheet's own edit button can reach. There's no backend this
// can write to — Save mutates a clone of the in-memory entity via
// TripDataContext's setData, which is what triggers useMemo(buildTripView)
// to re-run and marks the touched collection dirty for "export edits."
export function EditProvider({ children }: { children: ReactNode }) {
  const { data, setData } = useTripData();
  const [state, setState] = useState<EditState | null>(null);

  const openEdit = useCallback(
    (kind: EditKind, id: string) => setState({ mode: 'edit', kind, id, via: 'wizard' }),
    [],
  );
  const openDraftSequence = useCallback((drafts: QueuedDraft[]) => {
    if (!drafts.length) return;
    const [first, ...rest] = drafts;
    setState(stateFromDraft(first, rest));
  }, []);
  const openFromDraft = useCallback(
    (kind: EditKind, draft: Entity, overrideId?: string, onSaved?: (advance: () => void) => void) =>
      openDraftSequence([{ kind, entity: draft, overrideId, onSaved }]),
    [openDraftSequence],
  );
  // Cancel/Delete always abandons the rest of a draft sequence rather than
  // silently advancing to the next queued item — a viewer who bails on one
  // step of an import (the Stay, say) shouldn't have its sibling Transits
  // saved without ever being shown.
  const closeEdit = useCallback(() => setState(null), []);

  const handleSave = useCallback(
    (updated: Entity) => {
      if (!state) return;
      const collection = COLLECTION_FOR_KIND[state.kind];
      setData(
        (prev) => ({
          ...prev,
          [collection]: upsertById(prev[collection] as Entity[], updated),
        }),
        [collection],
      );
      if (state.mode === 'edit' && state.via === 'wizard') {
        closeEdit();
        return;
      }
      const { queue } = state;
      const advance = () => {
        if (queue.length) {
          const [next, ...rest] = queue;
          setState(stateFromDraft(next, rest));
        } else {
          closeEdit();
        }
      };
      if (state.onSaved) {
        state.onSaved(advance);
      } else {
        advance();
      }
    },
    [state, setData, closeEdit],
  );

  const handleDelete = useCallback(
    (kind: EditKind, id: string) => {
      const collection = COLLECTION_FOR_KIND[kind];
      setData(
        (prev) => ({
          ...prev,
          [collection]: (prev[collection] as Entity[]).filter((e) => e._id !== id),
        }),
        [collection],
      );
      closeEdit();
    },
    [setData, closeEdit],
  );

  const entity = state
    ? state.mode === 'create'
      ? state.entity
      : (state.seed ?? (data ? findByKind(state.kind, state.id, data) : undefined))
    : undefined;

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
              tripTravelers: data.trip.travelers,
              routes: data.routes,
              onClose: closeEdit,
              onSave: handleSave,
              onDelete: handleDelete,
            };
            return state.mode === 'edit' && state.via === 'wizard' ? (
              <EditEventWizard {...sharedProps} />
            ) : (
              <EditDialog {...sharedProps} isNew={state.mode === 'create'} />
            );
          })()}
        </Suspense>
      )}
    </EditContext.Provider>
  );
}
