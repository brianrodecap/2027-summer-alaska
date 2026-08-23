import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

import { getStoredApiKey, setStoredApiKey } from '../../config/aiKey';
import {
  DocumentImportError,
  draftEntityFromExtraction,
  type ExtractedFields,
  extractEntityFromDocument,
  findConflictCandidate,
} from '../../model/documentImport';
import { COLLECTION_FOR_KIND, type EditKind } from '../../model/editForms';
import { transitRouteLabel } from '../../model/tripModel';
import type { Activity, Stay, Transit } from '../../model/types';
import { useEdit } from '../../state/EditContext';
import { useTripData } from '../../state/TripDataContext';

const KIND_LABEL: Record<EditKind, string> = {
  activity: 'Activity',
  stay: 'Stay',
  transit: 'Transit',
};

function labelFor(kind: EditKind, entity: Activity | Stay | Transit): string {
  if (kind === 'stay') return (entity as Stay).lodging?.name || 'Untitled stay';
  if (kind === 'transit') return transitRouteLabel(entity as Transit);
  return (entity as Activity).text || 'Untitled activity';
}

function collectionFor(
  kind: EditKind,
  data: ReturnType<typeof useTripData>['data'],
): (Activity | Stay | Transit)[] {
  return data ? (data[COLLECTION_FOR_KIND[kind]] as (Activity | Stay | Transit)[]) : [];
}

interface ImportDocumentDialogProps {
  legId: string;
  date: string;
  onClose: () => void;
}

type Status = 'idle' | 'loading' | 'error' | 'success';

// Uploads a booking document (PDF or photo), sends it to the Anthropic API for
// extraction (src/model/documentImport.ts), and hands the result to EditContext's
// openFromDraft — which opens the same EditDialog a manual "Add" uses, pre-filled, for
// human review before Save. This dialog never commits anything itself.
export function ImportDocumentDialog({ legId, date, onClose }: ImportDocumentDialogProps) {
  const { openFromDraft } = useEdit();
  const { data } = useTripData();
  const [file, setFile] = useState<File | null>(null);
  const [apiKey, setApiKey] = useState(() => getStoredApiKey() ?? '');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedFields | null>(null);
  const [conflictId, setConflictId] = useState<string | null>(null);

  const handleExtract = async () => {
    if (!file || !apiKey.trim()) return;
    setStatus('loading');
    setErrorMessage(null);
    try {
      setStoredApiKey(apiKey.trim());
      const fields = await extractEntityFromDocument(file, apiKey.trim());
      const draft = draftEntityFromExtraction(fields, legId, date);
      const existing = collectionFor(fields.kind, data);
      setConflictId(findConflictCandidate(fields.kind, draft, existing));
      setExtracted(fields);
      setStatus('success');
    } catch (err) {
      setErrorMessage(
        err instanceof DocumentImportError
          ? err.message
          : 'Something went wrong reading that document.',
      );
      setStatus('error');
    }
  };

  const handleContinue = () => {
    if (!extracted) return;
    const draft = draftEntityFromExtraction(extracted, legId, date);
    openFromDraft(extracted.kind, draft, conflictId ?? undefined);
    onClose();
  };

  const handleDownloadOriginal = () => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const conflictEntity = conflictId
    ? collectionFor(extracted?.kind ?? 'activity', data).find((e) => e._id === conflictId)
    : undefined;

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Add from a document</DialogTitle>
      <DialogContent dividers>
        {errorMessage && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErrorMessage(null)}>
            {errorMessage}
          </Alert>
        )}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Button variant="outlined" component="label" disabled={status === 'loading'}>
            {file ? file.name : 'Choose a booking PDF or photo'}
            <input
              type="file"
              hidden
              accept=".pdf,image/*"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setStatus('idle');
                setExtracted(null);
              }}
            />
          </Button>
          <TextField
            label="Anthropic API key"
            type="password"
            fullWidth
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            helperText="Kept only in this browser's local storage — never committed or sent anywhere but api.anthropic.com."
          />
          {status !== 'success' && (
            <Button
              variant="contained"
              onClick={handleExtract}
              disabled={!file || !apiKey.trim() || status === 'loading'}
              sx={{ alignSelf: 'flex-start' }}
            >
              {status === 'loading' ? <CircularProgress size={20} /> : 'Extract'}
            </Button>
          )}
          {status === 'success' && extracted && (
            <Box sx={{ p: 2, borderRadius: 1, bgcolor: 'action.hover' }}>
              <Typography variant="subtitle2">Detected: {KIND_LABEL[extracted.kind]}</Typography>
              {conflictEntity && (
                <Typography variant="body2" sx={{ mt: 1 }}>
                  This looks like it may replace an existing{' '}
                  {KIND_LABEL[extracted.kind].toLowerCase()}:{' '}
                  <strong>{labelFor(extracted.kind, conflictEntity)}</strong>.
                </Typography>
              )}
              <Button size="small" onClick={handleDownloadOriginal} sx={{ mt: 1 }}>
                Download original file
              </Button>
            </Box>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3 }}>
        <Button onClick={onClose}>Cancel</Button>
        {status === 'success' && (
          <Button variant="contained" onClick={handleContinue}>
            Continue to review
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
