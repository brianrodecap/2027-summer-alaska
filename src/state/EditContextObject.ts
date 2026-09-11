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
  // itself — Save appends. `onSaved` (if given) fires once Save actually
  // commits — not on Cancel/Delete — with an `advance` callback the caller
  // must invoke itself once it's genuinely done, rather than firing and
  // forgetting: a caller that needs to run its own async follow-up first
  // (the document-import flow's own noteworthy callouts open as a NoteEdit
  // sequence right after the primary draft saves, see
  // NoteEditContextObject.ts's openNoteDraftSequence) has to hold off
  // calling `advance` until that follow-up is fully resolved, or two
  // dialogs from two different contexts end up open at once. A caller with
  // nothing to wait for just calls `advance` immediately.
  openFromDraft: (
    kind: EditKind,
    draft: Entity,
    overrideId?: string,
    onSaved?: (advance: () => void) => void,
  ) => void;
  // Reviews a batch of already-drafted entities one at a time, each through
  // the same flat EditDialog openFromDraft uses — the document-import
  // flow's own way of following up a primary Stay with sibling entities its
  // own document also implied (a bundled lodge shuttle's two Transit legs,
  // see documentImport.ts's draftIncludedTransfers) without cramming them
  // all into one dialog. Each item can carry its own `onSaved`, so e.g. only
  // the primary Stay's own save needs to chain into its noteworthy Notes.
  // Cancelling any step abandons the rest of the queue rather than skipping
  // ahead, so a viewer who bails partway through never has an unreviewed
  // sibling silently saved.
  openDraftSequence: (
    drafts: {
      kind: EditKind;
      entity: Entity;
      overrideId?: string;
      onSaved?: (advance: () => void) => void;
    }[],
  ) => void;
  deleteEntity: (kind: EditKind, id: string) => void;
}

export const EditContext = createContext<EditContextValue | null>(null);
