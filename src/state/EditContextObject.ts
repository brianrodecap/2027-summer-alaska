import { createContext } from 'react';

import type { EditKind } from '../model/editForms';
import type { Activity, Stay, Transit } from '../model/types';

type Entity = Activity | Stay | Transit;

export interface EditContextValue {
  // Opens the guided edit wizard (see components/wizard/EditEventWizard) on
  // an existing entity — the day-list row pencils and the activity side
  // sheet's own edit button. Brand-new entities never reach this: the day
  // list's "Add to this day" button opens components/wizard/AddEventWizard
  // directly instead, since its kind isn't decided yet either (that's the
  // wizard's own first question) — see DaysView's addWizardDay state.
  openEdit: (kind: EditKind, id: string) => void;
  // Opens the flat, one-page EditDialog seeded from an AI-extracted draft
  // (see model/documentImport.ts) — a full form fits a draft review better
  // than the step-by-step wizard, since every field already has a
  // (likely-correct) value to check rather than a blank to fill in. With
  // overrideId, opens in edit mode against that entity's id with the draft
  // supplying the form's starting values — Save then replaces it, exactly
  // like a normal edit. Without it, opens in create mode with the draft
  // itself — Save appends.
  openFromDraft: (kind: EditKind, draft: Entity, overrideId?: string) => void;
  deleteEntity: (kind: EditKind, id: string) => void;
}

export const EditContext = createContext<EditContextValue | null>(null);
