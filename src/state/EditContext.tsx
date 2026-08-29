import { lazy, type ReactNode, Suspense, useState } from 'react';

import { COLLECTION_FOR_KIND, type EditKind, findByKind } from '../model/editForms';
import type { Activity, Stay, Transit } from '../model/types';
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

type Entity = Activity | Stay | Transit;

// `via` picks which of the two components above renders this state:
// 'wizard' for a plain openEdit (the day-list pencils/side-sheet edit
// button) walks the guided step-by-step EditEventWizard; 'flat' for
// openFromDraft's AI-suggestion/import review renders the original
// one-page EditDialog instead, since a draft already has every field
// filled in for the user to check rather than a blank to fill in one step
// at a time. openFromDraft's create sub-case (no overrideId) is 'flat' for
// the same reason.
type EditState =
  | { mode: 'edit'; kind: EditKind; id: string; seed?: Entity; via: 'wizard' | 'flat' }
  | { mode: 'create'; kind: EditKind; entity: Entity; via: 'flat' };

// Wraps the trip page in one place both the day-list's edit pencils and the
// activity side sheet's own edit button can reach. There's no backend this
// can write to — Save mutates a clone of the in-memory entity via
// TripDataContext's setData, which is what triggers useMemo(buildTripView)
// to re-run and marks the touched collection dirty for "export edits."
export function EditProvider({ children }: { children: ReactNode }) {
  const { data, setData } = useTripData();
  const [state, setState] = useState<EditState | null>(null);

  const openEdit = (kind: EditKind, id: string) =>
    setState({ mode: 'edit', kind, id, via: 'wizard' });
  const openFromDraft = (kind: EditKind, draft: Entity, overrideId?: string) =>
    setState(
      overrideId
        ? { mode: 'edit', kind, id: overrideId, seed: { ...draft, _id: overrideId }, via: 'flat' }
        : { mode: 'create', kind, entity: draft, via: 'flat' },
    );
  const closeEdit = () => setState(null);

  const handleSave = (updated: Entity) => {
    if (!state) return;
    const { kind } = state;
    const isNew = state.mode === 'create';
    const collection = COLLECTION_FOR_KIND[kind];
    setData(
      (prev) => ({
        ...prev,
        [collection]: isNew
          ? [...(prev[collection] as Entity[]), updated]
          : (prev[collection] as Entity[]).map((e) => (e._id === updated._id ? updated : e)),
      }),
      [collection],
    );
    closeEdit();
  };

  const handleDelete = (kind: EditKind, id: string) => {
    const collection = COLLECTION_FOR_KIND[kind];
    setData(
      (prev) => ({
        ...prev,
        [collection]: (prev[collection] as Entity[]).filter((e) => e._id !== id),
      }),
      [collection],
    );
    closeEdit();
  };

  const entity = state
    ? state.mode === 'create'
      ? state.entity
      : (state.seed ?? (data ? findByKind(state.kind, state.id, data) : undefined))
    : undefined;

  return (
    <EditContext.Provider value={{ openEdit, openFromDraft, deleteEntity: handleDelete }}>
      {children}
      {state && data && entity && (
        <Suspense fallback={null}>
          {state.via === 'wizard' ? (
            <EditEventWizard
              kind={state.kind}
              entity={entity}
              stays={data.stays}
              activities={data.activities}
              transits={data.transits}
              tripTravelers={data.trip.travelers}
              routes={data.routes}
              onClose={closeEdit}
              onSave={handleSave}
              onDelete={handleDelete}
            />
          ) : (
            <EditDialog
              kind={state.kind}
              entity={entity}
              isNew={state.mode === 'create'}
              stays={data.stays}
              activities={data.activities}
              transits={data.transits}
              tripTravelers={data.trip.travelers}
              routes={data.routes}
              onClose={closeEdit}
              onSave={handleSave}
              onDelete={handleDelete}
            />
          )}
        </Suspense>
      )}
    </EditContext.Provider>
  );
}
