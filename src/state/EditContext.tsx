import { createContext, lazy, type ReactNode, Suspense, useContext, useState } from 'react';

import { blankForKind, COLLECTION_FOR_KIND, type EditKind, findByKind } from '../model/editForms';
import type { Activity, Stay, Transit } from '../model/types';
import { useTripData } from './TripDataContext';

// Lazy: the edit forms pull in PlacePickerField's Autocomplete and the
// date/time pickers, which most visits (read-only browsing) never touch.
// EditDialog is only ever mounted once `state` is set below, so this defers
// that weight until the first pencil/add tap.
const EditDialog = lazy(() =>
  import('../components/edit/EditDialog').then((m) => ({ default: m.EditDialog })),
);

export type { EditKind };

type Entity = Activity | Stay | Transit;

type EditState =
  | { mode: 'edit'; kind: EditKind; id: string; seed?: Entity }
  | { mode: 'create'; kind: EditKind; entity: Entity };

interface EditContextValue {
  openEdit: (kind: EditKind, id: string) => void;
  // Opens the dialog on a fresh, not-yet-saved entity pre-placed on `date`
  // within `legId` — the day list's own "Add" button. Save appends it to
  // the matching collection instead of replacing an existing entry.
  openCreate: (kind: EditKind, legId: string, date: string) => void;
  // Opens the dialog seeded from an AI-extracted draft (see
  // model/documentImport.ts). With overrideId, opens in edit mode against
  // that entity's id with the draft supplying the form's starting values —
  // Save then replaces it, exactly like a normal edit. Without it, opens in
  // create mode with the draft itself — Save appends, exactly like
  // openCreate.
  openFromDraft: (kind: EditKind, draft: Entity, overrideId?: string) => void;
  deleteEntity: (kind: EditKind, id: string) => void;
}

const EditContext = createContext<EditContextValue | null>(null);

// Wraps the trip page in one place both the day-list's edit pencils and the
// activity side sheet's own edit button can reach. There's no backend this
// can write to — Save mutates a clone of the in-memory entity via
// TripDataContext's setData, which is what triggers useMemo(buildTripView)
// to re-run and marks the touched collection dirty for "export edits."
export function EditProvider({ children }: { children: ReactNode }) {
  const { data, setData } = useTripData();
  const [state, setState] = useState<EditState | null>(null);

  const openEdit = (kind: EditKind, id: string) => setState({ mode: 'edit', kind, id });
  const openCreate = (kind: EditKind, legId: string, date: string) =>
    setState({ mode: 'create', kind, entity: blankForKind(kind, legId, date) });
  const openFromDraft = (kind: EditKind, draft: Entity, overrideId?: string) =>
    setState(
      overrideId
        ? { mode: 'edit', kind, id: overrideId, seed: { ...draft, _id: overrideId } }
        : { mode: 'create', kind, entity: draft },
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
    <EditContext.Provider
      value={{ openEdit, openCreate, openFromDraft, deleteEntity: handleDelete }}
    >
      {children}
      {state && data && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}
    </EditContext.Provider>
  );
}

export function useEdit(): EditContextValue {
  const ctx = useContext(EditContext);
  if (!ctx) throw new Error('useEdit must be used within an EditProvider');
  return ctx;
}
