import { createContext, type ReactNode, useContext, useState } from 'react';

import { EditDialog } from '../components/edit/EditDialog';
import { blankActivity, blankStay, blankTransit } from '../model/editForms';
import type { Activity, Stay, Transit } from '../model/types';
import { useTripData } from './TripDataContext';

export type EditKind = 'activity' | 'stay' | 'transit';

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

function findEntity(
  kind: EditKind,
  id: string,
  data: ReturnType<typeof useTripData>['data'],
): Entity | undefined {
  if (!data) return undefined;
  if (kind === 'activity') return data.activities.find((a) => a._id === id);
  if (kind === 'stay') return data.stays.find((s) => s._id === id);
  return data.transits.find((t) => t._id === id);
}

function blankFor(kind: EditKind, legId: string, date: string): Entity {
  if (kind === 'activity') return blankActivity(legId, date);
  if (kind === 'stay') return blankStay(legId, date);
  return blankTransit(legId, date);
}

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
    setState({ mode: 'create', kind, entity: blankFor(kind, legId, date) });
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
    setData(
      (prev) => {
        if (kind === 'activity') {
          return {
            ...prev,
            activities: isNew
              ? [...prev.activities, updated as Activity]
              : prev.activities.map((a) => (a._id === updated._id ? (updated as Activity) : a)),
          };
        }
        if (kind === 'stay') {
          return {
            ...prev,
            stays: isNew
              ? [...prev.stays, updated as Stay]
              : prev.stays.map((s) => (s._id === updated._id ? (updated as Stay) : s)),
          };
        }
        return {
          ...prev,
          transits: isNew
            ? [...prev.transits, updated as Transit]
            : prev.transits.map((t) => (t._id === updated._id ? (updated as Transit) : t)),
        };
      },
      [kind === 'activity' ? 'activities' : kind === 'stay' ? 'stays' : 'transits'],
    );
    closeEdit();
  };

  const handleDelete = (kind: EditKind, id: string) => {
    setData(
      (prev) => {
        if (kind === 'activity')
          return { ...prev, activities: prev.activities.filter((a) => a._id !== id) };
        if (kind === 'stay') return { ...prev, stays: prev.stays.filter((s) => s._id !== id) };
        return { ...prev, transits: prev.transits.filter((t) => t._id !== id) };
      },
      [kind === 'activity' ? 'activities' : kind === 'stay' ? 'stays' : 'transits'],
    );
    closeEdit();
  };

  const entity = state
    ? state.mode === 'create'
      ? state.entity
      : (state.seed ?? findEntity(state.kind, state.id, data))
    : undefined;

  return (
    <EditContext.Provider
      value={{ openEdit, openCreate, openFromDraft, deleteEntity: handleDelete }}
    >
      {children}
      {state && data && (
        <EditDialog
          kind={state.kind}
          entity={entity}
          isNew={state.mode === 'create'}
          stays={data.stays}
          tripTravelers={data.trip.travelers}
          routes={data.routes}
          onClose={closeEdit}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </EditContext.Provider>
  );
}

export function useEdit(): EditContextValue {
  const ctx = useContext(EditContext);
  if (!ctx) throw new Error('useEdit must be used within an EditProvider');
  return ctx;
}
