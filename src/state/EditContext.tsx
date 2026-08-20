import { createContext, useContext, useState, type ReactNode } from 'react';

import { useTripData } from './TripDataContext';
import { EditDialog } from '../components/edit/EditDialog';
import type { Activity, Stay, Transit } from '../model/types';

export type EditKind = 'activity' | 'stay' | 'transit';

interface EditTarget {
  kind: EditKind;
  id: string;
}

interface EditContextValue {
  openEdit: (kind: EditKind, id: string) => void;
}

const EditContext = createContext<EditContextValue | null>(null);

function findEntity(kind: EditKind, id: string, data: ReturnType<typeof useTripData>['data']): Activity | Stay | Transit | undefined {
  if (!data) return undefined;
  if (kind === 'activity') return data.activities.find((a) => a._id === id);
  if (kind === 'stay') return data.stays.find((s) => s._id === id);
  return data.transits.find((t) => t._id === id);
}

// Wraps the trip page in one place both the day-list's edit pencils and the
// activity side sheet's own edit button can reach. There's no backend this
// can write to — Save mutates a clone of the in-memory entity via
// TripDataContext's setData, which is what triggers useMemo(buildTripView)
// to re-run and marks the touched collection dirty for "export edits."
export function EditProvider({ children }: { children: ReactNode }) {
  const { data, setData } = useTripData();
  const [target, setTarget] = useState<EditTarget | null>(null);

  const openEdit = (kind: EditKind, id: string) => setTarget({ kind, id });
  const closeEdit = () => setTarget(null);

  const handleSave = (updated: Activity | Stay | Transit) => {
    if (!target) return;
    setData((prev) => {
      if (target.kind === 'activity') {
        return { ...prev, activities: prev.activities.map((a) => (a._id === target.id ? (updated as Activity) : a)) };
      }
      if (target.kind === 'stay') {
        return { ...prev, stays: prev.stays.map((s) => (s._id === target.id ? (updated as Stay) : s)) };
      }
      return { ...prev, transits: prev.transits.map((t) => (t._id === target.id ? (updated as Transit) : t)) };
    }, [target.kind === 'activity' ? 'activities' : target.kind === 'stay' ? 'stays' : 'transits']);
    closeEdit();
  };

  const handleDelete = (kind: EditKind, id: string) => {
    setData((prev) => {
      if (kind === 'activity') return { ...prev, activities: prev.activities.filter((a) => a._id !== id) };
      if (kind === 'stay') return { ...prev, stays: prev.stays.filter((s) => s._id !== id) };
      return { ...prev, transits: prev.transits.filter((t) => t._id !== id) };
    }, [kind === 'activity' ? 'activities' : kind === 'stay' ? 'stays' : 'transits']);
    closeEdit();
  };

  const entity = target ? findEntity(target.kind, target.id, data) : undefined;

  return (
    <EditContext.Provider value={{ openEdit }}>
      {children}
      {target && data && (
        <EditDialog
          kind={target.kind}
          entity={entity}
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
