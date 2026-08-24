import { createContext } from 'react';

import type { EditKind } from '../model/editForms';
import type { Activity, Stay, Transit } from '../model/types';

type Entity = Activity | Stay | Transit;

export interface EditContextValue {
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

export const EditContext = createContext<EditContextValue | null>(null);
