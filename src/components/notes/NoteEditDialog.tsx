import InfoIcon from '@mui/icons-material/Info';
import NotesIcon from '@mui/icons-material/Notes';
import WarningIcon from '@mui/icons-material/Warning';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

import type { NoteKind, Ref, RefEntityKind } from '../../model/types';
import type { NoteTarget } from '../../state/NoteEditContext';
import { ConfirmDialog } from '../shared/ConfirmDialog';

const KIND_LABEL: Record<NoteKind, string> = {
  warning: 'Alert',
  info: 'Info',
  footnote: 'Footnote',
};
const KIND_ICON: Record<NoteKind, typeof WarningIcon> = {
  warning: WarningIcon,
  info: InfoIcon,
  footnote: NotesIcon,
};

const ENTITY_LABEL: Record<RefEntityKind, string> = {
  trip: 'this trip',
  leg: 'this leg',
  stay: 'this stay',
  transit: 'this transit',
  route: 'this route',
  activity: 'this activity',
  scenario: 'this scenario branch',
  package: 'this package',
  mealOption: 'this candidate',
};

function describeRef(ref: Ref): string {
  if ('entity' in ref) return ENTITY_LABEL[ref.entity];
  if ('date' in ref) return ref.date;
  return `${ref.dateRange[0]} – ${ref.dateRange[1]}`;
}

// The only form for creating or editing a Note. concerns is deliberately not
// editable here — a note is always added from the specific row/section it's
// about (see NoteEditContext's openNoteCreate call sites), so its concerns
// ref is fixed at creation; "About <entity>" below is read-only context, not
// a field.
export function NoteEditDialog({
  target,
  onClose,
  onSave,
  onDelete,
}: {
  target: NoteTarget;
  onClose: () => void;
  onSave: (kind: NoteKind, text: string) => void;
  onDelete?: () => void;
}) {
  const [kind, setKind] = useState<NoteKind>(
    target.mode === 'create' ? target.kind : target.note.kind,
  );
  const [text, setText] = useState(target.mode === 'edit' ? target.note.text : '');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const about =
    target.mode === 'create'
      ? describeRef({ entity: target.entity, id: target.id })
      : describeRef(target.note.concerns[0]);

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>
        {target.mode === 'create' ? `Add ${KIND_LABEL[kind].toLowerCase()}` : 'Edit note'}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          About {about}
        </Typography>
        <ToggleButtonGroup
          value={kind}
          exclusive
          fullWidth
          onChange={(_, v: NoteKind | null) => v && setKind(v)}
          sx={{ mb: 2 }}
        >
          {(Object.keys(KIND_LABEL) as NoteKind[]).map((k) => {
            const Icon = KIND_ICON[k];
            return (
              <ToggleButton key={k} value={k} aria-label={KIND_LABEL[k]}>
                <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                  <Icon fontSize="small" />
                  <span>{KIND_LABEL[k]}</span>
                </Stack>
              </ToggleButton>
            );
          })}
        </ToggleButtonGroup>
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={3}
          label="Note text"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </DialogContent>
      <DialogActions sx={{ justifyContent: onDelete ? 'space-between' : 'flex-end', px: 3, pb: 2 }}>
        {onDelete && (
          <Button color="error" onClick={() => setConfirmingDelete(true)}>
            Delete
          </Button>
        )}
        <Stack direction="row" spacing={1}>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!text.trim()}
            onClick={() => onSave(kind, text.trim())}
          >
            Save
          </Button>
        </Stack>
      </DialogActions>
      {onDelete && (
        <ConfirmDialog
          open={confirmingDelete}
          title="Delete this note?"
          message="This can't be undone from the app — it removes the note entirely."
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={onDelete}
        />
      )}
    </Dialog>
  );
}
